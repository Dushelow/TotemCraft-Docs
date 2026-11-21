// Кэш проходимости мира (по образцу Baritone: CachedChunk, ChunkPacker, CachedRegion): каждый виденный чанк -
// по 2 бита на блок: 0 воздух, 1 вода, 2 твёрдое, 3 опасно (лава, огонь, паутина, магма). Не имена блоков, а то,
// что нужно для ходьбы. Путь строится и через чанки, которые сейчас не загружены (дальние пути, под землёй,
// в Незере), - модуль пути mineflayer своего кэша не держит и вдали «не видит» мир.
//  - Секция 16×16×16: однородная (весь камень, весь воздух) - одно число, иначе 1 КБ. Обычный чанк - 5-10 КБ.
//  - Упаковка в очереди понемногу (новая версия чанка заменяет ждущую), бот не замирает.
//  - Особые блоки (сундуки, порталы, кровати, печи, верстаки, спавнеры...) - списком с координатами: «где
//    ближайший» без перебора мира.
//  - Регионы 32×32 чанка на диске (gzip), пишутся только изменённые; в памяти - не больше MAX_CHUNKS ближних.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SPECIAL = /^(chest|trapped_chest|barrel|ender_chest|.*shulker_box|furnace|blast_furnace|smoker|crafting_table|anvil|chipped_anvil|damaged_anvil|enchanting_table|brewing_stand|smithing_table|grindstone|stonecutter|loom|cartography_table|lectern|.*_bed|nether_portal|end_portal_frame|spawner|trial_spawner|bell|beacon|respawn_anchor|composter|cauldron|jukebox)$/;
const AVOID = /^(lava|fire|soul_fire|cobweb|magma_block|campfire|soul_campfire|sweet_berry_bush|wither_rose|powder_snow|cactus|pointed_dripstone)$/;
const MAX_CHUNKS = 3000;
const PASS_V = 1;   // версия формата файлов кэша: другая - файл не читается (перепакуется заново)

class PassCache {
  constructor(dir) {
    this.dir = path.join(dir, 'map', 'pass');
    this.regions = new Map();   // 'dim|rx,rz' -> { chunks: Map('cx,cz' -> chunk), dirty }
    this.cat = null;            // stateId -> категория (0-3), special flag в бите 4
    this.queue = new Map();     // 'dim|cx,cz' -> { col, dim, cx, cz }
  }

  categories(registry) {
    if (this.cat) return this.cat;
    let max = 0; for (const bl of Object.values(registry.blocksByStateId || {})) if (bl && bl.maxStateId > max) max = bl.maxStateId;
    const cat = new Uint8Array(max + 1);
    for (const bl of Object.values(registry.blocksByName)) {
      const c = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(bl.name) ? 1 : AVOID.test(bl.name) ? 3 : bl.boundingBox === 'block' ? 2 : 0;
      const sp = SPECIAL.test(bl.name) ? 4 : 0;
      for (let id = bl.minStateId; id <= bl.maxStateId; id++) cat[id] = c | sp;
    }
    return (this.cat = cat);
  }

  /** Поставить чанк в очередь упаковки (повторная постановка заменяет ждущую версию). */
  enqueue(dim, cx, cz, col) { this.queue.set(`${dim}|${cx},${cz}`, { dim, cx, cz, col }); }

  /** Упаковать до n чанков из очереди. registry - для категорий. */
  work(registry, n = 2) {
    let done = 0;
    for (const [k, q] of this.queue) {
      this.queue.delete(k);
      try { this.pack(registry, q.dim, q.cx, q.cz, q.col); } catch {}
      if (++done >= n) break;
    }
    return done;
  }

