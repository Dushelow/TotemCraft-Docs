// Достать вещь с умом (22.11: «зачем с нуля брать, если можно спросить у меня, посмотреть в своих сундуках, купить у
// жителей»). Как человек: сначала своё (сундуки дома и где сама клала), потом купить у жителей (кого уже смотрела,
// а если жители рядом незнакомые - обойти), и только если нигде нет - сказать мозгу, чего нет и что дальше
// (попросить хозяина или добыть). Что лежит в своих сундуках - запоминается при каждом открытии, без повторных походов.
const { goals } = require('mineflayer-pathfinder');

const CHEST = /^(chest|trapped_chest|barrel)$/;
const fits = (name, want) => name === want || name.endsWith('_' + want) || name.startsWith(want + '_') || name.includes(want);

class Obtain {
  /** Запомнить, что лежит в сундуке (свой: дома или куда сама клала). */
  noteChest(x, y, z, items) {
    const m = this.memory; if (!m) return;
    const C = (m.data.chests = m.data.chests || {});
    const sum = {};
    for (const it of items) sum[it.name] = (sum[it.name] || 0) + it.count;
    C[`${this.dimName()}:${x},${y},${z}`] = { x, y, z, dim: this.dimName(), items: sum, at: Date.now() };
    const ks = Object.keys(C); if (ks.length > 200) for (const k of ks.sort((a, b) => C[a].at - C[b].at).slice(0, ks.length - 200)) delete C[k];
    m.save();
  }

  /** Свой ли сундук: у своего дома (16 бл.) или туда клала сама. */
  ownChest(v) {
    const h = require('./life').home(this);
    if (h && h.dim === this.dimName() && Math.hypot(h.x - v.x, h.z - v.z) <= 16 && Math.abs(h.y - v.y) <= 12) return true;
    const C = (this.memory && this.memory.data.chests) || {};
    return !!C[`${this.dimName()}:${v.x},${v.y},${v.z}`];
  }

  invHave(want) { return this.bot.inventory.items().filter((i) => fits(i.name, want)).reduce((s, i) => s + i.count, 0); }

  /** Из своих сундуков рядом (16 бл.): открыть, запомнить содержимое, взять нужное. Возвращает сколько взяла. */
  async takeFromOwn(want, need, tok) {
    const b = this.bot, lk = this.lockedChests || new Set();
    const C = (this.memory && this.memory.data.chests) || {};
    let got = 0;
    const dim = this.dimName();
    const list = b.findBlocks({ matching: (bl) => CHEST.test(bl.name), maxDistance: 16, count: 30 })
      .filter((v) => this.ownChest(v) && !lk.has(`${v.x},${v.y},${v.z}`))
      // сначала те, где по памяти есть нужное; где по памяти точно нет (смотрела за последний час) - в конец
      .sort((p, q) => score(q) - score(p));
    function score(v) { const e = C[`${dim}:${v.x},${v.y},${v.z}`]; return !e ? 0 : Object.keys(e.items).some((n) => fits(n, want)) ? 1 : -1; }
    for (const v of list) {
      if (got >= need) break;
      this.check(tok);
      const k = `${this.dimName()}:${v.x},${v.y},${v.z}`, known = C[k];
      if (known && Date.now() - known.at < 3600000 && !Object.keys(known.items).some((n) => fits(n, want))) continue;
      let c;
      try { c = await this.openLocked(v.x, v.y, v.z, tok); } catch (e) { if (this.isCancel(e)) throw e; continue; }
      try {
        for (const it of c.containerItems().filter((i) => fits(i.name, want))) {
          if (got >= need) break;
          const n = Math.min(need - got, it.count);
          try { await c.withdraw(it.type, null, n); got += n; } catch { break; }
        }
        this.noteChest(v.x, v.y, v.z, c.containerItems());
      } finally { try { c.close(); } catch {} }
    }
    return got;
  }

