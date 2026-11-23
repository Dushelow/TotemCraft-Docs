// Инструменты «узнать» и «подготовиться» (23.11, владелец: «инструментов мало, он слаб»; разбор AUTONOMY_REPORT.md).
// Принцип: нейросеть решает, что и зачем; тело даёт ей глаза, ноги и память, а не узкие команды.
//   !survey(радиус)     - обойти окрестность по всем видимым проходам до развилок и рассказать, что тут есть: куда ведут
//                         проходы, порталы, постройки, жители, опасности. Ответ на «найди сам», «изучи хаб», «догадайся»;
//   !link(A, B, как)    - записать связь мест («из хаба по северной ветке к замку»); сами пишутся: проход из обследования,
//                         пройденный портал, показанная дорога;
//   !howTo(B[, A])      - как пройти из A (или отсюда) в B: показанная дорога, цепочка связей, порталы, дорога в сторону;
//   !prepare(цель)      - собраться в путь или к делу: еда, лодка (лёд, вода), блоки, оружие и броня, вещи для квеста;
//   !findEntity(кто, р) - где ближайшие существа вида (жители, коровы, игроки, враги) и сколько;
//   !scan(блок, р)      - сколько таких блоков рядом и где ближайшие (руда, сундуки, кровати, порталы, что угодно).
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR8 = ['восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад', 'север', 'северо-восток'];
const dirName = (dx, dz) => DIR8[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];

