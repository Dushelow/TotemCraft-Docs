// Дом: этажи, сундуки, кровати, печи; выложить лишнее в свои сундуки.
// Вынесено из bot.js (21.11.2026, разбивка большого файла): методы подмешиваются в TotemBot, this - тело бота.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { BUILT } = require('./skills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';

class House {
  /**
   * Дом, в котором стоит бот (тело, без нейросети): этажи, сундуки, кровати, печи, лестницы, двери - в 16 блоках,
   * только если над головой крыша-постройка. Кэш 20 с. Этаж - уровень пола (y ног), этажи - уровни, где есть пол и
   * что-то из обстановки.
   */
  house() {
    const b = this.bot, p = b.entity.position.floored();
    if (this._house && Date.now() - this._house.at < 20000 && this._house.pos.distanceTo(p) < 6) return this._house.h;
    let roof = null;
    for (let dy = 2; dy <= 8 && !roof; dy++) { const k = b.blockAt(p.offset(0, dy, 0)); if (k && k.boundingBox === 'block') roof = k; }
    let h = null;
    // дом - крыша-постройка И стены хотя бы с трёх сторон в 6 блоках (открытая коробка или навес - не дом)
    const wallSide = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dz]) => { for (let i = 1; i <= 6; i++) { const k = b.blockAt(p.offset(dx * i, 1, dz * i)); if (k && k.boundingBox === 'block') return BUILT.test(k.name) || /_log$|stone|deepslate/.test(k.name); } return false; }).length;
    if (roof && (BUILT.test(roof.name) || this.skills.builtNear(p, 2)) && wallSide >= 3) {
      // этажи - по перекрытиям в этом же столбце: снизу от земли до крыши (а не по высотам сундуков соседних домов)
      const layers = [];
      let air = 0;
      for (let y = p.y - 1; y >= p.y - 24; y--) {
        const k = b.blockAt(new Vec3(p.x, y, p.z));
        if (!k) break;
        if (k.boundingBox !== 'block') { air++; continue; }
        if (!BUILT.test(k.name)) break;                 // дошли до земли
        if (air >= 2 || !layers.length) layers.push(y);
        air = 0;
      }
      const floorNo = layers.length;                    // 1 - пол на земле, 2 - второй этаж...
      let upper = 0; air = 0;
      for (let y = p.y + 2; y <= p.y + 24; y++) {
        const k = b.blockAt(new Vec3(p.x, y, p.z));
        if (!k) break;
        if (k.boundingBox !== 'block') { air++; continue; }
        if (air >= 2) upper++;
        air = 0;
      }
      // обстановка этого дома: в 10 блоках по горизонтали и под крышей (над ней в 6 блоках - постройка)
      const roofed = (v) => { for (let dy = 1; dy <= 6; dy++) { const k = b.blockAt(v.offset(0, dy, 0)); if (k && k.boundingBox === 'block' && BUILT.test(k.name)) return true; } return false; };
      const find = (re, n = 60) => b.findBlocks({ matching: (bl) => re.test(bl.name), maxDistance: 12, count: n })
        .filter((v) => Math.abs(v.y - p.y) <= 10 && Math.hypot(v.x - p.x, v.z - p.z) <= 10 && roofed(v));
      const byDist = (q, c) => q.distanceTo(p) - c.distanceTo(p);
      const chests = find(/^(chest|trapped_chest|barrel)$|shulker_box$/).sort(byDist);
      const beds = find(/_bed$/, 20).filter((v) => { const k = b.blockAt(v); return !k.getProperties || k.getProperties().part !== 'head'; }).sort(byDist);
      const work = find(/^(furnace|smoker|blast_furnace|crafting_table)$/, 20).sort(byDist);
      const stairs = find(/_stairs$|^ladder$|_trapdoor$/, 80);
      h = { chests, beds, work, stairs, floor: Math.max(1, floorNo), floors: Math.max(1, floorNo) + upper };
    }
    this._house = { at: Date.now(), pos: p, h };
    return h;
  }

  /** Коротко для мозга: «дом: 2 этажа (y 67, 71), сундуков 9 (5 на втором), кровать на втором, печи 2». */
  houseText() {
    const h = this.house();
    if (!h) return '';
    return `в доме: этажей ${h.floors}, ты на ${h.floor}-м; сундуков ${h.chests.length}, кроватей ${h.beds.length}, верстак и печи ${h.work.length}; лестниц ${h.stairs.length ? 'есть' : 'не видно'} - тело само ходит по этажам (!goTo, !putInChest, !stash, !sleep)`;
  }

  /**
   * Выложить лишнее в сундуки дома (16.11 «выложи всё лишнее в сундуки дома, оставь инструменты, броню, еду» -
   * бот вышел на улицу). Оставляет: инструменты и оружие, броню, щит, тотем, до 16 лучшей еды, факелы, лодку.
   * Сундуки - ближние по пути, полный - следующий.
   */
  async stash(a, tok) {
    const b = this.bot, h = this.house();
    // только свои сундуки: поставленные самой или в своём доме («мой дом» в памяти, 16 бл.) - не в чужие
    // (21.11 выложила 250 вещей в сундуки чужого амбара и «поблагодарила за помощь»)
    const myHome = require('./life').home(this);
    const own = (v) => this.skills.mine(v) || (myHome && Math.hypot(myHome.x - v.x, myHome.z - v.z) <= 16 && Math.abs(myHome.y - v.y) <= 12);
    const chests = (h && h.chests.length ? h.chests : b.findBlocks({ matching: (bl) => /^(chest|trapped_chest|barrel)$/.test(bl.name), maxDistance: 8, count: 10 })).filter(own);
    if (!chests.length) throw new Error(myHome ? `своих сундуков рядом нет: мои - в моём доме (${myHome.x} ${myHome.z}) или те, что поставила сама` : 'своих сундуков нет - поставь свой сундук или запомни свой дом');
    const KEEP = /(_pickaxe|_axe|_shovel|_hoe|_sword|bow|crossbow|trident|mace|shield|shears|fishing_rod|flint_and_steel|_helmet|_chestplate|_leggings|_boots|elytra|totem_of_undying|torch|_boat|_raft|compass|clock|map)$/;
    const foods = b.registry.foodsByName || {};
    const keepFood = new Set(b.inventory.items().filter((i) => foods[i.name]).sort((x, y) => (foods[y.name].foodPoints || 0) - (foods[x.name].foodPoints || 0)).slice(0, 1).map((i) => i.slot));
    const extra = String(a.keep || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const out = () => b.inventory.items().filter((i) => !KEEP.test(i.name) && !keepFood.has(i.slot) && !extra.some((k) => i.name.includes(k)));
    let put = 0;
    for (const v of chests) {
      this.check(tok);
      if (!out().length) break;
      let c;
      if ((this.lockedChests || new Set()).has(`${v.x},${v.y},${v.z}`)) continue;
      try { c = await this.openLocked(v.x, v.y, v.z, tok); } catch (e) { if (isCancel(e)) throw e; continue; }
      try {
        for (const it of out()) {
          try { await c.deposit(it.type, null, it.count); put += it.count; await sleep(rnd(120, 300)); } catch { break; }   // сундук полон - следующий
        }
      } finally { c.close(); }
    }
    if (!put) throw new Error('выкладывать нечего или сундуки полны');
    const left = out().reduce((s, i) => s + i.count, 0);
    return `выложил ${put} шт. в сундуки дома${left ? `, не поместилось ещё ${left}` : ''}; оставил инструменты, броню и еду`;
  }

  /**
   * Что сейчас падает с неба там, где бот: 'дождь', 'снег' или '' (ясно, или биом без осадков - пустыня, саванна).
   * Как в игре: идёт ли непогода (сила дождя от сервера) + биом под ногами: холодный (температура < 0,15,
   * в горах ниже с высотой) - снег. 21.11 зимой в заснеженной тайге бот говорил «дождь».
   */
  precip() {
    const b = this.bot;
    if (!/overworld/.test(b.game.dimension || '') || (b.rainState || 0) <= 0.3) return '';
    try {
      const k = b.blockAt(b.entity.position), name = k && k.biome && k.biome.name;
      const bio = name && b.registry.biomesByName[name];
      if (bio) {
        if (bio.has_precipitation === false || bio.precipitation === 'none') return '';
        const temp = (bio.temperature ?? 0.8) - Math.max(0, b.entity.position.y - 80) * 0.00125;
        if (temp < 0.15 || /snowy|frozen|ice_spikes|grove|jagged_peaks|frozen_peaks|snowy_slopes/.test(name)) return 'снег';
      }
    } catch {}
    return 'дождь';
  }

}

module.exports = { House };
