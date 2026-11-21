// Карта по блокам (как Xaero's World Map): для каждой точки чанка - что сверху, на какой высоте, глубина воды.
// Хранится строками в записи чанка (worldmap.js): px - вид блока (1 знак на блок), hy - высота (2 знака на блок),
// wd - глубина воды (1 знак, только если в чанке есть вода). ~800 байт на чанк.
// Нужна боту (дороги, дома, проходы, вода и броды видны точно, а не «чанк застроен») и для картинки в панели.
const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// вид блока -> цвет. Порядок важен: первое совпадение.
const KINDS = [
  ['unknown', /^$/, [0, 0, 0]],
  ['water', /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/, [52, 92, 196]],
  ['lava', /lava|magma_block/, [214, 96, 24]],
  ['ice', /ice$/, [150, 180, 240]],
  ['snow', /^(snow|snow_block|powder_snow)$/, [244, 248, 250]],
  ['grass', /^(grass_block|moss_block|moss_carpet|short_grass|tall_grass|fern|large_fern)$/, [104, 150, 64]],
  ['leaves', /_leaves$|azalea|vine/, [56, 112, 44]],
  ['flower', /tulip|dandelion|poppy|allium|bluet|daisy|cornflower|lily_of|sunflower|lilac|rose_bush|peony|orchid|wither_rose|pink_petals/, [198, 120, 170]],
  ['crop', /^(wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|sugar_cane|bamboo|sweet_berry_bush)$/, [196, 178, 80]],
  ['farmland', /^farmland$/, [120, 80, 46]],
  ['path', /^(dirt_path|gravel|coarse_dirt|rooted_dirt|mud|packed_mud|podzol)$/, [150, 126, 90]],
  ['dirt', /^(dirt|mycelium|soul_soil|soul_sand)$/, [134, 96, 66]],
  ['sand', /sand(stone)?$|^suspicious_sand$/, [218, 206, 150]],
  ['red', /^(red_sand|red_sandstone|terracotta|.*_terracotta)$/, [168, 92, 60]],
  ['wood', /_planks$|_log$|_wood$|_stem$|_hyphae$|_slab$|_stairs$|_fence|_door$|_trapdoor$|barrel|chest|crafting_table|bookshelf|composter|beehive|lectern/, [150, 110, 64]],
  ['roof', /bricks?$|_brick_|tiles?$|deepslate_tiles|nether_bricks/, [140, 74, 62]],
  ['wool', /_wool$|_carpet$|_bed$/, [220, 220, 220]],
  ['concrete', /_concrete$|_concrete_powder$|glazed_terracotta/, [180, 180, 186]],
  ['glass', /glass/, [200, 228, 236]],
  ['light', /lantern|torch|glowstone|sea_lantern|shroomlight|campfire|froglight|lamp/, [252, 210, 100]],
  ['metal', /iron_|gold_block|copper|chain|anvil|cauldron|hopper|rail/, [170, 170, 176]],
  ['netherrack', /^(netherrack|crimson_nylium|warped_nylium|nether_wart_block|warped_wart_block)$/, [110, 42, 42]],
  ['basalt', /basalt|blackstone/, [60, 58, 64]],
  ['end', /end_stone|purpur/, [220, 220, 160]],
  ['obsidian', /obsidian/, [32, 20, 48]],
  ['stone', /stone|andesite|diorite|granite|tuff|calcite|deepslate|cobble|ore$|bedrock|clay|dripstone|amethyst/, [128, 128, 128]],
  ['other', /./, [140, 140, 120]],
  ['wall', /^$/, [44, 44, 48]],   // стена в срезе (по имени не ищется; в конце - номера прежних видов не сдвигаются)
];
const WALL = KINDS.length - 1, WATER = KINDS.findIndex((k) => k[0] === 'water');
const KIND_INDEX = new Map();
function kindOf(name) {
  let i = KIND_INDEX.get(name);
  if (i === undefined) { i = KINDS.findIndex(([, re]) => re.test(name)); if (i < 0) i = KINDS.length - 2; KIND_INDEX.set(name, i); }
  return i;
}
const COLORS = KINDS.map((k) => k[2]);

/**
 * Поверхность чанка: 256 столбиков. airIds - id воздуха; nether - смотреть под потолком (первая пустота ниже
 * крыши, дальше первый блок). Возвращает { px, hy, wd } строками.
 */