class Survey {
  /** Обследование: проходы вокруг - пройти по каждому до 30 бл. (или до конца), посмотреть, что там; вернуться. */
  async survey(a, tok) {
    const b = this.bot, start = b.entity.position.clone(), R = Math.max(16, Math.min(80, +a.radius || 40));
    const until = Date.now() + Math.min(8 * 60000, +a.ms || 4 * 60000);
    const dim = this.dimName();
    const seen = [], done = new Set();
    const look = (tag) => {
      this.featuresTick && this.featuresTick(true);
      const S = this._scene || { roads: [], marks: [], signs: [] };
      for (const r of S.roads) {
        const k = `${Math.round((r.e1.x + r.e2.x) / 8)},${Math.round((r.e1.z + r.e2.z) / 8)}`;
        if (!seen.some((x) => x.k === k)) seen.push({ k, r, from: tag });
      }
    };
    look('отсюда');
    const report = [], lines = [];   // пройденные линии: тот же проход, увиденный с другого места, - не новый (стенд 23.11: 10 «проходов» из 3)
    const sameLine = (r) => {
      const mx = (r.e1.x + r.e2.x) / 2, mz = (r.e1.z + r.e2.z) / 2, L = Math.hypot(r.e2.x - r.e1.x, r.e2.z - r.e1.z) || 1, ux = (r.e2.x - r.e1.x) / L, uz = (r.e2.z - r.e1.z) / L;
      // та же прямая И тот же пройденный отрезок (север и юг через зал - одна прямая, но разные проходы)
      return lines.some((l) => { const t = (mx - l.x) * l.ux + (mz - l.z) * l.uz; return Math.abs(ux * l.ux + uz * l.uz) > 0.9 && Math.abs(-(mx - l.x) * l.uz + (mz - l.z) * l.ux) < 3 && t > -2 && t < (l.len || 0) + 2; });
    };
    // проходы по очереди: ближний конец - вход, дальний - куда идти (до 30 бл. за раз)
    for (let guard = 0; guard < 10 && Date.now() < until; guard++) {
      this.check(tok);
      const me = b.entity.position;
      const cand = seen.filter((x) => !done.has(x.k) && !sameLine(x.r)).map((x) => {
        const d1 = Math.hypot(x.r.e1.x - me.x, x.r.e1.z - me.z), d2 = Math.hypot(x.r.e2.x - me.x, x.r.e2.z - me.z);
        const near = d1 < d2 ? x.r.e1 : x.r.e2, far = d1 < d2 ? x.r.e2 : x.r.e1;
        return { ...x, near, far, d: Math.min(d1, d2) };
      }).filter((x) => Math.hypot(x.far.x - start.x, x.far.z - start.z) <= R + 30).sort((p, q) => p.d - q.d);
      const c = cand[0]; if (!c) break;
      done.add(c.k);
      const L = Math.hypot(c.far.x - c.near.x, c.far.z - c.near.z) || 1, ux = (c.far.x - c.near.x) / L, uz = (c.far.z - c.near.z) / L;
      // продолжение уже пройденного (та же прямая, тот же ход, начало у его конца) - дописать в ту же запись
      const cont = lines.find((l) => ux * l.ux + uz * l.uz > 0.9 && Math.abs(-(c.near.x - l.x) * l.uz + (c.near.z - l.z) * l.ux) < 3 && Math.abs((c.near.x - l.x) * l.ux + (c.near.z - l.z) * l.uz - l.len) < 6);
      const line = cont || { x: c.near.x, z: c.near.z, ux, uz, len: 0 }; if (!cont) lines.push(line);
      // проход идёт от меня в сторону, где я уже был (обратно к началу), - не новый
      if (Math.hypot(c.far.x - start.x, c.far.z - start.z) < Math.hypot(c.near.x - start.x, c.near.z - start.z) - 2 && Math.hypot(c.near.x - start.x, c.near.z - start.z) > 6) continue;
      const go = Math.min(L, 30), tx = Math.round(c.near.x + ux * go), tz = Math.round(c.near.z + uz * go);
      let reached = true;
      try { await this.goto(new goals.GoalNearXZ(tx, tz, 2), tok, 40000); } catch (e) { if (this.isCancel(e)) throw e; reached = false; }
      const p = b.entity.position;
      line.len = Math.max(line.len, (p.x - line.x) * ux + (p.z - line.z) * uz);   // пройденная часть прямой
      // кончается ли: дальше по той же линии проходимо ещё 4 бл.?
      const ahead = (() => { for (let k = 1; k <= 5; k++) { const x = Math.floor(p.x + ux * k), z = Math.floor(p.z + uz * k); const f = b.blockAt(new Vec3(x, Math.floor(p.y), z)), h = b.blockAt(new Vec3(x, Math.floor(p.y) + 1, z)); if (!f || !h || f.boundingBox !== 'empty' || h.boundingBox !== 'empty' || /chest|barrel|bed|table|furnace/.test(f.name)) return false; } return true; })();
      const what = this.surveySpot(p, 7);
      const name = `${c.r.label ? '«' + c.r.label + '» ' : ''}${c.r.kind || 'дорога'} из ${c.r.mat[0]} на ${dirName(ux, uz)}`;
      const entry = `${name}: ${reached ? 'прошёл ' + Math.round(line.len) + ' бл.' : 'не прошёл'}${ahead ? ', идёт дальше' : ', кончается'}${what ? '; там: ' + what : ''}`;
      if (cont && line.ri !== undefined) report[line.ri] = entry; else { line.ri = report.length; report.push(entry); }
      // связь: отсюда по этому проходу туда
      if (reached && this.memory) this.linkAdd({ a: `${Math.floor(c.near.x)} ${Math.floor(c.near.z)}`, b: `${Math.floor(p.x)} ${Math.floor(p.z)}`, how: name + (what ? ' (' + what + ')' : ''), dim, ax: c.near.x, az: c.near.z, bx: p.x, bz: p.z });
      look(name);
    }
    // вернуться, откуда начал (обследование - не уход)
    if (a.stay !== true) { try { await this.goto(new goals.GoalNear(start.x, start.y, start.z, 2), tok, 60000); } catch (e) { if (this.isCancel(e)) throw e; } }
    const here = this.surveySpot(start, 48);
    return `обследовал до ${R} бл. (${report.length} проходов): ${report.join(' | ') || 'проходов не видно'}${here ? ' || вокруг: ' + here : ''}`;
  }

