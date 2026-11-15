// Тело бота: mineflayer + pathfinder. Ходит компаньоном, берёт и кладёт вещи в сундуки, отдаёт вещи игрокам,
// проходит порталы. Блоки не ломает и не ставит (на живом сервере это был бы гриф).
// Заходит клиентом 1.21.11: его mineflayer поддерживает полностью, сервер 26.3 пускает через ViaVersion.
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('events');
const { Guard } = require('./guard');

const VERSION = '1.21.11';
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
      const mv = new Movements(bot);
      mv.canDig = false;              // ничего не ломать
      mv.allow1by1towers = false;     // и не строить столбы
      mv.scafoldingBlocks = [];
      mv.allowParkour = true;
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
      this.movements = mv;
      bot.pathfinder.setMovements(mv);
      this.guard = new Guard(this);
      this.guard.mode = this.opts.combat || 'defend';
      this.guard.attach();
      this.retry = 0;
      this.log('на сервере');
      this.event('ты зашёл на сервер');
      this.loops();
    });
    bot.on('spawn', () => { if (this.dim && this.dim !== bot.game.dimension) this.event(`ты в другом измерении: ${this.dimName()}`); this.dim = bot.game.dimension; });
    bot.on('messagestr', (msg, pos, json, sender) => this.onMessage(msg, pos, json, sender));
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
    this.emit('chat', text);
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

  stateText() {
    const s = this.state();
    if (s.status !== 'online') return 'ты не на сервере';
    const inv = Object.entries(s.items).map(([k, v]) => `${k} x${v}`).join(', ') || 'пусто';
    const near = s.near.map((n) => `${n.name} (${n.dist} бл.)`).join(', ') || 'никого';
    const doing = s.mode === 'follow' ? `идёшь за ${s.follow}` : s.mode === 'task' ? `выполняешь: ${s.task}` : 'стоишь';
    return `измерение: ${s.dim}, координаты ${s.pos.join(' ')}, здоровье ${s.health}/20, еда ${s.food}/20, сейчас ${doing}; ` +
      `инвентарь: ${inv}; рядом: ${near}`;
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
    });
    this.timer = setInterval(() => this.slowTick().catch(() => {}), 1000);
  }

  lookTick() {
    const b = this.bot;
    if (!b || !b.entity || b.pathfinder.isMoving() || this.busyLook || (this.guard && this.guard.fighting)) return;
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
    {
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
    this.log('застрял, пробую выбраться (' + this.stuck.tries + ')');
    b.setControlState('jump', true);
    b.setControlState('back', true);
    setTimeout(() => { try { b.setControlState('jump', false); b.setControlState('back', false); const g = b.pathfinder.goal; if (g) b.pathfinder.setGoal(g, b.pathfinder.dynamicGoal); } catch {} }, 400);
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

  // --- действия
  cancel() {
    this.token++;
    this.mode = 'idle';
    this.task = '';
    this.followName = '';
    if (this.bot) { try { this.bot.pathfinder.setGoal(null); this.bot.clearControlStates(); } catch {} }
  }

  check(tok) { if (tok !== this.token) throw new Cancelled('отменено'); }

  async goto(goal, tok, timeoutMs = 120000) {
    const b = this.bot;
    let timer;
    try {
      await Promise.race([
        b.pathfinder.goto(goal),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('не дошёл за отведённое время')), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
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

  async take(a, tok) {
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

  async portal(a, tok) {
    const b = this.bot;
    const from = b.game.dimension;
    await this.goto(new goals.GoalNear(+a.x, +a.y, +a.z, 1), tok);
    this.busyLook = true;
    try {
      await b.lookAt(new Vec3(+a.x + 0.5, +a.y + 0.5, +a.z + 0.5), true);
      b.setControlState('forward', true);
      await sleep(600);
      b.setControlState('forward', false);
      for (let i = 0; i < 40 && b.game.dimension === from; i++) { await sleep(500); this.check(tok); }
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
    try {
      for (const a of plain) {
        this.check(tok);
        let r;
        switch (a.act) {
          case 'goto': await this.goto(new goals.GoalNear(+a.x, +a.y, +a.z, 1), tok, 300000); r = `дошёл до ${a.x} ${a.y} ${a.z}`; break;
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
          case 'goto_place': {
            const pl = this.memory && this.memory.findPlace(a.name);
            if (!pl) throw new Error(`не знаю места «${a.name}»`);
            if (pl.dim !== this.dimName()) throw new Error(`место «${pl.name}» в другом измерении (${pl.dim}), туда через портал`);
            await this.goto(new goals.GoalNear(pl.x, pl.y, pl.z, 2), tok, 600000);
            r = `пришёл к месту «${pl.name}»`;
            break;
          }
          case 'wait': await sleep(Math.min(60, +a.seconds || 3) * 1000); this.check(tok); r = 'подождал'; break;
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
