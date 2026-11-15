// Карта бота (по образцу Xaero's World Map и кэша чанков Baritone): что бот видел, остаётся после ухода.
// По чанкам 16x16: рельеф (суша/вода/лава по 4 точкам), постройки игроков (скопление рукотворных блоков),
// точки интереса (сундуки, порталы, кровати, спавнеры, фермы, деревни). Сканирование раз в 20 с только новых
// или давно не виденных чанков, быстрым поиском mineflayer по типам блоков (без перебора каждого блока).
// Хранится в %APPDATA%/totembots/map/<измерение>.json (единицы-десятки КБ).
const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

// рукотворные блоки: их скопление в чанке - постройка
const BUILT = /(_planks|_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|glass|glass_pane|bricks|_brick|_wool|_carpet|_concrete|terracotta|_wall|bookshelf|lantern|torch|crafting_table|furnace|barrel|chest|_bed|ladder|scaffolding|polished_|smooth_|chiseled_|cut_|quartz_block|iron_bars|chain|_banner|flower_pot|item_frame|painting|smoker|blast_furnace|anvil|lectern|loom|cartography|fletching|smithing|stonecutter|grindstone|composter|beehive|campfire)$/;
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
      const found = this.chunkScan(b, cx, cz, n ? Math.round(hs / n) : null);
      m.chunks[`${cx},${cz}`] = { t: now, k: water >= 3 ? 'w' : lava >= 2 ? 'l' : 'g', h: n ? Math.round(hs / n) : null, b: found.built };
      // точки этого чанка - заново
      for (const k of Object.keys(m.poi)) if (k.endsWith(`@${cx},${cz}`)) delete m.poi[k];
      for (const [kind, v] of Object.entries(found.poi)) {
        if (kind === 'ферма' && v.n < 6) continue;   // пара блоков пашни - не ферма
        const key = `${kind}@${cx},${cz}`;
        const isNew = !(this.known || (this.known = new Set())).has(dim + key);
        this.known.add(dim + key);
        m.poi[key] = { kind, x: v.x, y: v.y, z: v.z, n: v.n, t: now };
        if (isNew && this.onFound && (kind === 'деревня' || kind === 'спавнер')) this.onFound(m.poi[key], tb.dimName());
      }
      done++;
    }
    if (done) { this.dirty = true; if (Date.now() - (this.savedAt || 0) > 30000) { this.save(dim); this.savedAt = Date.now(); } }
    return done;
  }

  /**
   * Один проход по чанку через палитры секций (как кэш Baritone): секции без нужных блоков пропускаются по палитре,
   * перебираются только те, где они есть. Возвращает { built: число рукотворных блоков, poi: { тип: {x,y,z,n} } }.
   */
  chunkScan(b, cx, cz, surfaceY = null) {
    const col = b.world.getColumn(cx, cz);
    const out = { built: 0, poi: {} };
    if (!col || !col.sections) return out;
    if (!this.cat) {   // stateId -> 'built' или тип точки
      this.cat = new Map();
      for (const bl of Object.values(b.registry.blocksByName)) {
        let c = null;
        for (const [re, kind] of POI) if (re.test(bl.name)) { c = kind; break; }
        if (!c && BUILT.test(bl.name)) c = 'built';
        if (!c) continue;
        for (let id = bl.minStateId; id <= bl.maxStateId; id++) this.cat.set(id, c);
      }
    }
    const add = (c, x, y, z, n = 1) => {
      // всё рукотворное (в т.ч. сундуки, кровати) считается и в постройку
      // постройка игроков - только у поверхности (подземные шахты и подземелья тоже из досок и заборов)
      const surface = surfaceY === null || y >= surfaceY - 8;
      if (surface && (c === 'built' || c === 'сундуки' || c === 'кровать' || c === 'мастерская')) out.built += n;
      if (c === 'built') return;
      const v = out.poi[c];
      if (v) v.n += n; else out.poi[c] = { x, y, z, n };
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
        if (c) add(c, cx * 16 + 8, y0 + 8, cz * 16 + 8, 4096);
        return;
      }
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = this.cat.get(col.getBlockStateId({ x, y: y0 + y, z }));
        if (c) add(c, cx * 16 + x, y0 + y, cz * 16 + z);
      }
    });
    return out;
  }

  async scanPoi(tb) { const b = tb.bot; if (b && b.entity) this.save(b.game.dimension); }

  /** Короткая сводка для мозга: ближайшие точки и постройки в 200 блоках, со сторонами света. */
  summary(tb) {
    const b = tb.bot;
    if (!b || !b.entity) return '';
    const m = this.load(b.game.dimension);
    const me = b.entity.position;
    const items = [];
    for (const v of Object.values(m.poi)) {
      const d = Math.hypot(v.x - me.x, v.z - me.z);
      const c = m.chunks[`${Math.floor(v.x / 16)},${Math.floor(v.z / 16)}`];
      const deep = c && c.h !== null && v.y < c.h - 10 ? ' под землёй' : '';
      if (d <= 200) items.push({ d, text: `${v.kind}${v.n > 1 ? ' (' + v.n + ')' : ''}${deep} ${Math.round(d)} бл. на ${compass(v.x - me.x, v.z - me.z)} (${v.x} ${v.y} ${v.z})` });
    }
    for (const [k, c] of Object.entries(m.chunks)) {
      if ((c.b || 0) < 30) continue;
      const [cx, cz] = k.split(',').map(Number);
      const x = cx * 16 + 8, z = cz * 16 + 8;
      const d = Math.hypot(x - me.x, z - me.z);
      if (d <= 200) items.push({ d: d + 0.1, text: `постройка ${Math.round(d)} бл. на ${compass(x - me.x, z - me.z)} (около ${x} ${z})`, built: true });
    }
    items.sort((a, b2) => a.d - b2.d);
    // постройки по соседним чанкам - одна запись на 48 блоков
    const out = [];
    for (const it of items) {
      if (it.built && out.some((o) => o.built && Math.abs(o.d - it.d) < 48)) continue;
      out.push(it);
      if (out.length >= 8) break;
    }
    const explored = Object.keys(m.chunks).length;
    return out.length ? `по карте (исследовано ${explored} чанков): ` + out.map((o) => o.text).join('; ') : `по карте: исследовано ${explored} чанков, рядом ничего приметного`;
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