  /**
   * !obtain(предмет, сколько): своё в инвентаре -> свои сундуки (дома, где клала) -> купить у жителей.
   * Не вышло - ошибка со списком, где смотрела и что дальше (мозг просит хозяина или добывает сам).
   */
  async obtain(a, tok) {
    const b = this.bot, want = String(a.item || a.want || '').toLowerCase().replace(/^minecraft:/, '').trim();
    const count = Math.max(1, Math.min(2304, +a.count || 1));
    if (!want) throw new Error('что достать? например white_wool 64');
    const start = this.invHave(want);
    if (start >= count) return `уже есть ${start} ${want}`;
    const looked = [];
    const left = () => count - this.invHave(want);
    const dim = this.dimName(), me = () => b.entity.position;
    // 1. свои сундуки: по памяти, где лежит нужное (до 300 бл.), потом дом
    const C = (this.memory && this.memory.data.chests) || {};
    const known = Object.values(C).filter((c) => c.dim === dim && Object.keys(c.items).some((n) => fits(n, want)) && Math.hypot(c.x - me().x, c.z - me().z) <= 300)
      .sort((p, q) => Math.hypot(p.x - me().x, p.z - me().z) - Math.hypot(q.x - me().x, q.z - me().z));
    for (const c of known.slice(0, 3)) {
      if (left() <= 0) break;
      this.check(tok);
      try { await this.goto(new goals.GoalNear(c.x, c.y, c.z, 3), tok, 120000); } catch (e) { if (this.isCancel(e)) throw e; continue; }
      const n = await this.takeFromOwn(want, left(), tok);
      looked.push(`сундук ${c.x} ${c.y} ${c.z}: ${n ? 'взяла ' + n : 'уже нет'}`);
    }
    const h = require('./life').home(this);
    if (left() > 0 && h && h.dim === dim && Math.hypot(h.x - me().x, h.z - me().z) <= 600) {
      try {
        if (Math.hypot(h.x - me().x, h.z - me().z) > 12) await this.goto(new goals.GoalNear(h.x, h.y, h.z, 3), tok, 180000);
        const n = await this.takeFromOwn(want, left(), tok);
        looked.push(`сундуки дома: ${n ? 'взяла ' + n : 'нет'}`);
      } catch (e) { if (this.isCancel(e)) throw e; looked.push('до дома не дошла: ' + e.message); }
    } else if (left() > 0 && !h) looked.push('своего дома не знаю');
    // 2. жители: кто продаёт (по памяти, до 200 бл.); незнакомые рядом - сначала посмотреть
    if (left() > 0) {
      const V = () => (this.memory && this.memory.data.villagers) || {};
      const sellers = () => Object.values(V()).filter((v) => v.dim === dim && Math.hypot(v.x - me().x, v.z - me().z) <= 200 && v.offers.some((o) => fits(o.out || '', want) && !o.off && o.left > 0))
        .sort((p, q) => Math.hypot(p.x - me().x, p.z - me().z) - Math.hypot(q.x - me().x, q.z - me().z));
      if (!sellers().length && this.villagersNear && this.villagersNear(48).length) { try { await this.lookTrades({ radius: 48 }, tok); } catch (e) { if (this.isCancel(e)) throw e; } }
      const s = sellers();
      if (!s.length) looked.push('жители: никто рядом не продаёт');
      for (const v of s.slice(0, 3)) {
        if (left() <= 0) break;
        this.check(tok);
        const o = v.offers.find((x) => fits(x.out || '', want));
        const per = Math.max(1, +String(o.get).split(' ')[0] || 1);
        try {
          await this.goto(new goals.GoalNear(v.x, v.y, v.z, 4), tok, 120000);
          const r = await this.doTrade({ want, times: Math.ceil(left() / per) }, tok);
          looked.push('жители: ' + r);
        } catch (e) { if (this.isCancel(e)) throw e; looked.push(`житель у ${v.x} ${v.z} (${o.give} -> ${o.get}): ${e.message}`); }
      }
    }
    const have = this.invHave(want);
    if (have >= count) return `достала ${want}: теперь ${have} (${looked.join('; ')})`;
    throw new Error(`${want}: есть ${have} из ${count}. Где смотрела: ${looked.join('; ') || 'нигде'}. Дальше: попроси у хозяина или игроков рядом (say), или добудь сама`);
  }
}

module.exports = { Obtain, fits };
