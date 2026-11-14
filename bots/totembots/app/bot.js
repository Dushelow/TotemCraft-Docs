// Тело бота: mineflayer + pathfinder. Ходит компаньоном, берёт и кладёт вещи в сундуки, отдаёт вещи игрокам,
// проходит порталы. Блоки не ломает и не ставит (на живом сервере это был бы гриф).
// Заходит клиентом 1.21.11: его mineflayer поддерживает полностью, сервер 26.3 пускает через ViaVersion.
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('events');

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
    const { name, host, port } = this.opts;
    this.status = 'connecting';
    this.log(`захожу на ${host}:${port} как ${name}`);
    const bot = this.bot = mineflayer.createBot({ host, port, username: name, version: VERSION, auth: 'offline', hideErrors: true });
    bot.loadPlugin(pathfinder);
    bot._client.on('show_dialog', (d) => this.onDialog(d));

    bot.once('spawn', () => {
      this.status = 'online';
      const mv = new Movements(bot);
      mv.canDig = false;              // ничего не ломать
      mv.allow1by1towers = false;     // и не строить столбы
      mv.scafoldingBlocks = [];
      mv.allowParkour = true;
      mv.allowSprinting = true;
      mv.canOpenDoors = true;
      this.movements = mv;
      bot.pathfinder.setMovements(mv);
      this.log('на сервере');
      this.event('ты зашёл на сервер');
      this.loops();
    });
    bot.on('spawn', () => { if (this.dim && this.dim !== bot.game.dimension) this.event(`ты в другом измерении: ${this.dimName()}`); this.dim = bot.game.dimension; });
    bot.on('messagestr', (msg, pos, json, sender) => this.onMessage(msg, pos, json, sender));
    // чат игроков (подписанный или нет): автор приходит отдельно от текста
    bot.on('chat', (username, message) => this.playerChat(username, message, false));
    bot.on('whisper', (username, message) => this.playerChat(username, message, true));
    bot.on('death', () => { this.log('умер'); this.event('ты умер и возродился, вещи остались на месте смерти', true); this.cancel(); });
    bot.on('kicked', (r) => this.log('кикнули: ' + this.reason(r)));
    bot.on('error', (e) => this.log('ошибка: ' + e.message));
    bot.on('end', (r) => {
      this.log('отключён: ' + (r || ''));
      this.status = 'off';
      this.bot = null;
      clearInterval(this.timer);
      this.emit('end');
    });
  }

  stop() {
    this.cancel();
    if (this.bot) this.bot.quit();
  }

  reason(r) { try { return typeof r === 'string' ? r : JSON.stringify(r).slice(0, 200); } catch { return String(r); } }

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
    if (/\/reg(ister)?\b/i.test(text) && now - (this.regAt || 0) > 10000) { this.regAt = now; this.bot.chat(`/register ${pw} ${pw}`); this.log('регистрируюсь в AuthMe'); return; }
    if (/\/l(ogin)?\b/i.test(text) && !/\/reg/i.test(text) && now - (this.loginAt || 0) > 10000) { this.loginAt = now; this.bot.chat(`/login ${pw}`); this.log('вхожу в AuthMe'); return; }
    if (pos === 'chat') {
      // сообщение игрока: автор - по UUID отправителя, текст без оформления; личка - по типу чата
      const p = sender && Object.values(this.bot.players).find((x) => x.uuid === sender);
      const whisper = /msg_command|commands\.message\.display\.incoming/.test(String(json && json.translate || ''));
      if (p) this.playerChat(p.username, text, whisper);
      return;
    }
    const parsed = this.parseChat(text);
    if (parsed) this.playerChat(parsed.from, parsed.text, parsed.whisper);
  }

  playerChat(from, text, whisper) {
    if (!from || from === this.opts.name || !text) return;
    const key = from + '|' + text;
    const now = Date.now();
    if (this.lastChat && this.lastChat.key === key && now - this.lastChat.at < 2000) return;   // одно сообщение двумя путями
    this.lastChat = { key, at: now };
    this.emit('player-chat', { from, text: String(text).trim(), whisper });
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

  say(text) { if (this.bot && this.status === 'online') this.bot.chat(String(text).slice(0, 250)); }

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
    b.on('physicsTick', () => { try { b._client.write('tick_end', {}); } catch {} this.lookTick(); });
    this.timer = setInterval(() => this.slowTick().catch(() => {}), 1000);
  }

  lookTick() {
    const b = this.bot;
    if (!b || !b.entity || b.pathfinder.isMoving() || this.busyLook) return;
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
    // еда
    if (b.food < 14 && !this.eating) {
      const food = b.inventory.items().find((i) => b.registry.foodsByName && b.registry.foodsByName[i.name]);
      if (food) {
        this.eating = true;
        try { await b.equip(food, 'hand'); await b.consume(); } catch {} finally { this.eating = false; }
      }
    }
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
