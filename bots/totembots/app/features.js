// Понимание местности (23.11, владелец: «научив стрелки находить, мы лишь заплатку сделаем - сделай капитально»).
//
// Корень ошибок «идёт не по тропе», «не нашёл ветку метро», «срезает через газоны»: тело видело мир клетками («под
// ногами X, впереди Y»), а не устройством места. Игрок с одного взгляда понимает: вот дорога, она ведёт туда, вот
// разметка на полу, она подписывает эту дорогу. Здесь то же, без нейросети и без знания конкретного сервера:
//   1) пол вокруг (до 28 бл.) - сетка «что под ногами, где можно стоять»;
//   2) ДОРОГИ - вытянутые связные полосы рукотворного пола (тропа, плитка, гравий, булыжник, лёд в Незере, доски),
//      не газон и не природа: материал, ширина, направление, концы, длина;
//   3) РАЗМЕТКА - небольшие фигуры цветных блоков (шерсть, бетон, терракота, глазурь, ковры, блоки лазурита,
//      редстоуна, изумруда, золота), отличные от пола вокруг: цвет (по оттенку - синие разных видов в одну), форма,
//      куда указывает (у стрелки острый конец уже тупого);
//   4) связь: разметка у начала дороги и указывает вдоль неё - дорога получает имя по цвету («синяя ветка»);
//   5) ПРОХОДЫ по форме свободного места, а не по материалу: тоннель в незерраке, мост над лавой, коридор, улица
//      между домами - узкая (до 4 бл.) и длинная полоса, где можно идти, со стенами или пустотой по бокам. Цвета и
//      стрелки редки (владелец: «мысли шире»), а проходы есть везде;
//   6) ТАБЛИЧКИ с направлением («Энд налево», «столовая ->», «замок прямо», «^ спавн»): куда указывает - по стороне,
//      куда смотрит табличка, и слову; проход или дорога, что уходит в ту сторону от таблички, получает её имя.
// Всё найденное копится в памяти (дороги и их имена переживают перезапуск), мозг получает строку [вокруг], а путь
// дешевле по известным дорогам (bot.js navStepCost) и дальний путь выбирает подписанную дорогу к цели (travel).
const { Vec3 } = require('vec3');

const NATURAL = /^(grass_block|dirt|coarse_dirt_never|rooted_dirt|podzol|mycelium|moss_block|sand|red_sand|stone|deepslate|tuff|andesite|diorite|granite|calcite|clay|mud|snow|snow_block|netherrack|soul_sand|soul_soil|basalt|blackstone|end_stone|crimson_nylium|warped_nylium|magma_block|water|lava|ice_never|farmland|short_grass|tall_grass|.*_leaves|gravel_never)$/;
const HUE = [
  ['синяя', /^(blue|light_blue|cyan)_|^lapis_block$|^blue_ice_never$/],
  ['красная', /^(red|pink|magenta)_|^redstone_block$|^red_nether_bricks$|^nether_wart_block$/],
  ['зелёная', /^(green|lime)_|^emerald_block$/],
  ['жёлтая', /^(yellow|orange)_|^gold_block$|^honeycomb_block$/],
  ['фиолетовая', /^purple_|^amethyst_block$/],
  ['белая', /^white_(wool|concrete|concrete_powder|terracotta|glazed_terracotta|carpet)$|^quartz_block$/],
  ['чёрная', /^black_(wool|concrete|concrete_powder|terracotta|glazed_terracotta|carpet)$/],
];
const DYED = /_(wool|concrete|concrete_powder|terracotta|glazed_terracotta|carpet|stained_glass)$|^(lapis_block|redstone_block|emerald_block|gold_block|amethyst_block|honeycomb_block|red_nether_bricks|nether_wart_block)$/;
const hueOf = (n) => { if (!DYED.test(n)) return ''; for (const [h, re] of HUE) if (re.test(n)) return h; return ''; };
// табличка: куда смотрит её лицо (к читающему); стоячая - rotation 0..15 (0 - юг), настенная - facing
function signFront(bl) {
  const pr = bl.getProperties ? bl.getProperties() : {};
  if (pr.rotation !== undefined) { const th = (+pr.rotation) * Math.PI / 8; return { x: -Math.sin(th), z: Math.cos(th) }; }
  return { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } }[pr.facing] || null;
}
const DIRWORDS = /(налево|влево|слева|направо|вправо|справа|прямо|вперёд|вперед|назад|сзади|north|south|east|west|left|right|север|юг|запад|восток|<-+|-+>|←|→|↑|↓|\^|<|>)/gi;
// направление из строки таблички: «налево/направо/прямо/назад» - от читающего (он смотрит на табличку, против её
// лица), стороны света - как есть
function signDir(t, f) {
  const fw = { x: -f.x, z: -f.z }, left = { x: fw.z, z: -fw.x }, right = { x: -fw.z, z: fw.x };
  if (/налево|влево|слева|left|<-|←|^\s*</i.test(t)) return left;
  if (/направо|вправо|справа|right|->|→|>\s*$/i.test(t)) return right;
  if (/прямо|вперёд|вперед|↑|\^/i.test(t)) return fw;
  if (/назад|сзади|↓/i.test(t)) return f;
  if (/север|north/i.test(t)) return { x: 0, z: -1 };
  if (/(^|[^а-я])юг|south/i.test(t)) return { x: 0, z: 1 };
  if (/запад|west/i.test(t)) return { x: -1, z: 0 };
  if (/восток|east/i.test(t)) return { x: 1, z: 0 };
  return null;
}
const DIR8 = ['восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад', 'север', 'северо-восток'];
const dirName = (dx, dz) => DIR8[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];

