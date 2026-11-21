// Порталы в Незер своими руками (как игрок): найти рамку рядом, зажечь её огнивом, достроить недостающий
// обсидиан, построить новую, сломать свою, если надо. Рамка - 4×5 с проёмом 2×3; углы могут быть любым блоком.
// Чужое не ломает: ломать можно только портал, который построила сама (память «мой портал»).
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILLER = /^(cobblestone|cobbled_deepslate|netherrack|dirt|stone|blackstone|andesite|diorite|granite|tuff|deepslate|basalt)$/;

/** Клетки рамки: проём (2 в ширину по оси, 3 в высоту) с нижним левым углом проёма в p, ось 'x' или 'z'. */
function frameCells(p, axis) {
  const ax = axis === 'x' ? [1, 0] : [0, 1], at = (i, dy) => new Vec3(p.x + ax[0] * i, p.y + dy, p.z + ax[1] * i);
  const inner = [], frame = [], corners = [];
  for (let i = 0; i < 2; i++) for (let dy = 0; dy < 3; dy++) inner.push(at(i, dy));
  for (let i = 0; i < 2; i++) { frame.push(at(i, -1)); frame.push(at(i, 3)); }
  for (let dy = 0; dy < 3; dy++) { frame.push(at(-1, dy)); frame.push(at(2, dy)); }
  corners.push(at(-1, -1), at(2, -1), at(-1, 3), at(2, 3));
  return { inner, frame, corners, axis, p };
}

class Portals {
  /** Рамки порталов рядом (24 бл.): горит ли, сколько обсидиана не хватает. Лучшие - первыми. */
  portalFrames(r = 24) {
    const b = this.bot, out = [], seen = new Set();
    for (const o of b.findBlocks({ matching: (bl) => bl.name === 'obsidian', maxDistance: r, count: 300 })) {
      for (const axis of ['x', 'z']) for (const off of [0, -1]) {
        const p = o.offset(axis === 'x' ? off : 0, 1, axis === 'z' ? off : 0), k = `${p.x},${p.y},${p.z},${axis}`;
        if (seen.has(k)) continue; seen.add(k);
        const f = frameCells(p, axis);
        const innerOk = f.inner.every((v) => { const bl = b.blockAt(v); return bl && /^(air|cave_air|nether_portal|fire|soul_fire)$/.test(bl.name); });
        if (!innerOk) continue;
        const missing = f.frame.filter((v) => { const bl = b.blockAt(v); return !bl || bl.name !== 'obsidian'; });
        if (missing.length > 4) continue;
        const lit = f.inner.some((v) => { const bl = b.blockAt(v); return bl && bl.name === 'nether_portal'; });
        out.push({ ...f, missing, lit, d: b.entity.position.distanceTo(p) });
      }
    }
    return out.sort((a, c) => (c.lit - a.lit) || (a.missing.length - c.missing.length) || (a.d - c.d));
  }

  /** Зажечь рамку огнивом (или огненным зарядом): по нижнему обсидиану проёма сверху. */
  async lightFrame(f, tok) {
    const b = this.bot;
    const fl = b.inventory.items().find((i) => /^(flint_and_steel|fire_charge)$/.test(i.name));
    if (!fl) throw new Error('нечем зажечь портал - нужно огниво');
    const base = b.blockAt(f.frame[0]);
    if (b.entity.position.distanceTo(f.p) > 4) await this.goto(new (require('mineflayer-pathfinder').goals.GoalNear)(f.p.x, f.p.y, f.p.z, 2), tok, 60000);
    this.busyLook = true;
    try { await b.equip(fl, 'hand'); await b.lookAt(base.position.offset(0.5, 1, 0.5), true); await sleep(200); await b.activateBlock(base, new Vec3(0, 1, 0)); await sleep(600); } finally { this.busyLook = false; }
    const lit = f.inner.some((v) => { const bl = b.blockAt(v); return bl && bl.name === 'nether_portal'; });
    if (!lit) throw new Error('огонь поставила, а портал не загорелся - рамка неправильная?');
    return 'портал зажгла';
  }

