// Тело бота: mineflayer + pathfinder. Ходит компаньоном, берёт и кладёт вещи в сундуки, отдаёт вещи игрокам,
// проходит порталы. Блоки не ломает и не ставит (на живом сервере это был бы гриф).
// Заходит клиентом 1.21.11: его mineflayer поддерживает полностью, сервер 26.3 пускает через ViaVersion.
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Skills, NATURAL, BUILT } = require('./skills');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('events');
const { Guard } = require('./guard');

const VERSION = process.env.TB_VERSION || '1.21.11';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

class Cancelled extends Error {}

// Пакет custom_click_action (этап настройки, id 0x08) вручную: в minecraft-data у него нет длины перед NBT,
// а сервер (ServerboundCustomClickActionPacket) читает NBT с префиксом длины - пакет от библиотеки сервер не разбирает.
const nbt = require('prismarine-nbt');
function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function clickActionPacket(id, value) {
  const named = nbt.writeUncompressed({ type: 'compound', name: '', value }, 'big');
  const anon = Buffer.concat([named.subarray(0, 1), named.subarray(3)]);   // сетевой NBT без имени корня
  const idBuf = Buffer.from(id, 'utf8');
  return Buffer.concat([varint(0x08), varint(idBuf.length), idBuf, varint(anon.length), anon]);   // проверено на стенде: без флага optional
}

class TotemBot extends EventEmitter {
  /** opts: { name, password, host, port } */
  constructor(opts) {
    super();
    this.opts = opts;
    this.bot = null;
    this.status = 'off';      // off | connecting | online
    this.mode = 'idle';       // idle | follow | task
    this.followName = '';
    this.task = '';
    this.token = 0;           // смена номера отменяет текущее задание
    this.lostReported = false;
    this.lookTarget = null;
  }

  log(text) { this.emit('log', text); }
  event(text, important = false) { this.emit('event', { text, important }); }