/** Главная ось набора клеток (PCA): направление, длина и ширина вдоль/поперёк. */
function axis(cells) {
  const n = cells.length, mx = cells.reduce((s, c) => s + c[0], 0) / n, mz = cells.reduce((s, c) => s + c[1], 0) / n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of cells) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  let lo = Infinity, hi = -Infinity, wl = Infinity, wh = -Infinity;
  for (const [x, z] of cells) { const t = (x - mx) * ux + (z - mz) * uz, w = -(x - mx) * uz + (z - mz) * ux; lo = Math.min(lo, t); hi = Math.max(hi, t); wl = Math.min(wl, w); wh = Math.max(wh, w); }
  return { mx, mz, ux, uz, lo, hi, len: hi - lo + 1, width: wh - wl + 1 };
}

/** Связные области сетки (4-соседство) по признаку key(x,z) -> строка или ''. */
function regions(grid, key) {
  const seen = new Set(), out = [];
  for (const [k, c] of grid) {
    if (seen.has(k)) continue;
    const kk = key(c); if (!kk) continue;
    const cells = [], q = [c]; seen.add(k);
    while (q.length) {
      const p = q.pop(); cells.push([p.x, p.z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${p.x + dx},${p.z + dz}`, n = grid.get(nk);
        if (!n || seen.has(nk) || key(n) !== kk) continue;
        seen.add(nk); q.push(n);
      }
    }
    out.push({ key: kk, cells });
  }
  return out;
}

class Features {
  /** Скан пола вокруг: Map "x,z" -> { x, y, z, name }. */
  floorScan(R = 28) {
    const b = this.bot, me = b.entity.position.floored(), grid = new Map();
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dz * dz > R * R) continue;
      const x = me.x + dx, z = me.z + dz;
      for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
        const y = me.y + dy, f = b.blockAt(new Vec3(x, y - 1, z), false);
        if (!f || f.boundingBox !== 'block') continue;
        const a = b.blockAt(new Vec3(x, y, z), false), h = b.blockAt(new Vec3(x, y + 1, z), false);
        if (!a || !h || a.boundingBox !== 'empty' || h.boundingBox !== 'empty') continue;
        // ковёр на полу - это пол цвета ковра
        grid.set(`${x},${z}`, { x, y, z, name: /carpet$/.test(a.name) ? a.name : f.name });
        break;
      }
    }
    return grid;
  }

  /** Разбор пола: дороги и разметка рядом; копится в памяти. Раз в несколько секунд, когда бот сдвинулся. */
  featuresTick(force) {
    const b = this.bot;
    if (!b || !b.entity) return;
    const p = b.entity.position, now = Date.now();
    if (!force && this._featAt && now - this._featAt < 4000) return;
    if (!force && this._featPos && p.distanceTo(this._featPos) < 8 && now - this._featAt < 30000) return;
    this._featAt = now; this._featPos = p.clone();
    const grid = this.floorScan();
    const dim = this.dimName ? this.dimName() : 'обычный мир';
    // дороги: рукотворный пол (не газон, не природа) или лёд/тропа; полосы, а не площади
    const roadKey = (c) => (NATURAL.test(c.name) || hueOf(c.name) ? '' : c.name.replace(/^(waxed_)?(exposed_|weathered_|oxidized_)?/, '').replace(/^(cracked_|mossy_|chiseled_|polished_|smooth_)/, '').replace(/_(slab|stairs)$/, ''));
    const roads = [];
    // соседние разные материалы одной дороги (плитка + гравий): сначала «рукотворное ли», потом материалы внутри
    for (const r of regions(grid, (c) => (roadKey(c) ? 'road' : ''))) {
      if (r.cells.length < 12) continue;
      const ax = axis(r.cells);
      if (ax.len < 10 || ax.len / Math.max(1, ax.width) < 2.5 || ax.width > 7) continue;   // площадь, а не дорога
      const mats = {}; for (const [x, z] of r.cells) { const n = grid.get(`${x},${z}`).name; mats[n] = (mats[n] || 0) + 1; }
      const mat = Object.entries(mats).sort((u, v) => v[1] - u[1]).slice(0, 2).map((e) => e[0]);
      const e1 = { x: Math.round(ax.mx + ax.ux * ax.lo), z: Math.round(ax.mz + ax.uz * ax.lo) }, e2 = { x: Math.round(ax.mx + ax.ux * ax.hi), z: Math.round(ax.mz + ax.uz * ax.hi) };
      const y = grid.get(`${r.cells[0][0]},${r.cells[0][1]}`).y;
      // упирается в край обзора - дорога длиннее, чем видно
      const edge = (e) => Math.hypot(e.x - p.x, e.z - p.z) > 24;
      roads.push({ mat, width: Math.round(ax.width), len: Math.round(ax.len), e1, e2, y, more: edge(e1) || edge(e2), ux: ax.ux, uz: ax.uz });
    }
    // проходы по форме: клетка в узкой (до 4) и длинной (6+) полосе свободного пола по одной из осей
    const runs = (c, dx, dz) => { let n = 1; for (const s2 of [1, -1]) for (let k = 1; k < 14; k++) { if (!grid.has(`${c.x + dx * k * s2},${c.z + dz * k * s2}`)) break; n++; } return n; };
    const narrow = new Map();
    for (const [k, c] of grid) { const rx = runs(c, 1, 0), rz = runs(c, 0, 1); if ((rx <= 4 && rz >= 6) || (rz <= 4 && rx >= 6)) narrow.set(k, c); }
    for (const r of regions(narrow, () => 'p')) {
      if (r.cells.length < 10) continue;
      const ax = axis(r.cells);
      if (ax.len < 8 || ax.len / Math.max(1, ax.width) < 2.5) continue;
      // не та же дорога, что уже найдена по материалу
      if (roads.some((rd) => Math.hypot((rd.e1.x + rd.e2.x) / 2 - ax.mx, (rd.e1.z + rd.e2.z) / 2 - ax.mz) < 4 && Math.abs(rd.ux * ax.ux + rd.uz * ax.uz) > 0.8)) continue;
      const mid = r.cells[Math.floor(r.cells.length / 2)], c0 = grid.get(`${mid[0]},${mid[1]}`);
      const roof = [2, 3, 4, 5].some((dy) => { const k = this.bot.blockAt(new Vec3(c0.x, c0.y + dy, c0.z), false); return k && k.boundingBox === 'block'; });
      const side = (sx, sz) => { const k = this.bot.blockAt(new Vec3(Math.round(c0.x + sx), c0.y - 1, Math.round(c0.z + sz)), false); return k ? k.name : ''; };
      const sides = [side(-ax.uz * 3, ax.ux * 3), side(ax.uz * 3, -ax.ux * 3)];
      const kind = roof ? 'тоннель' : sides.some((n) => /^(air|lava|water|void_air|cave_air)$/.test(n)) ? 'мост' : 'проход';
      const mats = {}; for (const [x, z] of r.cells) { const n = grid.get(`${x},${z}`).name; mats[n] = (mats[n] || 0) + 1; }
      const e1 = { x: Math.round(ax.mx + ax.ux * ax.lo), z: Math.round(ax.mz + ax.uz * ax.lo) }, e2 = { x: Math.round(ax.mx + ax.ux * ax.hi), z: Math.round(ax.mz + ax.uz * ax.hi) };
      const edge = (e) => Math.hypot(e.x - p.x, e.z - p.z) > 24;
      roads.push({ kind, mat: Object.entries(mats).sort((u, v) => v[1] - u[1]).slice(0, 2).map((e) => e[0]), width: Math.round(ax.width), len: Math.round(ax.len), e1, e2, y: c0.y, more: edge(e1) || edge(e2), ux: ax.ux, uz: ax.uz });
    }
    // разметка: цветные фигуры среди пола другого цвета
    const marks = [];
    for (const r of regions(grid, (c) => hueOf(c.name))) {
      if (r.cells.length < 3 || r.cells.length > 80) continue;
      const ax = axis(r.cells);
      if (ax.len > 16) continue;
      // куда указывает: на каком конце фигура уже (острие); близко по ширине - без направления (пятно, полоса)
      const widthAt = (t0, t1) => { const ws = r.cells.filter(([x, z]) => { const t = (x - ax.mx) * ax.ux + (z - ax.mz) * ax.uz; return t >= t0 && t <= t1; }).map(([x, z]) => -(x - ax.mx) * ax.uz + (z - ax.mz) * ax.ux); return ws.length ? Math.max(...ws) - Math.min(...ws) + 1 : 0; };
      const third = ax.len / 3, wLo = widthAt(ax.lo, ax.lo + third), wHi = widthAt(ax.hi - third, ax.hi);
      let dir = null;
      if (ax.len >= 3 && Math.abs(wLo - wHi) >= 1) dir = wHi < wLo ? { x: ax.ux, z: ax.uz } : { x: -ax.ux, z: -ax.uz };
      const y = grid.get(`${r.cells[0][0]},${r.cells[0][1]}`).y;
      const blocks = [...new Set(r.cells.map(([x, z]) => grid.get(`${x},${z}`).name))].slice(0, 3);
      marks.push({ hue: r.key, x: Math.round(ax.mx), z: Math.round(ax.mz), y, size: r.cells.length, dir, blocks, shape: dir ? 'стрелка' : ax.len / Math.max(1, ax.width) > 2.5 ? 'полоса' : 'пятно' });
    }
    // подпись дорог разметкой: цветная фигура у конца дороги (до 7 бл.) и указывает вдоль неё (или без направления)
    for (const m of marks) {
      let best = null, bd = 8;
      for (const rd of roads) for (const [e, far] of [[rd.e1, rd.e2], [rd.e2, rd.e1]]) {
        const d = Math.hypot(e.x - m.x, e.z - m.z); if (d >= bd) continue;
        const vx = far.x - e.x, vz = far.z - e.z, L = Math.hypot(vx, vz) || 1;
        if (m.dir && (m.dir.x * vx + m.dir.z * vz) / L < 0.5) continue;
        best = { rd, e, far }; bd = d;
      }
      if (best) { best.rd.label = m.hue; best.rd.start = best.e; best.rd.toward = dirName(best.far.x - best.e.x, best.far.z - best.e.z); m.road = best.rd; }
    }
    // таблички с направлением: подписать проход или дорогу, что уходит в ту сторону
    const signs = [];
    try {
      for (const v of this.bot.findBlocks({ matching: (bl) => /_sign$/.test(bl.name), maxDistance: 20, count: 24 })) {
        const bl = this.bot.blockAt(v); if (!bl) continue;
        let lines = []; try { const st = bl.getSignText(); lines = (Array.isArray(st) ? st : [st]).join('\n').split('\n').map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean); } catch {}
        if (!lines.length) continue;
        const f = signFront(bl); if (!f) continue;
        // строка - отдельное указание («Энд налево», «столовая вперёд»); плюс вся табличка целиком
        for (const ln of lines.length > 1 ? lines.concat([lines.join(' ')]) : lines) {
          const d = signDir(ln, f); if (!d) continue;
          const subj = ln.replace(DIRWORDS, ' ').replace(/[<>^←→↑↓|«»"]/g, ' ').replace(/\s+/g, ' ').trim();
          if (subj.length < 2) continue;
          signs.push({ subj: subj.slice(0, 40), x: v.x, z: v.z, d });
          let best = null, bs = 0.6;
          for (const rd of roads) for (const [e, far] of [[rd.e1, rd.e2], [rd.e2, rd.e1]]) {
            if (Math.hypot(e.x - v.x, e.z - v.z) > 12) continue;
            const vx = far.x - v.x, vz = far.z - v.z, L = Math.hypot(vx, vz) || 1, c = (vx * d.x + vz * d.z) / L;
            if (c > bs) { bs = c; best = { rd, e, far }; }
          }
          if (best && !best.rd.label) { best.rd.label = subj.slice(0, 40); best.rd.start = best.e; best.rd.toward = dirName(best.far.x - best.e.x, best.far.z - best.e.z); best.rd.bySign = true; }
        }
      }
    } catch {}
    this._scene = { at: now, dim, roads, marks, signs, pos: p.clone() };
    try { if (this.graphFeed) this.graphFeed(roads); } catch {}   // увиденные проходы - в карту связей (navgraph.js)
    this.rememberFeatures(dim, roads, marks);
  }

  /** В память: дороги (по концам и материалу, без повторов) и подписанные ветки - местами «ветка синяя». */
  rememberFeatures(dim, roads, marks) {
    const m = this.memory; if (!m) return;
    const R = (m.data.roads = m.data.roads || []);
    let changed = false;
    for (const rd of roads) {
      const same = R.find((q) => q.dim === dim && q.mat[0] === rd.mat[0] && Math.min(Math.hypot(q.e1.x - rd.e1.x, q.e1.z - rd.e1.z) + Math.hypot(q.e2.x - rd.e2.x, q.e2.z - rd.e2.z), Math.hypot(q.e1.x - rd.e2.x, q.e1.z - rd.e2.z) + Math.hypot(q.e2.x - rd.e1.x, q.e2.z - rd.e1.z)) < 12);
      const rec = { dim, mat: rd.mat, width: rd.width, len: rd.len, e1: rd.e1, e2: rd.e2, y: rd.y, label: rd.label || (same && same.label) || '', start: rd.start || (same && same.start) || null, toward: rd.toward || (same && same.toward) || '', at: Date.now() };
      if (same) { if (!same.label && rec.label) changed = true; Object.assign(same, rec); } else { R.push(rec); changed = true; }
      if (rd.label && rd.start) {
        const name = rd.bySign ? `${rd.label} (по табличке)` : `ветка ${rd.label}`;
        const old = m.data.places && Object.values(m.data.places).find((pl) => pl.name === name && pl.dim === dim);
        if (!old || Math.hypot(old.x - rd.start.x, old.z - rd.start.z) > 6) {
          m.place({ name, x: rd.start.x, y: rd.y, z: rd.start.z, dim, note: `начало: ${rd.kind || 'дорога'} (${rd.mat[0]}), ведёт на ${rd.toward}; ${rd.bySign ? 'так указывает табличка' : 'метка - ' + rd.label + ' разметка на полу'}` }, this.opts.name + (rd.bySign ? ' (понял по табличке)' : ' (понял по разметке)'));
          this.log(`понял: ${name} - дорога из ${rd.mat[0]} от ${rd.start.x} ${rd.start.z} на ${rd.toward}`);
        }
      }
    }
    if (R.length > 400) R.splice(0, R.length - 400);
    if (changed) m.save();
  }

  /** Строка мозгу: дороги и разметка вокруг (что подписано - по имени). */
  sceneText() {
    const S = this._scene; if (!S || Date.now() - S.at > 60000) return '';
    const me = this.bot.entity.position, out = [];
    const rs = S.roads.slice().sort((a, b) => Math.min(Math.hypot(a.e1.x - me.x, a.e1.z - me.z), Math.hypot(a.e2.x - me.x, a.e2.z - me.z)) - Math.min(Math.hypot(b.e1.x - me.x, b.e1.z - me.z), Math.hypot(b.e2.x - me.x, b.e2.z - me.z))).slice(0, 4);
    for (const r of rs) out.push(`${r.label ? (r.bySign ? '«' + r.label + '» по табличке: ' : 'ветка ' + r.label + ': ') : ''}${r.kind || 'дорога'} из ${r.mat.join('+')} шир. ${r.width}, ${r.len}${r.more ? '+' : ''} бл., ${r.e1.x} ${r.e1.z} - ${r.e2.x} ${r.e2.z}${r.toward ? ', ведёт на ' + r.toward : ''}`);
    const ms = S.marks.filter((m) => !m.road).slice(0, 4);
    for (const m of ms) out.push(`разметка: ${m.hue} ${m.shape}${m.dir ? ' на ' + dirName(m.dir.x, m.dir.z) : ''} у ${m.x} ${m.z} (${m.blocks.join(', ')})`);
    return out.join('; ');
  }

  /** Материал известных дорог в этой точке (для цены шага): «по дороге» дешевле. */
  onKnownRoad(x, z) {
    const S = this._scene; if (!S) return false;
    for (const r of S.roads) {
      const vx = r.e2.x - r.e1.x, vz = r.e2.z - r.e1.z, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - r.e1.x) * vx + (z - r.e1.z) * vz) / L2));
      if (Math.hypot(r.e1.x + vx * t - x, r.e1.z + vz * t - z) <= r.width / 2 + 0.5) return true;
    }
    return false;
  }

  /** Известная подписанная дорога, что ведёт к цели (для дальнего пути): начало и направление. */
  roadToward(dim, from, to) {
    // у цели есть имя - сначала дорога, подписанная похожим словом («замок», «Энд», «красная»)
    const R0 = (this.memory && this.memory.data.roads) || [];
    if (to.name) {
      const words = String(to.name).toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 2);
      const hit = R0.find((r) => r.dim === dim && r.start && r.label && words.some((w) => r.label.toLowerCase().includes(w)) && Math.hypot(r.start.x - from.x, r.start.z - from.z) < 300);
      if (hit) { const far = Math.hypot(hit.e1.x - hit.start.x, hit.e1.z - hit.start.z) > Math.hypot(hit.e2.x - hit.start.x, hit.e2.z - hit.start.z) ? hit.e1 : hit.e2; const L = Math.hypot(far.x - hit.start.x, far.z - hit.start.z) || 1; return { road: hit, ux: (far.x - hit.start.x) / L, uz: (far.z - hit.start.z) / L }; }
    }
    const R = (this.memory && this.memory.data.roads) || [];
    const tx = to.x - from.x, tz = to.z - from.z, TL = Math.hypot(tx, tz) || 1;
    let best = null, bs = 0.85;
    for (const r of R) {
      if (r.dim !== dim || !r.start) continue;
      if (Math.hypot(r.start.x - from.x, r.start.z - from.z) > 200) continue;
      const far = Math.hypot(r.e1.x - r.start.x, r.e1.z - r.start.z) > Math.hypot(r.e2.x - r.start.x, r.e2.z - r.start.z) ? r.e1 : r.e2;
      const vx = far.x - r.start.x, vz = far.z - r.start.z, L = Math.hypot(vx, vz) || 1, c = (vx * tx + vz * tz) / (L * TL);
      if (c > bs) { bs = c; best = { road: r, ux: vx / L, uz: vz / L }; }
    }
    return best;
  }
}

module.exports = { Features, hueOf, axis };
