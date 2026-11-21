// Дальние пути: пешком или через Незер (1 блок Незера = 8 обычного мира). Порталы бот знает с карты (видел сам)
// и пары порталов - запомнил, когда сам прошёл (вход -> выход). Хаб Незера, крыша Незера, туннели - всё одно:
// путь из известных порталов. Неизвестный выход в Незере считается по формуле (x/8, z/8), на месте ищется портал.
// Идея путевых точек Незера - из XaeroPlus («видеть точки обычного мира в Незере»), сам план - свой.
const fs = require('fs');
const path = require('path');

const NETHER_RISK = 1.4;     // шаг по Незеру «дороже»: лава, гасты
const PORTAL_COST = 40;      // вход в портал, ожидание, загрузка
const NEAR_PORTALS = 400;    // порталы дальше от бота или от цели не рассматриваем

const dkey = (dim) => (/nether|незер|ад/i.test(String(dim)) ? 'nether' : /the_end|^end$|энд|край/i.test(String(dim)) ? 'end' : 'overworld');
const dimName = (k) => ({ nether: 'Незер', end: 'Энд', overworld: 'обычный мир' }[k]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const conv = (p, from, to) => (from === to ? { x: Math.floor(p.x), y: p.y, z: Math.floor(p.z) }
  : from === 'overworld' && to === 'nether' ? { x: Math.floor(p.x / 8), y: p.y, z: Math.floor(p.z / 8) }
    : { x: Math.floor(p.x) * 8, y: p.y, z: Math.floor(p.z) * 8 });

// Тропы (тело запоминает, где реально прошло - как игрок помнит дорогу). 16.11 бот ни разу сам не дошёл по
// незер-хабу: !travel вёл напрямик под землю и по льду. Теперь каждый пройденный путь (за хозяином, сам) пишется
// точками через ~6 блоков с рёбрами между соседними; дальний путь сначала ищется по тропам (как по веткам метро),
// и идёт короткими переходами от точки к точке. Знает только то, где был, - чем больше ходит, тем лучше.
const CRUMB = 6, JOIN = 3.5, LINK = 14;
class Trails {
  constructor(dir) { this.dir = path.join(dir, 'map'); this.g = {}; this.dirty = {}; }
  load(d) {
    if (this.g[d]) return this.g[d];
    try { this.g[d] = JSON.parse(fs.readFileSync(path.join(this.dir, `trails-${d}.json`), 'utf8')); } catch { this.g[d] = { n: [], e: {} }; }
    return this.g[d];
  }
  save(d) { if (!this.dirty[d]) return; this.dirty[d] = false; try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, `trails-${d}.json`), JSON.stringify(this.g[d])); } catch {} }
  near(d, p, r = JOIN) {
    const g = this.load(d); let bi = -1, bd = r;
    for (let i = 0; i < g.n.length; i++) { const q = g.n[i]; if (Math.abs(q[1] - p.y) > 4) continue; const k = Math.hypot(q[0] - p.x, q[2] - p.z); if (k < bd) { bd = k; bi = i; } }
    return bi;
  }
  link(d, a, b) { const g = this.load(d); if (a === b || a < 0 || b < 0) return; (g.e[a] = g.e[a] || []).includes(b) || g.e[a].push(b); (g.e[b] = g.e[b] || []).includes(a) || g.e[b].push(a); this.dirty[d] = true; }
  /** Тело прошло здесь (на земле, не в воде): точка тропы и ребро от прошлой. */
  step(d, p, state) {
    const g = this.load(d);
    if (state.last && state.lastD === d && Math.hypot(state.last.x - p.x, state.last.z - p.z) < CRUMB && Math.abs(state.last.y - p.y) < 3) return;
    let i = this.near(d, p);
    if (i < 0) { if (g.n.length >= 6000) return; g.n.push([Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]); i = g.n.length - 1; this.dirty[d] = true; }
    if (state.lastI !== undefined && state.lastD === d && state.last && Math.hypot(state.last.x - p.x, state.last.z - p.z) < LINK && Math.abs(state.last.y - p.y) < 6) this.link(d, state.lastI, i);
    state.last = { x: p.x, y: p.y, z: p.z }; state.lastI = i; state.lastD = d;
  }
  forget(state) { state.last = null; state.lastI = undefined; }
  /** Путь по тропам от a до b: [{x,y,z}...] или null. Дейкстра по точкам (их немного). */
  route(d, a, b) {
    const g = this.load(d);
    const s = this.near(d, a, 24), t = this.near(d, b, 32);
    if (s < 0 || t < 0) return null;
    const dist = new Map([[s, 0]]), prev = new Map(), open = new Set([s]);
    const D = (i, j) => Math.hypot(g.n[i][0] - g.n[j][0], g.n[i][1] - g.n[j][1], g.n[i][2] - g.n[j][2]);
    while (open.size) {
      let u = -1, ud = Infinity; for (const i of open) { const k = dist.get(i); if (k < ud) { ud = k; u = i; } }
      open.delete(u);
      if (u === t) break;
      for (const v of g.e[u] || []) { const nd = ud + D(u, v); if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); open.add(v); } }
    }
    if (!dist.has(t)) return null;
    const out = []; for (let i = t; i !== undefined; i = prev.get(i)) out.unshift({ x: g.n[i][0], y: g.n[i][1], z: g.n[i][2] });
    return { points: out, len: dist.get(t) };
  }
  stats(d) { const g = this.load(d); return { points: g.n.length, links: Object.values(g.e).reduce((x, a) => x + a.length, 0) / 2 }; }
}