  /** Что есть у точки: порталы, постройки и их назначение, жители, враги, таблички. */
  surveySpot(p, r = 20) {
    const b = this.bot, out = [];
    try { const n = b.findBlocks({ point: p, matching: b.registry.blocksByName.nether_portal.id, maxDistance: r, count: 50 }); if (n.length) out.push(`портал у ${n[0].x} ${n[0].y} ${n[0].z}`); } catch {}
    // приметные блоки рядом: сундуки, кровати, верстаки, печи, рабочие места жителей, кафедры, колокол
    try {
      const NOTE = { chest: 'сундук', barrel: 'бочка', _bed: 'кровать', crafting_table: 'верстак', furnace: 'печь', lectern: 'кафедра', bell: 'колокол', anvil: 'наковальня', enchanting_table: 'стол зачарований', brewing_stand: 'варочная стойка', composter: 'компостер', smoker: 'коптильня' };
      const found = {};
      for (const v of b.findBlocks({ point: p, matching: (bl) => Object.keys(NOTE).some((k) => bl.name === k || bl.name.endsWith(k)), maxDistance: Math.min(r, 8), count: 40 })) {
        const n = b.blockAt(v).name, k = Object.keys(NOTE).find((q) => n === q || n.endsWith(q)); found[NOTE[k]] = (found[NOTE[k]] || 0) + 1;
      }
      const t = Object.entries(found).map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(', ');
      if (t) out.push(t);
    } catch {}
    const ents = Object.values(b.entities).filter((e) => e !== b.entity && e.position && e.position.distanceTo(p) < r);
    const vill = ents.filter((e) => e.name === 'villager').length, pl = ents.filter((e) => e.type === 'player').map((e) => e.username);
    const foes = ents.filter((e) => this.guard && this.guard.isHostile && this.guard.isHostile(e)).map((e) => e.name);
    if (vill) out.push(`жителей ${vill}`);
    if (pl.length) out.push(`игроки: ${pl.join(', ')}`);
    if (foes.length) out.push(`враги: ${[...new Set(foes)].join(', ')}`);
    try { const t = this.placeText && this.placeText(); if (t) out.push(t.slice(0, 120)); } catch {}
    try { const S = this._scene; if (S && S.signs && S.signs.length) out.push('таблички: ' + S.signs.slice(0, 3).map((s) => s.subj).join(', ')); } catch {}
    return out.join('; ');
  }

  // ---------- связи мест
  linkAdd(l) {
    const m = this.memory; if (!m) return 'памяти нет';
    const L = (m.data.links = m.data.links || []);
    const dup = L.find((x) => x.a === l.a && x.b === l.b && x.dim === l.dim);
    const rec = { a: String(l.a).slice(0, 60), b: String(l.b).slice(0, 60), how: String(l.how || '').slice(0, 160), dim: l.dim || this.dimName(), ax: l.ax, az: l.az, bx: l.bx, bz: l.bz, at: Date.now() };
    if (dup) Object.assign(dup, rec); else L.push(rec);
    if (L.length > 300) L.splice(0, L.length - 300);
    m.save();
    return `запомнил связь: ${rec.a} -> ${rec.b}${rec.how ? ' (' + rec.how + ')' : ''}`;
  }
  /** !link(A, B, как): названия мест или координаты «x z». */
  link(a) {
    const pos = (n) => { const pl = this.memory && this.memory.findPlace(n); if (pl) return pl; const m = /(-?\d+)\D+(-?\d+)/.exec(String(n)); return m ? { x: +m[1], z: +m[2] } : null; };
    const A = pos(a.a), B = pos(a.b);
    return this.linkAdd({ a: a.a, b: a.b, how: a.how, dim: (A && A.dim) || this.dimName(), ax: A && A.x, az: A && A.z, bx: B && B.x, bz: B && B.z });
  }

