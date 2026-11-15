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

class Travel {
  constructor(dir, worldMap) {
    this.file = path.join(dir, 'map', 'portal-links.json');
    this.wm = worldMap;
    try { this.links = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.links = []; }
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
        const cost = dist(pos, p) + PORTAL_COST + dist(pn, qn) * NETHER_RISK + PORTAL_COST + dist(q, dest);
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
      const cost = dist(pos, p) * (here === 'nether' ? NETHER_RISK : 1) + PORTAL_COST + dist(e, dest) * (there === 'nether' ? NETHER_RISK : 1);
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
    return `ты здесь = ${d === 'nether' ? 'обычный мир' : 'Незер'} ${c.x} ${c.z} по формуле 1:8; порталы: ${list.join('; ') || 'пока не знаю'}`;
  }
}

module.exports = { Travel, dkey, conv };