class Travel {
  constructor(dir, worldMap) {
    this.file = path.join(dir, 'map', 'portal-links.json');
    this.wm = worldMap;
    this.trails = new Trails(dir);
    try { this.links = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.links = []; }
  }

  /** Длина пути в измерении: по тропам, если есть, иначе по прямой (с риском для Незера). */
  legLen(d, a, b) {
    const r = this.trails.route(d, a, b);
    if (r) return Math.hypot(r.points[0].x - a.x, r.points[0].z - a.z) + r.len + Math.hypot(r.points[r.points.length - 1].x - b.x, r.points[r.points.length - 1].z - b.z);
    return dist(a, b) * (d === 'nether' ? NETHER_RISK * 1.5 : 1.2);   // по незнакомому - дороже
  }

  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.links)); }

  /** Бот прошёл портал: запомнить пару. Один и тот же вход - одна запись (новая заменяет старую). */
  addLink(fromDim, from, toDim, to) {
    const a = { d: dkey(fromDim), x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
    const b = { d: dkey(toDim), x: Math.floor(to.x), y: Math.floor(to.y), z: Math.floor(to.z) };
    if (a.d === b.d) return;
    this.links = this.links.filter((l) => !(l.a.d === a.d && dist(l.a, a) < 6));
    this.links.push({ a, b, at: Date.now() });
    this.links = this.links.slice(-200);
    this.save();
  }

  /** Известные порталы в измерении: с карты и из пар. */
  portals(d) {
    const out = [];
    const add = (p, src) => { if (!out.some((o) => dist(o, p) < 6 && Math.abs(o.y - p.y) < 8)) out.push({ x: p.x, y: p.y, z: p.z, src }); };
    for (const l of this.links) { if (l.a.d === d) add(l.a, 'пара'); if (l.b.d === d) add(l.b, 'пара'); }
    if (this.wm) {
      const m = this.wm.load(d === 'nether' ? 'the_nether' : d === 'end' ? 'the_end' : 'overworld');
      for (const v of Object.values(m.poi)) if (v.kind === 'портал') add(v, 'карта');
    }
    return out;
  }

  /** Куда выводит портал p из измерения d: известная пара или расчёт по формуле (точно = false). */
  exitOf(p, d) {
    const to = d === 'nether' ? 'overworld' : 'nether';
    for (const l of this.links) {
      if (l.a.d === d && dist(l.a, p) < 6) return { ...l.b, exact: true };
      if (l.b.d === d && dist(l.b, p) < 6 && l.a.d === to) return { ...l.a, exact: true };
    }
    const c = conv(p, d, to);
    // может, портал в том измерении уже виден на карте рядом с расчётной точкой
    const near = this.portals(to).filter((q) => dist(q, c) <= (to === 'nether' ? 16 : 128)).sort((q, r) => dist(q, c) - dist(r, c))[0];
    return near ? { ...near, d: to, exact: true, guess: true } : { ...c, d: to, exact: false };
  }

  /**
   * План пути от бота (pos, dim) к цели (dest {x,y,z,dim}). Возвращает { steps, text, cost } или { error }.
   * Шаги: walk {x,y,z} | walk_xz {x,z} | portal {x,y,z} | find_portal {x,z} (дойти к расчётной точке и найти портал).
   */
  plan(pos, dim, dest) {
    const here = dkey(dim), there = dkey(dest.dim || dim);
    if (here === 'end' || there === 'end') return here === there ? this.direct(pos, dest, here) : { error: 'в Энд и из Энда пути не строю' };
    if (here === there) {
      const direct = this.direct(pos, dest, here);
      if (here === 'nether' || dist(pos, dest) < 200) return direct;
      // через Незер: портал рядом с ботом -> Незер -> портал рядом с целью
      let best = direct;
      const P = this.portals('overworld').filter((p) => dist(p, pos) < NEAR_PORTALS);
      const Q = this.portals('overworld').filter((q) => dist(q, dest) < NEAR_PORTALS);
      for (const p of P) for (const q of Q) {
        if (dist(p, q) < 64) continue;
        const pn = this.exitOf(p, 'overworld'), qn = this.exitOf(q, 'overworld');
        const cost = this.legLen('overworld', pos, p) + PORTAL_COST + this.legLen('nether', pn, qn) + PORTAL_COST + this.legLen('overworld', q, dest);
        if (cost < best.cost * 0.8) {
          best = {
            cost,
            steps: [{ do: 'portal', ...p }, qn.exact ? { do: 'portal', ...qn } : { do: 'find_portal', x: qn.x, z: qn.z, y: qn.y }, { do: 'walk', ...dest }],
            text: `через Незер: портал ${p.x} ${p.y} ${p.z} (${Math.round(dist(pos, p))} бл.), в Незере ${Math.round(dist(pn, qn))} бл. до ${qn.exact ? 'портала' : 'места выхода (портал там поищу)'} ${qn.x} ${qn.z}, выход у ${q.x} ${q.z}, дальше ${Math.round(dist(q, dest))} бл.; пешком было бы ${Math.round(dist(pos, dest))} бл.`,
          };
        }
      }
      return best;
    }
    // в другое измерение: портал, где сумма «до портала + от выхода до цели» меньше
    let best = null;
    for (const p of this.portals(here)) {
      const e = this.exitOf(p, here);
      const cost = this.legLen(here, pos, p) + PORTAL_COST + this.legLen(there, e, dest);
      if (!best || cost < best.cost) {
        best = { cost, steps: [{ do: 'portal', ...p }, { do: 'walk', ...dest }],
          text: `портал ${p.x} ${p.y} ${p.z} (${Math.round(dist(pos, p))} бл.) в ${dimName(there)}, оттуда ${Math.round(dist(e, dest))} бл. до цели` };
      }
    }
    return best || { error: `не знаю ни одного портала в ${dimName(here)} - покажите мне портал или проведите через него` };
  }

  direct(pos, dest, d) {
    return { cost: dist(pos, dest) * (d === 'nether' ? NETHER_RISK : 1), steps: [{ do: 'walk', ...dest }], text: `пешком ${Math.round(dist(pos, dest))} бл.` };
  }

  /** Для мозга по запросу: порталы рядом и их пары. */
  describe(pos, dim) {
    const d = dkey(dim);
    const list = this.portals(d).map((p) => ({ p, k: dist(p, pos) })).sort((x, y) => x.k - y.k).slice(0, 6).map(({ p, k }) => {
      const e = this.exitOf(p, d);
      return `${p.x} ${p.y} ${p.z} (${Math.round(k)} бл.) -> ${dimName(e.d)} ${e.x} ${e.z}${e.exact ? '' : ' (расчёт)'}`;
    });
    const c = conv(pos, d, d === 'nether' ? 'overworld' : 'nether');
    const st = this.trails.stats(d);
    return `ты здесь = ${d === 'nether' ? 'обычный мир' : 'Незер'} ${c.x} ${c.z} по формуле 1:8; порталы: ${list.join('; ') || 'пока не знаю'}; знакомых троп в ${dimName(d)}: ${st.points} точек`;
  }
}

module.exports = { Travel, Trails, dkey, conv };
