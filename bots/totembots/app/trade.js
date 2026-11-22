// Торговля с жителями (как игрок в торговом зале на спавне): посмотреть, кто чем торгует, запомнить, купить или
// продать. Мозг решает, что выгодно (нафармить пшеницы и продать фермеру за изумруды, купить зачарованную книгу),
// тело ходит, открывает окно торговли, проверяет, хватает ли своего, и меняется. Что предлагает какой житель -
// в общей памяти (до 300 жителей), чтобы не обходить зал каждый раз.
const { goals } = require('mineflayer-pathfinder');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVillager = (e) => e && /^(villager|wandering_trader)$/.test(e.name || '');
const itemText = (i) => (i && i.name && i.count ? `${i.count} ${i.name}` : '');

class Trade {
  villagersNear(r = 24) {
    const me = this.bot.entity.position;
    return Object.values(this.bot.entities).filter((e) => isVillager(e) && e.position.distanceTo(me) <= r).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
  }
  villagerKey(e) { return `${this.dimName()}:${Math.round(e.position.x)},${Math.round(e.position.y)},${Math.round(e.position.z)}`; }

  /** Подойти и открыть окно торговли. */
  async openTrader(e, tok) {
    await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok, 60000);
    this.check(tok);
    await this.bot.lookAt(e.position.offset(0, 1.5, 0), true);
    return this.bot.openVillager(e);
  }

  /** Запомнить предложения жителя. */
  noteOffers(e, v) {
    const m = this.memory; if (!m) return [];
    const offers = (v.trades || []).map((t) => ({ give: [itemText(t.inputItem1), itemText(t.inputItem2)].filter(Boolean).join(' + '), price: t.realPrice, get: itemText(t.outputItem), out: t.outputItem && t.outputItem.name, left: Math.max(0, t.maximumNbTradeUses - t.nbTradeUses), off: !!t.tradeDisabled }));
    const V = (m.data.villagers = m.data.villagers || {});
    V[this.villagerKey(e)] = { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z), dim: this.dimName(), offers, at: Date.now() };
    const ks = Object.keys(V); if (ks.length > 300) for (const k of ks.sort((a, b) => V[a].at - V[b].at).slice(0, ks.length - 300)) delete V[k];
    m.save();
    return offers;
  }

  /** «Чем торгуют жители рядом»: обойти до 6 ближайших, кого не смотрели последние полчаса. */
  async lookTrades(a, tok) {
    const list = this.villagersNear(+a.radius || 24);
    if (!list.length) return 'жителей рядом нет';
    const V = (this.memory && this.memory.data.villagers) || {};
    const out = [];
    // порядок обхода: каждый следующий - ближайший к предыдущему (без беготни туда-сюда); известные недавно - из памяти
    const order = [], rest = list.slice(0, 6);
    let at = this.bot.entity.position;
    while (rest.length) { rest.sort((a, c) => a.position.distanceTo(at) - c.position.distanceTo(at)); const e = rest.shift(); order.push(e); at = e.position; }
    for (const e of order) {
      this.check(tok);
      const k = this.villagerKey(e), known = V[k];
      let offers = known && Date.now() - known.at < 1800000 ? known.offers : null;
      if (!offers) {
        let v;
        try { v = await this.openTrader(e, tok); } catch (err) { if (this.isCancel(err)) throw err; continue; }
        try { await sleep(400); offers = this.noteOffers(e, v); } finally { try { v.close(); } catch {} }
      }
      const open = offers.filter((o) => !o.off && o.left > 0);
      if (open.length) out.push(`житель у ${Math.round(e.position.x)} ${Math.round(e.position.z)}: ` + open.slice(0, 6).map((o, i) => `${i + 1}) ${o.give} -> ${o.get}`).join('; '));
    }
    return out.length ? out.join(' | ') : 'жители рядом сейчас ничего не продают (всё раскуплено или безработные)';
  }

  /**
   * Купить или продать: want - что получить (часть названия: emerald, book, bread), times - сколько раз.
   * Ищет у жителей рядом подходящее предложение, на которое хватает своих вещей.
   */
  async doTrade(a, tok) {
    const want = String(a.want || a.item || '').toLowerCase(), times = Math.max(1, Math.min(64, +a.times || 1));
    if (!want) throw new Error('что получить? например emerald или bread');
    const inv = () => this.invCounts();
    const list = this.villagersNear(32);
    if (!list.length) throw new Error('жителей рядом нет');
    const V = (this.memory && this.memory.data.villagers) || {};
    // сначала те, у кого по памяти есть нужное
    list.sort((x, y) => (((V[this.villagerKey(y)] || {}).offers || []).some((o) => (o.out || '').includes(want)) ? 1 : 0) - (((V[this.villagerKey(x)] || {}).offers || []).some((o) => (o.out || '').includes(want)) ? 1 : 0));
    let lastWhy = `никто рядом не продаёт ${want}`;
    for (const e of list.slice(0, 8)) {
      this.check(tok);
      const known = V[this.villagerKey(e)];
      if (known && Date.now() - known.at < 1800000 && !known.offers.some((o) => (o.out || '').includes(want) && !o.off && o.left > 0)) continue;
      let v;
      try { v = await this.openTrader(e, tok); } catch (err) { if (this.isCancel(err)) throw err; continue; }
      try {
        await sleep(400);
        this.noteOffers(e, v);
        const idx = (v.trades || []).findIndex((t) => t.outputItem && t.outputItem.name.includes(want) && !t.tradeDisabled && t.nbTradeUses < t.maximumNbTradeUses);
        if (idx < 0) continue;
        const t = v.trades[idx];
        const can = Math.min(times, t.maximumNbTradeUses - t.nbTradeUses,
          Math.floor((inv()[t.inputItem1.name] || 0) / Math.max(1, t.realPrice || t.inputItem1.count)),
          t.inputItem2 && t.inputItem2.count ? Math.floor((inv()[t.inputItem2.name] || 0) / t.inputItem2.count) : 64);
        if (can < 1) { lastWhy = `за ${itemText(t.outputItem)} просят ${t.realPrice || t.inputItem1.count} ${t.inputItem1.name}${t.inputItem2 && t.inputItem2.count ? ' + ' + itemText(t.inputItem2) : ''} - у меня не хватает`; continue; }
        await this.bot.trade(v, idx, can);
        await sleep(300);
        return `поменялась ${can} раз: ${t.realPrice || t.inputItem1.count} ${t.inputItem1.name}${t.inputItem2 && t.inputItem2.count ? ' + ' + itemText(t.inputItem2) : ''} -> ${itemText(t.outputItem)}`;
      } finally { try { v.close(); } catch {} }
    }
    throw new Error(lastWhy);
  }

  /** Для мозга: что помню про жителей рядом (без похода к ним). */
  tradesKnown(r = 64) {
    const V = (this.memory && this.memory.data.villagers) || {}, me = this.bot.entity.position;
    const near = Object.values(V).filter((v) => v.dim === this.dimName() && Math.hypot(v.x - me.x, v.z - me.z) <= r);
    if (!near.length) return '';
    const all = near.flatMap((v) => v.offers.filter((o) => !o.off).map((o) => `${o.give}->${o.get}`));
    return `жители рядом (помню ${near.length}): ` + [...new Set(all)].slice(0, 12).join('; ');
  }
}

module.exports = { Trade };
