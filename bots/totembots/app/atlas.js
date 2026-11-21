// Атлас: тело само узнаёт дороги и подписи мира, пока ходит (общий для всех ботов программы).
//  - Ледяные ветки Незера (метро): лёд под ногами со свободным местом над ним - узлы троп, соседние связаны.
//    Так план пути через Незер идёт по веткам, даже если бот по ним ни разу не ходил, а только видел.
//  - Таблички: текст с координатами запоминается (не в места, чтобы не забить память): «к капитану →», «10к восток».
//    Найти место по слову (поручение «place капитан») ищет и в табличках.
//  - Порталы, которым хозяин дал имя («наш портал»), - тоже порталы для плана пути.
const { Vec3 } = require('vec3');
const ICE = /^(packed_ice|blue_ice|ice)$/;

class Atlas {
  atlasTick() {
    const b = this.bot;
    if (!b || !b.entity || !this.travel || !this.travel.trails) return;
    this._atlasN = (this._atlasN || 0) + 1;
    const { dkey } = require('./travel');
    const d = dkey(b.game.dimension);
    if (d === 'nether' && this._atlasN % 5 === 0) this.iceRoads(d);
    if (this._atlasN % 10 === 0) this.noteSigns();
  }

  /** Лёд в радиусе 32: по одной клетке на квадрат 6×6, связи между соседними квадратами. */
  iceRoads(d) {
    const b = this.bot, T = this.travel.trails;
    const cells = b.findBlocks({ matching: (bl) => ICE.test(bl.name), maxDistance: 32, count: 400 });
    const grid = new Map();
    for (const p of cells) {
      const a1 = b.blockAt(p.offset(0, 1, 0)), a2 = b.blockAt(p.offset(0, 2, 0));
      if (!a1 || !a2 || a1.boundingBox !== 'empty' || a2.boundingBox !== 'empty') continue;   // по льду можно идти
      const k = `${Math.floor(p.x / 6)},${Math.floor(p.z / 6)}`;
      if (!grid.has(k)) grid.set(k, p.offset(0, 1, 0));
    }
    if (grid.size < 3) return;
    const idx = new Map();
    for (const [k, p] of grid) {
      let i = T.near(d, p, 3.5);
      if (i < 0) { const g = T.load(d); if (g.n.length >= 6000) return; g.n.push([p.x, p.y, p.z]); i = g.n.length - 1; T.dirty[d] = true; }
      idx.set(k, i);
    }
    for (const [k, i] of idx) {
      const [gx, gz] = k.split(',').map(Number);
      for (const [ax, az] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { const j = idx.get(`${gx + ax},${gz + az}`); if (j !== undefined) T.link(d, i, j); }
    }
  }

  /** Таблички рядом (10 бл.) - в память табличек: текст, место, измерение. */
  noteSigns() {
    const b = this.bot, m = this.memory;
    if (!m) return;
    const S = (m.data.signs = m.data.signs || {});
    let added = 0;
    for (const p of b.findBlocks({ matching: (bl) => /_sign$/.test(bl.name), maxDistance: 10, count: 20 })) {
      const k = `${this.dimName()}:${p.x},${p.y},${p.z}`;
      if (S[k] && Date.now() - S[k].at < 3600000) continue;
      let t = '';
      try { const st = b.blockAt(p).getSignText(); t = (Array.isArray(st) ? st : [st]).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '); } catch {}
      if (!t) continue;
      S[k] = { text: t.slice(0, 160), x: p.x, y: p.y, z: p.z, dim: this.dimName(), at: Date.now() };
      added++;
    }
    if (added) {
      const ks = Object.keys(S); if (ks.length > 800) for (const k of ks.sort((x, y) => S[x].at - S[y].at).slice(0, ks.length - 800)) delete S[k];
      m.save();
    }
  }
}

module.exports = { Atlas };
