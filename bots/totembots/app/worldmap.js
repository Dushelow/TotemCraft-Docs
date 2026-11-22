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
  // признаки - то, чего игрок не добудет или не поставит (рамка Края, усиленный глубинный сланец, позолоченный чернокамень),
  // или целый набор блоков сооружения сразу; на сервере структуры перемешаны, а строители берут эти блоки для декора
  ['крепость Края', (n) => n.has('end_portal_frame'), /(stone_brick|iron_bars|oak_door|bookshelf|oak_planks|oak_fence|torch|cobweb|ladder|chest|end_portal_frame|stone_button|oak_slab|cobblestone|chiseled_stone_bricks|stone_slab|stone_stairs)$/],
  ['испытания', (n) => n.has('trial_spawner') || n.has('vault'), /(tuff|copper|chest|barrel|candle|decorated_pot|glass|ladder|lantern|chain|_slab|_stairs|_wall|polished_|chiseled_|bricks|_door|_trapdoor|_bulb|_grate|hopper|dispenser|dropper|_button|lever|_pressure_plate|scaffolding|torch)$/],
  ['древний город', (n) => n.has('reinforced_deepslate'), /(deepslate|basalt|soul_|candle|_wool|_carpet|chest|ladder|dark_oak|spruce|lantern|_slab|_stairs|_wall|polished_|chiseled_|bricks|cut_|torch|_fence|_trapdoor|_door|skull|head)$/],
  ['крепость Незера', (n, nether) => nether && n.has('nether_bricks') && n.has('nether_brick_fence') && n.has('nether_brick_stairs'), /(nether_brick|chest)/],
  ['бастион', (n) => n.has('gilded_blackstone') && n.has('polished_blackstone_bricks'), /(blackstone|basalt|chest|chain|lantern|_slab|_stairs|_wall|bricks)/],
  ['подводный храм', (n, nether) => !nether && n.has('prismarine_bricks') && n.has('dark_prismarine') && n.has('sea_lantern'), /(prismarine|sea_lantern)/],
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
// Анти-иксрей Paper на сервере (paper-world-defaults.yml, engine-mode 3, ниже y 64): клиенту, а значит и боту,
// приходят поддельные руды, сундуки, обсидиан, замшелый булыжник внутри камня. Настоящие - только открытые (рядом
// воздух, вода, прозрачный блок): открытые сервер не подделывает. Список - как hidden-blocks в конфиге сервера.
const XRAY_HIDDEN = /^(.*_ore|raw_copper_block|raw_iron_block|raw_gold_block|mossy_cobblestone|obsidian|chest|ender_chest|clay)$/;
const XRAY_MAX_Y = 64;
const SCAN_MS = 20000;
const RESCAN_MS = 10 * 60 * 1000;
const COMPASS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];

function compass(dx, dz) {
  // в Minecraft север - это -Z, восток - +X
  const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8];
}

