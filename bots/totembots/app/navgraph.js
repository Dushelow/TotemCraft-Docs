// Ориентирование как у настоящих роботов (23.11, владелец: «как справляются умные роботы Тесла и Бостон Динамикс?»):
//   - КАРТА СВЯЗЕЙ (у Spot - GraphNav): места и переходы между ними графом. Основа - тропы (travel.js Trails): где
//     прошёл бот и где ходили игроки рядом. Сюда же - проходы, которые тело увидело (features.js: дороги, тоннели,
//     мосты, коридоры), даже если по ним ещё не ходили: увидел - знает, что там можно пройти и куда это ведёт;
//   - РАЗВЕДКА ГРАНИЦ (frontier exploration): до цели граф не доходит - идти по графу к самой близкой к цели известной
//     точке (край знаний), а оттуда дальше разведкой; каждый пройденный кусок становится частью графа;
//   - ПОКАЗ МАРШРУТА (у Spot - Autowalk): «покажу дорогу до X» - хозяин ведёт, тело идёт следом и записывает путь
//     (с переходами через порталы), «пришли» - маршрут сохранён под именем; потом !route(X) - пройти его самому, туда
//     или обратно. Таблички и цвета не нужны: имя маршруту даёт тот, кто показал.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NavGraph {
  /** Увиденные проходы - в граф троп: точки вдоль отрезка через ~8 бл., связанные по порядку. */
  graphFeed(roads) {
    if (!this.travel || !this.travel.trails || !this.bot || !this.bot.game) return;
    const { dkey } = require('./travel');
    const d = dkey(this.bot.game.dimension), T = this.travel.trails;
    for (const r of roads) {
      if (r.y === undefined || r.len < 8) continue;
      const n = Math.max(1, Math.round(r.len / 8)), st = {};
      for (let i = 0; i <= n; i++) {
        const x = r.e1.x + (r.e2.x - r.e1.x) * i / n, z = r.e1.z + (r.e2.z - r.e1.z) * i / n;
        // step связывает точки не дальше 14 бл. - через 8 бл. связь будет
        T.step(d, { x: x + 0.5, y: r.y, z: z + 0.5 }, st);
      }
    }
  }

  /**
   * Край знаний: по графу от себя - к точке, ближайшей к цели (если она заметно ближе). Возвращает точки пути или null.
   */
  frontierRoute(d, me, tgt) {
    const T = this.travel && this.travel.trails; if (!T) return null;
    const g = T.load(d), s = T.near(d, me, 24);
    if (s < 0) return null;
    const D = (i, j) => Math.hypot(g.n[i][0] - g.n[j][0], g.n[i][1] - g.n[j][1], g.n[i][2] - g.n[j][2]);
    const dist = new Map([[s, 0]]), prev = new Map(), open = [s];
    while (open.length) {
      open.sort((a, b) => dist.get(a) - dist.get(b));
      const u = open.shift();
      for (const v of g.e[u] || []) { const nd = dist.get(u) + D(u, v); if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); open.push(v); } }
      if (dist.size > 4000) break;
    }
    const here = Math.hypot(tgt.x - me.x, tgt.z - me.z);
    let best = -1, bd = here * 0.7;
    for (const [i, c] of dist) {
      const k = Math.hypot(g.n[i][0] - tgt.x, g.n[i][2] - tgt.z);
      if (k < bd && c < here * 2 + 64) { bd = k; best = i; }   // ближе к цели, а путь по графу не безумно длинный
    }
    if (best < 0 || here - bd < 24) return null;
    const out = []; for (let i = best; i !== undefined; i = prev.get(i)) out.unshift({ x: g.n[i][0], y: g.n[i][1], z: g.n[i][2] });
    return { points: out, left: bd };
  }

  /** Пройти по точкам графа (через одну, последнюю обязательно). */
  async walkPoints(pts, tok, ms) {
    const { goals } = require('mineflayer-pathfinder');
    const b = this.bot, until = Date.now() + ms;
    const list = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    for (const p of list) {
      this.check(tok);
      if (Math.hypot(p.x - b.entity.position.x, p.z - b.entity.position.z) < 3) continue;
      await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, Math.max(20000, until - Date.now()));
    }
  }

  // ---------- показ маршрута
  /** «Покажу дорогу до X»: идти за хозяином и записывать его путь (точки через 4 бл., измерение у каждой). */
  teachStart(a) {
    const who = a.who || (this.opts.masters || [])[0];
    const name = String(a.name || '').trim();
    if (!who) throw new Error('не знаю, за кем идти');
    if (!name) throw new Error('как назвать дорогу? например: «покажу дорогу до замка»');
    this._teach = { name, who, pts: [], at: Date.now() };
    try { this.follow(who); } catch {}
    this.log(`запись маршрута «${name}»: иду за ${who} и запоминаю путь`);
    return `иду за ${who} и запоминаю дорогу «${name}»; скажи «пришли», когда дойдём`;
  }
  teachTick() {
    const T = this._teach; if (!T || !this.bot || !this.bot.entity) return;
    const e = this.player && this.player(T.who);
    const dim = this.dimName ? this.dimName() : '';
    const p = e ? e.position : null;
    if (!p) return;
    const last = T.pts[T.pts.length - 1];
    // как хозяин проходит: в тесноте (лаз, лестница, вода, люк, дверь рядом) - каждый блок, на просторе - через 4
    // (23.11: секретная дверь, кнопка под лестницей, лаз с люками - бот проходил «пердя скрипя», без записи хода)
    const ba = (v) => (typeof this.bot.blockAt === 'function' ? this.bot.blockAt(v) : null);
    const f = p.floored(), at = (dx, dy, dz) => (ba(f.offset(dx, dy, dz)) || {}).name || '';
    const ladder = /ladder|vine|scaffolding/.test(at(0, 0, 0) + at(0, 1, 0));
    const wet = /water/.test(at(0, 0, 0));
    const tight = ladder || wet || [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => { const k = ba(f.offset(dx, 1, dz)); return k && k.boundingBox === 'block'; }).length >= 2
      || [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([dx, dz]) => /door|trapdoor|gate|pressure_plate|button|lever/.test(at(dx, 0, dz) + at(dx, 1, dz) + at(dx, -1, dz)));
    const step = tight ? 1 : 4;
    if (!last || last.dim !== dim || Math.hypot(last.x - p.x, last.z - p.z) >= step || Math.abs(last.y - p.y) >= (tight ? 1 : 3)) T.pts.push({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim, ...(ladder ? { ladder: 1 } : {}), ...(tight ? { tight: 1 } : {}), ...(wet ? { wet: 1 } : {}) });
    if (Date.now() - T.at > 2 * 3600000) this.teachStop(true);
  }
  teachStop(timeout) {
    const T = this._teach; if (!T) return 'я ничего не записывал';
    // «пришли» - где хозяин стоит сейчас, это и есть конец дороги (последний шаг мог не попасть в запись)
    try { const e = this.player && this.player(T.who); if (e) { const p = e.position, last = T.pts[T.pts.length - 1], dim = this.dimName ? this.dimName() : ''; if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1.5) T.pts.push({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim }); } } catch {}
    this._teach = null;
    if (T.pts.length < 2) return 'дорога слишком короткая - не записал';
    const m = this.memory;
    if (m) {
      const R = (m.data.routes = m.data.routes || {});
      R[T.name.toLowerCase()] = { name: T.name, pts: T.pts, by: T.who, at: Date.now() };
      const end = T.pts[T.pts.length - 1];
      m.place({ name: T.name, x: end.x, y: end.y, z: end.z, dim: end.dim, note: `конец показанной дороги (${T.pts.length} точек)` }, this.opts.name + ` (показал ${T.who})`);
      m.save();
    }
    const len = T.pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - T.pts[i - 1].x, p.z - T.pts[i - 1].z) : 0), 0);
    const dims = [...new Set(T.pts.map((p) => p.dim))];
    return `${timeout ? 'запись остановлена по времени; ' : ''}запомнил дорогу «${T.name}»: ${T.pts.length} точек, ~${Math.round(len)} бл.${dims.length > 1 ? ', через ' + dims.join(' -> ') : ''}`;
  }

  /** Записанный маршрут по имени (или ведущий к месту с таким именем). */
  routeFind(name) {
    const R = (this.memory && this.memory.data.routes) || {}, n = String(name || '').toLowerCase().trim();
    if (!n) return null;
    if (R[n]) return R[n];
    const words = n.split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 2);
    return Object.values(R).find((r) => words.some((w) => r.name.toLowerCase().includes(w))) || null;
  }

  /** Пройти показанный маршрут: от ближайшей его точки (туда или обратно), с порталами по пути. */
  async routeRun(a, tok) {
    const r = this.routeFind(a.name);
    if (!r) throw new Error(`не знаю дороги «${a.name}» - покажи её: «покажу дорогу до ${a.name}»`);
    const b = this.bot, me = b.entity.position, dim = this.dimName();
    let pts = r.pts.slice();
    if (a.back) pts.reverse();
    // начать с ближайшей точки маршрута в этом измерении (вдруг уже на полпути)
    let i0 = 0, bd = Infinity;
    pts.forEach((p, i) => { if (p.dim === dim) { const k = Math.hypot(p.x - me.x, p.z - me.z); if (k < bd) { bd = k; i0 = i; } } });
    if (bd === Infinity) throw new Error(`дорога «${r.name}» начинается в другом мире (${pts[0].dim})`);
    pts = pts.slice(i0);
    this.log(`иду по показанной дороге «${r.name}»: ${pts.length} точек`);
    for (let i = 0; i < pts.length; i++) {
      this.check(tok);
      const p = pts[i];
      if (p.dim !== this.dimName()) {
        // в записи сменился мир - тут хозяин прошёл через портал: войти в ближайший
        this.log(`по дороге «${r.name}» - портал в ${p.dim}`);
        await this.run([{ act: 'portal' }], 'портал по маршруту', 'master');
        await sleep(1500);
        if (this.dimName() !== p.dim) throw new Error(`портал привёл не туда (${this.dimName()}, а в записи ${p.dim})`);
        continue;
      }
      if (p.press) {
        // здесь хозяин нажал кнопку, рычаг или встал на плиту - сделать то же и сразу дальше, бегом
        const k = b.blockAt(new (b.entity.position.constructor)(p.press.x, p.press.y, p.press.z));
        try {
          if (k && /_pressure_plate$/.test(k.name)) await this.goto(new goals.GoalBlock(p.press.x, p.press.y, p.press.z), tok, 20000);
          else if (k) { await this.goto(new goals.GoalNear(p.press.x, p.press.y, p.press.z, 2), tok, 20000); await b.lookAt(k.position.offset(0.5, 0.5, 0.5), true); await b.activateBlock(k); }
          this.log(`по дороге «${r.name}»: ${k ? k.name : 'механизм'} у ${p.press.x} ${p.press.y} ${p.press.z}, как хозяин`);
          if (this.dashAfterMech) this.dashAfterMech();
        } catch (e) { if (this.isCancel(e)) throw e; }
        continue;
      }
      if (p.ladder) {
        // участок лестницы: лезть до её конца навыком, пропустив записанные точки лестницы
        let j = i; while (j + 1 < pts.length && pts[j + 1].ladder) j++;
        const up = pts[j].y >= p.y;
        if (Math.abs(b.entity.position.y - pts[j].y) > 1.5) { try { await this.climbLadder({ dir: up ? 'up' : 'down' }, tok); } catch (e) { if (this.isCancel(e)) throw e; } }
        i = j; continue;
      }
      if (!p.tight && i % 2 && i !== pts.length - 1) continue;   // на просторе через точку - ~8 бл., ровнее
      if (Math.hypot(p.x - b.entity.position.x, p.z - b.entity.position.z) < (p.tight ? 0.8 : 3) && Math.abs(p.y - b.entity.position.y) < 1.5) continue;
      try { await this.walkTo({ x: p.x, y: p.y, z: p.z }, tok, p.tight ? 20000 : 120000); }
      catch (e) {
        if (this.isCancel(e) || !p.tight) throw e;
        // в тесноте путь не строится (течение, ребро люка) - как хозяин: лицом к точке и вперёд руками
        await this.stepTo(p, tok);
      }
    }
    return `прошёл по дороге «${r.name}»`;
  }

  /** Шаг руками к соседней точке (лаз, вода, ребро люка), как игрок: лицом, вперёд, прыжок вверх/в воде - вперёд под водой. */
  async stepTo(p, tok) {
    const b = this.bot, V = b.entity.position.constructor, t = new V(p.x + 0.5, p.y, p.z + 0.5), until = Date.now() + 3000;
    const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
    try {
      while (Date.now() < until) {
        this.check(tok);
        const q = b.entity.position;
        if (Math.hypot(t.x - q.x, t.z - q.z) < 0.6 && Math.abs(t.y - q.y) < 1.2) return true;
        await b.lookAt(t.offset(0, 1.5, 0), true);
        const wet = /water/.test((b.blockAt(q) || {}).name || ''), upy = t.y - q.y;
        ctl('forward', true); ctl('sprint', true); ctl('jump', wet ? upy > 0.6 : upy > 0.4); ctl('sneak', false);
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    } finally { for (const k of ['forward', 'sprint', 'jump', 'sneak']) ctl(k, false); }
  }

  /** Для мозга: какие дороги показаны. */
  routesText() {
    const R = (this.memory && this.memory.data.routes) || {};
    const v = Object.values(R);
    return v.length ? 'показанные дороги: ' + v.map((r) => `«${r.name}» (${r.pts.length} точек, ${[...new Set(r.pts.map((p) => p.dim))].join('->')})`).join(', ') : '';
  }
}

module.exports = { NavGraph };