  start() {
    if (this.bot) return;
    this.manual = false;
    clearTimeout(this.reconnectTimer);
    const { name, host, port } = this.opts;
    this.status = 'connecting';
    this.log(`захожу на ${host}:${port} как ${name}`);
    const bot = this.bot = mineflayer.createBot({ host, port, username: name, version: VERSION, auth: 'offline', hideErrors: true });
    bot.loadPlugin(pathfinder);
    bot._client.on('show_dialog', (d) => this.onDialog(d));
    // Уши: аддон TotemVoiceAddon присылает речь игроков рядом по каналу totem:ears ([1]+ник, [2]+PCM 48 кГц, [3]).
    // Канал надо объявить серверу (minecraft:register), иначе Bukkit не пришлёт.
    bot.once('login', () => { try { bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('totem:ears') }); } catch {} });
    let heard = null;
    bot._client.on('custom_payload', (p) => {
      if (p.channel !== 'totem:ears' || !p.data || !p.data.length) return;
      const t = p.data[0];
      if (t === 1) heard = { from: p.data.subarray(1).toString('utf8'), parts: [] };
      else if (t === 2 && heard) heard.parts.push(Buffer.from(p.data.subarray(1)));
      else if (t === 3 && heard) { const h = heard; heard = null; this.emit('speech', { from: h.from, pcm: Buffer.concat(h.parts) }); }
    });
    // Отбрасывание: с 1.21.9 скорость в пакете уже в блоках за тик (minecraft-data так и раскладывает: -0.4, 0.36),
    // а mineflayer делит её ещё на 8000 по старому формату - бот не отлетал, Vulcan отмечал Velocity (стенд 15.11).
    // Обработчик ставим после входа: модули mineflayer подключаются позже createBot, и их обработчик иначе сработал бы последним.
    bot.once('login', () => bot._client.on('entity_velocity', (p) => {
      if (bot.entity && p.entityId === bot.entity.id && p.velocity && Math.abs(p.velocity.x) < 20) {
        bot.entity.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      }
    }));
    // Смена слота в руке на тот же самый - Vulcan Bad Packets C (кик с одного раза, стенд 15.11: при посадке урожая
    // mineflayer заново выбирал слот семян). Настоящий клиент такого не шлёт - отбрасываем повтор.
    {
      const raw = bot._client.write.bind(bot._client);
      let slot = -1;
      bot._client.on('held_item_slot', (p) => { slot = p.slot ?? p.slotId ?? slot; });
      const trail = [];   // для отладки: последние пакеты (TB_PACKETLOG=1 печатает их при кике)
      bot.on('kicked', () => { if (process.env.TB_PACKETLOG) console.log('последние пакеты:\n' + trail.join('\n')); });
      bot._client.write = (name, params) => {
        if (process.env.TB_PACKETLOG && !/^(position|position_look|look|flying|tick_end|keep_alive|pong)$/.test(name)) { trail.push(Date.now() % 100000 + ' ' + name + ' ' + JSON.stringify(params).slice(0, 140)); if (trail.length > 25) trail.shift(); }
        if (name === 'held_item_slot') {
          if (params.slotId === slot) return;
          slot = params.slotId;
        }
        return raw(name, params);
      };
    }

    bot.once('spawn', () => {
      this.status = 'online';
      // Сервер 26.3 тихо откатывает игрока, если тело касается стенки вплотную (физика mineflayer подводит его на
      // волосок ближе, чем считает сервер): у ступенек - десятки откатов, «на земле» сбрасывается, прыжок срывается -
      // бот «застревает на ровном месте» (стенд-копия мира 15.11: 76 откатов на одну ступеньку). Тело чуть шире -
      // останавливается за волосок до блока, как настоящий клиент.
      bot.physics.playerHalfWidth = 0.3005;
      const mv = new Movements(bot);
      // Ходит как Baritone: по дороге копает природное и подставляет под себя землю/булыжник (без этого 99 застреваний
      // за 15.11: ямы, закрытые проходы, ступенька в два блока). Ломать и ставить - только вдали от чужих построек:
      // карта (чанк застроен) + 3 блока вокруг (кэш на 30 с, pathfinder спрашивает одну клетку много раз).
      mv.canDig = true;
      for (const bl of Object.values(bot.registry.blocksByName)) if (!NATURAL.test(bl.name) || /_log$|_stem$/.test(bl.name)) mv.blocksCantBreak.add(bl.id);
      const nearBuilt = (pos) => {
        const k = pos.x + ',' + pos.y + ',' + pos.z, c = (this._builtCache = this._builtCache || new Map()), hit = c.get(k);
        if (hit && Date.now() - hit.at < 30000) return hit.v;
        if (c.size > 20000) c.clear();
        const v = this.skills.builtChunk(pos) || !!this.skills.builtNear(pos, 3);
        c.set(k, { v, at: Date.now() });
        return v;
      };
      mv.exclusionAreasBreak = [(block) => (block.position && !this.skills.mine(block.position) && nearBuilt(block.position) ? 100 : 0)];
      mv.exclusionAreasPlace = [(block) => (block.position && nearBuilt(block.position) ? 100 : 0)];
      mv.scafoldingBlocks = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'coarse_dirt', 'blackstone']
        .map((n) => bot.registry.itemsByName[n]).filter(Boolean).map((i) => i.id);
      mv.allow1by1towers = true;      // выбраться из ямы столбиком, как игрок
      mv.digCost = 2;                 // копать - дороже обхода: ломает, только когда обойти нельзя
      mv.placeCost = 2;
      mv.allowParkour = false;   // прыжки с разбега у pathfinder срываются (бот стоит перед ямой без клавиш, стенд 15.11)
      mv.allowSprinting = true;
      mv.canOpenDoors = true;
      // по образцу Baritone (maxFallHeightNoWater, blocksToAvoid, mobAvoidance, exclusionAreas)
      mv.maxDropDown = 3;
      for (const n of ['fire', 'soul_fire', 'lava', 'magma_block', 'campfire', 'soul_campfire', 'sweet_berry_bush',
        'wither_rose', 'powder_snow', 'cactus', 'pointed_dripstone']) {
        const bl = bot.registry.blocksByName[n];
        if (bl) mv.blocksToAvoid.add(bl.id);
      }
      mv.entitiesToAvoid = new Set(['creeper']);
      mv.exclusionAreasStep = [(block) => this.forbiddenCost(block)];
      // Ходьба по настоящей форме блоков (nav.js): ступеньки, плиты, кровати, ковры, люки, двери, заборы, углы по
      // диагонали - геометрией, как в игре. Заменила заплатки 15-21.11 (ковёр выше ног, диагонали, house-moves).
      require('./nav').install(mv, bot);
      this.movements = mv;
      bot.pathfinder.setMovements(mv);
      bot.pathfinder.thinkTimeout = 15000;   // путь в обход (без паркура) ищется дольше 5 с по умолчанию
      this.guard = new Guard(this);
      this.guard.mode = this.opts.combat || 'defend';
      this.guard.attach();
      require('./life').start(this);   // нужды и распорядок дня - само тело (life.js)
      this.retry = 0;
      this.log('на сервере');
      this.event('ты зашёл на сервер');
      this.loops();
    });
    bot.on('spawn', () => {
      if (this.dim && this.dim !== bot.game.dimension) {
        this.event(`ты в другом измерении: ${this.dimName()}`);
        // прошёл портал (а не умер): стоял в портале перед этим - запомнить пару «вход -> выход»
        const was = this.inPortal, fromDim = this.dim;
        if (was && Date.now() - was.at < 15000 && this.travel) {
          setTimeout(() => {
            try {
              const p = bot.entity.position;
              const exit = bot.findBlock({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 4 });
              if (exit) { this.travel.addLink(fromDim, was.pos, bot.game.dimension, exit.position); this.log(`запомнил портал: ${was.pos.x} ${was.pos.z} -> ${Math.floor(p.x)} ${Math.floor(p.z)} (${this.dimName()})`); }
            } catch {}
          }, 1500);
        }
      }
      if (this.dim && this.dim !== bot.game.dimension) this.arrivedAt = Date.now();
      this.dim = bot.game.dimension; this.inPortal = null;
    });
    bot.on('path_update', (r) => { this.lastPath = { status: r.status, path: r.path, at: Date.now() }; });
    bot.on('messagestr', (msg, pos, json, sender) => {
      if (pos === 'system' || pos === 'game_info') { this.lastSystem = (this.lastSystem || []).concat(String(msg).slice(0, 160)).slice(-10); }
      this.onMessage(msg, pos, json, sender);
    });
    // чат разбирается в onMessage (каналы по оформлению Essentials); события mineflayer chat/whisper не используем:
    // его шаблоны принимали личку «[ник -> я] текст» ещё и за общий чат
    bot.on('death', () => {
      const p = bot.entity.position;
      this.deathPoint = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim: bot.game.dimension, at: Date.now() };
      this.resumeFollow = this.followName || this.resumeFollow;
      this.log(`умер на ${this.deathPoint.x} ${this.deathPoint.y} ${this.deathPoint.z}`);
      this.ev('смерть', {});
      // опасное место: путь будет его обходить сутки (память опасности, как у мобов и NPC)
      if (this.memory) { const dd = this.memory.data.danger = (this.memory.data.danger || []).filter((x) => Date.now() - x.at < 86400000); dd.push({ ...this.deathPoint, dim: this.dimName() }); if (dd.length > 50) dd.shift(); this.memory.save(); }
      if (this.memory) this.memory.journal(this.opts.name, `умер на ${this.deathPoint.x} ${this.deathPoint.y} ${this.deathPoint.z} (${this.dimName()})`);
      this.cancel();
      // после возрождения (spawn) - забрать вещи, как waypoint смерти в Baritone
      bot.once('spawn', () => setTimeout(() => this.afterDeath().catch(() => {}), 2500));
    });
    // кто из игроков ударил: замах рукой в последние 0,6 с в 5 блоках (удар без атакующего в событии)
    // жесты игроков: удар по блоку и присед (чтобы показывать, а не диктовать координаты)
    this.gestures = new Map();   // ник -> { poke: {name,x,y,z,at}, crouch: [время...] }
    const g = (n) => { if (!this.gestures.has(n)) this.gestures.set(n, { poke: null, crouch: [] }); return this.gestures.get(n); };
    bot.on('blockBreakProgressObserved', (block, stage, entity) => {
      if (entity && entity.type === 'player' && entity.username) g(entity.username).poke = { name: block.name, x: block.position.x, y: block.position.y, z: block.position.z, at: Date.now() };
    });
    bot.on('entityCrouch', (e) => { if (e.type === 'player' && e.username) { const c = g(e.username).crouch; c.push(Date.now()); if (c.length > 6) c.shift(); } });
    // кто спит (события mineflayer по позе игрока)
    this.sleepers = new Set();
    bot.on('entitySleep', (e) => { if (e !== bot.entity) this.sleepers.add(e.id); });
    bot.on('entityWake', (e) => this.sleepers.delete(e.id));
    const swings = new Map();
    bot.on('entitySwingArm', (e) => { if (e.type === 'player') swings.set(e.username, Date.now()); });
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const who = [...swings].find(([n, t]) => Date.now() - t < 600 && bot.players[n] && bot.players[n].entity
        && bot.players[n].entity.position.distanceTo(bot.entity.position) < 5);
      if (who && Date.now() - (this.hitReported || 0) > 10000) { this.hitReported = Date.now(); this.event(`игрок ${who[0]} ударил тебя`, true); }
    });
    bot.on('kicked', (r) => { this.kickReason = this.reason(r); this.log('кикнули: ' + this.kickReason); });
    bot.on('error', (e) => this.log('ошибка: ' + e.message));
    bot.on('end', (r) => {
      this.log('отключён: ' + (r || ''));
      this.status = 'off';
      this.bot = null;
      clearInterval(this.timer);
      this.emit('end');
      const banned = /ban|бан|заблокир/i.test(this.kickReason || '');
      if (!this.manual && !banned) {
        this.retry = Math.min(120, (this.retry || 10) * 1.5);
        this.log(`переподключусь через ${Math.round(this.retry)} с`);
        this.reconnectTimer = setTimeout(() => { this.kickReason = ''; this.start(); }, this.retry * 1000);
      }
    });
  }

  stop() {
    this.manual = true;
    clearTimeout(this.reconnectTimer);
    this.cancel();
    if (this.bot) this.bot.quit();
  }

  // Причина кика приходит текстом, JSON-компонентом или NBT: собираем из неё только видимый текст
  reason(r) {
    const out = [];
    const walk = (v, key) => {
      if (typeof v === 'string') {
        if (key === 'text' || key === '' || key === 'value' || key === undefined) {
          try { if (/^[{[]/.test(v)) { walk(JSON.parse(v)); return; } } catch {}
          if (!/^(compound|string|list|byte|int)$/.test(v)) out.push(v);
        }
        return;
      }
      if (Array.isArray(v)) { v.forEach((x) => walk(x)); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!/^(type|color|bold|italic|underlined|strikethrough|obfuscated|translate)$/.test(k)) walk(x, k); }
    };
    try { walk(r); } catch {}
    const t = out.join('').replace(/§./g, '').replace(/\s+/g, ' ').trim();
    return (t || (typeof r === 'string' ? r : JSON.stringify(r))).slice(0, 300);
  }

  dimName() {
    const d = String(this.bot && this.bot.game.dimension || '');
    return /nether/.test(d) ? 'Незер' : /end/.test(d) ? 'Энд' : 'обычный мир';
  }

  // --- AuthMe и чат
  // AuthMe 6 спрашивает пароль окном ещё до входа в мир (этап настройки соединения). Заполняем все поля окна паролем
  // и жмём кнопку с «submit». Окна не от AuthMe не трогаем.
  onDialog(d) {
    const raw = JSON.stringify(d);
    if (!/authme:/i.test(raw)) { this.log('окно сервера, не от AuthMe: пропускаю'); return; }
    const ids = [...raw.matchAll(/"id":\{"type":"string","value":"(authme:[^"]+)"/g)].map((m) => m[1]);
    const submit = ids.find((i) => /submit/i.test(i));
    if (!submit) { this.log('окно AuthMe без кнопки входа: ' + ids.join(', ')); return; }
    const keys = [...raw.matchAll(/"key":\{"type":"string","value":"([^"]+)"/g)].map((m) => m[1]);
    const value = {};
    for (const k of keys) value[k] = { type: 'string', value: this.opts.password };
    this.bot._client.writeRaw(clickActionPacket(submit, value));
    this.log('ввёл пароль в окне AuthMe (' + submit + ')');
  }

  onMessage(msg, pos, json, sender) {
    if (pos === 'game_info') return;
    const text = String(msg).trim();
    if (!text) return;
    const pw = this.opts.password;
    const now = Date.now();
    // запасной вход AuthMe командой - только по сообщению сервера и только пока бот не вошёл
    // (раньше срабатывало и на «/l» в словах игроков)
    if (pos === 'system' && !this.authed) {
      if (/\/reg(ister)?\b/i.test(text) && now - (this.regAt || 0) > 10000) { this.regAt = now; this.bot.chat(`/register ${pw} ${pw}`); this.log('регистрируюсь в AuthMe'); return; }
      if (/\/l(ogin)?\b/i.test(text) && !/\/reg/i.test(text) && now - (this.loginAt || 0) > 10000) { this.loginAt = now; this.bot.chat(`/login ${pw}`); this.log('вхожу в AuthMe'); return; }
    }
    if (/successful login|успешн.*вход|вы вошли|logged-in/i.test(text)) this.authed = true;
    if (pos === 'chat') {
      // сообщение игрока: автор - по UUID отправителя. Канал - по оформлению Essentials (unsigned):
      // «[Рядом] <ник> текст» - ближний, «<ник> текст» - общий. Текст - без приставки «!» ближнего чата.
      const p = sender && Object.values(this.bot.players).find((x) => x.uuid === sender);
      const shown = json && json.unsigned ? String(json.unsigned.toString()) : '';
      const local = /^\s*\[Рядом\]/i.test(shown);
      let body = text;
      const m = /^.*?<[^>]+>\s?(.*)$/.exec(shown);
      if (m && m[1]) body = m[1];
      else if (local) body = text.replace(/^!\s*/, '');
      this.emit('chat', `${local ? '[рядом]' : '[общий]'} ${p ? p.username : '?'}: ${body}`);
      if (p) this.playerChat(p.username, body, false, local ? 'local' : 'global');
      return;
    }
    // не сообщение игрока по протоколу: личка Essentials, клановый чат SimpleClans, системное. В журнал - с каналом,
    // чтобы было видно, откуда пришло (21.11: не понять было, общий это чат или личка)
    const parsed = this.parseChat(text);
    const clan = /^\s*\[(Клан|Clan|Союз|Ally)\]/i.test(text);
    const local = /^\s*\[Рядом\]/i.test(text);
    const ch = !parsed ? 'сервер' : parsed.whisper ? 'личка' : clan ? 'клан' : local ? 'рядом' : 'общий';
    this.emit('chat', `[${ch}] ${clan ? text.replace(/^\s*\[[^\]]+\]\s*/, '') : parsed ? parsed.from + ': ' + parsed.text : text}`);
    if (parsed) this.playerChat(parsed.from, parsed.text, parsed.whisper, parsed.whisper ? 'whisper' : local ? 'local' : 'global');
  }

  playerChat(from, text, whisper, channel = whisper ? 'whisper' : 'global') {
    if (!from || from === this.opts.name || !text) return;
    const key = from + '|' + text;
    const now = Date.now();
    if (this.lastChat && this.lastChat.key === key && now - this.lastChat.at < 2000) return;   // одно сообщение двумя путями
    this.lastChat = { key, at: now };
    this.emit('player-chat', { from, text: String(text).trim(), whisper: channel === 'whisper', channel });
  }

  // Формат чата на сервере свой (префиксы, кланы, ближний чат, личка Essentials), поэтому автора ищем по нику из списка игроков
  // в «шапке» сообщения до первого «:» или «>». Личка Essentials: «[Ник -> я] текст».
  parseChat(text) {
    const names = Object.keys(this.bot.players || {}).sort((a, b) => b.length - a.length);
    const pm = /^\[?\s*([A-Za-z0-9_]{3,16})\s*(?:->|→)\s*(?:я|me|[A-Za-z0-9_]{3,16})\s*\]?\s*:?\s*(.+)$/i.exec(text);
    if (pm && names.includes(pm[1])) return { from: pm[1], text: pm[2].trim(), whisper: true };
    const sep = text.search(/[:>»]/);
    if (sep < 0) return null;
    const head = text.slice(0, sep);
    const from = names.find((n) => new RegExp(`(^|[^A-Za-z0-9_])${n}([^A-Za-z0-9_]|$)`).test(head));
    if (!from) return null;
    return { from, text: text.slice(sep + 1).trim(), whisper: false };
  }

  /** Сказать в канал: личка - /msg ник, ближний - «!текст» (TotemEssentialsAddon), общий - обычный чат. */
  /** Куда показывает игрок: блок под его взглядом (до 8 бл.), последний удар по блоку, присед за 10 с. Текстом для мозга. */
  pointing(name) {
    const b = this.bot, e = this.player(name);
    if (!b || !e) return '';
    const out = [];
    try {
      const eye = e.position.offset(0, 1.62, 0);
      const dir = new Vec3(-Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), -Math.cos(e.yaw) * Math.cos(e.pitch));
      const hit = b.world.raycast(eye, dir, 8);
      if (hit && hit.name !== 'air') out.push(`смотрит на ${hit.name} ${hit.position.x} ${hit.position.y} ${hit.position.z}`);
    } catch {}
    const gs = this.gestures && this.gestures.get(name);
    if (gs && gs.poke && Date.now() - gs.poke.at < 60000) out.push(`ударил рукой по ${gs.poke.name} ${gs.poke.x} ${gs.poke.y} ${gs.poke.z} (${Math.round((Date.now() - gs.poke.at) / 1000)} с назад)`);
    if (gs) { const n = gs.crouch.filter((t) => Date.now() - t < 10000).length; if (n) out.push(`приседал ${n} раз за 10 с`); }
    return out.join('; ');
  }

  say(text, channel = 'global', to = '') {
    if (!this.bot || this.status !== 'online') return;
    let t = String(text).replace(/^[/!]+/, '').slice(0, 240);   // своя реплика не должна стать командой
    if (!t) return;
    if (channel === 'whisper' && to) t = `/msg ${to} ${t}`;
    else if (channel === 'local') t = '!' + t;
    else if (channel === 'global') t = '/g ' + t;
    this.bot.chat(t);
  }

  // --- состояние для Qwen
  player(name) {
    const p = this.bot && this.bot.players[name];
    return p && p.entity ? p.entity : null;
  }

  state() {
    const b = this.bot;
    if (!b || this.status !== 'online' || !b.entity) return { status: this.status };
    const p = b.entity.position;
    const items = {};
    for (const it of b.inventory.items()) items[it.name] = (items[it.name] || 0) + it.count;
    const near = Object.values(b.players).filter((pl) => pl.entity && pl.username !== b.username)
      .map((pl) => ({ name: pl.username, dist: Math.round(pl.entity.position.distanceTo(p)) }))
      .filter((x) => x.dist <= 48).sort((x, y) => x.dist - y.dist);
    return {
      status: this.status, dim: this.dimName(), pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)],
      health: Math.round(b.health), food: b.food, items, near, mode: this.mode, follow: this.followName, task: this.task,
    };
  }

  // --- фоновое поведение: взгляд как у человека, еда, слежение за тем, за кем идём
  loops() {
    const b = this.bot;
    // Сервер 1.21.2+ применяет шаги игрока только после пакета «конец тика клиента», mineflayer его не шлёт:
    // без него сервер считает, что бот стоит на месте (проверено на стенде 26.3, 15.11.2026).
    // Порядок пакетов как у настоящего клиента: «конец тика» прошлого тика → действия этого тика (удар) → движение.
    // physicsTick у mineflayer вызывается до отправки движения, поэтому tick_end здесь закрывает прошлый тик, а удар
    // (guard.combatTick) уходит синхронно внутри этого тика. Без tick_end сервер 1.21.2+ не применяет шаги; удар вне
    // тика (из async-кода) Vulcan отмечал как Kill Aura / Aim (стенд 15.11, 36 отметок; после правки - ноль).
    b.on('physicsTick', () => {
      try { b._client.write('tick_end', {}); } catch {}
      this.lookTick();
      if (this.guard) this.guard.combatTick();
      // своё плавание (swim.js); не взялось (суша впереди, нет пути) - старая логика воды и выхода на берег
      if (!require('./swim').swimTick(this)) this.swimTick();
      this.waterExitTick();
    });
    this.timer = setInterval(() => this.slowTick().catch(() => {}), 1000);
  }

  lookTick() {
    const b = this.bot;
    if (!b || !b.entity || b.pathfinder.isMoving() || this.busyLook || this.mode === 'task' || (this.guard && this.guard.fighting)) return;
    const t = this.lookTarget;
    if (!t) return;
    const eye = b.entity.position.offset(0, b.entity.height * 0.9, 0);
    const d = t.minus(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z));
    let dy = yaw - b.entity.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const dp = pitch - b.entity.pitch;
    if (Math.abs(dy) < 0.02 && Math.abs(dp) < 0.02) return;
    // плавный поворот: доля пути за тик, не мгновенно
    const k = 0.18;
    b.look(b.entity.yaw + dy * k, b.entity.pitch + dp * k, true);
  }

  async slowTick() {
    const b = this.bot;
    if (!b || !b.entity) return;
    this.senseTick();
    this.handsTick().catch(() => {});
    this.reflexTick().catch(() => {});
    try { this.shoreTick(); } catch {}
    // взгляд: на того, за кем идём, иногда по сторонам
    const owner = this.followName ? this.player(this.followName) : null;
    const nearest = Object.values(b.players).filter((p) => p.entity && p.username !== b.username)
      .map((p) => p.entity).sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
    const focus = owner || (nearest && nearest.position.distanceTo(b.entity.position) < 8 ? nearest : null);
    if (Math.random() < 0.15 || !focus) {
      if (Math.random() < 0.3) this.lookTarget = b.entity.position.offset(rnd(-8, 8), rnd(0, 3), rnd(-8, 8));
    } else {
      this.lookTarget = focus.position.offset(0, focus.height * 0.9, 0);
    }
    await this.eatTick();
    this.airTick();
    this.stuckTick();
    this.sleepTick().catch(() => {});
    // в воде без дела - всплывать (держать прыжок), как игрок; иначе бот тонет
    if (!this.busyLook) {   // busyLook - бот сам ведёт движение (выход на берег, портал): не мешать прыжку
      const here = b.blockAt(b.entity.position.offset(0, 1, 0));
      const inWater = here && /water|kelp|seagrass|bubble_column/.test(here.name);
      if (inWater && !b.pathfinder.isMoving()) { b.setControlState('jump', true); this.swimming = true; }
      else if (this.swimming) { b.setControlState('jump', false); this.swimming = false; }
    }
    this.notice().catch(() => {});
    if (this.travel && this.travel.trails) {
      const { dkey } = require('./travel');
      const d = dkey(b.game.dimension), at = b.blockAt(b.entity.position);
      this.trailState = this.trailState || {};
      if (b.entity.onGround && at && !/water|lava|nether_portal/.test(at.name)) this.travel.trails.step(d, b.entity.position, this.trailState);
      else if (at && /nether_portal/.test(at.name)) this.travel.trails.forget(this.trailState);
      if ((this._trSave = (this._trSave || 0) + 1) % 30 === 0) this.travel.trails.save(d);
    }
    // в портале после перехода не стоять - затянет обратно (16.11: «сколько раз говорил!!!»); только если не заходим нарочно
    {
      const at = b.blockAt(b.entity.position);
      if (at && at.name === 'nether_portal' && !this.portalTask && Date.now() - (this.arrivedAt || 0) > 1500 && Date.now() - (this.portalStepAt || 0) > 4000) {
        this.portalStepAt = Date.now();
        const p0 = b.entity.position.floored();
        const out = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => p0.offset(dx, 0, dz))
          .find((v) => { const f = b.blockAt(v), h = b.blockAt(v.offset(0, 1, 0)), u = b.blockAt(v.offset(0, -1, 0)); return f && h && u && f.boundingBox === 'empty' && f.name !== 'nether_portal' && h.boundingBox === 'empty' && u.boundingBox === 'block' && !/lava/.test(f.name); });
        if (out) { this.log('стою в портале - отхожу, чтобы не затянуло'); const was = b.pathfinder.goal; b.pathfinder.setGoal(new goals.GoalBlock(out.x, out.y, out.z)); if (was && this.mode === 'follow') setTimeout(() => { try { if (this.mode === 'follow' && this.followName) this.follow(this.followName); } catch {} }, 1500); }
      }
    }
    // инвентарь полон - сказать мозгу один раз (16.11: не брал шерсть, и никто не понимал почему)
    {
      const full = b.inventory.emptySlotCount() === 0;
      if (full && !this.fullSaid) { this.fullSaid = true; this.event('инвентарь полон: подобрать ничего не можешь - выложи лишнее в сундук (!putInChest) или выброси (!discard)', true); }
      else if (!full) this.fullSaid = false;
    }
    // компаньон: потерял из виду - сказать один раз
    if (this.mode === 'follow') {
      if (!owner) {
        if (!this.lostReported) { this.lostReported = true; this.event(`ты потерял из виду ${this.followName} (далеко или в другом измерении)`, true); }
      } else if (this.lostReported) {
        this.lostReported = false;
        b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true);
      }
    }
  }

  // Еда по образцу Meteor AutoEat: чёрный список (вредное и хорус - телепортирует), лучшее по сытости и насыщению.
  // Голод < 14 - есть; здоровье неполное и голод < 18 вне боя - доесть для лечения.
  // Золотое яблоко (AutoGap): opts.gapple = 'emergency' (по умолчанию: бой и здоровье <= 8) или 'never'.
  async eatTick() {
    const b = this.bot;
    if (this.eating || !b.registry.foodsByName) return;
    const BAD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew',
      'chicken', 'golden_apple', 'enchanted_golden_apple']);
    const fighting = this.guard && this.guard.fighting;
    let pick = null;
    if ((this.opts.gapple || 'emergency') === 'emergency' && fighting && b.health <= 8) {
      pick = b.inventory.items().find((i) => i.name === (b.health <= 4 ? 'enchanted_golden_apple' : 'golden_apple'))
        || b.inventory.items().find((i) => /golden_apple$/.test(i.name));
    }
    const hungry = b.food < 14 || (b.health < 20 && b.food < 18 && !fighting);
    if (!pick && hungry && b.food < 20) {
      const score = (i) => { const f = b.registry.foodsByName[i.name]; return f ? f.foodPoints + f.saturation : -1; };
      pick = b.inventory.items().filter((i) => b.registry.foodsByName[i.name] && !BAD.has(i.name)).sort((x, y) => score(y) - score(x))[0];
      // совсем голодно и нормальной еды нет - гнилая плоть лучше голодной смерти
      if (!pick && b.food <= 6) pick = b.inventory.items().find((i) => i.name === 'rotten_flesh');
    }
    if (!pick) return;
    this.eating = true;
    try { await this.eatNow(pick); this.log('съел ' + pick.name); } catch (e) { this.log('не смог поесть: ' + e.message); } finally { this.eating = false; }
  }

  // Сторож застревания (Baritone: movementTimeoutTicks): путь идёт, а бот 5 с почти на месте -
  // прыжок и шаг назад, путь заново; три раза подряд - сообщить мозгу.
  stuckTick() {
    const b = this.bot;
    if (!b.pathfinder.isMoving()) { this.stuck = null; return; }
    const p = b.entity.position;
    if (!this.stuck || p.distanceTo(this.stuck.at) > 1) { this.stuck = { at: p.clone(), since: Date.now(), tries: this.stuck ? this.stuck.tries : 0 }; return; }
    if (Date.now() - this.stuck.since < 5000) return;
    this.stuck.tries++;
    this.stuck.since = Date.now();
    // запись для разбора: цель, сколько до неё, следующие шаги пути, блоки вокруг
    {
      const g = b.pathfinder.goal, lp = this.lastPath || {};
      const gp = g && (g.entity ? g.entity.position : (g.x !== undefined ? new Vec3(g.x, g.y !== undefined ? g.y : p.y, g.z) : null));
      const fl = p.floored(), around = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) around.push(`${dx},${dz}:${(b.blockAt(fl.offset(dx, 0, dz)) || {}).name}/${(b.blockAt(fl.offset(dx, 1, dz)) || {}).name}`);
      this.log(`застрял: я ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}, цель ${g ? g.constructor.name : 'нет'}${gp ? ' до неё ' + gp.distanceTo(p).toFixed(1) : ''}, путь ${lp.status || '?'} ${(lp.path || []).slice(0, 3).map((n) => `${Math.floor(n.x)},${Math.floor(n.y)},${Math.floor(n.z)}`).join(' ')}, под ногами ${(b.blockAt(fl.offset(0, -1, 0)) || {}).name}, вокруг ${around.join(' ')}, земля ${b.entity.onGround}`);
    }
    this.log('застрял, пробую выбраться (' + this.stuck.tries + ')');
    this.ev('застрял', { tries: this.stuck.tries, goal: b.pathfinder.goal ? b.pathfinder.goal.constructor.name : '' });
    // водоросли и трава в воде держат тело («застрял в водорослях», 15.11): срезать их вокруг - ломаются мгновенно, природное
    {
      const fl = p.floored(), weeds = [];
      for (let dy = 0; dy <= 1; dy++) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = b.blockAt(fl.offset(dx, dy, dz));
        if (k && /^(kelp|kelp_plant|seagrass|tall_seagrass|short_grass|tall_grass|fern|large_fern|vine)$/.test(k.name)) weeds.push(k);
      }
      if (weeds.length) {
        this.log('срезаю водоросли и траву вокруг: ' + weeds.length);
        (async () => { for (const k of weeds.slice(0, 6)) { try { await b.dig(k, true); } catch {} } try { if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} })();
        return;
      }
    }
    // в воде - как игрок: вперёд с прыжком (выплыть на уступ); на суше - прыжок и шаг назад
    const feetW = b.blockAt(b.entity.position);
    const swim = feetW && /water/.test(feetW.name);
    // над головой блок - прыгать бесполезно (удар о потолок Vulcan видит как Jump C): только шаг назад
    const head = b.blockAt(b.entity.position.offset(0, 2.2, 0));
    if (!swim && head && head.boundingBox === 'block') { b.setControlState('back', true); setTimeout(() => { try { b.setControlState('back', false); if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 400); return; }
    const dir = swim ? 'forward' : 'back';
    b.setControlState('jump', true);
    b.setControlState(dir, true);
    setTimeout(() => { try { b.setControlState('jump', false); b.setControlState(dir, false); /* новый путь к той же цели (setGoal оборвал бы текущий переход: «goal was changed») */ if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 400);
    if (this.stuck.tries === 3 && Date.now() - (this.stuckSaidAt || 0) > 180000) { this.stuckSaidAt = Date.now(); this.event('ты застрял и не можешь пройти дальше (тело пробует выбраться само; писать об этом в чат не нужно)', true); }
  }

  // Сон: на сервере ночь пропускается, когда спят все не-AFK. Кто-то лёг, ночь, кровать в 16 блоках - ложимся.
  // Утром mineflayer будит сам; кровать запоминаем (Baritone doBedWaypoints).
  async sleepTick() {
    const b = this.bot;
    if (this.opts.sleep === false || b.isSleeping || this.mode === 'task' || this.sleepTry > Date.now()) return;
    const t = b.time && b.time.timeOfDay;
    const night = t !== undefined && t >= 12542 && t <= 23460;
    if (!night && !b.thunderState) return;
    const someoneSleeps = [...(this.sleepers || [])].some((id) => b.entities[id] && b.entities[id].type === 'player');
    if (!someoneSleeps) return;
    if (this.guard && this.guard.fighting) return;
    const bed = b.findBlock({ matching: (bl) => /_bed$/.test(bl.name), maxDistance: 16 });
    if (!bed) { this.sleepTry = Date.now() + 60000; return; }
    this.sleepTry = Date.now() + 30000;
    try {
      await this.toBed(bed, this.token, 20000);
      await b.sleep(bed);
      this.log('лёг спать');
      if (this.memory) this.memory.place({ name: `кровать у ${bed.position.x} ${bed.position.z}`, x: bed.position.x, y: bed.position.y, z: bed.position.z, dim: this.dimName(), note: 'спал тут' }, this.opts.name);
      b.once('wake', () => { this.log('проснулся'); if (this.followName && this.player(this.followName)) this.follow(this.followName); });
    } catch (e) { this.log('не смог лечь: ' + e.message); }
  }

  // Запретные места: в памяти место с пометкой «нельзя», «чужая», «не заходить» - путь обходит 16 блоков вокруг
  forbiddenCost(block) {
    if (!block || !block.position) return 0;
    // опасный пол (магма, костёр) - pathfinder смотрит только блоки на уровне тела
    // с запасом в блок: на углу бот срезает диагональ и цепляет край
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const floor = this.bot.blockAt(block.position.offset(dx, -1, dz), false);
      if (floor && /^(magma_block|campfire|soul_campfire)$/.test(floor.name)) return dx || dz ? 20 : 100;
    }
    const m = this.memory;
    if (!m) return 0;
    const dim = this.dimName();
    // где недавно погиб - обходить, если есть другой путь (дороже, но не запрещено)
    for (const x of m.data.danger || []) if (x.dim === dim && Date.now() - x.at < 86400000 && Math.abs(x.x - block.position.x) < 5 && Math.abs(x.z - block.position.z) < 5 && Math.abs(x.y - block.position.y) < 5) return 25;
    if (!this.forbidden || this.forbidden.version !== m.version) {
      this.forbidden = { version: m.version, list: Object.values(m.data.places).filter((p) => /нельзя|чуж|не заход|запрет/i.test(p.name + ' ' + (p.note || ''))) };
    }
    for (const p of this.forbidden.list) {
      if (p.dim === dim && Math.abs(p.x - block.position.x) < 16 && Math.abs(p.z - block.position.z) < 16) return 100;
    }
    return 0;
  }

  // Сам замечает и запоминает: порталы рядом, новых игроков. Раз в 10 с, дёшево.
  async notice() {
    const b = this.bot, m = this.memory;
    if (!m || !b || !b.entity) return;
    const t = Date.now();
    if (t - (this.noticedAt || 0) < 10000) return;
    this.noticedAt = t;
    const me = b.entity.position, dim = this.dimName();
    const portal = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 24 });
    if (portal) {
      const p = portal.position;
      const known = Object.values(m.data.places).some((x) => x.dim === dim && Math.hypot(x.x - p.x, x.y - p.y, x.z - p.z) < 12);
      if (!known) {
        const r = m.place({ name: `портал ${dim === 'Незер' ? 'в Незере' : 'в обычном мире'} ${p.x} ${p.z}`, x: p.x, y: p.y, z: p.z, dim, note: 'нашёл сам' }, this.opts.name);
        this.log(r);
        this.event(`ты нашёл портал в Незер: ${p.x} ${p.y} ${p.z} (${dim}), запомнил`, false);
      }
    }
    this.met = this.met || new Set();
    for (const pl of Object.values(b.players)) {
      if (!pl.entity || pl.username === b.username || this.met.has(pl.username)) continue;
      if (pl.entity.position.distanceTo(me) > 16) continue;
      this.met.add(pl.username);
      const where = m.nearestPlace(me, dim);
      m.journal(this.opts.name, `встретил ${pl.username}${where ? ' у места «' + where.name + '»' : ''}`);
    }
  }

  // Чутьё раз в секунду, дёшево: стоит ли в портале (для пар порталов), где видел игроков (радар Xaero, но с памятью),
  // и заметные перемены (ночь, утро, дождь, знакомый снова рядом) - мозгу как «момент», он сам решит, реагировать ли.
  senseTick() {
    const b = this.bot, me = b.entity.position, now = Date.now(), dim = this.dimName();
    try {
      const at = b.blockAt(me);
      if (at && at.name === 'nether_portal') this.inPortal = { pos: { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) }, at: now };
    } catch {}
    this.seen = this.seen || {};
    this.closeAt = this.closeAt || {};
    for (const pl of Object.values(b.players)) {
      if (!pl.entity || pl.username === b.username) continue;
      const p = pl.entity.position;
      this.seen[pl.username] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim, at: now };
      if (p.distanceTo(me) <= 16) {
        const last = this.closeAt[pl.username];
        if (last && now - last > 10 * 60000) this.emit('moment', { kind: 'встреча:' + pl.username, who: pl.username, text: `${pl.username} снова рядом (не виделись ${Math.round((now - last) / 60000)} мин)` });
        if (!last) this.closeAt[pl.username] = now - 1;   // первая встреча за сеанс - без «снова»
        this.closeAt[pl.username] = now;
      }
    }
    const t = b.time && b.time.timeOfDay;
    if (t !== undefined) {
      const night = t >= 13000 && t < 23000;
      if (this.wasNight !== undefined && night !== this.wasNight) this.emit('moment', night ? { kind: 'ночь', text: 'стемнело, наступает ночь' } : { kind: 'утро', text: 'рассвело' });
      this.wasNight = night;
    }
    const rain = !!this.precip();
    if (this.wasRain !== undefined && rain && !this.wasRain) this.emit('moment', { kind: 'дождь', text: (this.precip() === 'снег' ? 'пошёл снег' : 'пошёл дождь') + (b.thunderState > 0.3 ? ', гроза' : '') });
    this.wasRain = rain;
  }

  /** Как игрок: в основной руке - оружие или инструмент, а не тотем и не случайный блок; тотем - во второй руке. */
  async handsTick() {
    const b = this.bot;
    if (this.mode === 'task' || this.busyLook || this.eating || (this.guard && this.guard.fighting)) return;
    if (Date.now() - (this.handsAt || 0) < 15000) return;
    this.handsAt = Date.now();
    const items = b.inventory.items();
    const off = b.inventory.slots[45];
    const totem = items.find((i) => i.name === 'totem_of_undying');
    if (totem && (!off || off.name !== 'totem_of_undying')) { await b.equip(totem, 'off-hand'); return; }
    const held = b.heldItem;
    const W = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe'];
    const best = W.map((n) => items.find((i) => i.name === n)).find(Boolean);
    const odd = held && !W.includes(held.name) && !/pickaxe|shovel|_axe|hoe|fishing_rod|shield|bow|crossbow|trident|mace|spear/.test(held.name);
    if (best && (!held || odd)) { await b.equip(best, 'hand'); return; }
    if (!best && odd) { try { await b.unequip('hand'); } catch {} }
  }

  /** Надеть или взять в руку: броня - на тело, щит и тотем - во вторую руку, остальное - в основную. */
  async equipItem(a) {
    const b = this.bot, q = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const it = b.inventory.items().find((i) => i.name === q) || b.inventory.items().find((i) => i.name.includes(q));
    if (!it) throw new Error(`нет в инвентаре: ${q}`);
    const dest = /_helmet$|turtle_helmet/.test(it.name) ? 'head' : /_chestplate$|^elytra$/.test(it.name) ? 'torso' : /_leggings$/.test(it.name) ? 'legs' : /_boots$/.test(it.name) ? 'feet' : /^(shield|totem_of_undying)$/.test(it.name) ? 'off-hand' : 'hand';
    await b.equip(it, dest);
    this.handsAt = Date.now() + 120000;   // сам выбрал, что держать - порядок в руках пока не трогает
    return `надел/взял ${it.name}`;
  }

  /**
   * Съесть предмет, как игрок: взять в руку, держать «использовать» ~1,8 с, отпустить. bot.consume() на 26.3 через
   * ViaVersion часто не дожидается ответа сервера (Promise timed out при 8 здоровья, 15.11). Успех - предмета стало
   * меньше или еда выросла. Две попытки.
   */
  async eatNow(it) {
    const b = this.bot;
    const count = () => b.inventory.items().filter((i) => i.name === it.name).reduce((s, i) => s + i.count, 0);
    for (let t = 0; t < 2; t++) {
      const before = count(), food = b.food;
      await b.equip(it, 'hand');
      await sleep(100);
      b.activateItem(false);
      const long = it.name === 'dried_kelp' ? 1000 : 1700;
      for (let w = 0; w < (long + 1500) / 100; w++) { await sleep(100); if (count() < before || b.food > food) break; }
      try { b.deactivateItem(); } catch {}
      if (count() < before || b.food > food) return;
      await sleep(300);
    }
    throw new Error(`не съелось ${it.name}`);
  }

  /** Поесть: названное или лучшее из того, что есть. */
  async eatItem(a) {
    const b = this.bot;
    const foods = b.registry.foodsByName || {};
    const q = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const BAD = /rotten_flesh|spider_eye|poisonous_potato|pufferfish|chorus_fruit|suspicious_stew|raw_chicken|chicken$/;
    const it = q ? b.inventory.items().find((i) => i.name === q)
      : b.inventory.items().filter((i) => foods[i.name] && !BAD.test(i.name)).sort((x, y) => (foods[y.name].foodPoints || 0) - (foods[x.name].foodPoints || 0))[0];
    if (!it) throw new Error(q ? `нет в инвентаре: ${q}` : 'нечего есть');
    if (!foods[it.name]) throw new Error(`${it.name} не едят${it.name === 'kelp' ? ' (сырую ламинарию нельзя: сначала пожарить в печи -> dried_kelp)' : ''}`);
    if (b.food >= 20 && !/golden_apple/.test(it.name)) return 'не голоден';
    this.eating = true;
    try { await this.eatNow(it); } finally { this.eating = false; }
    return `съел ${it.name}`;
  }

  /** Команда сервера как у обычного игрока. Входа/пароля не касается (AuthMe - сам). */
  async serverCommand(a) {
    let t = String(a.text || '').trim();
    if (!t) throw new Error('пустая команда');
    if (!t.startsWith('/')) t = '/' + t;
    if (/^\/(login|l|register|reg|changepassword|cp|unregister|email|logout)\b/i.test(t)) throw new Error('эту команду не пишу');
    const before = this.lastSystem || [];
    this.lastSystem = [];
    this.bot.chat(t.slice(0, 250));
    await sleep(1500);
    const reply = (this.lastSystem || []).slice(-3).join(' | ');
    this.lastSystem = before.concat(this.lastSystem).slice(-10);
    return `${t}${reply ? ': сервер ответил: ' + reply.slice(0, 200) : ''}`;
  }

  /** Напасть на моба (не игрока): честный бой guard. */
  async attackMob(a, tok) {
    const b = this.bot, kind = String(a.mob || '').toLowerCase().replace(/^minecraft:/, '');
    const me = b.entity.position;
    const t = Object.values(b.entities).filter((e) => e.type !== 'player' && e.isValid && e !== b.entity && (!kind || (e.name || '') === kind || (e.name || '').includes(kind)) && e.position.distanceTo(me) < 32)
      .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
    if (!t) throw new Error(`рядом нет ${kind || 'мобов'}`);
    if (!this.guard) throw new Error('бой выключен');
    const was = this.guard.mode; if (was === 'off') this.guard.mode = 'defend';
    this.guard.prey = t.id;
    const until = Date.now() + 40000;
    try {
      while (t.isValid && Date.now() < until) {
        this.check(tok);
        if (t.position.distanceTo(b.entity.position) > 2.5) { try { await this.goto(new goals.GoalFollow(t, 2), tok, 4000); } catch (e) { if (e instanceof Cancelled) throw e; } }
        await sleep(250);
      }
    } finally { this.guard.prey = null; this.guard.mode = was; try { b.pathfinder.setGoal(null); } catch {} }
    await this.pickup({ radius: 6 }, tok).catch(() => {});
    return t.isValid ? `не добил ${t.name}` : `убил ${t.name}`;
  }

  /** Подойти к кровати вплотную (сервер пускает лечь только в ~2 блоках: «the bed is too far» с GoalNear 2 по диагонали и через этаж). */
  async toBed(bed, tok, ms) {
    const b = this.bot;
    // вплотную к кровати (соседняя клетка): «видеть» её мало - сквозь стену и с другого этажа сервер не даёт лечь (21.11)
    try { await this.goto(new goals.GoalGetToBlock(bed.position.x, bed.position.y, bed.position.z), tok, ms); }
    catch (e) { if (e instanceof Cancelled) throw e; await this.goto(new goals.GoalLookAtBlock(bed.position, b.world, { reach: 2 }), tok, ms); }
  }

  /** Лечь спать в кровать рядом (ночью или в грозу). */
  async goSleep(tok) {
    const b = this.bot;
    const bed = b.findBlock({ matching: (bl) => /_bed$/.test(bl.name), maxDistance: 32 });
    if (!bed) throw new Error('рядом нет кровати');
    const t = b.time && b.time.timeOfDay;
    if (t !== undefined && !(t >= 12542 && t <= 23460) && !b.thunderState) throw new Error('сейчас день - спать можно только ночью или в грозу');
    await this.toBed(bed, tok, 60000);
    await b.sleep(bed);
    return 'лёг спать';
  }

  /**
   * Рефлексы (как modes в Mindcraft), без нейросети: огонь/лава - выйти на безопасное; игрок вплотную - отойти;
   * темно и есть факелы - поставить; вещи рядом - подобрать. Только когда бот не занят заданием (кроме огня).
   */
  async reflexTick() {
    const b = this.bot, e = b.entity, now = Date.now();
    if (!e || this.busyLook) return;
    const p = e.position, feet = b.blockAt(p), under = b.blockAt(p.offset(0, -0.5, 0));
    const burning = (e.metadata && (e.metadata[0] & 0x01)) || (feet && /fire|lava/.test(feet.name)) || (under && /magma_block|campfire/.test(under.name));
    if (burning && now - (this.fireAt || 0) > 3000) {
      this.fireAt = now;
      const water = b.findBlock({ matching: (bl) => bl.name === 'water', maxDistance: 8 });
      let safe = water ? water.position : null;
      if (!safe) {
        for (let r = 2; r <= 6 && !safe; r++) for (let a = 0; a < 8 && !safe; a++) {
          const v = p.offset(Math.round(Math.cos(a * Math.PI / 4) * r), 0, Math.round(Math.sin(a * Math.PI / 4) * r)).floored();
          const f = b.blockAt(v), u = b.blockAt(v.offset(0, -1, 0)), h = b.blockAt(v.offset(0, 1, 0));
          if (f && h && u && f.boundingBox === 'empty' && h.boundingBox === 'empty' && u.boundingBox === 'block' && !/fire|lava/.test(f.name) && !/magma|lava|campfire/.test(u.name)) safe = v;
        }
      }
      if (safe) { this.log('горю - ухожу ' + (water ? 'в воду' : 'из огня')); try { b.pathfinder.setGoal(new goals.GoalNear(safe.x, safe.y, safe.z, 0)); } catch {} }
      return;
    }
    if (this.mode === 'task') return;
    // игрок вплотную (стоит в нас) - шаг в сторону, как живой
    if (this.mode === 'idle' && now - (this.elbowAt || 0) > 4000) {
      const close = Object.values(b.players).find((pl) => pl.entity && pl.username !== b.username && pl.entity.position.distanceTo(p) < 0.9);
      if (close) { this.elbowAt = now; try { b.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalNear(close.entity.position.x, close.entity.position.y, close.entity.position.z, 2))); setTimeout(() => { try { if (this.mode === 'idle') b.pathfinder.setGoal(null); } catch {} }, 1500); } catch {} return; }
    }
    // темно (свет блоков <= 2, неба нет) и есть факелы - поставить под ноги рядом, не у чужих построек
    if (now - (this.torchAt || 0) > 15000 && feet && (feet.light || 0) <= 2 && (feet.skyLight || 0) <= 2 && b.inventory.items().some((i) => i.name === 'torch')) {
      this.torchAt = now;
      if (!this.skills.builtNear(p.floored(), 6)) this.skills.place({ block: 'torch' }, this.token).then(() => this.log('поставил факел - темно')).catch(() => {});
      return;
    }
    // вещи на земле рядом - подобрать (стоит без дела)
    if (this.mode === 'idle' && now - (this.lootAt || 0) > 10000) {
      const drop = Object.values(b.entities).find((x) => x.name === 'item' && x.position && x.position.distanceTo(p) < 5);
      if (drop) { this.lootAt = now; this.pickup({ radius: 5 }, this.token).catch(() => {}); }
    }
  }

  /** Где последний раз видел игроков (по запросу мозга). */
  seenText() {
    const now = Date.now();
    const list = Object.entries(this.seen || {}).filter(([n]) => n !== this.opts.name).sort((a, c) => c[1].at - a[1].at).slice(0, 15)
      .map(([n, s]) => `${n}: ${s.x} ${s.y} ${s.z} (${s.dim}), ${now - s.at < 5000 ? 'сейчас' : Math.round((now - s.at) / 60000) + ' мин назад'}`);
    return list.join('; ') || 'пока никого не видел';
  }

  // Дальний путь: план (пешком или через Незер) и исполнение по шагам. Цель - место из памяти или координаты.
  async travelTo(a, tok) {
    const b = this.bot;
    if (!this.travel) throw new Error('нет модуля путей');
    let dest;
    if (a.place) {
      const pl = this.memory && this.memory.findPlace(a.place);
      if (!pl) throw new Error(`не знаю места «${a.place}»`);
      dest = { x: pl.x, y: pl.y, z: pl.z, dim: pl.dim, name: pl.name };
    } else {
      if (a.x === undefined || a.z === undefined) throw new Error('куда? нужны x и z или место');
      dest = { x: +a.x, y: a.y !== undefined ? +a.y : null, z: +a.z, dim: a.dim || this.dimName() };
    }
    const plan = this.travel.plan(b.entity.position, b.game.dimension, dest);
    if (plan.error) throw new Error(plan.error);
    this.log('путь: ' + plan.text);
    this.event('путь: ' + plan.text, false);
    const legTime = (d) => Math.max(120000, d / 3 * 1500);   // ~3 бл./с с запасом
    for (const s of plan.steps) {
      this.check(tok);
      const d = Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z);
      if (s.do === 'portal') await this.portal(s, tok);
      else if (s.do === 'find_portal') {
        await this.goto(new goals.GoalNearXZ(s.x, s.z, 6), tok, legTime(d));
        const pb = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 40 });
        if (!pb) throw new Error(`у ${s.x} ${s.z} (${this.dimName()}) портала нет - выход надо построить`);
        await this.portal(pb.position, tok);
      } else await this.walkTo(s, tok, legTime(d));
    }
    const p = b.entity.position;
    return `дошёл${dest.name ? ' до «' + dest.name + '»' : ''} (${plan.text}), теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, ${this.dimName()}`;
  }

  /**
   * Дойти до точки: далеко (40+ бл.) и есть знакомая тропа - по ней, отрезками от точки к точке (как по веткам метро,
   * чанки по пути загружены); тропы нет - напрямик, как раньше.
   */
  async walkTo(s, tok, ms = 300000) {
    const b = this.bot, me = b.entity.position;
    const goal = s.y === null || s.y === undefined ? new goals.GoalNearXZ(s.x, s.z, 2) : new goals.GoalNear(s.x, s.y, s.z, 2);
    if (this.travel && this.travel.trails && Math.hypot(s.x - me.x, s.z - me.z) > 40) {
      const { dkey } = require('./travel');
      const d = dkey(b.game.dimension);
      const r = this.travel.trails.route(d, me, { x: s.x, y: s.y ?? me.y, z: s.z });
      if (r && r.len < Math.hypot(s.x - me.x, s.z - me.z) * 2.5) {
        this.log(`иду по знакомой тропе: ${r.points.length} точек, ${Math.round(r.len)} бл.`);
        const until = Date.now() + ms;
        // точки через одну-две (по ~12 бл.), последнюю - обязательно
        const pts = r.points.filter((_, i) => i % 2 === 0 || i === r.points.length - 1);
        for (const p of pts) {
          this.check(tok);
          if (Math.hypot(p.x - b.entity.position.x, p.z - b.entity.position.z) < 3) continue;
          try { await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, Math.max(20000, until - Date.now())); }
          catch (e) { if (e instanceof Cancelled) throw e; this.log('с тропы сбился: ' + e.message.slice(0, 80) + ' - дальше разведкой'); break; }
        }
      }
    }
    // до 160 бл. (в прорисовке) - сначала обычная ходьба: модуль сам находит путь по загруженному; не вышло или
    // дальше - разведка: тело прокладывает путь отрезками (scout.js), пройденное станет тропой
    const far = Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z);
    if (far > 48) {
      let done = false;
      if (far <= 160) { try { await this.goto(goal, tok, Math.min(ms, 90000)); done = true; } catch (e) { if (e instanceof Cancelled) throw e; this.log('напрямую не дошла: ' + String(e.message).slice(0, 80) + ' - разведка'); } }
      if (done) return;
      await require('./scout').explore(this, s.x, s.z, tok, ms);
    }
    await this.goto(goal, tok, ms);
  }

  // --- действия
  cancel() {
    this.token++;
    this.mode = this.paused ? 'paused' : 'idle';
    this.task = '';
    this.followName = '';
    if (this.bot) { try { this.bot.pathfinder.setGoal(null); this.bot.clearControlStates(); } catch {} }
  }

  /** Полная пауза (кнопка в панели): бросить дело, стоять, ничего не начинать самой. Рефлексы (еда, отбиться,
   *  не утонуть) работают - иначе бот умрёт, пока стоит. Снять паузу - вернуться к следованию, если шла за кем-то. */
  setPaused(on) {
    if (on && !this.paused) {
      this.pausedFollow = this.followName || '';
      this.cancel();
      this.paused = true; this.mode = 'paused'; this.task = 'пауза';
      this.log('пауза: дела брошены, стою; отбиваюсь и ем, если надо');
    } else if (!on && this.paused) {
      this.paused = false;
      if (this.mode === 'paused') { this.mode = 'idle'; this.task = ''; }
      const f = this.pausedFollow; this.pausedFollow = '';
      if (f && this.player(f)) { this.log('пауза снята - снова иду за ' + f); try { this.follow(f); } catch {} }
      else this.log('пауза снята');
    }
  }

  check(tok) { if (tok !== this.token) throw new Cancelled('отменено'); }
  isCancel(e) { return e instanceof Cancelled; }
  get skills() { return this._skills || (this._skills = new Skills(this)); }

  async goto(goal, tok, timeoutMs = 120000) {
    const b = this.bot;
    const until = Date.now() + timeoutMs;
    // бой (отбежать от крипера, отступить к хозяину) перехватывает путь - после него идти дальше, до 6 раз
    // сторож: 20 с без приближения к цели хотя бы на блок - пути отсюда нет, бросить (бот упирался в корпус корабля)
    const gx = goal.x !== undefined ? goal.x : goal.entity ? null : null, gz = goal.z;
    let bestD = Infinity, bestAt = Date.now();
    const far = () => (gx === undefined || gx === null ? 0 : Math.hypot(b.entity.position.x - gx, b.entity.position.z - gz));
    for (let attempt = 0; ; attempt++) {
      let timer, watch;
      try {
        await Promise.race([
          b.pathfinder.goto(goal),
          new Promise((_, rej) => { watch = setInterval(() => {
            const d = far(); if (!d) return;
            if (d < bestD - 1) { bestD = d; bestAt = Date.now(); }
            else if (Date.now() - bestAt > 20000) rej(new Error(`отсюда не подойти: 20 с без приближения, осталось ${Math.round(d)} бл. (путь закрыт - выбери другое)`));
          }, 1000); }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('не дошёл за отведённое время')), Math.max(1000, until - Date.now())); }),
        ]);
        // модуль пути считает «дошёл», если не смог построить ни одного шага (пустой путь) - проверить самим:
        // 21.11 «пришёл к месту «мой дом»» за 0,06 с, стоя за 150 бл., и бот радовался, что дома
        if (goal.isEnd && goal.x !== undefined && !goal.entity && !goal.isEnd(b.entity.position.floored())) {
          const left = Math.round(Math.hypot((goal.x ?? b.entity.position.x) - b.entity.position.x, (goal.z ?? b.entity.position.z) - b.entity.position.z));
          if (attempt < 1 && left > 2) { this.log(`путь пустой, до цели ${left} бл. - пробую ещё раз`); await sleep(400); continue; }
          throw new Error(`не дошёл: путь не строится, до цели ${left} бл.`);
        }
        break;
      } catch (e) {
        this.check(tok);
        // путь оборвался в воде (pathfinder не умеет вылезать на уступ) - вылезти самому и продолжить
        const feet = b.blockAt(b.entity.position);
        if (feet && /water|kelp|seagrass/.test(feet.name) && attempt < 5 && Date.now() < until && !/goal was changed/i.test(e.message)) {
          const g = goal.x !== undefined ? goal : null;
          const ledge = this.ledgeNear(5, g);
          if (ledge) {
            if (await this.climbOut(ledge)) { this.log('вылез из воды, продолжаю путь'); continue; }
            (this.badShore = this.badShore || []).push({ v: ledge.offset(0, -1, 0), at: Date.now() });   // в следующий раз - другой уступ
          }
        }
        if (!/goal was changed/i.test(e.message) || attempt >= 5 || Date.now() > until) throw e;
        for (let i = 0; i < 30 && this.guard && (this.guard.fighting || this.guard.fleeing); i++) { await sleep(1000); this.check(tok); }
        this.log('продолжаю путь');
      } finally { clearTimeout(timer); clearInterval(watch); }
    }
    this.check(tok);
  }

  follow(name) {
    const e = this.player(name);
    this.cancel();
    if (!e) return `не вижу ${name} рядом`;
    this.mode = 'follow';
    this.followName = name;
    this.lostReported = false;
    this.bot.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true);
    return `иду за ${name}`;
  }

  /** Таблички рядом (8 блоков): текст с обеих сторон. */
  readSigns() {
    const b = this.bot, out = [];
    for (const p of b.findBlocks({ matching: (bl) => /_sign$/.test(bl.name), maxDistance: 8, count: 20 })) {
      const k = b.blockAt(p);
      let t = '';
      try { const st = k.getSignText ? k.getSignText() : []; t = (Array.isArray(st) ? st : [st]).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '); } catch {}
      if (t) out.push(`${p.x} ${p.y} ${p.z}: «${t}»`);
    }
    return out.length ? 'таблички: ' + out.join('; ') : 'рядом нет табличек с текстом';
  }

  /** Как близко идти следом (блоков): настройка бота «Поведение», меняется и словами («ближе», «подальше»). */
  followDist() { const d = +this.opts.followDist || 3; return Math.max(1.2, d + rnd(-0.3, 0.3)); }
  setFollowDist(d) {
    this.opts.followDist = Math.max(1.5, Math.min(12, +d || 3));
    if (this.mode === 'follow' && this.followName) { const e = this.player(this.followName); if (e) this.bot.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true); }
    return this.opts.followDist;
  }

  // Портал: встать прямо перед ним обычной ходьбой (наискосок мешает рама), потом шагнуть внутрь тоже ходьбой
  // pathfinder (его шаги античит принимает). Ручной прыжок - только запасной: с земли, прямо, не больше 3 раз
  // (частые прыжки в раму Vulcan считает Step C, после 15 - бан; стенд 15.11).
  async portal(a, tok) {
    this.portalTask = true;
    try { return await this._portal(a, tok); } finally { this.portalTask = false; this.arrivedAt = Date.now(); }
  }

  async _portal(a, tok) {
    const b = this.bot;
    const from = b.game.dimension;
    const id = b.registry.blocksByName.nether_portal.id;
    if (a.x === undefined || a.y === undefined || a.z === undefined) {
      const near = b.findBlock({ matching: id, maxDistance: 48 });
      if (!near) throw new Error('рядом нет портала');
      a = { x: near.position.x, y: near.position.y, z: near.position.z };
    }
    let target = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
    const pb = b.findBlock({ point: target, matching: id, maxDistance: 6 });
    if (pb) {
      target = pb.position;
      for (let i = 0; i < 4; i++) { const below = b.blockAt(target.offset(0, -1, 0)); if (below && below.name === 'nether_portal') target = target.offset(0, -1, 0); else break; }
    }
    const pbl = b.blockAt(target);
    const axis = pbl && pbl.getProperties ? pbl.getProperties().axis : 'x';
    const free = (v) => { const x = b.blockAt(v); return x && x.boundingBox === 'empty' && x.name !== 'nether_portal' && !/lava|fire/.test(x.name); };
    const sides = [];
    for (const s2 of [1, -1]) for (const dy of [-1, 0]) {
      const f = target.offset(axis === 'z' ? s2 : 0, dy, axis === 'z' ? 0 : s2);
      const below = b.blockAt(f.offset(0, -1, 0));
      if (free(f) && free(f.offset(0, 1, 0)) && below && below.boundingBox === 'block') sides.push(f);
    }
    const me0 = b.entity.position;
    sides.sort((p1, p2) => p1.distanceTo(me0) - p2.distanceTo(me0));
    const front = sides[0] || null;
    this.log(`к порталу ${target.x} ${target.y} ${target.z}: встаю перед ним ${front ? front.x + ' ' + front.y + ' ' + front.z : '(места перед ним не вижу)'}`);
    if (front) await this.goto(new goals.GoalBlock(front.x, front.y, front.z), tok, 90000);
    else await this.goto(new goals.GoalNear(target.x, target.y, target.z, 2), tok, 90000);
    const inside = () => { const at = b.blockAt(b.entity.position); return at && at.name === 'nether_portal'; };
    // только что вышел из этого портала (стоит в нём) - сервер не перенесёт снова, пока не выйдешь: шаг наружу и пауза
    if (inside() || Date.now() - (this.arrivedAt || 0) < 5000) {
      if (front) { try { await this.goto(new goals.GoalBlock(front.x, front.y, front.z), tok, 10000); } catch (e) { if (e instanceof Cancelled) throw e; } }
      await sleep(2500);
    }
    try { await this.goto(new goals.GoalBlock(target.x, target.y, target.z), tok, 8000); } catch (e) { if (e instanceof Cancelled) throw e; try { b.pathfinder.setGoal(null); } catch {} }
    this.busyLook = true;
    try {
      for (let i = 0; i < 3 && !inside() && b.game.dimension === from; i++) {
        this.check(tok);
        for (let w = 0; w < 20 && !b.entity.onGround; w++) await sleep(50);
        await b.lookAt(new Vec3(target.x + 0.5, b.entity.position.y + 1.62, target.z + 0.5), true);
        b.setControlState('forward', true);
        if (front && front.y < target.y) { await sleep(100); b.setControlState('jump', true); await sleep(100); b.setControlState('jump', false); }
        await sleep(600);
        b.clearControlStates();
        await sleep(700);
      }
      for (let i = 0; i < 30 && b.game.dimension === from; i++) { await sleep(500); this.check(tok); }
    } finally { b.clearControlStates(); this.busyLook = false; }
    if (b.game.dimension === from) throw new Error('портал не сработал');
    await sleep(2000);
    return `прошёл портал, теперь ${this.dimName()}`;
  }

  // --- навыки: подобрать вещи, вернуть свои после смерти, урожай
  // Вещи на земле рядом (как pickup в Baritone). Свои после смерти, чужие брошенные, дроп с урожая.
  async pickup(a, tok) {
    const b = this.bot;
    const r = Math.min(24, +a.radius || 8);
    const center = a.x !== undefined ? new Vec3(+a.x, +a.y, +a.z) : b.entity.position.clone();
    let got = 0;
    for (let round = 0; round < 40; round++) {
      this.check(tok);
      const items = Object.values(b.entities).filter((e) => e.name === 'item' && e.isValid && e.position.distanceTo(center) <= r)
        .sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position));
      if (!items.length) break;
      const it = items[0];
      try {
        await this.goto(new goals.GoalNear(it.position.x, it.position.y, it.position.z, 0.8), tok, 20000);
      } catch (e) { if (e instanceof Cancelled) throw e; }
      for (let i = 0; i < 10 && it.isValid; i++) await sleep(150);
      if (!it.isValid) got++;
      else { it.isValid = false; }   // недостижимо - пропускаем
    }
    return got ? `подобрал вещи (${got} кучек)` : 'вещей рядом нет';
  }

  // Урожай ломается мгновенно: настоящий клиент шлёт только «начал ломать» (status 0) и взмах. mineflayer.dig()
  // шлёт ещё и «закончил» (status 2) по уже пустому блоку - Vulcan Bad Packets C, кик (стенд 15.11).
  async breakInstant(block) {
    const b = this.bot;
    await b.lookAt(block.position.offset(0.5, 0.3, 0.5));
    this.digSeq = (this.digSeq || 0) + 1;
    b._client.write('block_dig', { status: 0, location: block.position, face: 1, sequence: this.digSeq });
    b.swingArm();
    for (let i = 0; i < 20; i++) {   // ждём, пока сервер сообщит, что блок сломан
      await sleep(50);
      const now = b.blockAt(block.position);
      if (!now || now.name !== block.name) return;
    }
    throw new Error('блок не сломался');
  }

  async recover(tok) {
    const d = this.deathPoint;
    if (!d) return 'места смерти не помню';
    if (d.dim !== this.bot.game.dimension) throw new Error(`вещи остались в другом измерении (${d.x} ${d.y} ${d.z})`);
    await this.goto(new goals.GoalNear(d.x, d.y, d.z, 2), tok, 300000);
    // предметы на земле сервер показывает не сразу после прихода: смотрим ещё пару раз
    let r = '';
    for (let i = 0; i < 3; i++) {
      r = await this.pickup({ x: d.x, y: d.y, z: d.z, radius: 10 }, tok);
      if (!/нет$/.test(r)) break;
      await sleep(1500);
    }
    this.deathPoint = null;
    return 'дошёл до места смерти, ' + r;
  }

  async afterDeath() {
    const d = this.deathPoint;
    if (!d || !this.bot) return;
    const follow = this.resumeFollow;
    this.event(`ты умер на ${d.x} ${d.y} ${d.z} и возродился, иду забирать вещи`, true);
    const res = await this.run([{ act: 'recover' }], 'забрать вещи после смерти');
    this.event('после смерти: ' + res, true);
    if (follow && this.player(follow)) this.follow(follow);
    this.resumeFollow = '';
  }

  // Урожай: спелые культуры - сломать, подобрать, посадить обратно («взял - засади обратно»). Ничего, кроме урожая, не ломает.
  async harvest(a, tok) {
    const b = this.bot;
    // по образцу Baritone FarmProcess: что спелое и как сажать
    const CROPS = { wheat: [7, 'wheat_seeds'], carrots: [7, 'carrot'], potatoes: [7, 'potato'], beetroots: [3, 'beetroot_seeds'],
      nether_wart: [3, 'nether_wart'], sugar_cane: ['stack'], bamboo: ['stack'], melon: ['fruit'], pumpkin: ['fruit'] };
    const want = a.crop ? String(a.crop).replace(/^minecraft:/, '') : '';
    const ids = Object.keys(CROPS).filter((n) => !want || n === want || n.startsWith(want)).map((n) => b.registry.blocksByName[n].id);
    const ready = (bl) => {
      const rule = CROPS[bl.name][0];
      if (rule === 'stack') return b.blockAt(bl.position.offset(0, -1, 0)).name === bl.name;   // нижний стебель не трогаем
      if (rule === 'fruit') {   // плод, а не украшение: рядом стебель, который к нему прикреплён
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const s = b.blockAt(bl.position.offset(dx, 0, dz));
          return s && s.name === `attached_${bl.name}_stem`;
        });
      }
      return (bl.getProperties().age | 0) >= rule;
    };
    const r = Math.min(32, +a.radius || 16);
    let done = 0, replanted = 0;
    const limit = +a.count || 256;
    for (let i = 0; i < limit; i++) {
      this.check(tok);
      const pos = b.findBlocks({ matching: ids, maxDistance: r, count: 200 })
        .map((p) => b.blockAt(p)).filter((bl) => bl && CROPS[bl.name] && ready(bl))
        .sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
      if (!pos) break;
      const [, seed] = CROPS[pos.name];
      const p = pos.position;
      await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, 30000);
      const blk = b.blockAt(p);
      if (!blk || blk.name !== pos.name) continue;
      this.busyLook = true;
      try {
        if (blk.hardness === 0) await this.breakInstant(blk);
        else {   // арбуз, тыква, бамбук: обычное ломание лучшим инструментом (AutoTool)
          const tool = b.inventory.items().filter((x) => /_axe$/.test(x.name)).sort((x, y) => y.type - x.type)[0];
          if (tool) await b.equip(tool, 'hand');
          await b.lookAt(p.offset(0.5, 0.5, 0.5));
          await b.dig(blk, true);
        }
        done++;
        this.log('сорвал ' + pos.name + ' ' + p.x + ' ' + p.y + ' ' + p.z);
        this.busyLook = false;
        await sleep(300);
        await this.pickup({ x: p.x + 0.5, y: p.y, z: p.z + 0.5, radius: 2.5 }, tok);   // семена из этого же куста
        await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, 15000);
        this.busyLook = true;
        const soil = b.blockAt(p.offset(0, -1, 0));
        const s = seed && typeof seed === 'string' && !['stack', 'fruit'].includes(seed) ? b.inventory.items().find((x) => x.name === seed) : null;
        if (s && soil && /farmland|soul_sand/.test(soil.name) && b.blockAt(p).name === 'air') {
          await b.equip(s, 'hand');
          await b.placeBlock(soil, new Vec3(0, 1, 0));
          replanted++;
        }
      } catch (e) { if (e instanceof Cancelled) throw e; this.log('урожай: ' + pos.name + ': ' + e.message); } finally { this.busyLook = false; }
    }
    await this.pickup({ radius: 6 }, tok);
    return done ? `собрал урожай: ${done}, посадил обратно: ${replanted}` : 'спелого урожая рядом нет';
  }

  /**
   * Голос в Plasmo Voice через аддон TotemVoiceAddon на сервере: речь уходит обычными пакетами игры по каналу
   * totem:voice - [1] начало, [2]+PCM 48 кГц моно 16 бит кусками до 30 КБ, [3] конец. Аддон проигрывает её у бота.
   */
  async sendVoice(pcm, rate) {
    const b = this.bot;
    if (!b || this.status !== 'online') return false;
    // перевод в 48 кГц линейной интерполяцией (Qwen даёт 24 кГц, Piper - 22,05 кГц)
    const inN = Math.floor(pcm.length / 2);
    const outN = Math.floor(inN * 48000 / rate);
    const out = Buffer.alloc(outN * 2);
    for (let i = 0; i < outN; i++) {
      const pos = i * rate / 48000, j = Math.floor(pos), f = pos - j;
      const a = pcm.readInt16LE(Math.min(j, inN - 1) * 2), c = pcm.readInt16LE(Math.min(j + 1, inN - 1) * 2);
      out.writeInt16LE(Math.round(a + (c - a) * f), i * 2);
    }
    const send = (type, data) => b._client.write('custom_payload', { channel: 'totem:voice', data: Buffer.concat([Buffer.from([type]), data || Buffer.alloc(0)]) });
    send(1);
    for (let off = 0; off < out.length; off += 30000) {
      send(2, out.subarray(off, off + 30000));
      await sleep(15);
    }
    send(3);
    return true;
  }

  /** remember: place (без координат - где стою), person, fact. */
  remember(a, by) {
    const m = this.memory;
    if (!m) return 'памяти нет';
    const who = this.opts.name + (by ? ` (${by})` : '');
    const kind = a.kind || (a.text ? 'fact' : a.note && !a.x ? 'person' : 'place');
    if (kind === 'place') {
      const p = this.bot.entity.position;
      return m.place({ name: a.name, x: a.x ?? Math.floor(p.x), y: a.y ?? Math.floor(p.y), z: a.z ?? Math.floor(p.z), dim: a.dim || this.dimName(), note: a.note }, who);
    }
    if (kind === 'person') return m.person(a, who);
    if (kind === 'journal' || kind === 'thought') { m.journal(this.opts.name, a.text); return 'записал в дневник'; }
    return m.fact(a, who);
  }

  /** Прогулка: пройти radius блоков в сторону света (по умолчанию - где ещё не был). Не дошёл - не беда. */
  async wander(a, tok) {
    const b = this.bot, me = b.entity.position.clone();
    const DIRS = { 'север': 0, 'северо-восток': 45, 'восток': 90, 'юго-восток': 135, 'юг': 180, 'юго-запад': 225, 'запад': 270, 'северо-запад': 315 };
    const r = Math.max(16, Math.min(96, +a.radius || 48));
    const dir = DIRS[a.dir] !== undefined ? a.dir : (this.worldMap ? this.worldMap.leastExplored(this) : Object.keys(DIRS)[Math.floor(Math.random() * 8)]);
    const ang = (DIRS[dir] + (Math.random() - 0.5) * 50) * Math.PI / 180;
    const x = Math.round(me.x + Math.sin(ang) * r), z = Math.round(me.z - Math.cos(ang) * r);
    let note = '';
    try { await this.goto(new goals.GoalNearXZ(x, z, 3), tok, 90000); } catch (e) { if (e instanceof Cancelled) throw e; note = ' (дальше не прошёл)'; }
    const p = b.entity.position;
    const seen = this.worldMap ? this.worldMap.nearby(this, 48, 3).map((o) => o.text).join('; ') : '';
    return `прогулялся на ${dir}: прошёл ${Math.round(p.distanceTo(me))} бл.${note}, теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` + (seen ? `; рядом: ${seen}` : '');
  }

  /** Выполнить список действий по порядку. Возвращает итог текстом. */
  /**
   * Судья дел (кто главнее): хозяин (3) > мозг по просьбе игрока (2) > мозг сам (1) > жизнь тела (0).
   * Младший не прерывает дело старшего, пока оно идёт (не дольше 5 мин): иначе своё «свободное время» мозга
   * обрывало поручение хозяина, а жизнь тела - решения мозга (16-21.11).
   */
  claim(source) {
    const rank = { master: 3, player: 2, self: 1, life: 0 }[source] ?? 2;
    const cur = this.taskOwner;
    if (cur && this.mode === 'task' && Date.now() - cur.at < 300000 && rank < cur.rank) return `занята делом поважнее (${cur.label}) - сделаю после`;
    this.taskOwner = { rank, at: Date.now() };
    return '';
  }

  /** Единый журнал событий тела (JSON по строке): для разбора игры и сценариев. */
  ev(type, data = {}) {
    try {
      const p = this.bot && this.bot.entity ? this.bot.entity.position : null;
      const line = JSON.stringify({ t: new Date().toISOString(), type, pos: p ? [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)] : null, dim: this.bot && this.bot.game && this.bot.game.dimension, ...data });
      require('fs').appendFileSync(require('path').join(__dirname, '..', 'local', 'logs', `${this.opts.name}.events.jsonl`), line + '\n');
    } catch {}
  }

  /** Сколько каких вещей сейчас (для проверки итога действия). */
  invCounts() { const m = {}; for (const i of (this.bot && this.bot.inventory ? this.bot.inventory.items() : [])) m[i.name] = (m[i.name] || 0) + i.count; return m; }

  async run(actions, label, source = 'player') {
    if (!this.bot || this.status !== 'online') return 'бот не на сервере';
    if (this.paused) return 'на паузе - стою, пока хозяин не нажмёт «Продолжить»';
    const busy = this.claim(source);
    if (busy) { this.ev('отказ_судьи', { source, label }); return busy; }
    if (this.taskOwner) this.taskOwner.label = label || actions.map((a) => a && a.act).join(', ');
    this.runSource = source;   // для умных предметов: рычаг и кнопка - только по просьбе хозяина
    this.lastRunAt = Date.now();   // для жизни тела: мозг занят - не перебивать
    let plain = actions.filter((a) => a && a.act);
    if (!plain.length) return '';
    // «стоп» в цепочке с другими действиями Qwen ставит, чтобы бросить прежнее: прежнее и так отменяется
    if (plain.length > 1) plain = plain.filter((a) => a.act !== 'stop');
    // одиночные мгновенные: идти за кем-то, стоп
    if (plain.length === 1 && plain[0].act === 'follow') return this.follow(plain[0].who);
    if (plain.length === 1 && plain[0].act === 'stop') { this.cancel(); return 'остановился'; }
    // Идёт за кем-то, а дело лёгкое (посмотреть, поесть, надеть, план, подождать...) - после него снова идти следом.
    // Раньше любое такое действие обрывало слежку навсегда: бот отвечал в чат и вставал (16.11).
    const LIGHT = new Set(['combat', 'signs', 'followDist', 'look', 'plan', 'craftable', 'lesson', 'remember', 'forget', 'equip', 'eat', 'cmd', 'wait', 'toss', 'discardAll', 'findSpot', 'craft', 'pickup', 'sleep', 'mount', 'dismount', 'give']);
    const resume = this.mode === 'follow' && plain.every((a) => LIGHT.has(a.act)) ? this.followName : '';
    this.cancel();
    const tok = this.token;
    this.mode = 'task';
    this.task = label || plain.map((a) => a.act).join(', ');
    const done = [];
    const b0 = () => this.bot.entity.position;
    let inv0 = this.invCounts();
    try {
      for (const a of plain) {
        this.check(tok);
        let r;
        switch (a.act) {
          case 'goto': {
            const tgt = new Vec3(+a.x, a.y !== undefined ? +a.y : this.bot.entity.position.y, +a.z);
            try { if (Math.hypot(tgt.x - this.bot.entity.position.x, tgt.z - this.bot.entity.position.z) > 40) await this.walkTo({ x: tgt.x, y: a.y !== undefined ? tgt.y : null, z: tgt.z }, tok, 300000); else await this.goto(a.y !== undefined ? new goals.GoalNear(tgt.x, tgt.y, tgt.z, 1) : new goals.GoalNearXZ(tgt.x, tgt.z, 1), tok, 300000); r = `дошёл до ${a.x} ${a.y ?? ''} ${a.z}`; }
            catch (e) {
              if (e instanceof Cancelled) throw e;
              const left = this.bot.entity.position.distanceTo(tgt);
              if (left > 6) throw e;
              r = `дошёл почти до ${a.x} ${a.y ?? ''} ${a.z} (осталось ${left.toFixed(0)} бл.: ближе пути нет)`;
            }
            break;
          }
          case 'come': {
            const e = this.player(a.who);
            if (!e) throw new Error(`не вижу ${a.who}`);
            await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok, 300000); r = `подошёл к ${a.who}`; break;
          }
          case 'take': r = await this.take(a, tok); break;
          case 'put': r = await this.put(a, tok); break;
          case 'give': r = await this.give(a, tok); break;
          case 'portal': r = await this.portal(a, tok); break;
          case 'pickup': r = await this.pickup(a, tok); break;
          case 'recover': r = await this.recover(tok); break;
          case 'harvest': r = await this.harvest(a, tok); break;
          case 'remember': r = this.remember(a, label); break;
          case 'forget': r = this.memory ? this.memory.forget(a) : 'памяти нет'; break;
          case 'travel': r = await this.travelTo(a, tok); break;
          case 'goto_place': {
            const pl = this.memory && this.memory.findPlace(a.name);
            if (!pl) throw new Error(`не знаю места «${a.name}»`);
            // в другом измерении или далеко - дальний путь (может, через Незер)
            if (this.travel && (pl.dim !== this.dimName() || Math.hypot(pl.x - b0().x, pl.z - b0().z) > 300)) { r = await this.travelTo({ place: a.name }, tok); break; }
            // дальше 48 бл. - тропами, обычной ходьбой, разведкой (walkTo); рядом - просто подойти
            if (Math.hypot(pl.x - b0().x, pl.z - b0().z) > 48) await this.walkTo({ x: pl.x, y: pl.y, z: pl.z }, tok, 600000);
            else await this.goto(new goals.GoalNear(pl.x, pl.y, pl.z, 2), tok, 600000);
            r = `пришёл к месту «${pl.name}»`;
            break;
          }
          case 'wait': await sleep(Math.min(60, +a.seconds || 3) * 1000); this.check(tok); r = 'подождал'; break;
          case 'wander': r = await this.wander(a, tok); break;
          case 'gather': r = await this.skills.gather(a, tok); break;
          case 'till': r = await this.skills.till(a, tok); break;
          case 'plant': r = await this.skills.plant(a, tok); break;
          case 'farm': r = await this.skills.farm(a, tok); break;
          case 'plan': r = require('./recipes').plan(this.bot, a.item, a.count); break;
          case 'craftable': r = require('./recipes').craftable(this.bot); break;
          case 'findSpot': { const sp = this.skills.freeSpots(5); r = sp.length ? 'места без построек: ' + sp.map((s) => `${s.x} ${s.y} ${s.z} (${Math.round(s.d)} бл. на ${s.dir})`).join('; ') : 'на карте пока нет мест без построек - !wander, чтобы разведать'; break; }
          case 'goFree': { const s = await this.skills.goToFreeSpot(tok); r = `пришёл на свободное место ${s.x} ${s.z}`; break; }
          case 'lesson': r = this.memory ? this.memory.lesson(a.text, this.opts.name) : 'памяти нет'; break;
          case 'equip': r = await this.equipItem(a); break;
          case 'eat': r = await this.eatItem(a); break;
          case 'cmd': r = await this.serverCommand(a); break;
          case 'attack': r = await this.attackMob(a, tok); break;
          case 'sleep': r = await this.goSleep(tok); break;
          case 'hold': this.cancel(); this.mode = 'hold'; return done.concat('стою на месте и жду').join('; ');
          case 'combat': { const m = { defend: 'defend', flee: 'flee', off: 'off', защищать: 'defend', убегать: 'flee', нет: 'off' }[String(a.mode || '').toLowerCase()]; if (!m || !this.guard) throw new Error('режим боя: defend, flee или off'); this.guard.mode = m; this.opts.combat = m; if (this.onCombat) this.onCombat(m); r = 'режим боя: ' + { defend: 'защищаю', flee: 'убегаю к хозяину', off: 'мобов не трогаю' }[m]; break; }
          case 'signs': r = this.readSigns(); break;
          case 'use': r = await require('./objects').use(this, a, tok); break;
          case 'stash': r = await this.stash(a, tok); break;
          case 'followDist': { const cur = +this.opts.followDist || 3; r = 'держусь в ' + this.setFollowDist(a.d === 'closer' ? cur - 1 : a.d === 'farther' ? cur + 2 : a.d) + ' бл.'; if (this.onFollowDist) this.onFollowDist(this.opts.followDist); break; }
          case 'mount': r = await this.mount(a, tok); break;
          case 'dismount': r = await this.dismount(); break;
          case 'drive': r = await this.drive(a, tok); break;
          case 'discardAll': r = await this.discardAll(a); break;
          case 'duel': r = await this.duel(a, tok); break;
          case 'craft': r = await this.skills.craft(a, tok); break;
          case 'place': r = await this.skills.place(a, tok); break;
          case 'break': r = await this.skills.breakAt(a, tok); break;
          case 'mine': r = await this.skills.mineOre(a, tok); break;
          case 'surface': r = await this.skills.surface(a, tok); break;
          case 'fish': r = await this.skills.fish(a, tok); break;
          case 'smelt': r = await this.skills.smelt(a, tok); break;
          case 'hunt': r = await this.skills.hunt(a, tok); break;
          case 'shear': r = await this.skills.shear(a, tok); break;
          case 'toss': r = await this.skills.toss(a, tok); break;
          case 'build': r = await this.skills.build(a, tok); break;
          case 'look': r = 'посмотрел'; break;
          case 'follow': done.push(this.follow(a.who)); return done.join('; ');
          case 'stop': this.cancel(); return done.concat('остановился').join('; ');
          default: r = `не знаю действие ${a.act}`;
        }
        // проверка итога: что реально изменилось в инвентаре (мозг видит правду, а не «вроде положила»)
        if (/^(take|put|toss|stash|discardAll|craft|smelt|gather|mine|harvest|pickup|give|hunt|shear|fish|eat|recover)$/.test(a.act)) {
          const after = this.invCounts(), diff = [];
          for (const k of new Set([...Object.keys(inv0), ...Object.keys(after)])) { const d = (after[k] || 0) - (inv0[k] || 0); if (d) diff.push(`${d > 0 ? '+' : ''}${d} ${k}`); }
          if (diff.length) r += ` [инвентарь: ${diff.slice(0, 6).join(', ')}]`;
          else if (/^(take|put|craft|gather|mine|give|stash)$/.test(a.act)) r += ' [инвентарь не изменился - похоже, на деле не вышло]';
          inv0 = after;
        }
        done.push(r);
        this.log(r);
        this.ev('итог_действия', { act: a.act, ok: true, r: String(r).slice(0, 200), source });
      }
      return done.join('; ') + '; задание выполнено';
    } catch (e) {
      if (e instanceof Cancelled) { this.ev('отмена', { label, source }); return done.concat('задание отменено').join('; '); }
      this.ev('итог_действия', { ok: false, err: String(e.message).slice(0, 200), label, source });
      return done.concat('не получилось: ' + e.message).join('; ');
    } finally {
      if (tok === this.token) { this.mode = 'idle'; this.task = ''; this.taskOwner = null; try { this.bot.pathfinder.setGoal(null); } catch {} if (resume) this.follow(resume); }
    }
  }
}

// методы из отдельных модулей (разбивка bot.js): транспорт, дом
for (const M of [require('./vehicles').Vehicles, require('./house').House, require('./perception').Perception, require('./water').Water, require('./containers').Containers]) {
  for (const k of Object.getOwnPropertyNames(M.prototype)) if (k !== 'constructor') Object.defineProperty(TotemBot.prototype, k, Object.getOwnPropertyDescriptor(M.prototype, k));
}

module.exports = { TotemBot, clickActionPacket, Cancelled };
