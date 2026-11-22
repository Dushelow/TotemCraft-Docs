// Торговля с жителями (как игрок в торговом зале на спавне): посмотреть, кто чем торгует, запомнить, купить или
// продать. Мозг решает, что выгодно (нафармить пшеницы и продать фермеру за изумруды, купить зачарованную книгу),
// тело ходит, открывает окно торговли, проверяет, хватает ли своего, и меняется. Что предлагает какой житель -
// в общей памяти (до 300 жителей), чтобы не обходить зал каждый раз.
const { goals } = require('mineflayer-pathfinder');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVillager = (e) => e && /^(villager|wandering_trader)$/.test(e.name || '');
const itemText = (i) => (i && i.name && i.count ? `${i.count} ${i.name}` : '');
// профессия из метаданных жителя (villager_data: число из реестра или имя), без неё - ''
const PROF = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];
function profession(e) {
  for (const m of (e && e.metadata) || []) {
    if (!m || typeof m !== 'object') continue;
    const v = m.villagerProfession ?? m.profession;
    if (v === undefined) continue;
    if (typeof v === 'number') return '';   // номер из реестра: порядок в 26.3 не проверен - не гадать
    return String(v).replace(/^minecraft:/, '');
  }
  return '';
}
function isBaby(e) { try { return (e.metadata || []).some((m, i) => i === 16 && m === true); } catch { return false; } }
// кто что покупает за изумруды (ваниль): по своим вещам сразу идти к нужному жителю, а не обходить всех
const BUYS = { farmer: /^(wheat|potato|carrot|beetroot|pumpkin|melon)$/, fisherman: /^(string|coal|cod|salmon|tropical_fish|pufferfish)$/, shepherd: /_wool$/, fletcher: /^(stick|flint|string|feather|tripwire_hook)$/, librarian: /^(paper|book|ink_sac|writable_book)$/, cartographer: /^(paper|glass_pane|compass)$/, cleric: /^(rotten_flesh|gold_ingot|rabbit_foot|scute|turtle_scute|glass_bottle|nether_wart)$/, butcher: /^(chicken|porkchop|rabbit|beef|mutton|dried_kelp_block|sweet_berries|coal)$/, leatherworker: /^(leather|rabbit_hide|flint)$/, mason: /^(clay_ball|stone|granite|andesite|diorite|quartz)$/, armorer: /^(coal|iron_ingot|lava_bucket|diamond)$/, toolsmith: /^(coal|iron_ingot|flint|diamond)$/, weaponsmith: /^(coal|iron_ingot|flint|diamond)$/ };
const withTimeout = (p, ms, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms))]);

class Trade {
  villagersNear(r = 24) {
    const me = this.bot.entity.position;
    return Object.values(this.bot.entities).filter((e) => isVillager(e) && e.position.distanceTo(me) <= r && !/^(none|nitwit)$/.test(profession(e)) && !(this.zoneAt && this.zoneAt(e.position.x, e.position.z) && this.zoneAt(e.position.x, e.position.z).kind === 'запрет')).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
  }
  villagerKey(e) { return `${this.dimName()}:${Math.round(e.position.x)},${Math.round(e.position.y)},${Math.round(e.position.z)}`; }

  /** Подойти и открыть окно торговли. */
  async openTrader(e, tok) {
    // 15 с на подход, 5 с на окно: безработный, ребёнок или занятый житель окно не открывает, и mineflayer ждал его
    // вечно (22.11: «подошла, а торгов нет, и долго»)
    // Жители на поле и за прилавком: точно «рядом в 2 бл.» пути часто нет («No path to the goal», 22.11 - торговля
    // не вышла ни разу). Торговать можно с 3 бл.: сначала 2, нет пути - 3, и пробуем открыть, если дотянуться можно
    const d = () => e.position.distanceTo(this.bot.entity.position);
    for (const r of [2, 3]) {
      if (d() <= 3) break;
      try { await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, r), tok, 12000); } catch (err) { if (this.isCancel(err)) throw err; }
    }
    this.check(tok);
    if (d() > 3.4) throw new Error(`не подойти к жителю (ближе ${d().toFixed(1)} бл. пути нет)`);
    await this.bot.lookAt(e.position.offset(0, 1.5, 0), true);
    const v = await withTimeout(this.bot.openVillager(e), 5000, 'житель не открыл окно торговли');
    for (let k = 0; k < 10 && !(v.trades && v.trades.length); k++) await sleep(200);
    return v;
  }

  /** Запомнить предложения жителя. */
  noteOffers(e, v) {
    const m = this.memory; if (!m) return [];
    if (!(v.trades || []).length) return [];
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
    const out = [], why = [];
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
        try { v = await this.openTrader(e, tok); } catch (err) { if (this.isCancel(err)) throw err; why.push(`${profession(e) || 'житель'}: ${err.message}`); this.log(`торговля: ${profession(e) || 'житель'} у ${Math.round(e.position.x)} ${Math.round(e.position.z)} - ${err.message}`); continue; }
        try { await sleep(250); offers = this.noteOffers(e, v); } finally { try { v.close(); } catch {} }
      }
      const open = offers.filter((o) => !o.off && o.left > 0);
      if (open.length) out.push(`${profession(e) || 'житель'} у ${Math.round(e.position.x)} ${Math.round(e.position.z)}: ` + open.slice(0, 6).map((o, i) => `${i + 1}) ${o.give} -> ${o.get}`).join('; '));
    }
    if (out.length) return out.join(' | ') + (why.length ? ` (не вышло с ${why.length}: ${why[0]})` : '');
    if (why.length) throw new Error(`ни один житель не открыл торговлю (${why.length}): ${why.slice(0, 2).join('; ')}`);
    return 'жители рядом сейчас ничего не продают (всё раскуплено или безработные)';
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
    // порядок: по памяти есть нужное; за изумруды - житель, который покупает то, что у меня есть (фермер - пшеницу);
    // потом ближе. Житель, который точно не купит моё, за изумрудами не обходится
    const mine = Object.keys(inv()), me = this.bot.entity.position;
    const score = (e) => {
      const mem = ((V[this.villagerKey(e)] || {}).offers || []).some((o) => (o.out || '').includes(want) && !o.off && o.left > 0) ? 10 : 0;
      const pr = profession(e), buys = want === 'emerald' && pr && BUYS[pr] && mine.some((n) => BUYS[pr].test(n)) ? 6 : 0;
      return mem + buys - e.position.distanceTo(me) / 8;
    };
    if (want === 'emerald') { const fit = list.filter((e) => { const pr = profession(e); return !pr || !BUYS[pr] || mine.some((n) => BUYS[pr].test(n)); }); if (fit.length) list.splice(0, list.length, ...fit); }
    list.sort((x, y) => score(y) - score(x));
    let fails = 0;
    let lastWhy = `никто рядом не продаёт ${want}`;
    for (const e of list.slice(0, 8)) {
      this.check(tok);
      const known = V[this.villagerKey(e)];
      if (known && Date.now() - known.at < 1800000 && !known.offers.some((o) => (o.out || '').includes(want) && !o.off && o.left > 0)) continue;
      let v;
      try { v = await this.openTrader(e, tok); } catch (err) { if (this.isCancel(err)) throw err; lastWhy = err.message; this.log(`торговля: ${profession(e) || 'житель'} у ${Math.round(e.position.x)} ${Math.round(e.position.z)} - ${err.message}`); if (++fails >= 4) break; continue; }
      try {
        await sleep(250);
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

module.exports = { Trade, profession };
