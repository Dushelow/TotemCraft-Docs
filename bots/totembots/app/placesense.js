// Понимание места (22.11: «научить понимать интерьер, этажи, формы, дороги, смысл строений»). Без нейросети, по
// блокам вокруг, как игрок понимает с одного взгляда:
//  - что это за постройка по тому, что в ней стоит (кровати - жильё, печи и верстаки - мастерская, коптильня -
//    кухня, полки и кафедра - библиотека, варочные стойки - алхимия, много сундуков - склад, пашня - ферма, колокол -
//    центр деревни, рельсы - станция, загон с животными, портал);
//  - на дороге ли бот и куда она идёт (тропа, гравий, булыжник, плиты, лёд в Незере), или где ближайшая;
//  - этажи и где лестница (из house.js), под крышей ли, есть ли окна.
// Итог - одна строка «[место] ...» мозгу и точки интереса для осмотра (companion: «осматриваюсь»).
const { Vec3 } = require('vec3');

// [что это, вес, образец блока]
const PURPOSE = [
  ['жильё (спальня)', 3, /_bed$/],
  ['кухня, пекарня', 3, /^(smoker|cake|composter)$/],
  ['мастерская', 2, /^(crafting_table|furnace|blast_furnace|anvil|chipped_anvil|damaged_anvil|smithing_table|grindstone|stonecutter)$/],
  ['библиотека', 2, /^(bookshelf|chiseled_bookshelf|lectern|enchanting_table)$/],
  ['алхимия (зелья)', 3, /^(brewing_stand|cauldron|water_cauldron)$/],
  ['склад', 1, /^(chest|trapped_chest|barrel)$|shulker_box$/],
  ['ферма', 1, /^(farmland|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|hay_block)$/],
  ['центр деревни', 6, /^bell$/],
  ['станция, рельсы', 1, /rail$/],
  ['портал в Незер', 5, /^nether_portal$/],
  ['картограф, карты', 3, /^cartography_table$/],
  ['ткацкая', 3, /^loom$/],
  ['лучник', 3, /^fletching_table$/],
  ['пасека', 3, /^(beehive|bee_nest)$/],
  ['маяк', 6, /^beacon$/],
];
const ROAD = /^(dirt_path|gravel|cobblestone|mossy_cobblestone|stone_bricks|cracked_stone_bricks|polished_andesite|polished_diorite|polished_granite|smooth_stone|.*_slab|packed_ice|blue_ice|bricks|deepslate_bricks|deepslate_tiles|polished_blackstone_bricks|tuff_bricks|mud_bricks|sandstone|smooth_sandstone|cut_sandstone|stone|andesite)$/;
const PATHY = /^(dirt_path|gravel|packed_ice|blue_ice|.*_slab|.*bricks|polished_.*|smooth_.*|cobblestone)$/;
// на что интересно посмотреть, осматриваясь
const INTEREST = /_sign$|_wall_sign$|_hanging_sign$|_door$|^(chest|barrel|bell|lectern|anvil|crafting_table|furnace|smoker|blast_furnace|brewing_stand|enchanting_table|bookshelf|jukebox|note_block|flower_pot|campfire|lantern|beacon|cartography_table|loom|composter|beehive|item_frame|armor_stand|decorated_pot)$|^potted_|_banner$|_bed$/;

