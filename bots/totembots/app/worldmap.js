// Карта бота (по образцу Xaero's World Map и кэша чанков Baritone): что бот видел, остаётся после ухода.
// По чанкам 16x16: рельеф (суша/вода/лава по 4 точкам), постройки игроков (скопление рукотворных блоков),
// точки интереса (сундуки, порталы, кровати, спавнеры, фермы, деревни). Сканирование раз в 20 с только новых
// или давно не виденных чанков, быстрым поиском mineflayer по типам блоков (без перебора каждого блока).
// Хранится в %APPDATA%/totembots/map/<измерение>.json (единицы-десятки КБ).
const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

// рукотворные блоки: их скопление в чанке - постройка. Глубина не важна: на билдерском сервере строят и под землёй
// (дома, искусственные пещеры). Природные сооружения (шахты, подземелья, крепости...) узнаются по признакам и их
// блоки из подсчёта убираются; постройкой считается чанк, где рукотворных блоков много и они разные.
const BUILT = /(_planks|_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|glass|glass_pane|bricks|_brick|_wool|_carpet|_concrete|_concrete_powder|terracotta|_wall|bookshelf|lantern|torch|crafting_table|furnace|barrel|chest|_bed|ladder|scaffolding|polished_|smooth_|chiseled_|cut_|quartz_block|iron_bars|chain|_banner|flower_pot|item_frame|painting|smoker|blast_furnace|anvil|lectern|loom|cartography|fletching|smithing|stonecutter|grindstone|composter|beehive|campfire|^rail|_rail|_sign|end_rod|redstone_lamp|hopper|dispenser|dropper|observer|piston|repeater|comparator|lever|_button|_pressure_plate|jukebox|note_block|candle|cauldron|sea_lantern|shulker_box|enchanting_table|brewing_stand|beacon)$/;
// такого в природе не бывает: даже пара блоков - точно игроки
const STRONG = /(_concrete|_concrete_powder|glazed_terracotta|stained_glass|stained_glass_pane|enchanting_table|beacon|hopper|observer|piston|repeater|comparator|redstone_lamp|shulker_box|jukebox|note_block|_banner)$/;
// признаки природных сооружений (сами блоки нужны только для узнавания)
const MINESHAFT = /^(oak_planks|oak_fence|dark_oak_planks|dark_oak_fence|spruce_planks|spruce_fence|rail|cobweb|torch|wall_torch|chest)$/;
const MARK = /^(cobweb|mossy_cobblestone|end_portal_frame|mossy_stone_bricks|cracked_stone_bricks|trial_spawner|vault|reinforced_deepslate|sculk_shrieker|nether_bricks|nether_brick_fence|gilded_blackstone|polished_blackstone_bricks|prismarine_bricks|dark_prismarine)$/;
// [название, признак по набору блоков чанка, какие блоки в этом чанке - от сооружения, а не от игроков]
const STRUCT = [
  ['шахта', (n) => n.has('cobweb') && (n.has('rail') || n.has('oak_fence') || n.has('dark_oak_fence')), /^(oak_planks|oak_fence|dark_oak_planks|dark_oak_fence|rail|cobweb|torch|wall_torch|chest)$/],
  ['подземелье', (n) => n.has('spawner') && n.has('mossy_cobblestone'), /^(cobblestone|mossy_cobblestone|chest)$/],
  ['крепость Края', (n) => n.has('end_portal_frame') || (n.has('mossy_stone_bricks') && n.has('cracked_stone_bricks') && n.has('iron_bars')), /(stone_brick|iron_bars|oak_door|bookshelf|oak_planks|oak_fence|torch|cobweb|ladder|chest|end_portal_frame|stone_button|oak_slab|cobblestone|chiseled_stone_bricks|stone_slab|stone_stairs)$/],
  ['испытания', (n) => n.has('trial_spawner') || n.has('vault'), /(tuff|copper|chest|barrel|candle|decorated_pot|glass|ladder|lantern|chain|_slab|_stairs|_wall|polished_|chiseled_|bricks|_door|_trapdoor|_bulb|_grate|hopper|dispenser|dropper|_button|lever|_pressure_plate|scaffolding|torch)$/],
  ['древний город', (n) => n.has('reinforced_deepslate') || n.has('sculk_shrieker'), /(deepslate|basalt|soul_|candle|_wool|_carpet|chest|ladder|dark_oak|spruce|lantern|_slab|_stairs|_wall|polished_|chiseled_|bricks|cut_|torch|_fence|_trapdoor|_door|skull|head)$/],
  ['крепость Незера', (n) => n.has('nether_bricks') && n.has('nether_brick_fence'), /(nether_brick|chest)/],
  ['бастион', (n) => n.has('gilded_blackstone') || n.has('polished_blackstone_bricks'), /(blackstone|basalt|chest|chain|lantern|_slab|_stairs|_wall|bricks)/],
  ['подводный храм', (n) => n.has('prismarine_bricks') || n.has('dark_prismarine'), /(prismarine|sea_lantern)/],
];
// точки интереса: тип -> как назвать
const POI = [
  [/^(chest|trapped_chest|barrel|.*shulker_box)$/, 'сундуки'],
  [/^nether_portal$/, 'портал'],
  [/_bed$/, 'кровать'],
  [/^spawner$/, 'спавнер'],
  [/^farmland$/, 'ферма'],
  [/^bell$/, 'деревня'],
  [/^(enchanting_table|brewing_stand|beacon|respawn_anchor|lodestone)$/, 'мастерская'],
];
const SCAN_MS = 20000;
const RESCAN_MS = 10 * 60 * 1000;
const COMPASS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];