  /** Найти рамку рядом и сделать рабочей: горит - ок; не горит - достроить обсидиан и зажечь. */
  async portalFix(a, tok) {
    const f = this.portalFrames(+a.radius || 24)[0];
    if (!f) throw new Error('рамки портала рядом нет');
    if (f.lit) return `портал у ${f.p.x} ${f.p.y} ${f.p.z} и так работает`;
    if (f.missing.length) {
      const have = this.invCounts().obsidian || 0;
      if (have < f.missing.length) throw new Error(`рамке не хватает ${f.missing.length} обсидиана, а у меня ${have}`);
      for (const v of f.missing) await this.skills.place({ block: 'obsidian', x: v.x, y: v.y, z: v.z, master: true }, tok);
    }
    const r = await this.lightFrame(f, tok);
    this.portalBuiltMark && this.portalBuiltMark(f, false);
    return (f.missing.length ? `достроила ${f.missing.length} обсидиана, ` : '') + r + ` у ${f.p.x} ${f.p.y} ${f.p.z}`;
  }

  /**
   * Построить портал рядом: нужно 10 обсидиана (углы - любым блоком: булыжник, незерак, земля) и огниво.
   * Место - ровная земля 4 в ширину с воздухом 5 в высоту, не у чужих построек.
   */
  async portalBuild(a, tok) {
    const b = this.bot, inv = this.invCounts();
    if ((inv.obsidian || 0) < 10) throw new Error(`для портала нужно 10 обсидиана, у меня ${inv.obsidian || 0}`);
    if (!b.inventory.items().some((i) => /^(flint_and_steel|fire_charge)$/.test(i.name))) throw new Error('для портала нужно огниво');
    const filler = Object.keys(inv).find((n) => FILLER.test(n) && inv[n] >= 4);
    const cornerBlock = filler || ((inv.obsidian || 0) >= 14 ? 'obsidian' : null);
    if (!cornerBlock) throw new Error('для углов рамки нужно 4 любых блока (булыжник, незерак) или ещё 4 обсидиана');
    const me = b.entity.position.floored();
    const free = (v) => { const bl = b.blockAt(v); return bl && /^(air|cave_air|short_grass|tall_grass|snow)$/.test(bl.name); };
    const solid = (v) => { const bl = b.blockAt(v); return bl && bl.boundingBox === 'block' && !/lava|water/.test(bl.name); };
    let spot = null;
    for (let r = 2; r <= 6 && !spot; r++) for (const axis of ['x', 'z']) for (let dx = -r; dx <= r && !spot; dx++) for (let dz = -r; dz <= r && !spot; dz++) {
      const p = me.offset(dx, 1, dz), f = frameCells(p, axis);   // проём на блок выше ног: нижний ряд рамки - на земле
      const cells = [...f.inner, ...f.frame.filter((v) => v.y >= p.y), ...f.corners.filter((v) => v.y >= p.y)];
      const under = [...f.frame.filter((v) => v.y === p.y - 1), ...f.corners.filter((v) => v.y === p.y - 1)];
      if (!cells.every(free) || !under.every(free) || !under.map((v) => v.offset(0, -1, 0)).every(solid)) continue;
      if (this.skills.builtNear(p, 4)) continue;
      if (Math.hypot(me.x - p.x, me.z - p.z) < 1.5) continue;
      spot = f;
    }
    if (!spot) throw new Error('рядом нет ровного места 4×5 под портал');
    const f = spot, put = (v, block) => this.skills.place({ block, x: v.x, y: v.y, z: v.z, master: true }, tok);
    // порядок: низ и нижние углы (на землю), стойки снизу вверх, верхние углы, верх
    const low = f.corners.filter((v) => v.y === f.p.y - 1), high = f.corners.filter((v) => v.y === f.p.y + 3);
    for (const v of f.frame.filter((v) => v.y === f.p.y - 1)) await put(v, 'obsidian');
    for (const v of low) await put(v, cornerBlock);
    for (let dy = 0; dy < 3; dy++) for (const v of f.frame.filter((q) => q.y === f.p.y + dy)) await put(v, 'obsidian');
    for (const v of high) await put(v, cornerBlock);
    for (const v of f.frame.filter((v) => v.y === f.p.y + 3)) await put(v, 'obsidian');
    const r = await this.lightFrame(f, tok);
    this.portalBuiltMark(f, true);
    return `построила и ${r} у ${f.p.x} ${f.p.y} ${f.p.z}`;
  }