  /** Как пройти в B (из A или отсюда): всё, что тело знает, по порядку надёжности. */
  howTo(a) {
    const b = this.bot, me = b.entity.position, dim = this.dimName();
    const out = [];
    const to = String(a.to || a.b || '').trim(), from = String(a.from || a.a || '').trim();
    if (!to) return 'куда? !howTo(место)';
    // 1) показанная дорога
    try { const rt = this.routeFind && this.routeFind(to); if (rt) out.push(`есть показанная дорога «${rt.name}» (${rt.pts.length} точек): !route(${rt.name})`); } catch {}
    // 2) цепочка связей (поиск в ширину по названиям)
    const L = (this.memory && this.memory.data.links) || [];
    if (L.length) {
      const startNames = from ? [from.toLowerCase()] : L.filter((l) => l.ax !== undefined && l.dim === dim && Math.hypot(l.ax - me.x, l.az - me.z) < 40).map((l) => l.a.toLowerCase());
      const q = startNames.map((n) => [n, []]), seenN = new Set(startNames);
      let found = null;
      while (q.length && !found) {
        const [n, path] = q.shift();
        for (const l of L.filter((x) => x.a.toLowerCase() === n || x.b.toLowerCase() === n)) {
          const nx = l.a.toLowerCase() === n ? l.b : l.a, p2 = path.concat(`${l.a} -> ${l.b}${l.how ? ' (' + l.how + ')' : ''}`);
          if (nx.toLowerCase().includes(to.toLowerCase())) { found = p2; break; }
          if (!seenN.has(nx.toLowerCase()) && p2.length < 8) { seenN.add(nx.toLowerCase()); q.push([nx.toLowerCase(), p2]); }
        }
      }
      if (found) out.push('по связям: ' + found.join('; '));
    }
    // 3) место и порталы (расчёт дальнего пути)
    const pl = this.memory && this.memory.findPlace(to);
    if (pl && this.travel) {
      try { const plan = this.travel.plan(me, b.game.dimension, { x: pl.x, y: pl.y, z: pl.z, dim: pl.dim }); if (plan && !plan.error) out.push(`расчёт: ${plan.text}`); else if (plan) out.push(`расчёт: ${plan.error}`); } catch {}
    }
    // 4) дорога в ту сторону
    try {
      const tgt = pl ? { x: pl.x, z: pl.z, name: to } : (() => { const m = /(-?\d+)\D+(-?\d+)/.exec(to); return m ? { x: +m[1], z: +m[2] } : null; })();
      const rt = tgt && this.roadToward && this.roadToward(dim, me, tgt);
      if (rt) out.push(`дорога в ту сторону: ${rt.road.kind || 'дорога'} из ${rt.road.mat[0]} от ${rt.road.start.x} ${rt.road.start.z}`);
    } catch {}
    if (!out.length) return `как пройти к «${to}», не знаю: места нет в памяти, связей и дорог туда не видел. Можно !survey, спросить хозяина или дать координаты`;
    return `к «${to}»: ` + out.join(' | ');
  }