  pack(registry, dim, cx, cz, col) {
    const cat = this.categories(registry), minY = col.minY || 0, secs = [], special = [];
    for (let s = 0; s < col.sections.length; s++) {
      const sec = col.sections[s];
      if (!sec || (sec.data && sec.data.value !== undefined)) {   // секция одного блока (или пустая)
        const id = !sec ? 0 : sec.data.value;
        secs.push(cat[id] & 3);
        continue;
      }
      const bits = new Uint8Array(1024);
      let first = -1, uniform = true;
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = cat[col.getBlockStateId({ x, y: minY + s * 16 + y, z })] || 0;
        const v = c & 3, i = (y << 8) | (z << 4) | x;
        bits[i >> 2] |= v << ((i & 3) * 2);
        if (first < 0) first = v; else if (v !== first) uniform = false;
        if (c & 4) special.push([cx * 16 + x, minY + s * 16 + y, cz * 16 + z, registry.blocksByStateId[col.getBlockStateId({ x, y: minY + s * 16 + y, z })].name]);
      }
      secs.push(uniform ? first : bits);
    }
    const r = this.region(dim, cx >> 5, cz >> 5);
    r.chunks.set(`${cx},${cz}`, { minY, secs, special, t: Date.now() });
    r.dirty = true;
    this.trimMemory();
  }

  region(dim, rx, rz) {
    const k = `${dim}|${rx},${rz}`;
    let r = this.regions.get(k);
    if (r) { r.used = Date.now(); return r; }
    r = { chunks: new Map(), dirty: false, used: Date.now(), dim, rx, rz };
    try {
      const file = JSON.parse(zlib.gunzipSync(fs.readFileSync(this.file(dim, rx, rz))).toString());
      const raw = file.v === PASS_V ? file.chunks : {};
      for (const [ck, c] of Object.entries(raw)) r.chunks.set(ck, { minY: c.minY, t: c.t, special: c.special || [], secs: c.secs.map((s) => (typeof s === 'number' ? s : new Uint8Array(Buffer.from(s, 'base64')))) });
    } catch {}
    this.regions.set(k, r);
    return r;
  }

  file(dim, rx, rz) { return path.join(this.dir, String(dim).replace(/[^a-z0-9_]/gi, '_'), `r.${rx}.${rz}.gz`); }

  /** Категория блока из кэша: 0 воздух, 1 вода, 2 твёрдое, 3 опасно; undefined - чанк не видела. */
  get(dim, x, y, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const c = this.region(dim, cx >> 5, cz >> 5).chunks.get(`${cx},${cz}`);
    if (!c) return undefined;
    const s = Math.floor((y - c.minY) / 16);
    if (s < 0) return 2;
    if (s >= c.secs.length) return 0;
    const sec = c.secs[s];
    if (typeof sec === 'number') return sec;
    const i = (((y - c.minY) & 15) << 8) | ((((z % 16) + 16) % 16) << 4) | (((x % 16) + 16) % 16);
    return (sec[i >> 2] >> ((i & 3) * 2)) & 3;
  }

  /** Ближайшие особые блоки по имени (часть имени) в известных чанках: [{x,y,z,name,d}]. */
  nearest(dim, q, pos, max = 5, radius = 2048) {
    const re = q instanceof RegExp ? q : new RegExp(String(q).replace(/[^a-z0-9_]/gi, ''), 'i');
    const out = [];
    // регионы вокруг - подгрузить с диска (те, что бот видел в прошлые заходы)
    const R = Math.ceil(radius / 512), rx0 = Math.floor(pos.x / 512), rz0 = Math.floor(pos.z / 512);
    for (let rx = rx0 - R; rx <= rx0 + R; rx++) for (let rz = rz0 - R; rz <= rz0 + R; rz++) if (fs.existsSync(this.file(dim, rx, rz))) this.region(dim, rx, rz);
    for (const r of this.regions.values()) {
      if (r.dim !== dim) continue;
      for (const c of r.chunks.values()) for (const [x, y, z, name] of c.special) {
        if (!re.test(name)) continue;
        const d = Math.hypot(x - pos.x, y - pos.y, z - pos.z);
        if (d <= radius) out.push({ x, y, z, name, d });
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, max);
  }

  /** Держать в памяти не больше MAX_CHUNKS: давно не нужные регионы - на диск и из памяти. */
  trimMemory() {
    let n = 0; for (const r of this.regions.values()) n += r.chunks.size;
    if (n <= MAX_CHUNKS) return;
    const list = [...this.regions.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, r] of list) { if (n <= MAX_CHUNKS * 0.8) break; this.saveRegion(r); this.regions.delete(k); n -= r.chunks.size; }
  }

  saveRegion(r) {
    if (!r.dirty) return;
    const out = {};
    for (const [ck, c] of r.chunks) out[ck] = { minY: c.minY, t: c.t, special: c.special, secs: c.secs.map((s) => (typeof s === 'number' ? s : Buffer.from(s).toString('base64'))) };
    try { const f = this.file(r.dim, r.rx, r.rz); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ v: PASS_V, chunks: out }))); r.dirty = false; } catch {}
  }
  saveAll() { for (const r of this.regions.values()) this.saveRegion(r); }

  /** Подключить к телу: упаковка при загрузке чанка и при изменении блока, раз в 5 мин - на диск. */
  attach(tb) {
    const b = tb.bot;
    const dimOf = () => String(b.game && b.game.dimension || 'overworld').replace(/^minecraft:/, '');
    b.on('chunkColumnLoad', (p) => { try { const cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16); const col = b.world.getColumn(cx, cz); if (col) this.enqueue(dimOf(), cx, cz, col); } catch {} });
    // изменился блок - перепаковать чанк, но не чаще раза в 30 с на чанк (фермы и редстоун меняют блоки постоянно)
    const again = new Map();
    b.on('blockUpdate', (o, n) => { try { const v = (n || o).position, cx = Math.floor(v.x / 16), cz = Math.floor(v.z / 16), k = cx + ',' + cz; if (Date.now() - (again.get(k) || 0) < 30000) return; again.set(k, Date.now()); if (again.size > 2000) again.clear(); const col = b.world.getColumn(cx, cz); if (col) this.enqueue(dimOf(), cx, cz, col); } catch {} });
    if (tb.passTimer) clearInterval(tb.passTimer);
    tb.passTimer = setInterval(() => { try { this.work(b.registry, 2); } catch {} }, 150);
    if (tb.passSave) clearInterval(tb.passSave);
    tb.passSave = setInterval(() => this.saveAll(), 300000);
    b.once('end', () => { this.saveAll(); clearInterval(tb.passTimer); clearInterval(tb.passSave); });
    tb.passCache = this;
    tb.passDim = dimOf;
  }
}

module.exports = { PassCache, SPECIAL };