function compass(dx, dz) {
  // в Minecraft север - это -Z, восток - +X
  const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8];
}

class WorldMap {
  constructor(dir) {
    this.dir = path.join(dir, 'map');
    this.dims = {};   // имя измерения -> { chunks: { 'cx,cz': {t, k, b, h} }, poi: { 'тип@x,z': {...} } }
    this.listeners = [];
  }

  dimKey(dim) { return String(dim || 'overworld').replace(/^minecraft:/, '').replace(/[^a-z0-9_]/gi, '_'); }

  load(dim) {
    const k = this.dimKey(dim);
    if (!this.dims[k]) {
      try { this.dims[k] = JSON.parse(fs.readFileSync(path.join(this.dir, k + '.json'), 'utf8')); } catch { this.dims[k] = { chunks: {}, poi: {} }; }
    }
    return this.dims[k];
  }

  save(dim) {
    const k = this.dimKey(dim);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, k + '.json'), JSON.stringify(this.dims[k]));
  }

  /** Подключить к телу бота. Рельеф - понемногу каждые 3 с, постройки и точки - раз в минуту или после 32 блоков пути,
   *  с паузами между поисками: бот не замирает (первый скан целиком занимал 11 с - стенд 15.11). */
  attach(tb, onFound = () => {}) {
    this.onFound = onFound;
    if (tb.mapTimer) clearInterval(tb.mapTimer);
    let busy = false, lastPoi = 0, lastPos = null;
    tb.mapTimer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        this.relief(tb, 6);
        const b = tb.bot;
        const moved = b && b.entity && lastPos ? b.entity.position.distanceTo(lastPos) : Infinity;
        if (b && b.entity && (Date.now() - lastPoi > 60000 || moved > 32)) {
          lastPoi = Date.now(); lastPos = b.entity.position.clone();
          await this.scanPoi(tb, onFound);
        }
      } catch {} finally { busy = false; }
    }, 3000);
  }

  /** Полный скан сразу (для проверок). */
  async scan(tb, onFound) { if (onFound) this.onFound = onFound; while (this.relief(tb, 50)) { /* пока есть чанки */ } this.save(tb.bot.game.dimension); }

  /** Рельеф до limit новых чанков: 4 точки на чанк. Возвращает, сколько обработал. */
  relief(tb, limit) {
    const b = tb.bot;
    if (!b || !b.entity || tb.status !== 'online') return 0;
    const dim = b.game.dimension;
    const m = this.load(dim);
    const me = b.entity.position, now = Date.now();
    const pcx = Math.floor(me.x / 16), pcz = Math.floor(me.z / 16), rc = 6;
    const todo = [];
    for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
      const c = m.chunks[`${pcx + dx},${pcz + dz}`];
      if (!c || now - c.t > RESCAN_MS) todo.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    }
    todo.sort((x, y) => x[2] - y[2]);   // ближние сначала
    let done = 0;
    for (const [cx, cz] of todo) {
      if (done >= limit) break;
      if (!b.world.getColumn(cx, cz)) continue;
      let water = 0, lava = 0, hs = 0, n = 0;
      // поверхность сверху вниз: пустые секции пропускаются по палитре (в Незере - с потолка, берём ниже крыши)
      const col = b.world.getColumn(cx, cz);
      const AIR = this.airIds || (this.airIds = new Set(['air', 'cave_air', 'void_air'].map((nm) => b.registry.blocksByName[nm]).filter(Boolean).flatMap((bl) => { const r = []; for (let id = bl.minStateId; id <= bl.maxStateId; id++) r.push(id); return r; })));
      const minY = col.minY || 0;
      const topY = /nether/.test(String(dim)) ? 120 : minY + col.sections.length * 16 - 1;
      for (const [ox, oz] of [[4, 4], [12, 4], [4, 12], [12, 12]]) {
        for (let y = topY; y >= minY; y--) {
          const sec = col.sections[Math.floor((y - minY) / 16)];
          if (!sec || (sec.data && sec.data.value !== undefined && AIR.has(sec.data.value))) { y -= (y - minY) % 16; continue; }
          const id = col.getBlockStateId({ x: ox, y, z: oz });
          if (AIR.has(id)) continue;
          const nm = (b.registry.blocksByStateId[id] || {}).name || '';
          if (/water|kelp|seagrass/.test(nm)) water++;
          else if (/lava/.test(nm)) lava++;
          hs += y; n++;
          break;
        }
      }
      const h = n ? Math.round(hs / n) : null;
      const found = this.chunkScan(b, cx, cz);
      // u: постройка под землёй - рукотворное в среднем глубже земли над ним (земля без построек и деревьев)
      const gy = found.built ? this.ground(b, col, found.bx, found.bz, topY) : null;
      m.chunks[`${cx},${cz}`] = { t: now, k: water >= 3 ? 'w' : lava >= 2 ? 'l' : 'g', h, b: found.built, ...(found.built && gy !== null && found.by < gy - 6 ? { u: 1 } : {}) };
      // точки этого чанка - заново
      for (const k of Object.keys(m.poi)) if (k.endsWith(`@${cx},${cz}`)) delete m.poi[k];
      for (const [kind, v] of Object.entries(found.poi)) {
        if (kind === 'ферма' && v.n < 6) continue;   // пара блоков пашни - не ферма
        const key = `${kind}@${cx},${cz}`;
        const isNew = !(this.known || (this.known = new Set())).has(dim + key);
        this.known.add(dim + key);
        m.poi[key] = { kind, x: v.x, y: v.y, z: v.z, n: v.n, t: now };
        // в память - один раз на сооружение (оно тянется через несколько чанков): рядом такого же ещё не было
        const dup = Object.entries(m.poi).some(([k2, o]) => k2 !== key && o.kind === kind && Math.hypot(o.x - v.x, o.z - v.z) < 64);
        if (isNew && !dup && this.onFound && /деревня|спавнер|крепость|испытания|древний город|бастион|храм/.test(kind)) this.onFound(m.poi[key], tb.dimName());
      }
      done++;
    }
    if (done) { this.dirty = true; if (Date.now() - (this.savedAt || 0) > 30000) { this.save(dim); this.savedAt = Date.now(); } }
    return done;
  }

  /**
   * Один проход по чанку через палитры секций (как кэш Baritone): секции без нужных блоков пропускаются по палитре,
   * перебираются только те, где они есть. Возвращает { built: число рукотворных блоков (0 - не постройка),
   * by: их средняя высота, poi: { тип: {x,y,z,n} } }. Природные сооружения тоже попадают в poi.
   */
  chunkScan(b, cx, cz) {
    const col = b.world.getColumn(cx, cz);
    const out = { built: 0, by: null, poi: {} };
    if (!col || !col.sections) return out;
    if (!this.cat) {   // stateId -> { c: 'built' | 'mark' | тип точки, name, built: считать ли в постройку }
      this.cat = new Map();
      for (const bl of Object.values(b.registry.blocksByName)) {
        let c = null;
        for (const [re, kind] of POI) if (re.test(bl.name)) { c = kind; break; }
        if (!c && BUILT.test(bl.name)) c = 'built';
        if (!c && MARK.test(bl.name)) c = 'mark';
        if (!c) continue;
        const v = { c, name: bl.name, built: c === 'built' || c === 'сундуки' || c === 'кровать' || c === 'мастерская' || (c === 'mark' && BUILT.test(bl.name)) };
        for (let id = bl.minStateId; id <= bl.maxStateId; id++) this.cat.set(id, v);
      }
    }
    // по секциям (16 блоков в высоту): шахта глубоко и дом наверху в одном чанке - разные вещи
    const secs = new Map();    // номер секции -> Map(имя блока -> { n, ys, xs, zs, x, y, z, built })
    const all = new Set();     // все имена в чанке - для признаков сооружений
    const add = (i, v, x, y, z, n = 1) => {
      let names = secs.get(i);
      if (!names) secs.set(i, names = new Map());
      const s = names.get(v.name);
      if (s) { s.n += n; s.ys += y * n; s.xs += x * n; s.zs += z * n; } else names.set(v.name, { n, ys: y * n, xs: x * n, zs: z * n, x, y, z, built: v.built });
      all.add(v.name);
      if (v.c === 'built' || v.c === 'mark') return;
      const p = out.poi[v.c];
      if (p) p.n += n; else out.poi[v.c] = { x, y, z, n };
    };
    const minY = col.minY || 0;
    col.sections.forEach((sec, i) => {
      if (!sec || !sec.data) return;
      const y0 = minY + i * 16;
      const d = sec.data;
      if (d.palette) {
        if (!d.palette.some((id) => this.cat.has(id))) return;   // в секции нет ничего нужного
      } else if (d.value !== undefined) {
        const c = this.cat.get(d.value);
        if (c) add(i, c, cx * 16 + 8, y0 + 8, cz * 16 + 8, 4096);
        return;
      }
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = this.cat.get(col.getBlockStateId({ x, y: y0 + y, z }));
        if (c) add(i, c, cx * 16 + x, y0 + y, cz * 16 + z);
      }
    });
    // природные сооружения по признакам во всём чанке: в poi, их блоки не в счёт
    const natural = [];
    for (const [kind, test, re] of STRUCT) {
      if (!test(all)) continue;
      natural.push(re);
      let at = null;
      for (const names of secs.values()) for (const [nm, st] of names) if (!at && (MARK.test(nm) || re.test(nm))) at = st;
      if (at && !out.poi[kind]) out.poi[kind] = { x: at.x, y: at.y, z: at.z, n: 1 };
    }
    // счёт секции (или двух соседних вместе - постройка на стыке)
    const score = (list) => {
      let n = 0, ys = 0, xs = 0, zs = 0, kinds = 0, strong = 0;
      const seen = new Set();
      for (const names of list) {
        if (!names) continue;
        const bn = [...names].filter(([nm, st]) => st.built && !natural.some((re) => re.test(nm)));
        // шахта без паутины в этом чанке: в секции только доски, заборы, рельсы, факелы - это шахта, не дом
        if (bn.length && bn.every(([nm]) => MINESHAFT.test(nm)) && bn.some(([nm]) => /_fence$/.test(nm))) {
          if (!out.poi['шахта']) out.poi['шахта'] = { x: bn[0][1].x, y: bn[0][1].y, z: bn[0][1].z, n: 1 };
          continue;
        }
        for (const [nm, st] of bn) { n += st.n; ys += st.ys; xs += st.xs; zs += st.zs; if (!seen.has(nm)) { seen.add(nm); kinds++; } if (STRONG.test(nm)) strong += st.n; }
      }
      return { n, ys, xs, zs, ok: (kinds >= 3 && n >= 12) || (strong >= 2 && n >= 4) };
    };
    let n = 0, ys = 0, xs = 0, zs = 0;
    for (const i of [...secs.keys()].sort((p, q) => p - q)) {
      const one = score([secs.get(i)]);
      if (!one.n) continue;
      if (one.ok || score([secs.get(i - 1), secs.get(i)]).ok || score([secs.get(i), secs.get(i + 1)]).ok) { n += one.n; ys += one.ys; xs += one.xs; zs += one.zs; }
    }
    if (n) { out.built = n; out.by = Math.round(ys / n); out.bx = Math.round(xs / n) - cx * 16; out.bz = Math.round(zs / n) - cz * 16; }
    return out;
  }

  /** Земля в столбце чанка сверху вниз: первый блок, который не воздух, не рукотворный и не дерево (ветки, стволы). */
  ground(b, col, ox, oz, topY) {
    const minY = col.minY || 0;
    for (let y = topY; y >= minY; y--) {
      const sec = col.sections[Math.floor((y - minY) / 16)];
      if (!sec || (sec.data && sec.data.value !== undefined && this.airIds.has(sec.data.value))) { y -= (y - minY) % 16; continue; }
      const id = col.getBlockStateId({ x: ox, y, z: oz });
      if (this.airIds.has(id)) continue;
      const c = this.cat && this.cat.get(id);
      if (c && c.built) continue;
      const nm = (b.registry.blocksByStateId[id] || {}).name || '';
      if (/_leaves$|_log$|_wood$|vine|snow$|^short_grass|^tall_grass|^fern|flower|bush/.test(nm)) continue;
      return y;
    }
    return null;
  }

  /** В какой стороне света (в 3-12 чанках) бот видел меньше всего чанков - туда интересно сходить. */
  leastExplored(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return COMPASS[Math.floor(Math.random() * 8)];
    const m = this.load(b.game.dimension);
    const pcx = Math.floor(b.entity.position.x / 16), pcz = Math.floor(b.entity.position.z / 16);
    const cnt = {};
    for (const d of COMPASS) cnt[d] = Math.random();   // при равенстве - случайно
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      const r = Math.hypot(dx, dz);
      if (r < 3 || r > 12) continue;
      if (m.chunks[`${pcx + dx},${pcz + dz}`]) cnt[compass(dx, dz)] += 1;
    }
    return Object.entries(cnt).sort((a, c) => a[1] - c[1])[0][0];
  }

  async scanPoi(tb) { const b = tb.bot; if (b && b.entity) this.save(b.game.dimension); }

  /** Приметное в radius блоках: точки и постройки, ближние первыми (постройки по соседним чанкам - одна на 48 блоков). */
  nearby(tb, radius = 200, max = 8) {
    const b = tb.bot;
    if (!b || !b.entity) return [];
    const m = this.load(b.game.dimension);
    const me = b.entity.position;
    const items = [];
    for (const v of Object.values(m.poi)) {
      const d = Math.hypot(v.x - me.x, v.z - me.z);
      const c = m.chunks[`${Math.floor(v.x / 16)},${Math.floor(v.z / 16)}`];
      const deep = c && c.h !== null && v.y < c.h - 10 ? ' под землёй' : '';
      if (d <= radius) items.push({ d, kind: v.kind, x: v.x, y: v.y, z: v.z, key: `${v.kind}@${v.x},${v.z}`,
        text: `${v.kind}${v.n > 1 && /сундуки|кровать|ферма/.test(v.kind) ? ' (' + v.n + ')' : ''}${deep} ${Math.round(d)} бл. на ${compass(v.x - me.x, v.z - me.z)} (${v.x} ${v.y} ${v.z})` });
    }
    for (const [k, c] of Object.entries(m.chunks)) {
      if ((c.b || 0) < 12) continue;
      const [cx, cz] = k.split(',').map(Number);
      const x = cx * 16 + 8, z = cz * 16 + 8;
      const d = Math.hypot(x - me.x, z - me.z);
      const y = c.h !== null ? c.h : Math.floor(me.y);
      if (d <= radius) items.push({ d: d + 0.1, kind: 'постройка', built: true, x, y, z, key: `постройка@${cx},${cz}`,
        text: `постройка${c.u ? ' под землёй' : ''} ${Math.round(d)} бл. на ${compass(x - me.x, z - me.z)} (около ${x} ${z})` });
    }
    items.sort((a, b2) => a.d - b2.d);
    const out = [];
    for (const it of items) {
      if (out.some((o) => o.kind === it.kind && !/сундуки|кровать|портал|спавнер|ферма|мастерская/.test(it.kind) && Math.hypot(o.x - it.x, o.z - it.z) < 48)) continue;
      out.push(it);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Короткая сводка для мозга: ближайшие точки и постройки в 200 блоках, со сторонами света. */
  summary(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return '';
    const explored = Object.keys(this.load(b.game.dimension).chunks).length;
    const out = this.nearby(tb, 200, 8);
    return out.length ? `исследовано ${explored} чанков; ` + out.map((o) => o.text).join('; ') : `исследовано ${explored} чанков, рядом ничего приметного`;
  }

  /** Данные для картинки в панели: чанки и точки вокруг (cx,cz бота в центре). */
  view(tb, radiusChunks = 24) {
    const b = tb.bot;
    if (!b || !b.entity) return null;
    const m = this.load(b.game.dimension);
    const pcx = Math.floor(b.entity.position.x / 16), pcz = Math.floor(b.entity.position.z / 16);
    const chunks = [];
    for (const [k, c] of Object.entries(m.chunks)) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.abs(cx - pcx) <= radiusChunks && Math.abs(cz - pcz) <= radiusChunks) chunks.push([cx - pcx, cz - pcz, c.k, c.b || 0]);
    }
    const poi = Object.values(m.poi).map((v) => [Math.floor(v.x / 16) - pcx, Math.floor(v.z / 16) - pcz, v.kind])
      .filter(([x, z]) => Math.abs(x) <= radiusChunks && Math.abs(z) <= radiusChunks);
    return { r: radiusChunks, chunks, poi, total: Object.keys(m.chunks).length };
  }
}

module.exports = { WorldMap, compass };
