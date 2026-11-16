// Тело бота: mineflayer + pathfinder. Ходит компаньоном, берёт и кладёт вещи в сундуки, отдаёт вещи игрокам,
// проходит порталы. Блоки не ломает и не ставит (на живом сервере это был бы гриф).
// Заходит клиентом 1.21.11: его mineflayer поддерживает полностью, сервер 26.3 пускает через ViaVersion.
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Skills } = require('./skills');
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
      mv.canDig = false;              // ничего не ломать
      mv.allow1by1towers = false;     // и не строить столбы
      mv.scafoldingBlocks = [];
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
      // Ковёр (мох, шерсть) по pathfinder проходим всегда - а на уровне тела и головы это преграда: бот упирался
      // в ковёр на бугорке впереди (боевой, 482 66 -611, 15.11). Ковёр выше ног - не проходим, путь в обход.
      {
        const gb = mv.getBlock.bind(mv);
        mv.getBlock = function (pos, dx, dy, dz) {
          const b2 = gb(pos, dx, dy, dz);
          if (dy >= 1 && b2 && this.carpets.has(b2.type) && b2.safe) return Object.assign(Object.create(Object.getPrototypeOf(b2)), b2, { safe: false });
          return b2;
        };
      }
      // Главная причина «застрял на ровном месте» (стенд-копия мира 15.11): pathfinder шагает по диагонали, если
      // свободна хотя бы ОДНА из двух соседних клеток, и тело (0,6 блока) цепляется за угол блока. Как Baritone:
      // диагональ - только если свободны обе стороны (на уровне ног и головы).
      {
        const diag = mv.getMoveDiagonal.bind(mv);
        mv.getMoveDiagonal = function (node, dir, neighbors) {
          const y = this.getBlock(node, dir.x, 0, dir.z).physical ? 1 : 0;
          for (const [dx, dz] of [[0, dir.z], [dir.x, 0]]) {
            for (let dy = 0; dy <= y + 1; dy++) if (!this.getBlock(node, dx, dy, dz).safe) return;   // и уровень ног при прыжке
          }
          return diag(node, dir, neighbors);
        };
      }
      this.movements = mv;
      bot.pathfinder.setMovements(mv);
      bot.pathfinder.thinkTimeout = 15000;   // путь в обход (без паркура) ищется дольше 5 с по умолчанию
      this.guard = new Guard(this);
      this.guard.mode = this.opts.combat || 'defend';
      this.guard.attach();
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
    if (pos !== 'chat') this.emit('chat', text);   // сообщения игроков пишутся в журнал ниже, с ником и каналом
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
      this.emit('chat', `${local ? '[рядом] ' : ''}${p ? p.username : '?'}: ${body}`);
      if (p) this.playerChat(p.username, body, false, local ? 'local' : 'global');
      return;
    }
    const parsed = this.parseChat(text);
    if (parsed) this.playerChat(parsed.from, parsed.text, parsed.whisper, parsed.whisper ? 'whisper' : (/^\s*\[Рядом\]/i.test(text) ? 'local' : 'global'));
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

  /** Состояние по частям: core и near идут в каждом сообщении, остальное - когда меняется или когда бот посмотрит. */
  stateParts() {
    const s = this.state();
    if (s.status !== 'online') return null;
    const b = this.bot;
    const t = b.time && b.time.timeOfDay;
    const tod = t === undefined ? '' : t < 1000 ? 'утро' : t < 11500 ? 'день' : t < 13000 ? 'вечер' : t < 23000 ? 'ночь' : 'рассвет';
    const weather = b.thunderState > 0 ? ', гроза' : b.isRaining ? ', дождь' : '';
    const ch = this.worldMap && this.worldMap.load(b.game.dimension).chunks[`${Math.floor(s.pos[0] / 16)},${Math.floor(s.pos[2] / 16)}`];
    // «под землёй» - только если над головой нет неба (свет неба у головы < 8, и над головой твёрдое в 40 блоках);
    // средняя высота чанка врёт у ледяных шипов, гор и деревьев (боевой 15.11: на льду «под землёй»)
    let under = '';
    {
      const head = b.blockAt(b.entity.position.offset(0, 1.6, 0));
      const sky = head && typeof head.skyLight === 'number' ? head.skyLight : null;
      let roof = false;
      for (let dy = 2; dy <= 40 && !roof; dy++) { const k = b.blockAt(b.entity.position.offset(0, dy, 0)); if (k && k.boundingBox === 'block' && !/leaves|glass|ice/.test(k.name)) roof = true; }
      if (roof && (sky === null ? (ch && ch.h !== null && s.pos[1] < ch.h - 6) : sky < 8)) under = ', под землёй';
    }
    const doing = s.mode === 'follow' ? `идёшь за ${s.follow}` : s.mode === 'task' ? `выполняешь: ${s.task}` : 'стоишь';
    return {
      pos: s.pos,
      core: `${s.dim} ${s.pos.join(' ')}${under}; ${tod}${weather}; здоровье ${s.health}/20, еда ${s.food}/20; ${doing}`,
      near: s.near.length ? 'рядом: ' + s.near.map((n) => `${n.name} ${n.dist} бл.`).join(', ') : 'рядом никого (48 бл.)',
      inv: Object.entries(s.items).map(([k, v]) => `${k} x${v}`).join(', ') || 'пусто',
      online: Object.keys(b.players || {}).filter((n) => n !== this.opts.name).sort(),
      sees: this.glance(),
      map: () => (this.worldMap ? this.worldMap.summary(this) : 'карты нет'),
    };
  }

  /** Снимок для зрения: вид глазами + карта сверху (PNG). */
  snapshot() { const { Vision } = require('./vision'); return new Vision(this.bot).snapshot(); }

  /** Взгляд (каждое сообщение, дёшево): под ногами, перед собой, в руке, мобы и вещи в 16 блоках. */
  glance() {
    const b = this.bot, e = b.entity, p = e.position;
    const nm = (v) => { const k = b.blockAt(v); return k ? k.name.replace(/^minecraft:/, '') : '?'; };
    const fwd = p.offset(-Math.sin(e.yaw) * 1.5, 0, -Math.cos(e.yaw) * 1.5);
    const mobs = {};
    let drops = 0;
    for (const x of Object.values(b.entities)) {
      if (x === e || !x.position || x.type === 'player') continue;
      if (x.position.distanceTo(p) > 16) continue;
      if (x.name === 'item') drops++; else if (x.name && x.type !== 'object' && x.type !== 'orb') mobs[x.name] = (mobs[x.name] || 0) + 1;
    }
    const ml = Object.entries(mobs).sort((a2, b2) => b2[1] - a2[1]).slice(0, 5).map(([k, v]) => v > 1 ? `${k} x${v}` : k).join(', ');
    const held = b.heldItem ? b.heldItem.name : 'пусто';
    return `под ногами ${nm(p.offset(0, -0.5, 0))}, впереди ${nm(fwd)}/${nm(fwd.offset(0, 1, 0))}, в руке ${held}` + (ml ? `; мобы: ${ml}` : '') + (drops ? `; вещей на земле ${drops}` : '');
  }

  /** Осмотреться: мобы и животные, вещи на земле, приметные блоки в 10 блоках, биом. По запросу мозга. */
  lookAround() {
    const b = this.bot;
    if (!b || !b.entity) return 'ты не на сервере';
    const me = b.entity.position;
    const mobs = {}, players = [];
    let drops = 0;
    for (const e of Object.values(b.entities)) {
      if (e === b.entity || !e.position) continue;
      const d = e.position.distanceTo(me);
      if (d > 24) continue;
      if (e.type === 'player') players.push(`${e.username} ${Math.round(d)} бл.`);
      else if (e.name === 'item') drops++;
      else if (['hostile', 'mob', 'animal', 'passive', 'water_creature', 'ambient'].includes(e.type) || e.kind) mobs[e.name] = (mobs[e.name] || 0) + 1;
    }
    const blocks = {};
    try {
      const NOTABLE = /(chest|barrel|shulker_box|crafting_table|furnace|smoker|_door|_bed|anvil|enchanting_table|brewing_stand|wheat|carrots|potatoes|beetroots|farmland|sugar_cane|melon|pumpkin|nether_portal|spawner|_sign|lantern|torch|_ore|bell|composter|lectern)$/;
      for (const p of b.findBlocks({ matching: (bl) => NOTABLE.test(bl.name), maxDistance: 10, count: 400 })) {
        const nm = b.blockAt(p).name.replace(/^wall_|_wall(?=_)/, '');
        blocks[nm] = (blocks[nm] || 0) + 1;
      }
    } catch {}
    let biome = '';
    try { const bl = b.blockAt(me); biome = bl && bl.biome && bl.biome.name ? bl.biome.name : ''; } catch {}
    const list = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => v > 1 ? `${k} x${v}` : k).join(', ');
    return [biome && `биом ${biome}`, players.length && `игроки: ${players.join(', ')}`, `мобы и звери (24 бл.): ${list(mobs) || 'нет'}`,
      drops && `вещей на земле: ${drops}`, `блоки рядом (10 бл.): ${list(blocks) || 'ничего приметного'}`].filter(Boolean).join('; ');
  }

  stateText() {
    const s = this.state();
    if (s.status !== 'online') return 'ты не на сервере';
    const inv = Object.entries(s.items).map(([k, v]) => `${k} x${v}`).join(', ') || 'пусто';
    const near = s.near.map((n) => `${n.name} (${n.dist} бл.)`).join(', ') || 'никого (в 48 блоках)';
    const online = Object.keys(this.bot.players || {}).filter((n) => n !== this.opts.name);
    const doing = s.mode === 'follow' ? `идёшь за ${s.follow}` : s.mode === 'task' ? `выполняешь: ${s.task}` : 'стоишь';
    return `измерение: ${s.dim}, координаты ${s.pos.join(' ')}, здоровье ${s.health}/20, еда ${s.food}/20, сейчас ${doing}; ` +
      `инвентарь: ${inv}; рядом: ${near}; на сервере онлайн ${online.length}: ${online.slice(0, 30).join(', ') || 'никого'}`
      + (this.worldMap ? '; ' + this.worldMap.summary(this) : '');
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
      this.swimTick();
      this.waterExitTick();
    });
    this.timer = setInterval(() => this.slowTick().catch(() => {}), 1000);
  }

  // Выход из воды на уступ: в клиенте Minecraft, если в воде упираешься в блок, а над ним свободно, игрока
  // подбрасывает на 0,3 (outOfLiquidImpulse). Физика mineflayer это не делает (стенд 15.11: бот не мог выйти на
  // пляж). Даём тот же толчок, когда бот идёт вперёд или по пути; античит это видит как обычный выход (0 отметок).
  /**
   * Выбраться из воды на уступ (best - клетка, где встать), как игрок: прыжок держать, у стенки внизу волны - чуть назад,
   * на гребне - вперёд (упор на гребне - толчок через край, waterExitTick). pathfinder этот ход не умеет. true - вышел.
   */
  async climbOut(best) {
    const b = this.bot;
    this.busyLook = true;
    try {
      try { b.pathfinder.setGoal(null); } catch {}
      for (let i = 0; i < 240; i++) {   // до 12 с
        const f = b.blockAt(b.entity.position);
        if (!f || !/water|kelp|seagrass/.test(f.name)) break;
        const q = b.entity.position, crest = q.y - Math.floor(q.y) >= 0.45;
        if (i === 0) await b.lookAt(best.offset(0.5, 1.4, 0.5));
        b.setControlState('sprint', false);
        b.setControlState('jump', true);
        b.setControlState('forward', crest || !b.entity.isCollidedHorizontally);
        b.setControlState('back', !crest && b.entity.isCollidedHorizontally);
        await sleep(50);
      }
    } finally { b.clearControlStates(); this.busyLook = false; }
    const f = b.blockAt(b.entity.position);
    return !(f && /water/.test(f.name));
  }

  /** Уступ рядом (до r блоков), где можно встать, - ближе к цели goal (если дана). */
  ledgeNear(r = 5, goal = null) {
    const b = this.bot, me = b.entity.position, lvl = Math.floor(me.y);
    const ok = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && !/water|leaves|glass/.test(k.name); };
    const free = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'empty' && !/water|lava/.test(k.name); };
    let best = null, bs = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 1; dy++) {
      const v = new Vec3(Math.floor(me.x) + dx, lvl + dy, Math.floor(me.z) + dz);
      if (!ok(v) || !free(v.offset(0, 1, 0)) || !free(v.offset(0, 2, 0))) continue;
      if ((this.badShore || []).some((x) => Date.now() - x.at < 10 * 60000 && x.v.distanceTo(v) < 1.5)) continue;   // сюда уже не вылез
      // проход к уступу: в клетке между ботом и уступом над водой есть место для головы (не ледяной потолок)
      const mx = Math.round((v.x + 0.5 + me.x) / 2 - 0.5), mz = Math.round((v.z + 0.5 + me.z) / 2 - 0.5);
      if (!free(new Vec3(mx, lvl + 2, mz)) && !(b.blockAt(new Vec3(mx, lvl + 2, mz)) || {}).name?.includes('water')) continue;
      const d = Math.hypot(v.x + 0.5 - me.x, v.z + 0.5 - me.z) + (goal ? Math.hypot(v.x - goal.x, v.z - goal.z) * 0.3 : 0);
      if (d < bs) { bs = d; best = v.offset(0, 1, 0); }
    }
    return best;
  }

  // Плавание как у игрока (pathfinder в воде дёргал бег на гребнях и бросал клавиши у берега, голова крутилась):
  // держать прыжок (ровно на поверхности, вниз - только если путь уходит вниз), без бега, вперёд к следующей точке
  // пути, которая хотя бы на полблока в стороне. Идёт после pathfinder в том же такте - его клавиши перекрываются.
  swimTick() {
    const b = this.bot, e = b.entity;
    if (!e || this.busyLook || !b.pathfinder.isMoving()) return;
    const p = e.position, feet = b.blockAt(p);
    if (!e.isInWater && !(feet && /water/.test(feet.name))) return;
    const path = (this.lastPath || {}).path || [];
    if (!path.length) return;
    const c = (n) => ({ x: Number.isInteger(n.x) ? n.x + 0.5 : n.x, y: n.y, z: Number.isInteger(n.z) ? n.z + 0.5 : n.z });
    let i0 = 0, best = Infinity;
    path.forEach((n, i) => { const q = c(n), d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); if (d < best) { best = d; i0 = i; } });
    let nx = null;
    for (let i = i0; i < path.length; i++) { const q = c(path[i]); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.5) { nx = q; break; } }
    if (!nx) return;
    b.setControlState('sprint', false);
    b.setControlState('forward', true);
    b.setControlState('jump', nx.y >= Math.floor(p.y));
    const yaw = Math.atan2(-(nx.x - p.x), -(nx.z - p.z));
    let dy = yaw - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(dy) > 0.05) b.look(e.yaw + Math.max(-0.35, Math.min(0.35, dy)), 0, true);   // плавно, без рывков
  }

  waterExitTick() {
    const b = this.bot, e = b.entity;
    if (!e || e.velocity.y > 0.2) return;
    const feet = b.blockAt(e.position);
    if (!feet || !/water|seagrass|kelp/.test(feet.name)) return;   // ноги в воде (isInWater у края бывает false)
    const p = e.position;
    if (process.env.TB_DEBUG) console.log('вода:', p.y.toFixed(2), 'fwd', b.getControlState('forward'), 'moving', b.pathfinder.isMoving(), 'yaw', e.yaw.toFixed(2));
    if (!b.getControlState('forward') && !b.pathfinder.isMoving()) return;
    if (b.pathfinder.isMoving()) {   // ведёт путь: толчок, только если следующая точка выше (вылезти), а не плывём вдоль берега
      const nx = ((this.lastPath || {}).path || [])[0];
      if (!nx || nx.y <= Math.floor(e.position.y)) return;
    }
    const yaw = e.yaw;
    const front = p.offset(-Math.sin(yaw) * 0.8, 0, -Math.cos(yaw) * 0.8).floored();
    const ledge = b.blockAt(front), up1 = b.blockAt(front.offset(0, 1, 0)), up2 = b.blockAt(front.offset(0, 2, 0));
    if (!ledge || ledge.boundingBox !== 'block' || !up1 || up1.boundingBox !== 'empty' || !up2 || up2.boundingBox !== 'empty') return;
    if (Math.hypot(front.x + 0.5 - p.x, front.z + 0.5 - p.z) > 1.3) return;   // уступ вплотную
    // как в клиенте: сначала всплыть повыше (прыжок в воде), с гребня - толчок 0,3 через край
    if (p.y - Math.floor(p.y) < 0.45) { b.setControlState('jump', true); return; }
    // один толчок на касание, не чаще раза в секунду: толчок каждый такт Vulcan видит как полёт (Flight F, бан на стенде)
    if (Date.now() - (this.exitAt || 0) < 2000) return;
    this.exitAt = Date.now();
    e.velocity.y = 0.3;
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
      const inWater = here && /water/.test(here.name);
      if (inWater && !b.pathfinder.isMoving()) { b.setControlState('jump', true); this.swimming = true; }
      else if (this.swimming) { b.setControlState('jump', false); this.swimming = false; }
    }
    this.notice().catch(() => {});
    // компаньон: потерял из виду - сказать один раз
    if (this.mode === 'follow') {
      if (!owner) {
        if (!this.lostReported) { this.lostReported = true; this.event(`ты потерял из виду ${this.followName} (далеко или в другом измерении)`, true); }
      } else if (this.lostReported) {
        this.lostReported = false;
        b.pathfinder.setGoal(new goals.GoalFollow(owner, rnd(2.2, 3.5)), true);
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
    try { await b.equip(pick, 'hand'); await b.consume(); this.log('съел ' + pick.name); } catch {} finally { this.eating = false; }
  }

  // Воздух кончается под водой - всплыть, даже посреди пути
  airTick() {
    const b = this.bot;
    const head = b.blockAt(b.entity.position.offset(0, 1.6, 0));
    const under = head && /water|bubble_column/.test(head.name);
    if (under && b.oxygenLevel !== undefined && b.oxygenLevel < 12) {
      b.setControlState('jump', true);
      this.surfacing = true;
    } else if (this.surfacing && !under) {
      b.setControlState('jump', false);
      this.surfacing = false;
    }
  }

  // Как человек: без дела в воде не болтается - через 15 с плывёт к ближайшему берегу (до 40 блоков).
  // Только когда стоит без задания и ни за кем не идёт: в задании и при слежке путь строит pathfinder.
  shoreTick() {
    const b = this.bot, me = b.entity.position;
    const feet = b.blockAt(me);
    const wet = feet && /water|bubble_column|kelp|seagrass/.test(feet.name);
    if (!wet || this.mode !== 'idle' || b.pathfinder.isMoving()) { this.wetSince = wet ? (this.wetSince || Date.now()) : 0; return; }
    if (!this.wetSince) this.wetSince = Date.now();
    if (Date.now() - this.wetSince < 15000 || Date.now() - (this.shoreTry || 0) < 10000) return;
    this.shoreTry = Date.now();
    // берег - природная земля (не чужие доски, лодки и причалы: туда из воды не залезть, да и не наше)
    const NATURAL = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|sand|red_sand|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|clay|mud|snow_block|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|ice|packed_ice|blue_ice)$/;
    const solid = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && NATURAL.test(k.name); };
    this.badShore = (this.badShore || []).filter((x) => Date.now() - x.at < 10 * 60000);
    const empty = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'empty' && !/water|lava/.test(k.name); };
    // сначала пологий берег (встать не выше уровня воды - выйти шагом), потом уступ в блок: из воды на уступ
    // физика mineflayer не подпрыгивает (проверено на стенде 15.11), поэтому уступ - запасной
    const lvl = Math.floor(me.y);
    let best = null;
    // сначала природный берег в 40 блоках; нет - любая твёрдая опора в 64 (причал, мостки - как игрок; не палуба над головой)
    const anySolid = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && !/water|leaves|_glass|glass/.test(k.name); };
    for (const [maxUp, R, ok] of [[1, 40, solid], [1, 64, anySolid]]) {
    for (let r = 1; r <= R && !best; r += (r < 6 ? 1 : 2)) {
      for (let a = 0; a < 32; a++) {
        const x = Math.floor(me.x + Math.cos(a * Math.PI / 16) * (r + 0.3)), z = Math.floor(me.z + Math.sin(a * Math.PI / 16) * (r + 0.3));
        for (let y = Math.floor(me.y) + 2; y >= Math.floor(me.y) - 3; y--) {
          const v = new Vec3(x, y, z);
          if (v.y + 1 - lvl > maxUp) continue;
          if (ok(v) && empty(v.offset(0, 1, 0)) && empty(v.offset(0, 2, 0)) && !this.badShore.some((x) => x.v.distanceTo(v) < 3)) { best = v.offset(0, 1, 0); break; }
        }
        if (best) break;
      }
    }
    if (best) break;
    }
    if (!best && this.worldMap) {   // рядом нет - ближайшая суша по карте (вся прорисовка), плыть туда
      const m = this.worldMap.load(b.game.dimension), pcx = Math.floor(me.x / 16), pcz = Math.floor(me.z / 16);
      let bd = Infinity, land = null;
      for (const [k, c] of Object.entries(m.chunks)) {
        if (c.k !== 'g' || c.h === null || c.h < lvl) continue;
        const [cx, cz] = k.split(',').map(Number), d = Math.hypot(cx - pcx, cz - pcz);
        if (d < bd && d > 0) { bd = d; land = { x: cx * 16 + 8, z: cz * 16 + 8 }; }
      }
      if (land) {
        this.log(`берега рядом нет - плыву к суше по карте: ${land.x} ${land.z}`);
        this.mode = 'shore';
        this.goto(new goals.GoalNearXZ(land.x, land.z, 6), this.token, 120000).catch(() => {}).finally(() => { if (this.mode === 'shore') this.mode = 'idle'; });
        return;
      }
    }
    if (!best) { this.log('в воде, берега рядом не вижу'); return; }
    this.log(`выплываю на берег: ${best.x} ${best.y} ${best.z}`);
    this.mode = 'shore';   // пока плывёт - не «стоит без дела»
    // берег рядом - как игрок: лицом к суше, держать «вперёд» и «прыжок», пока не выйдет из воды (до 5 с)
    if (Math.hypot(best.x + 0.5 - me.x, best.z + 0.5 - me.z) <= 6) {
      this.climbOut(best).then((ok) => {
        if (!ok) { this.badShore.push({ v: best.offset(0, -1, 0), at: Date.now() }); this.log('на этот берег не вылез, поищу другой'); }
        else this.log('вышел на берег');
        if (this.mode === 'shore') this.mode = 'idle';
      });
      return;
    }
    const tok = this.token;
    this.goto(new goals.GoalNear(best.x, best.y, best.z, 1), tok, 40000)
      .catch(async (e) => {
        // у самого берега путь из воды на уступ не строится: как человек - лицом к берегу, вперёд с прыжком, один раз
        if (e instanceof Cancelled) throw e;
        { const p0 = b.entity.position.floored(); const rows = [];
          for (let dy = -1; dy <= 2; dy++) { const r = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const k = b.blockAt(p0.offset(dx, dy, dz)); r.push(k ? k.name.replace(/_?(block|planks)$/, '').slice(0, 9) : '?'); } rows.push(`y${p0.y + dy}: ` + r.join(',')); }
          const ents = Object.values(b.entities).filter((x) => x !== b.entity && x.position.distanceTo(b.entity.position) < 3).map((x) => x.name);
          this.log(`у берега: я ${b.entity.position.x.toFixed(1)} ${b.entity.position.y.toFixed(1)} ${b.entity.position.z.toFixed(1)}, цель ${best.x} ${best.y} ${best.z}; ${rows.join(' | ')}; рядом: ${ents.join(',') || 'никого'}`); }
        if (b.entity.position.distanceTo(best) > 3.5) throw e;
        try { b.pathfinder.setGoal(null); } catch {}
        this.busyLook = true;
        try {
          await b.lookAt(best.offset(0.5, 1.2, 0.5), true);
          b.setControlState('forward', true); b.setControlState('jump', true);
          await sleep(1200);
        } finally { b.clearControlStates(); this.busyLook = false; }
        const feet = b.blockAt(b.entity.position);
        if (feet && /water/.test(feet.name)) throw e;
      })
      .then(() => this.log('выбрался на берег'))
      .catch((e) => { if (e instanceof Cancelled) return; this.badShore.push({ v: best.offset(0, -1, 0), at: Date.now() }); this.log('к этому берегу не доплыл, поищу другой'); })
      .finally(() => { if (this.mode === 'shore') { this.mode = 'idle'; try { b.pathfinder.setGoal(null); } catch {} } });
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
    if (this.stuck.tries === 3) this.event('ты застрял и не можешь пройти дальше', true);
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
      await this.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2), this.token, 20000);
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
    const rain = !!b.isRaining;
    if (this.wasRain !== undefined && rain && !this.wasRain) this.emit('moment', { kind: 'дождь', text: 'пошёл дождь' + (b.thunderState > 0 ? ', гроза' : '') });
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

  /** Поесть: названное или лучшее из того, что есть. */
  async eatItem(a) {
    const b = this.bot;
    const foods = b.registry.foodsByName || {};
    const q = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const BAD = /rotten_flesh|spider_eye|poisonous_potato|pufferfish|chorus_fruit|suspicious_stew|raw_chicken|chicken$/;
    const it = q ? b.inventory.items().find((i) => i.name === q)
      : b.inventory.items().filter((i) => foods[i.name] && !BAD.test(i.name)).sort((x, y) => (foods[y.name].foodPoints || 0) - (foods[x.name].foodPoints || 0))[0];
    if (!it) throw new Error('нечего есть');
    if (b.food >= 20 && !/golden_apple/.test(it.name)) return 'не голоден';
    this.eating = true;
    try { await b.equip(it, 'hand'); await b.consume(); } finally { this.eating = false; }
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

  /** Лечь спать в кровать рядом (ночью или в грозу). */
  async goSleep(tok) {
    const b = this.bot;
    const bed = b.findBlock({ matching: (bl) => /_bed$/.test(bl.name), maxDistance: 32 });
    if (!bed) throw new Error('рядом нет кровати');
    await this.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2), tok, 60000);
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
      } else if (s.y === null || s.y === undefined) await this.goto(new goals.GoalNearXZ(s.x, s.z, 2), tok, legTime(d));
      else await this.goto(new goals.GoalNear(s.x, s.y, s.z, 2), tok, legTime(d));
    }
    const p = b.entity.position;
    return `дошёл${dest.name ? ' до «' + dest.name + '»' : ''} (${plan.text}), теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, ${this.dimName()}`;
  }

  // --- действия
  cancel() {
    this.token++;
    this.mode = 'idle';
    this.task = '';
    this.followName = '';
    if (this.bot) { try { this.bot.pathfinder.setGoal(null); this.bot.clearControlStates(); } catch {} }
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
        break;
      } catch (e) {
        this.check(tok);
        // путь оборвался в воде (pathfinder не умеет вылезать на уступ) - вылезти самому и продолжить
        const feet = b.blockAt(b.entity.position);
        if (feet && /water/.test(feet.name) && attempt < 5 && Date.now() < until && !/goal was changed/i.test(e.message)) {
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
    this.bot.pathfinder.setGoal(new goals.GoalFollow(e, rnd(2.2, 3.5)), true);
    return `иду за ${name}`;
  }

  matchItems(list, want) {
    const w = String(want || '').toLowerCase().replace(/^minecraft:/, '').trim();
    if (!w || w === 'all' || w === 'все' || w === 'всё') return list;
    return list.filter((i) => i.name === w || i.name.endsWith('_' + w) || i.name.startsWith(w + '_') || i.name.includes(w));
  }

  async openAt(x, y, z, tok) {
    const b = this.bot;
    const block = b.blockAt(new Vec3(x, y, z));
    if (!block) throw new Error(`блок ${x} ${y} ${z} не загружен (далеко)`);
    await this.goto(new goals.GoalGetToBlock(x, y, z), tok);
    this.busyLook = true;
    try {
      await b.lookAt(block.position.offset(0.5, 0.5, 0.5));
      return await b.openContainer(block);
    } finally { this.busyLook = false; }
  }

  // сундук не назван - ближайший (6 блоков)
  nearestChest(a) {
    if (!a.nearest && a.x !== undefined) return a;
    const k = this.bot.findBlock({ matching: (bl) => /^(chest|trapped_chest|barrel)$/.test(bl.name), maxDistance: 6 });
    if (!k) throw new Error('рядом (6 блоков) нет сундука - нужны координаты: !takeFromChest(x, y, z, предмет, сколько)');
    return { ...a, x: k.position.x, y: k.position.y, z: k.position.z };
  }

  async take(a, tok) {
    a = this.nearestChest(a);
    const c = await this.openAt(+a.x, +a.y, +a.z, tok);
    let left = a.count ? +a.count : Infinity, got = 0;
    try {
      for (const it of this.matchItems(c.containerItems(), a.item)) {
        if (left <= 0) break;
        const n = Math.min(left, it.count);
        await c.withdraw(it.type, null, n);
        left -= n; got += n;
        await sleep(rnd(150, 400));
      }
    } finally { c.close(); }
    if (!got) throw new Error(`в сундуке ${a.x} ${a.y} ${a.z} нет ${a.item}`);
    return `взял ${got} ${a.item} из ${a.x} ${a.y} ${a.z}`;
  }

  async put(a, tok) {
    a = this.nearestChest(a);
    const c = await this.openAt(+a.x, +a.y, +a.z, tok);
    let left = a.count ? +a.count : Infinity, put = 0;
    try {
      for (const it of this.matchItems(this.bot.inventory.items(), a.item)) {
        if (left <= 0) break;
        const n = Math.min(left, it.count);
        await c.deposit(it.type, null, n);
        left -= n; put += n;
        await sleep(rnd(150, 400));
      }
    } finally { c.close(); }
    if (!put) throw new Error(`нет у меня ${a.item}`);
    return `положил ${put} ${a.item} в ${a.x} ${a.y} ${a.z}`;
  }

  async give(a, tok) {
    const b = this.bot;
    const e = this.player(a.who);
    if (!e) throw new Error(`не вижу ${a.who} (далеко или в другом измерении)`);
    await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok);
    const e2 = this.player(a.who);
    if (e2) await b.lookAt(e2.position.offset(0, 1.2, 0));
    let left = a.count ? +a.count : Infinity, gave = 0;
    for (const it of this.matchItems(b.inventory.items(), a.item)) {
      if (left <= 0) break;
      const n = Math.min(left, it.count);
      await b.toss(it.type, null, n);
      left -= n; gave += n;
      await sleep(rnd(200, 500));
    }
    if (!gave) throw new Error(`нет у меня ${a.item}`);
    return `отдал ${a.who} ${gave} ${a.item}`;
  }

  // Портал: встать прямо перед ним обычной ходьбой (наискосок мешает рама), потом шагнуть внутрь тоже ходьбой
  // pathfinder (его шаги античит принимает). Ручной прыжок - только запасной: с земли, прямо, не больше 3 раз
  // (частые прыжки в раму Vulcan считает Step C, после 15 - бан; стенд 15.11).
  async portal(a, tok) {
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
  async run(actions, label) {
    if (!this.bot || this.status !== 'online') return 'бот не на сервере';
    let plain = actions.filter((a) => a && a.act);
    if (!plain.length) return '';
    // «стоп» в цепочке с другими действиями Qwen ставит, чтобы бросить прежнее: прежнее и так отменяется
    if (plain.length > 1) plain = plain.filter((a) => a.act !== 'stop');
    // одиночные мгновенные: идти за кем-то, стоп
    if (plain.length === 1 && plain[0].act === 'follow') return this.follow(plain[0].who);
    if (plain.length === 1 && plain[0].act === 'stop') { this.cancel(); return 'остановился'; }
    this.cancel();
    const tok = this.token;
    this.mode = 'task';
    this.task = label || plain.map((a) => a.act).join(', ');
    const done = [];
    const b0 = () => this.bot.entity.position;
    try {
      for (const a of plain) {
        this.check(tok);
        let r;
        switch (a.act) {
          case 'goto': {
            const tgt = new Vec3(+a.x, a.y !== undefined ? +a.y : this.bot.entity.position.y, +a.z);
            try { await this.goto(a.y !== undefined ? new goals.GoalNear(tgt.x, tgt.y, tgt.z, 1) : new goals.GoalNearXZ(tgt.x, tgt.z, 1), tok, 300000); r = `дошёл до ${a.x} ${a.y ?? ''} ${a.z}`; }
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
            await this.goto(new goals.GoalNear(pl.x, pl.y, pl.z, 2), tok, 600000);
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
        done.push(r);
        this.log(r);
      }
      return done.join('; ') + '; задание выполнено';
    } catch (e) {
      if (e instanceof Cancelled) return done.concat('задание отменено').join('; ');
      return done.concat('не получилось: ' + e.message).join('; ');
    } finally {
      if (tok === this.token) { this.mode = 'idle'; this.task = ''; try { this.bot.pathfinder.setGoal(null); } catch {} }
    }
  }
}

module.exports = { TotemBot, clickActionPacket };