/** Видно ли блок x y z из глаз: луч шагами по 0,2 доходит до его клетки, не упираясь в другой непрозрачный блок. */
function sees(b, eye, x, y, z, SEE_THROUGH) {
  const tx = x + 0.5, ty = y + 0.5, tz = z + 0.5, dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z, len = Math.hypot(dx, dy, dz);
  const n = Math.ceil(len / 0.2);
  let last = '';
  for (let i = 1; i <= n; i++) {
    const px = Math.floor(eye.x + dx * i / n), py = Math.floor(eye.y + dy * i / n), pz = Math.floor(eye.z + dz * i / n);
    if (px === x && py === y && pz === z) return true;
    const k = px + ',' + py + ',' + pz;
    if (k === last) continue; last = k;
    const bl = b.blockAt(new (require('vec3').Vec3)(px, py, pz));
    if (bl && bl.boundingBox === 'block' && !SEE_THROUGH.test(bl.name)) return false;
  }
  return true;
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
  /** Найденное в чанке, но ещё не виденное глазами: ждёт, пока бот на него посмотрит (до 3000 мест). */
  pend(dim, key, rec) {
    const P = (this.load(dim).pend = this.load(dim).pend || {});   // в файле карты: после перезапуска не теряется
    P[key] = rec;
    const ks = Object.keys(P); if (ks.length > 3000) delete P[ks[0]];
  }

  /**
   * Раз в секунду: что из найденного бот сейчас видит глазами (до 40 бл., луч до блока не упирается в другой
   * непрозрачный блок) - становится точкой карты и памяти. Старые точки без отметки «видела» - туда же, на проверку.
   */
  seenTick(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return;
    const dim = String(b.game.dimension), m = this.load(dim);
    if (!m.verified) {   // точки, записанные до 22.11 (иксреем), - снова на проверку глазами
      m.verified = 1;
      for (const [k, v] of Object.entries(m.poi)) if (!v.seen) { this.pend(dim, k, { ...v, pts: v.pts || [[v.x, v.y, v.z]] }); delete m.poi[k]; }
      this.dirty = true;
    }
    const P = m.pend || {};
    const { SEE_THROUGH } = require('./steer');
    const eye = b.entity.position.offset(0, 1.62, 0);
    let checks = 0;
    for (const [key, r] of Object.entries(P)) {
      const p = { key, rec: r };
      const near = (p.rec.pts || [[r.x, r.y, r.z]]).filter(([x, y, z]) => Math.hypot(x + 0.5 - eye.x, y + 0.5 - eye.y, z + 0.5 - eye.z) <= 40);
      if (!near.length) continue;
      let ok = false;
      for (const [x, y, z] of near) {
        if (checks++ > 60) return;
        if (sees(b, eye, x, y, z, SEE_THROUGH)) { ok = true; break; }
      }
      if (!ok) continue;
      delete P[key];
      const now = Date.now(), rec = { ...p.rec, seen: now };
      delete rec.pts;
      const isNew = !(this.known || (this.known = new Set())).has(dim + p.key);
      this.known.add(dim + p.key);
      m.poi[p.key] = rec;
      this.dirty = true;
      const dup = Object.entries(m.poi).some(([k2, o]) => k2 !== p.key && o.kind === rec.kind && Math.hypot(o.x - rec.x, o.z - rec.z) < 64);
      if (isNew && !dup && this.onFound && /деревня|спавнер|крепость|испытания|древний город|бастион|храм/.test(rec.kind)) this.onFound(rec, tb.dimName());
    }
  }

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
      // карта по блокам: что сверху в каждой точке, высота, глубина воды (mapgrid.js)
      let grid = {};
      try { grid = require('./mapgrid').surface(b, col, AIR, /nether/.test(String(dim))); } catch {}
      // биом в середине чанка на высоте поверхности (как подпись биома у карт): где снег, пустыня, грибы, болото
      try { const by = h !== null ? h : 64; const bid = col.getBiome({ x: 8, y: by, z: 8 }); const bn = b.registry.biomes && b.registry.biomes[bid]; if (bn) grid.bi = bn.name; } catch {}
      m.chunks[`${cx},${cz}`] = { t: now, k: water >= 3 ? 'w' : lava >= 2 ? 'l' : 'g', h, b: found.built, ...(found.built && gy !== null && found.by < gy - 6 ? { u: 1 } : {}), ...grid };
      // точки этого чанка - заново
      const was = Object.entries(m.poi).filter(([k]) => k.endsWith(`@${cx},${cz}`));
      for (const [k] of was) delete m.poi[k];
      for (const [, v] of was) if (!found.poi[v.kind] && STRUCT.some(([n]) => n === v.kind) && this.onLost) this.onLost(v, tb.dimName());
      for (const [kind, v] of Object.entries(found.poi)) {
        if (kind === 'ферма' && v.n < 6) continue;   // пара блоков пашни - не ферма
        const key = `${kind}@${cx},${cz}`;
        // честно, без иксрея (22.11: «видит спавнеры сквозь структуры»): блоки чанка тело знает, но точкой на
        // карте и в памяти место становится, только когда бот его увидел глазами (seenTick, луч из глаз)
        const old = was.find(([k]) => k === key);
        if (!(old && old[1].seen)) { this.pend(dim, key, { kind, x: v.x, y: v.y, z: v.z, n: v.n, t: now, pts: v.pts || [[v.x, v.y, v.z]] }); continue; }
        const isNew = !(this.known || (this.known = new Set())).has(dim + key);
        this.known.add(dim + key);
        m.poi[key] = { kind, x: v.x, y: v.y, z: v.z, n: v.n, t: now, seen: old ? old[1].seen : now };
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
        const v = { c, name: bl.name, built: !/moss_carpet$/.test(bl.name) && ( c === 'built' || c === 'сундуки' || c === 'кровать' || c === 'мастерская' || (c === 'mark' && BUILT.test(bl.name))) };
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
      if (p) { p.n += n; if (p.pts.length < 8) p.pts.push([x, y, z]); } else out.poi[v.c] = { x, y, z, n, pts: [[x, y, z]] };
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
        if (c && !(y0 < XRAY_MAX_Y && XRAY_HIDDEN.test(c.name))) add(i, c, cx * 16 + 8, y0 + 8, cz * 16 + 8, 4096);
        return;
      }
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = this.cat.get(col.getBlockStateId({ x, y: y0 + y, z }));
        if (!c) continue;
        if (y0 + y < XRAY_MAX_Y && XRAY_HIDDEN.test(c.name) && !this.exposed(b, col, cx, cz, x, y0 + y, z)) continue;   // подделка анти-иксрея
        add(i, c, cx * 16 + x, y0 + y, cz * 16 + z);
      }
    });
    // природные сооружения по признакам во всём чанке: в poi, их блоки не в счёт
    const natural = [];
    for (const [kind, test, re] of STRUCT) {
      if (!test(all, /nether/.test(String(b.game.dimension)))) continue;
      let other = 0, otherKinds = 0;
      for (const names of secs.values()) for (const [nm, st] of names) if (st.built && !re.test(nm) && !MARK.test(nm)) { other += st.n; otherKinds++; }
      if (other >= 24 && otherKinds >= 4) continue;   // вокруг постройка игроков (стекло, доски, двери...) - не природное
      natural.push(re);
      let at = null;
      for (const names of secs.values()) for (const [nm, st] of names) if (!at && (MARK.test(nm) || re.test(nm))) at = st;
      if (at && !out.poi[kind]) {
        const pts = [];
        for (const names of secs.values()) for (const [nm, st] of names) if (pts.length < 8 && (MARK.test(nm) || re.test(nm))) pts.push([st.x, st.y, st.z]);
        out.poi[kind] = { x: at.x, y: at.y, z: at.z, n: 1, pts };
      }
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
          if (!out.poi['шахта']) out.poi['шахта'] = { x: bn[0][1].x, y: bn[0][1].y, z: bn[0][1].z, n: 1, pts: bn.slice(0, 8).map(([, st]) => [st.x, st.y, st.z]) };
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

  /** Открыт ли блок (сосед - воздух, вода или прозрачный): такие анти-иксрей не подделывает. */
  exposed(b, col, cx, cz, lx, y, lz) {
    if (!this.clear) {
      this.clear = new Set();
      for (const bl of Object.values(b.registry.blocksByName)) {
        if (bl.transparent || bl.boundingBox === 'empty' || /water|lava|glass|leaves/.test(bl.name)) for (let id = bl.minStateId; id <= bl.maxStateId; id++) this.clear.add(id);
      }
    }
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const x = lx + dx, z = lz + dz;
      let id;
      if (x >= 0 && x < 16 && z >= 0 && z < 16) id = col.getBlockStateId({ x, y: y + dy, z });
      else { const c2 = b.world.getColumn(cx + Math.floor(x / 16), cz + Math.floor(z / 16)); if (!c2) continue; id = c2.getBlockStateId({ x: ((x % 16) + 16) % 16, y: y + dy, z: ((z % 16) + 16) % 16 }); }
      if (this.clear.has(id)) return true;
    }
    return false;
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

  /**
   * Просканировать досконально: где ближайшие блоки такого вида во всех загруженных чанках (по палитрам секций,
   * секции без него пропускаются - быстро). q - id блока или часть («diamond_ore» найдёт и deepslate_diamond_ore).
   */
  find(tb, q, max = 6) {
    const b = tb.bot;
    if (!b || !b.entity) return 'ты не на сервере';
    q = String(q || '').toLowerCase().replace(/^minecraft:/, '').trim();
    if (!q) return 'что искать?';
    const ids = new Set();
    const names = [];
    for (const bl of Object.values(b.registry.blocksByName)) {
      if (bl.name === q || bl.name.endsWith('_' + q) || (q.length >= 4 && bl.name.includes(q))) {
        names.push(bl.name);
        for (let id = bl.minStateId; id <= bl.maxStateId; id++) ids.add(id);
      }
    }
    if (!ids.size) return `не знаю блок «${q}» (нужен id Minecraft, например diamond_ore, chest, nether_portal)`;
    const me = b.entity.position;
    const found = [];
    let total = 0, faked = 0;
    const hidden = names.some((n) => XRAY_HIDDEN.test(n));
    for (const { chunkX, chunkZ, column: col } of b.world.getColumns()) {
      if (!col || !col.sections) continue;
      if (found.length > 4000) break;
      const minY = col.minY || 0;
      col.sections.forEach((sec, i) => {
        if (!sec || !sec.data) return;
        const d = sec.data;
        if (d.palette ? !d.palette.some((id) => ids.has(id)) : !ids.has(d.value)) return;
        const y0 = minY + i * 16;
        for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          if (!ids.has(col.getBlockStateId({ x, y: y0 + y, z }))) continue;
          if (y0 + y < XRAY_MAX_Y && hidden && !this.exposed(b, col, +chunkX, +chunkZ, x, y0 + y, z)) { faked++; continue; }
          total++;
          const p = { x: chunkX * 16 + x, y: y0 + y, z: chunkZ * 16 + z };
          p.d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
          found.push(p);
        }
      });
    }
    const xr = faked ? ` (ниже ${XRAY_MAX_Y} сервер прячет такие блоки внутри камня и шлёт подделки - считаю только открытые, их видно глазами)` : '';
    // брёвна: только настоящие деревья, которые можно рубить (из построек - нельзя, о них отдельно)
    let fromBuilds = 0;
    if (/_log$|_stem$/.test(q) && tb.skills) {
      const ok = found.filter((p) => { const k = b.blockAt(new (require('vec3').Vec3)(p.x, p.y, p.z)); const why = k ? tb.skills.whyNot(k) : 'нет'; if (why) fromBuilds++; return !why; });
      found.length = 0; found.push(...ok); total = ok.length;
      if (!total) return `${q}: рядом только брёвна из построек или без листвы (${fromBuilds}) - рубить нельзя. Уйди подальше от построек (!wander) и ищи деревья там`;
    }
    if (!total) return `${names.slice(0, 3).join(', ')}: в загруженных чанках (~${b.world.getColumns().length} чанков вокруг) открытых нет${xr}`;
    found.sort((a, c) => a.d - c.d);
    // соседние блоки одной жилы или одного сундука - одна запись
    const out = [];
    for (const p of found) { if (!out.some((o) => Math.abs(o.x - p.x) <= 2 && Math.abs(o.y - p.y) <= 2 && Math.abs(o.z - p.z) <= 2)) out.push(p); if (out.length >= max) break; }
    return `${q}${xr}: всего ${total} бл.; ближайшие: ` + out.map((p) => `${p.x} ${p.y} ${p.z} (${Math.round(p.d)} бл. на ${compass(p.x - me.x, p.z - me.z)})`).join('; ');
  }

  /** В какой стороне света (в 3-12 чанках) бот видел меньше всего чанков - туда интересно сходить. */
  leastExplored(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return COMPASS[Math.floor(Math.random() * 8)];
    const m = this.load(b.game.dimension);
    const pcx = Math.floor(b.entity.position.x / 16), pcz = Math.floor(b.entity.position.z / 16);
    const cnt = {};
    for (const d of COMPASS) cnt[d] = Math.random();   // при равенстве - случайно
    // «где никто не был» (как новые чанки у XaeroPlus): бот там не был, построек нет, тропы и натоптанность
    // игроков нет. Виденное +1, постройка +2, тропа игроков или бота +1,5 за точку.
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      const r = Math.hypot(dx, dz);
      if (r < 3 || r > 12) continue;
      const c = m.chunks[`${pcx + dx},${pcz + dz}`];
      if (c) cnt[compass(dx, dz)] += 1 + ((c.b || 0) >= 12 ? 2 : 0);
    }
    try {
      const T = tb.travel && tb.travel.trails, d = require('./travel').dkey(b.game.dimension), me = b.entity.position;
      if (T) for (const n of T.load(d).n) { const dx = n[0] - me.x, dz = n[2] - me.z, r = Math.hypot(dx, dz); if (r > 48 && r < 200) cnt[compass(dx, dz)] += 1.5; }
    } catch {}
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
      // слои: точка сильно выше или ниже бота - сказать, насколько (в шахте, на горе, в Незере между ярусами)
      const dy = Math.round(v.y - me.y), lay = Math.abs(dy) >= 8 ? `, ${dy > 0 ? 'выше' : 'ниже'} тебя на ${Math.abs(dy)}` : '';
      if (d <= radius) items.push({ d, kind: v.kind, x: v.x, y: v.y, z: v.z, key: `${v.kind}@${v.x},${v.z}`,
        text: `${v.kind}${v.n > 1 && /сундуки|кровать|ферма/.test(v.kind) ? ' (' + v.n + ')' : ''}${deep} ${Math.round(d)} бл. на ${compass(v.x - me.x, v.z - me.z)}${lay} (${v.x} ${v.y} ${v.z})` });
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

  /**
   * Поселения: застроенные чанки, связанные друг с другом (через 1 чанк), - одно поселение. 5+ чанков - город
   * или посёлок игроков, меньше - отдельная постройка; колокол рядом - деревня жителей. Сам бот: «в городе» или
   * «в дикой местности», чтобы понимать, где можно копать и брать, а где чужое.
   */
  settlements(tb, radius = 600) {
    const b = tb.bot, m = this.load(b.game.dimension), me = b.entity.position;
    const pcx = Math.floor(me.x / 16), pcz = Math.floor(me.z / 16), R = Math.ceil(radius / 16);
    const built = new Set();
    for (const [k, c] of Object.entries(m.chunks)) { if ((c.b || 0) < 12) continue; const [cx, cz] = k.split(',').map(Number); if (Math.abs(cx - pcx) <= R && Math.abs(cz - pcz) <= R) built.add(k); }
    const seen = new Set(), out = [];
    for (const k of built) {
      if (seen.has(k)) continue;
      const group = [], stack = [k]; seen.add(k);
      while (stack.length) {
        const cur = stack.pop(); group.push(cur);
        const [cx, cz] = cur.split(',').map(Number);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const n = `${cx + dx},${cz + dz}`; if (built.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
      }
      const xs = group.map((g) => +g.split(',')[0] * 16 + 8), zs = group.map((g) => +g.split(',')[1] * 16 + 8);
      const x = Math.round(xs.reduce((s, v) => s + v, 0) / xs.length), z = Math.round(zs.reduce((s, v) => s + v, 0) / zs.length);
      const inside = group.includes(`${pcx},${pcz}`) || group.some((g) => { const [cx, cz] = g.split(',').map(Number); return Math.abs(cx - pcx) <= 1 && Math.abs(cz - pcz) <= 1; });
      const village = Object.values(m.poi).some((v) => v.kind === 'деревня' && Math.hypot(v.x - x, v.z - z) < 16 * Math.max(3, Math.sqrt(group.length)));
      out.push({ n: group.length, x, z, inside, d: Math.hypot(x - me.x, z - me.z), kind: group.length >= 5 ? (village ? 'деревня с постройками игроков' : 'поселение игроков') : 'постройка' });
    }
    return out.sort((a, c) => a.d - c.d);
  }

  /** Биомы вокруг (до 400 бл.): какой здесь и ближайшие другие со стороной света. «биом: тайга; рядом: пустыня 300 бл. на юг». */
  biomes(tb, radius = 400) {
    const b = tb.bot, m = this.load(b.game.dimension), me = b.entity.position;
    const here = (m.chunks[`${Math.floor(me.x / 16)},${Math.floor(me.z / 16)}`] || {}).bi;
    const near = {};
    for (const [k, c] of Object.entries(m.chunks)) {
      if (!c.bi || c.bi === here) continue;
      const [cx, cz] = k.split(',').map(Number), x = cx * 16 + 8, z = cz * 16 + 8, d = Math.hypot(x - me.x, z - me.z);
      if (d > radius) continue;
      if (!near[c.bi] || d < near[c.bi].d) near[c.bi] = { d, x, z };
    }
    const list = Object.entries(near).sort((a, c) => a[1].d - c[1].d).slice(0, 4).map(([n, v]) => `${n} ${Math.round(v.d)} бл. на ${compass(v.x - me.x, v.z - me.z)}`);
    return (here ? `биом: ${here}` : '') + (list.length ? `${here ? '; ' : ''}рядом: ${list.join(', ')}` : '');
  }

  /** Короткая сводка для мозга: где бот (город или дикая местность), поселения, ближайшие точки, со сторонами света. */
  summary(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return '';
    const explored = Object.keys(this.load(b.game.dimension).chunks).length;
    const me = b.entity.position;
    const st = this.settlements(tb).filter((s) => s.n >= 5);
    const here = st.find((s) => s.inside);
    const where = here ? `ты в ${{ 'постройка': 'застроенном месте', 'поселение игроков': 'поселении игроков', 'деревня с постройками игроков': 'деревне с постройками игроков' }[here.kind]} (${here.n} застроенных чанков) - здесь всё чужое: не копать, не брать` : 'ты в дикой местности (построек игроков рядом нет)';
    const towns = st.filter((s) => !s.inside).slice(0, 3).map((s) => `${s.kind} (${s.n} чанков) ${Math.round(s.d)} бл. на ${compass(s.x - me.x, s.z - me.z)} (около ${s.x} ${s.z})`);
    const out = this.nearby(tb, 200, 8);
    let bio = ''; try { bio = this.biomes(tb); } catch {}
    let fresh = ''; try { fresh = this.leastExplored(tb); } catch {}
    return `${where}; исследовано ${explored} чанков` + (fresh ? ` (меньше всего знакомо на ${fresh})` : '') + (bio ? '; ' + bio : '') + (towns.length ? '; поселения: ' + towns.join('; ') : '') + (out.length ? '; ' + out.map((o) => o.text).join('; ') : '');
  }

  /** Под землёй (крыша над головой, ниже поверхности чанка на 6+) или в Незере - показывать срез на высоте бота. */
  layerMode(tb) {
    const b = tb.bot, p = b.entity.position, d = String(b.game.dimension);
    if (/nether/.test(d)) return `ярус Незера на высоте ${Math.floor(p.y)}`;
    const c = this.load(d).chunks[`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`];
    if (c && c.h !== null && p.y < c.h - 6) return `подземный слой на высоте ${Math.floor(p.y)} (поверхность около ${c.h})`;
    return '';
  }

  /**
   * Ходы вокруг под землёй (для мозга): по срезу на высоте бота - куда можно пройти и как далеко (до 48 бл.),
   * поиском в ширину по клеткам с полом. «Ходы: север 30 бл., восток 12 бл.; тупик на западе».
   */
  tunnels(tb) {
    const b = tb.bot, p = b.entity.position, air = this.airIds;
    if (!air || !this.layerMode(tb)) return '';
    const y0 = Math.floor(p.y), mg = require('./mapgrid');
    const cells = new Map();
    const get = (x, z) => {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16), k = `${cx},${cz}`;
      if (!cells.has(k)) { const col = b.world.getColumn(cx, cz); cells.set(k, col ? mg.decode(mg.slice(b, col, air, y0)) : null); }
      const d = cells.get(k); if (!d) return null;
      const i = (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16);
      return d.k[i] > 0 && d.k[i] !== mg.WALL && !/water|lava/.test(mg.KINDS[d.k[i]][0]) ? d.h[i] : null;   // пол (не стена, не обрыв, не жидкость)
    };
    const sx = Math.floor(p.x), sz = Math.floor(p.z), seen = new Set([`${sx},${sz}`]), q = [[sx, sz, get(sx, sz) ?? y0 - 1]];
    const far = {};
    while (q.length && seen.size < 6000) {
      const [x, z, h] = q.shift();
      const dx = x - sx, dz = z - sz, dist = Math.hypot(dx, dz);
      if (dist > 48) continue;
      const dir = compass(dx, dz);
      if (dist > (far[dir] || 0)) far[dir] = dist;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ax, nz = z + az, k = `${nx},${nz}`;
        if (seen.has(k)) continue;
        const nh = get(nx, nz);
        if (nh === null || Math.abs(nh - h) > 1) continue;   // ступень больше блока - не проход
        seen.add(k); q.push([nx, nz, nh]);
      }
    }
    const open = Object.entries(far).filter(([, d]) => d >= 8).sort((a, c) => c[1] - a[1]).map(([d, n]) => `${d} ${Math.round(n)} бл.`);
    return open.length ? 'ходы вокруг: ' + open.join(', ') : 'вокруг тупик (на твоём уровне ходов нет дальше 8 бл.)';
  }

  /** Данные для картинки в панели: чанки и точки вокруг (cx,cz бота в центре). */
  /**
   * Карта для панели (22.11: «дёргается и неудобная»): всё в координатах мира, а не «бот в центре чанка»; чанки,
   * которые панель уже знает (known: ключ -> время записи), без рисунка - перерисовывается только новое.
   * layer: 'auto' (под землёй - срез с запасом, без мигания у входа в пещеру) или 'surface'.
   */
  mapView(tb, o = {}) {
    const b = tb.bot;
    if (!b || !b.entity) return null;
    const dim = String(b.game.dimension), m = this.load(dim), p = b.entity.position, mg = require('./mapgrid');
    const r = Math.max(4, Math.min(28, +o.r || 16)), known = o.known || {};
    const ccx = Math.floor((o.cx ?? p.x) / 16), ccz = Math.floor((o.cz ?? p.z) / 16);
    const chunks = [];
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const k = `${ccx + dx},${ccz + dz}`, c = m.chunks[k];
      if (!c) continue;
      const okv = c.gv === mg.GRID_V;
      if (known[k] === c.t) { chunks.push([ccx + dx, ccz + dz, c.t]); continue; }
      chunks.push([ccx + dx, ccz + dz, c.t, c.k, c.b || 0, okv ? c.px || '' : '', okv ? c.hy || '' : '', okv ? c.wd || '' : '', c.my || 0]);
    }
    // срез под землёй: вход - на 6 ниже поверхности, выход - выше на 3 (запас, чтобы не мигало у входа в пещеру)
    let layer = '';
    if (o.layer !== 'surface') {
      if (/nether/.test(dim)) layer = `ярус Незера на высоте ${Math.floor(p.y)}`;
      else {
        const c = m.chunks[`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`], h = c && c.h !== null && c.h !== undefined ? c.h : null;
        const was = tb._mapUnder;
        tb._mapUnder = h !== null && (was ? p.y < h - 3 : p.y < h - 6);
        if (tb._mapUnder) layer = `подземный слой на высоте ${Math.floor(p.y)} (поверхность около ${h})`;
      }
    }
    const slice = [];
    if (layer && this.airIds) {
      const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
      for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
        const col = b.world.getColumn(pcx + dx, pcz + dz);
        if (!col) continue;
        try { const s = mg.slice(b, col, this.airIds, Math.floor(p.y)); slice.push([pcx + dx, pcz + dz, s.px, s.hy, s.my]); } catch {}
      }
    }
    const inR = (x, z) => Math.abs(Math.floor(x / 16) - ccx) <= r && Math.abs(Math.floor(z / 16) - ccz) <= r;
    const poi = Object.values(m.poi).filter((v) => inR(v.x, v.z)).map((v) => [v.x, v.z, v.kind]);
    const ents = [];
    try { for (const [x, z, g, name] of tb.radar(64).list) ents.push([x, z, g, name || '']); } catch {}
    for (const pl of Object.values(b.players)) if (pl.entity && pl.username !== b.username) ents.push([pl.entity.position.x, pl.entity.position.z, 'player', pl.username]);
    const labels = [];
    if (tb.memory) for (const pl of Object.values(tb.memory.data.places || {})) if (pl.dim === tb.dimName() && !/^табличка/.test(pl.name) && inR(pl.x, pl.z)) labels.push([pl.x, pl.z, pl.name]);
    return { dim, me: [p.x, p.y, p.z, b.entity.yaw], chunks, slice, poi, ents, labels, layer, total: Object.keys(m.chunks).length, colors: mg.COLORS, time: b.time ? b.time.timeOfDay : 6000, rain: !!b.isRaining };
  }

  view(tb, radiusChunks = 16) {
    const b = tb.bot;
    if (!b || !b.entity) return null;
    const m = this.load(b.game.dimension);
    const pcx = Math.floor(b.entity.position.x / 16), pcz = Math.floor(b.entity.position.z / 16);
    const chunks = [];
    for (const [k, c] of Object.entries(m.chunks)) {
      const [cx, cz] = k.split(',').map(Number);
      const okv = c.gv === require('./mapgrid').GRID_V;   // другая версия формата - как старый чанк, пока не перечитается
      if (Math.abs(cx - pcx) <= radiusChunks && Math.abs(cz - pcz) <= radiusChunks) chunks.push([cx - pcx, cz - pcz, c.k, c.b || 0, okv ? c.px || '' : '', okv ? c.hy || '' : '', okv ? c.wd || '' : '', c.my || 0]);
    }
    const poi = Object.values(m.poi).map((v) => [Math.floor(v.x / 16) - pcx, Math.floor(v.z / 16) - pcz, v.kind])
      .filter(([x, z]) => Math.abs(x) <= radiusChunks && Math.abs(z) <= radiusChunks);
    const p = b.entity.position;
    // под землёй или в Незере - срез на уровне бота (ходы вокруг), а не крыша: ближние 5 чанков, считается на лету
    const layer = this.layerMode(tb);
    if (layer) {
      const air = this.airIds;
      if (air) for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
        const col = b.world.getColumn(pcx + dx, pcz + dz);
        if (!col) continue;
        let s; try { s = require('./mapgrid').slice(b, col, air, Math.floor(p.y)); } catch { continue; }
        const i = chunks.findIndex((c) => c[0] === dx && c[1] === dz), row = [dx, dz, 'g', 0, s.px, s.hy, '', s.my];
        if (i >= 0) chunks[i] = row; else chunks.push(row);
      }
    }
    // радар на карте: кто вокруг (враги, животные, жители, транспорт, игроки) - в блоках от угла карты
    const ents = [];
    try { for (const [x, z, g] of tb.radar(64).list) ents.push([x - (pcx - radiusChunks) * 16, z - (pcz - radiusChunks) * 16, g]); } catch {}
    for (const pl of Object.values(b.players)) if (pl.entity && pl.username !== b.username) ents.push([Math.floor(pl.entity.position.x) - (pcx - radiusChunks) * 16, Math.floor(pl.entity.position.z) - (pcz - radiusChunks) * 16, 'player']);
    const ox0 = (pcx - radiusChunks) * 16, oz0 = (pcz - radiusChunks) * 16, W = (radiusChunks * 2 + 1) * 16;
    const labels = [];
    if (tb.memory) for (const pl of Object.values(tb.memory.data.places || {})) {
      if (pl.dim !== tb.dimName() || /^табличка/.test(pl.name)) continue;
      const x = pl.x - ox0, z = pl.z - oz0;
      if (x >= 0 && z >= 0 && x < W && z < W) labels.push([x, z, pl.name]);
    }
    return { r: radiusChunks, chunks, poi, ents, labels, total: Object.keys(m.chunks).length, layer, me: [((Math.floor(p.x) % 16) + 16) % 16, ((Math.floor(p.z) % 16) + 16) % 16], colors: require('./mapgrid').COLORS };
  }
}

module.exports = { WorldMap, compass };
