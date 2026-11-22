// Язык тела без чата (22.11, по исследованию владельца: как игроки Minecraft «говорят» движениями). Тело само узнаёт
// жесты и их связки у игроков рядом и отвечает своими - без нейросети; мозгу уходит только смысл («кивнул: да»,
// «показал на сундук», «зовёт за собой»), и только то, о чём есть что решать.
//
// Что видно у игрока (ванильный клиент): присед, прыжок, взмах рукой, поворот головы (кивок, мотание, кружение),
// что в руке, броня, выброшенный рядом предмет, подошёл или ушёл, сел (GSit: ступеньки и нижние полублоки,
// подушки 26.3). Смысл зависит от обстановки: двойной присед - привет, после боя - «без обид», над убитым - насмешка.
//
// Сидение (сервер TotemCraft): GSit сажает на нижнюю ступеньку или полублок по щелчку пустой рукой, встать -
// присесть; /sit - сесть, где стоишь; подушка (26.3) - щелчок по ней. Бот садится рядом с хозяином, когда тот сел.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIN = 3000;   // окно «фразы»: связка движений за 3 с
const WEAPON = /_sword$|_axe$|^bow$|^crossbow$|^trident$|^mace$|_spear$/;
const SEAT = /_stairs$|_slab$/;

class Gestures {
  /** Подключить (из bot.js при входе): события игроков + выборка положения раз в 2 тика. */
  gesturesAttach(bot) {
    this.gx = new Map();   // ник -> { s: [{t,x,y,z,yaw,pitch}], crouch: [t], swing: [t], said: {вид: t}, held, armor, near }
    const get = (e) => {
      if (!e || e.type !== 'player' || !e.username || e === bot.entity) return null;
      let g = this.gx.get(e.username);
      if (!g) this.gx.set(e.username, g = { s: [], crouch: [], swing: [], said: {}, held: null, armor: null });
      return g;
    };
    bot.on('entityCrouch', (e) => { const g = get(e); if (g) { g.crouch.push(Date.now()); if (g.crouch.length > 10) g.crouch.shift(); } });
    bot.on('entitySwingArm', (e) => { const g = get(e); if (g) { g.swing.push(Date.now()); if (g.swing.length > 10) g.swing.shift(); } });
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const p = Object.values(bot.players).map((x) => x.entity).filter((x) => x && x !== bot.entity && x.position.distanceTo(bot.entity.position) < 4.5)
        .sort((a, c) => a.position.distanceTo(bot.entity.position) - c.position.distanceTo(bot.entity.position))[0];
      if (p) { const g = get(p); if (g) { g.hitAt = Date.now(); g.hitEmpty = !p.heldItem; } this.pvpAt = Date.now(); if (p.heldItem && this.affinityAdd) this.affinityAdd(p.username, -5, 'ударил оружием'); }
    });
    bot.on('entityDead', (e) => { if (e && e.position) this.deadAt = { t: Date.now(), pos: e.position.clone() }; });
    bot.on('itemDrop', (e) => {
      // предмет появился рядом с игроком, который смотрит на бота, - вероятно, подарок
      setTimeout(() => {
        if (!e || !e.position || !bot.entity) return;
        for (const pl of Object.values(bot.players)) {
          const p = pl.entity;
          if (!p || p === bot.entity || p.position.distanceTo(e.position) > 2.5 || p.position.distanceTo(bot.entity.position) > 8) continue;
          const g = get(p); if (g && this.facing(p, bot.entity.position) > 0.8) g.dropAt = Date.now();
        }
      }, 300);
    });
    let n = 0;
    bot.on('physicsTick', () => {
      if (++n % 2 || !bot.entity) return;
      try { this.gestureSample(bot); } catch (e) { if (this.fault) this.fault('жесты', e); }
    });
  }

  /** Насколько игрок p смотрит на точку to: 1 - прямо, 0 - вбок, -1 - спиной. */
  facing(p, to) {
    const dx = to.x - p.position.x, dz = to.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    return (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / l;
  }

  gestureSample(bot) {
    const now = Date.now(), me = bot.entity.position;
    for (const pl of Object.values(bot.players)) {
      const p = pl.entity;
      if (!p || p === bot.entity || p.position.distanceTo(me) > 16) continue;
      const g = this.gx.get(pl.username) || (this.gx.set(pl.username, { s: [], crouch: [], swing: [], said: {}, held: null, armor: null }), this.gx.get(pl.username));
      g.s.push({ t: now, x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch, ground: p.onGround !== false });
      while (g.s.length && now - g.s[0].t > 4000) g.s.shift();
      const held = p.heldItem ? p.heldItem.name : '';
      if (g.held !== null && held !== g.held) g.heldAt = now, g.heldPrev = g.held;
      g.held = held;
      const armor = (p.equipment || []).slice(2, 6).filter(Boolean).length;
      if (g.armor !== null && armor < g.armor) g.armorOffAt = now;
      g.armor = armor;
      g.sitting = !!p.vehicle;
      if (g.sitting && !g.satAt) g.satAt = now; else if (!g.sitting) g.satAt = 0;
      const k = this.readGesture(pl.username, g, p, now);
      if (k) this.onGesture(pl.username, k, p, now);
    }
  }

  /** Узнать «фразу» по следу за 3 с. Возвращает { kind, text, at? } или null. Одно и то же - не чаще раза в 4 с. */
  readGesture(name, g, p, now) {
    const me = this.bot.entity.position, d = p.position.distanceTo(me), look = this.facing(p, me);
    const once = (kind, text, extra = {}) => { if (now - (g.said[kind] || 0) < 4000) return null; g.said[kind] = now; return { kind, text, ...extra }; };
    const recent = (arr, ms = WIN) => arr.filter((t) => now - t < ms).length;
    const s = g.s.filter((x) => now - x.t < 1600);
    // кивок / мотание головой: 2+ смены направления и размах
    const swings = (key, amp) => {
      let dir = 0, flips = 0, lo = Infinity, hi = -Infinity;
      for (let i = 1; i < s.length; i++) {
        let dv = s[i][key] - s[i - 1][key];
        if (key === 'yaw') { while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; }
        if (Math.abs(dv) < 0.04) continue;
        const nd = Math.sign(dv); if (dir && nd !== dir) flips++; dir = nd;
        lo = Math.min(lo, s[i][key]); hi = Math.max(hi, s[i][key]);
      }
      return flips >= 2 && hi - lo > amp;
    };
    const crouches = recent(g.crouch, 2500);
    const dead = this.deadAt && now - this.deadAt.t < 20000 && this.deadAt.pos.distanceTo(p.position) < 3;
    if (crouches >= 3 && dead) return once('насмешка', 'приседает над убитым (насмешка)');
    if (crouches >= 2 && this.pvpAt && now - this.pvpAt < 30000) return once('без обид', 'приседает после стычки: «без обид, хорошая игра»');
    if (crouches >= 2 && d < 12) return once('привет', 'приседает тебе: «привет, я свой»');
    if (s.length > 4 && d < 12 && look > 0.6 && swings('pitch', 0.5)) return once('да', 'кивнул: «да»');
    // кружение: суммарный поворот за 1,6 с больше круга
    let tot = 0; for (let i = 1; i < s.length; i++) { let dv = s[i].yaw - s[i - 1].yaw; while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; tot += dv; }
    if (d < 12 && Math.abs(tot) > 5.5) return once('кружится', 'кружится на месте (радуется или дурачится)');
    if (s.length > 4 && d < 12 && look > 0.4 && swings('yaw', 0.6)) return once('нет', 'мотает головой: «нет»');
    // прыжки: 2+ отрыва от земли за 3 с
    let jumps = 0; for (let i = 1; i < g.s.length; i++) if (now - g.s[i].t < WIN && g.s[i].y - g.s[i - 1].y > 0.25 && g.s[i - 1].ground) jumps++;
    if (jumps >= 2 && d < 12) return once('радость', 'прыгает на месте (радуется)');
    if (g.hitAt && now - g.hitAt < 1500 && g.hitEmpty) return once('тычок', 'ткнул тебя рукой: «эй, обрати внимание»');
    if (g.dropAt && now - g.dropAt < 2000) return once('подарок', 'бросил тебе предмет (подарок?)');
    if (g.armorOffAt && now - g.armorOffAt < 2000 && d < 10) return once('мир', 'снял броню: мирные намерения');
    if (g.heldAt && now - g.heldAt < 1500 && d < 10 && look > 0.8) {
      if (WEAPON.test(g.held || '')) return once('оружие', `достал ${g.held} и смотрит на тебя`);
      if (WEAPON.test(g.heldPrev || '') && !g.held) return once('убрал оружие', 'убрал оружие: «я не нападу»');
      if (/flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose/.test(g.held || '')) return once('цветок', 'держит цветок и смотрит на тебя');
    }
    // указал: смотрит на блок в 2-8 бл. и машет по нему (не по сущности)
    if (recent(g.swing, 900) >= 1 && d < 16) {
      try {
        const eye = p.position.offset(0, 1.62, 0), dir = new Vec3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
        const hit = this.bot.world.raycast(eye, dir, 8);
        if (hit && hit.position && hit.position.distanceTo(eye) > 1.5 && look < 0.7) return once('указал', `показал на ${hit.name} ${hit.position.x} ${hit.position.y} ${hit.position.z}`, { at: hit.position });
        if (look > 0.8 && d < 8) return once('эй', 'машет тебе рукой: «эй»');
      } catch {}
    }
    // «за мной»: отошёл от бота на 3+ бл. за 3 с и оглянулся
    const old = g.s.find((x) => now - x.t < WIN);
    if (old && d > 4 && d < 20 && d - Math.hypot(old.x - me.x, old.z - me.z) > 2.5 && look > 0.7) return once('за мной', 'отходит и оглядывается на тебя: «иди за мной»');
    if (g.sitting && g.satAt && now - g.satAt > 1500 && now - g.satAt < 3000 && d < 10) return once('сел', 'сел отдохнуть');
    return null;
  }

  /** Ответ тела сразу + смысл мозгу (только то, о чём есть что решать). */
  onGesture(name, k, p, now) {
    const master = this.isMasterName ? this.isMasterName(name) : name === this.followName;
    this.log(`жест: ${name} ${k.text}`);
    // симпатия по делам (presence.js): подарок, мир, привет - теплее; насмешка, оружие на бота - холоднее
    const AFF = { 'подарок': 4, 'мир': 2, 'убрал оружие': 1, 'цветок': 2, 'привет': 1, 'без обид': 2, 'насмешка': -4, 'оружие': master ? 0 : -2 };
    if (AFF[k.kind] && this.affinityAdd) this.affinityAdd(name, AFF[k.kind], k.kind);
    const cold = this.affinity && this.affinity(name) <= -20;
    this.lastGesture = { name, ...k, t: now };
    if (this.attend) this.attend(name, 2500);
    const reply = {
      'привет': 'привет', 'без обид': 'привет', 'радость': 'радость', 'кружится': 'кружится', 'да': null, 'нет': null,
      'тычок': 'кивок', 'эй': 'кивок', 'подарок': 'спасибо', 'мир': 'привет', 'убрал оружие': 'кивок', 'цветок': 'привет',
      'указал': 'кивок', 'за мной': 'кивок', 'сел': null, 'оружие': null, 'насмешка': null,
    }[k.kind];
    // с тем, кто обижал, - холодно: на привет мотает головой и отворачивается, на радость не отвечает
    const answer = cold ? ({ 'привет': 'нет', 'радость': null, 'кружится': null, 'спасибо': 'кивок' }[reply] ?? reply) : reply;
    if (answer && this.mode !== 'task' && !(this.guard && this.guard.fighting)) this.gesture(answer).catch(() => {});
    if (k.kind === 'указал' && k.at) this.lookTarget = k.at.offset(0.5, 0.5, 0.5);
    if (k.kind === 'подарок' && this.mode === 'idle') setTimeout(() => this.pickup && this.pickup({ radius: 4 }, this.token).catch(() => {}), 600);
    // хозяин позвал жестом - идти следом сразу (без нейросети)
    if (master && k.kind === 'за мной' && this.mode !== 'follow' && this.mode !== 'task' && !this._errandBusy) { try { this.follow(name); } catch {} }
    // хозяин сел - сесть рядом, если есть куда
    if (master && k.kind === 'сел' && this.mode === 'follow') this.sitNear(p.position).catch(() => {});
    // мозгу - смысловые (решать есть что); приветы и радость - нет, тело ответило само
    if (/^(да|нет|указал|подарок|оружие|насмешка|тычок|за мной)$/.test(k.kind)) this.emit('gesture', { name, kind: k.kind, text: k.text, master, aff: this.affinityWord ? this.affinityWord(name) : '' });
  }

  /**
   * Показать жест (тело, без нейросети). Виды: привет (двойной присед), кивок, нет, радость (прыжки), кружится,
   * спасибо (присед и взгляд), поклон, грусть (взгляд вниз), эй (взмах), указать (на lookTarget).
   */
  async gesture(kind) {
    const b = this.bot;
    if (!b || !b.entity || this.gesturing) return;
    this.gesturing = true; this.busyLook = true;
    const yaw0 = b.entity.yaw, pitch0 = b.entity.pitch;
    const look = (y, p) => b.look(y, p, true).catch(() => {});
    try {
      switch (kind) {
        case 'привет': case 'спасибо':
          for (let i = 0; i < 2; i++) { b.setControlState('sneak', true); await sleep(180); b.setControlState('sneak', false); await sleep(180); }
          break;
        case 'кивок': case 'да':
          for (let i = 0; i < 2; i++) { await look(yaw0, 0.6); await sleep(160); await look(yaw0, -0.15); await sleep(160); }
          break;
        case 'нет':
          for (let i = 0; i < 2; i++) { await look(yaw0 + 0.5, pitch0); await sleep(150); await look(yaw0 - 0.5, pitch0); await sleep(150); }
          break;
        case 'радость':
          for (let i = 0; i < 2; i++) { b.setControlState('jump', true); await sleep(120); b.setControlState('jump', false); await sleep(420); }
          break;
        case 'кружится':
          for (let i = 1; i <= 8; i++) { await look(yaw0 + i * Math.PI / 4, pitch0); await sleep(70); }
          break;
        case 'поклон':
          b.setControlState('sneak', true); await look(yaw0, 0.9); await sleep(700); b.setControlState('sneak', false);
          break;
        case 'грусть':
          await look(yaw0, 1.0); await sleep(1500);
          break;
        case 'эй':
          b.swingArm('right'); await sleep(250); b.swingArm('right');
          break;
        default: return;
      }
      await look(yaw0, pitch0);
    } finally { this.gesturing = false; this.busyLook = false; try { b.setControlState('sneak', false); b.setControlState('jump', false); } catch {} }
  }

  /**
   * Сесть рядом с точкой (хозяином): подушка (26.3), нижняя ступенька или полублок до 6 бл. (GSit, щелчок пустой рукой).
   * Встаёт, когда хозяин пошёл (companion.js) - присед.
   */
  async sitNear(pos) {
    const b = this.bot;
    if (b.vehicle || this.seat) return false;
    const cushion = Object.values(b.entities).find((e) => /cushion/.test(e.name || '') && e.position.distanceTo(pos) < 6 && !Object.values(b.entities).some((x) => x.vehicle === e));
    let target = null;
    if (!cushion) {
      const pts = b.findBlocks({ point: pos, matching: (bl) => SEAT.test(bl.name) || /cushion/.test(bl.name), maxDistance: 6, count: 20 });
      for (const v of pts) {
        const bl = b.blockAt(v), pr = bl.getProperties ? bl.getProperties() : {};
        if (/_slab$/.test(bl.name) && pr.type !== 'bottom') continue;
        if (/_stairs$/.test(bl.name) && pr.half !== 'bottom') continue;
        const up = b.blockAt(v.offset(0, 1, 0)), up2 = b.blockAt(v.offset(0, 2, 0));
        if (!up || up.boundingBox !== 'empty' || (up2 && up2.boundingBox !== 'empty')) continue;
        if (Object.values(b.players).some((p) => p.entity && p.entity.position.distanceTo(v.offset(0.5, 0.5, 0.5)) < 0.9)) continue;   // занято
        target = bl; break;
      }
    }
    if (!cushion && !target) return false;
    const where = cushion ? cushion.position : target.position;
    try { await this.goto(new goals.GoalNear(where.x, where.y, where.z, 2), this.token, 15000); } catch { return false; }
    // пустая рука (GSit: empty-hand-only)
    try { const empty = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !b.inventory.slots[36 + i]); if (empty !== undefined) b.setQuickBarSlot(empty); } catch {}
    try { if (cushion) await b.activateEntity(cushion); else await b.activateBlock(target); } catch { return false; }
    await sleep(500);
    if (!b.vehicle) return false;
    this.seat = { since: Date.now(), at: where };
    this.task = 'сижу рядом';
    this.log('села рядом' + (cushion ? ' на подушку' : ` на ${target.name}`));
    return true;
  }

  /** Встать (GSit: присесть). */
  async standUp() {
    const b = this.bot;
    if (!this.seat && !b.vehicle) return;
    this.seat = null;
    if (this.task === 'сижу рядом') this.task = '';
    try { b.setControlState('sneak', true); await sleep(300); b.setControlState('sneak', false); } catch {}
  }
}

module.exports = { Gestures };