function surface(b, col, airIds, nether) {
  const minY = col.minY || 0, maxY = minY + col.sections.length * 16 - 1;
  const top = nether ? Math.min(maxY, 122) : maxY;
  let px = '', hy = '', wd = '', anyWater = false;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let y = top, seenAir = !nether, found = -1, name = '';
    for (; y >= minY; y--) {
      const sec = col.sections[Math.floor((y - minY) / 16)];
      if (!sec || (sec.data && sec.data.value !== undefined && airIds.has(sec.data.value))) { seenAir = true; y -= (y - minY) % 16; continue; }
      const id = col.getBlockStateId({ x, y, z });
      if (airIds.has(id)) { seenAir = true; continue; }
      if (!seenAir) continue;   // Незер: ещё в потолке
      const bl = b.registry.blocksByStateId[id];
      name = bl ? bl.name : '';
      if (/^(short_grass|tall_grass|fern|large_fern|dead_bush)$/.test(name)) continue;   // трава - смотреть землю под ней
      found = y; break;
    }
    const k = found < 0 ? 0 : kindOf(name);
    let depth = 0;
    if (k === WATER) {   // вода: глубина до дна (до 15)
      for (let yy = found - 1; yy >= minY && depth < 15; yy--) { const bl = b.registry.blocksByStateId[col.getBlockStateId({ x, y: yy, z })]; if (!bl || !/water|kelp|seagrass|bubble_column/.test(bl.name)) break; depth++; }
      anyWater = true;
    }
    const hv = found < 0 ? 0 : Math.max(0, Math.min(4095, found - minY + 1));
    px += A64[k]; hy += A64[hv >> 6] + A64[hv & 63]; wd += A64[depth];
  }
  return { px, hy: hy, wd: anyWater ? wd : undefined, my: minY };
}

/**
 * Срез на высоте y0 (как режим пещер у Xaero): в каждой точке - пол, на котором можно стоять от y0+2 до y0-6
 * (над ним два блока воздуха), или стена (на уровне y0 и y0+1 сплошное), или пусто (обрыв). Для пещер, шахт,
 * многоэтажных баз и ярусов Незера: видно ходы на уровне бота, а не крышу над ним.
 */
function slice(b, col, airIds, y0) {
  const minY = col.minY || 0;
  const solid = (x, y, z) => { if (y < minY) return true; const id = col.getBlockStateId({ x, y, z }); if (airIds.has(id)) return false; const bl = b.registry.blocksByStateId[id]; return !!bl && bl.boundingBox === 'block' && !/water|lava/.test(bl.name); };
  let px = '', hy = '';
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let k = 0, hv = 0;
    if (solid(x, y0, z) && solid(x, y0 + 1, z)) { k = WALL; hv = y0 - minY + 1; }   // стена
    else for (let y = y0 + 2; y >= y0 - 6; y--) {
      if (solid(x, y, z) && !solid(x, y + 1, z) && !solid(x, y + 2, z)) {
        const bl = b.registry.blocksByStateId[col.getBlockStateId({ x, y, z })];
        k = kindOf(bl ? bl.name : ''); hv = y - minY + 1; break;
      }
      const bl = b.registry.blocksByStateId[col.getBlockStateId({ x, y, z })];
      if (bl && /water|lava/.test(bl.name)) { k = kindOf(bl.name); hv = y - minY + 1; break; }
    }
    px += A64[k]; hy += A64[hv >> 6] + A64[hv & 63];
  }
  return { px, hy, my: minY };
}

/** Разбор строк чанка для картинки и для тела. */
function decode(c) {
  if (!c || !c.px) return null;
  const k = new Uint8Array(256), h = new Int16Array(256), d = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    k[i] = A64.indexOf(c.px[i]);
    const hv = A64.indexOf(c.hy[i * 2]) * 64 + A64.indexOf(c.hy[i * 2 + 1]);
    h[i] = hv ? hv - 1 + (c.my || 0) : -999;
    d[i] = c.wd ? A64.indexOf(c.wd[i]) : 0;
  }
  return { k, h, d };
}

module.exports = { surface, slice, decode, KINDS, COLORS, kindOf, A64, WALL };