class PlaceSense {
  /** Что за постройка вокруг (до 8 бл.): одно-два назначения по найденному внутри. */
  buildingPurpose() {
    const b = this.bot, p = b.entity.position.floored(), sc = {};
    const seen = new Map();
    try {
      for (const v of b.findBlocks({ matching: (bl) => PURPOSE.some(([, , re]) => re.test(bl.name)), maxDistance: 8, count: 120 })) {
        if (Math.abs(v.y - p.y) > 6) continue;
        const k = b.blockAt(v); const pp = PURPOSE.find(([, , re]) => re.test(k.name));
        if (!pp) continue;
        sc[pp[0]] = (sc[pp[0]] || 0) + pp[1];
        seen.set(pp[0], v);
      }
    } catch {}
    // жители рядом - по профессии подсказка
    const top = Object.entries(sc).filter(([n, v]) => v >= (n === 'склад' ? 6 : n === 'ферма' ? 8 : 2)).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([n]) => n);
    return top;
  }

  /** Дорога: стоит ли на ней и куда она тянется, или где ближайшая (до 10 бл.). */
  roadSense() {
    const b = this.bot, p = b.entity.position.floored();
    const under = (x, z, y = p.y - 1) => { for (const dy of [0, -1, 1]) { const k = b.blockAt(new Vec3(x, y + dy, z)); if (k && k.boundingBox === 'block') return k; } return null; };
    const isRoad = (x, z) => { const k = under(x, z); return !!(k && PATHY.test(k.name)); };
    const { compass } = require('./worldmap');
    if (isRoad(p.x, p.z)) {
      const run = (dx, dz) => { let n = 0; for (let i = 1; i <= 12 && isRoad(p.x + dx * i, p.z + dz * i); i++) n++; return n; };
      const ns = run(0, -1) + run(0, 1), ew = run(1, 0) + run(-1, 0);
      if (Math.max(ns, ew) >= 5) { const kind = (under(p.x, p.z) || {}).name || ''; return `ты на дороге (${/ice/.test(kind) ? 'ледяная' : /dirt_path/.test(kind) ? 'тропа' : /gravel/.test(kind) ? 'гравийная' : 'мощёная'}), тянется ${ns >= ew ? 'север-юг' : 'запад-восток'}`; }
    }
    for (let r = 2; r <= 10; r++) for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (isRoad(p.x + dx, p.z + dz) && isRoad(p.x + dx + Math.sign(dz), p.z + dz + Math.sign(dx)) ) return `дорога в ${r} бл. на ${compass(dx, dz)}`;
    }
    return '';
  }

  /** Окна и свет: под крышей ли и видно ли наружу (стекло). */
  shellSense() {
    const b = this.bot, p = b.entity.position.floored();
    let roof = 0, glass = 0;
    for (let dy = 2; dy <= 6 && !roof; dy++) { const k = b.blockAt(p.offset(0, dy, 0)); if (k && k.boundingBox === 'block') roof = dy; }
    if (!roof) return '';
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (const dy of [1, 2]) { const k = b.blockAt(p.offset(dx, dy, dz)); if (k && /glass|pane/.test(k.name)) glass++; }
    return glass ? `окна есть (${Math.min(glass, 30)} стёкол)` : 'без окон';
  }

  /** Одна строка мозгу: что это за место. */
  placeText() {
    try {
      const parts = [];
      const pur = this.buildingPurpose();
      if (pur.length) parts.push('похоже на: ' + pur.join(', '));
      const h = this.house && this.house();
      if (h && h.floors > 1) parts.push(`этажей ${h.floors}, ты на ${h.floor}-м${h.stairs && h.stairs.length ? ', лестница есть' : ''}`);
      const sh = this.shellSense(); if (sh) parts.push(sh);
      const rd = this.roadSense(); if (rd) parts.push(rd);
      return parts.join('; ');
    } catch { return ''; }
  }

  /** Точки интереса вокруг (для осмотра): блоки и живые, с весом. */
  interestPoints(center, r = 12) {
    const b = this.bot, out = [];
    try {
      for (const v of b.findBlocks({ point: center, matching: (bl) => INTEREST.test(bl.name), maxDistance: r, count: 40 })) {
        if (Math.abs(v.y - center.y) > 5) continue;
        const k = b.blockAt(v);
        out.push({ at: v.offset(0.5, /_sign|banner|frame/.test(k.name) ? 0.5 : 0.7, 0.5), w: /_sign|bell|beacon|banner/.test(k.name) ? 2 : 1, what: k.name });
      }
    } catch {}
    for (const e of Object.values(b.entities)) {
      if (!e.position || e === b.entity || e.position.distanceTo(center) > r || e.name === 'item' || e.type === 'object') continue;
      out.push({ at: e.position.offset(0, (e.height || 1) * 0.8, 0), w: e.type === 'player' ? 1.5 : 1, what: e.username || e.name, ent: e });
    }
    // даль: в стороны на уровне глаз, где ничего не мешает (смотрит вдаль)
    for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2; out.push({ at: center.offset(Math.cos(a) * 30, 1.6 + Math.random() * 4, Math.sin(a) * 30), w: 0.5, what: 'вдаль' }); }
    return out;
  }
}

module.exports = { PlaceSense, PURPOSE };