  // ---------- подготовка
  /** Собраться к делу или в путь: a.goal - место, координаты или вид дела («поход», «война», «шахта», «Незер»). */
  async prepare(a, tok) {
    const b = this.bot, goal = String(a.goal || a.to || '').toLowerCase(), notes = [];
    const pl = this.memory && this.memory.findPlace(goal), m = /(-?\d+)\D+(-?\d+)/.exec(goal);
    const tgt = pl || (m ? { x: +m[1], z: +m[2], dim: 'обычный мир' } : null);
    const far = tgt ? Math.hypot(tgt.x - b.entity.position.x, tgt.z - b.entity.position.z) : 0;
    let plan = null; try { if (tgt && this.travel) plan = this.travel.plan(b.entity.position, b.game.dimension, { x: tgt.x, y: tgt.y || 64, z: tgt.z, dim: tgt.dim }); } catch {}
    const nether = /незер|nether|ад/.test(goal) || (plan && /Незер/.test(plan.text || ''));
    // 1) еда, блоки, обсидиан и огниво (если в конце может не быть портала) - из своих сундуков
    try { notes.push('вещи: ' + await this.gearUp()); } catch (e) { if (this.isCancel(e)) throw e; notes.push('вещи: ' + e.message); }
    // 2) лодка: путь по Незеру (ледяные дороги метро) или по воде
    const inv = this.invCounts();
    if ((nether || far > 300) && !Object.keys(inv).some((n) => /_boat$|_raft$/.test(n))) {
      try { const r = await this.obtain({ item: 'oak_boat', count: 1 }, tok); notes.push('лодка: ' + r); } catch (e) { if (this.isCancel(e)) throw e; notes.push('лодки нет (' + e.message.slice(0, 60) + ') - сделаю из 5 досок, если будут'); }
    }
    // 3) бой: набор по опасности (Незер, война - серьёзнее)
    try { notes.push(await this.loadout({ kit: /война|рейд|пвп/.test(goal) ? 'война' : nether ? 'мечник' : 'универсал' }, tok)); } catch (e) { if (this.isCancel(e)) throw e; }
    // 4) вещи для квеста: «отдать ник предмет» - чтобы были с собой
    try {
      const q = this.errand && this.errand();
      for (const s of (q && q.steps) || []) {
        const item = s.item || (s.act && (s.act.item));
        const n = +(s.count || (s.act && s.act.count) || 1);
        if (item && (s.do === 'give' || (s.act && s.act.act === 'give')) && (this.invCounts()[item] || 0) < n) {
          try { notes.push(`для квеста ${item}: ` + await this.obtain({ item, count: n }, tok)); } catch (e) { if (this.isCancel(e)) throw e; notes.push(`для квеста нет ${item} (${e.message.slice(0, 60)})`); }
        }
      }
    } catch {}
    if (plan) notes.push('путь: ' + (plan.text || plan.error));
    return `собрался${goal ? ' к «' + goal + '»' : ''}: ` + notes.join(' | ');
  }

  // ---------- поиск
  findEntity(a) {
    const b = this.bot, me = b.entity.position, r = Math.min(128, +a.radius || 64), w = String(a.who || a.what || '').toLowerCase();
    const RU = { 'житель': 'villager', 'жители': 'villager', 'жителей': 'villager', 'корова': 'cow', 'коровы': 'cow', 'овца': 'sheep', 'овцы': 'sheep', 'свинья': 'pig', 'курица': 'chicken', 'лошадь': 'horse', 'игрок': 'player', 'игроки': 'player', 'враг': 'hostile', 'враги': 'hostile', 'зомби': 'zombie', 'скелет': 'skeleton', 'крипер': 'creeper' };
    const want = RU[w] || w;
    const list = Object.values(b.entities).filter((e) => e !== b.entity && e.position && e.position.distanceTo(me) <= r && (
      want === 'player' ? e.type === 'player' : want === 'hostile' ? (this.guard && this.guard.isHostile(e)) : (e.name || '').includes(want) || (e.username || '').toLowerCase().includes(want)))
      .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me));
    if (!list.length) return `${w || 'никого'}: в ${r} бл. не вижу`;
    return `${w}: ${list.length} в ${r} бл.; ближайшие: ` + list.slice(0, 5).map((e) => `${e.username || e.name} ${Math.floor(e.position.x)} ${Math.floor(e.position.y)} ${Math.floor(e.position.z)} (${Math.round(e.position.distanceTo(me))} бл.)`).join(', ');
  }
  scanBlocks(a) {
    const b = this.bot, me = b.entity.position, r = Math.min(64, +a.radius || 32), w = String(a.block || '').toLowerCase().replace(/^minecraft:/, '');
    const ids = Object.values(b.registry.blocksByName).filter((x) => x.name === w || x.name.includes(w)).map((x) => x.id);
    if (!ids.length) return `не знаю блока «${w}»`;
    const ps = b.findBlocks({ matching: ids, maxDistance: r, count: 400 });
    if (!ps.length) return `${w}: в ${r} бл. нет`;
    return `${w}: ${ps.length}${ps.length >= 400 ? '+' : ''} в ${r} бл.; ближайшие: ` + ps.slice(0, 5).map((p) => `${b.blockAt(p).name} ${p.x} ${p.y} ${p.z} (${Math.round(p.distanceTo(me))} бл.)`).join(', ');
  }
}

module.exports = { Survey };