  /** Запомнить портал («мой портал» - если построила сама; можно ломать только такие). */
  portalBuiltMark(f, mine) {
    if (!this.memory) return;
    const name = mine ? `мой портал ${f.p.x} ${f.p.z}` : `портал у ${f.p.x} ${f.p.z}`;
    this.memory.place({ name, x: f.p.x, y: f.p.y, z: f.p.z, dim: this.dimName(), note: mine ? `построила сама; ось ${f.axis}` : 'зажгла' }, this.opts.name);
  }

  /** Сломать свой портал (рамка, которую построила сама): забрать обсидиан, если кирка позволяет. */
  async portalBreak(a, tok) {
    const f = this.portalFrames(16)[0];
    if (!f) throw new Error('портала рядом нет');
    const mine = Object.values((this.memory && this.memory.data.places) || {}).find((p) => /^мой портал/.test(p.name) && Math.abs(p.x - f.p.x) <= 1 && Math.abs(p.z - f.p.z) <= 1 && Math.abs(p.y - f.p.y) <= 1);
    if (!mine && !a.master) throw new Error('это не мой портал - чужое не ломаю (только по слову хозяина)');
    const pick = this.bot.inventory.items().find((i) => /^(diamond|netherite)_pickaxe$/.test(i.name));
    if (!pick) throw new Error('обсидиан ломается только алмазной киркой');
    let n = 0;
    for (const v of f.frame) { const bl = this.bot.blockAt(v); if (bl && bl.name === 'obsidian') { await this.skills.breakAt({ x: v.x, y: v.y, z: v.z, force: true }, tok); n++; } }
    if (mine && this.memory) { for (const [k, p] of Object.entries(this.memory.data.places)) if (p === mine) delete this.memory.data.places[k]; this.memory.save(); }
    return `сломала портал у ${f.p.x} ${f.p.y} ${f.p.z}: ${n} обсидиана`;
  }

  /**
   * Нужен выход здесь (в пути): рамка рядом - починить и зажечь; нет - построить, если есть из чего.
   * true - портал есть и горит.
   */
  async portalHere(tok, why = '') {
    const f = this.portalFrames(24)[0];
    if (f && f.lit) return true;
    // защита от ошибки: свой портал - не чаще раза в час и с сообщением хозяину (чтобы не настроить порталов по миру)
    if (!f && Date.now() - (this.portalBuiltAt || 0) < 3600000) { this.log('портал уже строила в этот час - второй не строю'); return false; }
    const boss = (this.errand && this.errand() && this.errand().from) || (this.masters && this.masters[0]);
    if (!f && why && boss) this.say(why, 'whisper', boss);
    if (f) { try { this.log('рядом рамка портала - чиню и зажигаю: ' + await this.portalFix({}, tok)); return true; } catch (e) { if (this.isCancel(e)) throw e; this.log('рамку не вышло: ' + e.message); } }
    try { this.log(await this.portalBuild({}, tok)); this.portalBuiltAt = Date.now(); return true; } catch (e) { if (this.isCancel(e)) throw e; this.log('построить портал не вышло: ' + e.message); return false; }
  }
}

module.exports = { Portals, frameCells };
