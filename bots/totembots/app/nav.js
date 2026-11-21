// Навигация по настоящей форме блоков (корень проблем с ходьбой).
//
// Модуль пути mineflayer-pathfinder видит мир сеткой целых кубиков «твёрдый / пустой»: формы блока он не знает. Отсюда
// все ошибки 15-21.11: люк считался то стеной, то полом; кровать и плита «поднимали» бота на клетку; лестница под
// потолком - «пути нет»; стена из люков - проход. Каждую форму латали отдельно (house-moves.js).
//
// Здесь проходимость решается так же, как в самой игре: у каждого блока в его текущем состоянии есть «коробки
// столкновений» (открытый люк - тонкая стенка у края, закрытый - пластина снизу или сверху, кровать - 0,56 высоты,
// забор - 1,5, ступенька - две коробки). Тело бота - коробка 0,6 × 0,6 × 1,8. Шаг в соседнюю клетку проверяется
// «прогулкой»: тело по кусочкам ведётся от центра к центру, в каждой точке:
//   - опора - самая высокая верхушка коробок под телом; подъём до 0,6 - шагом (ступенька, плита, кровать, ковёр),
//     до 1,25 - прыжком (над головой должно хватить места), ниже - падение не глубже maxDropDown;
//   - тело на этой высоте ни во что не упирается (углы, стенки люков и дверей, потолок над ступенькой);
//   - тело не в воде, лаве, огне и паутине (вода - за модулем пути).
// Если мешают только деревянные дверь, калитка или люк, тело проверяет, станет ли свободно, когда их открыть или
// закрыть, и только тогда откроет по пути (так модуль пути открывает калитки). Копание, мостки, вода и лестницы-лианы
// остаются за модулем пути: его ходы с ломанием и стройкой, вертикальные и водные не трогаем.
const Move = require('mineflayer-pathfinder/lib/move');
const { Vec3 } = require('vec3');

const HALF = 0.3, H = 1.8, STEP = 0.6, JUMP = 1.25, EPS = 1e-3;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const OPENABLE = /(_door|_fence_gate|_trapdoor)$/;
const BAD = /^(water|lava|fire|soul_fire|cobweb|bubble_column|sweet_berry_bush|powder_snow)$/;

function install(mv, bot) {
  const base = mv.getNeighbors.bind(mv);
  const Block = require('prismarine-block')(mv.bot.registry);
  const cache = new Map();   // коробки блока по координатам; сбрасывается раз в 3 с (мир меняется)
  let cacheAt = 0, ox = 0, oz = 0;   // числовой ключ кэша - от точки отсчёта (строки в 5 раз медленнее)
  const blk = (x, y, z) => mv.bot.blockAt(new Vec3(x, y, z), false);

  function shapesOf(b, x, y, z) {
    const r = [];
    if (b && b.boundingBox !== 'empty' && b.shapes) for (const s of b.shapes) r.push({ x0: x + s[0], y0: y + s[1], z0: z + s[2], x1: x + s[3], y1: y + s[4], z1: z + s[5] });
    return r;
  }
  /** Блок в клетке: коробки столкновений (в мировых координатах), можно ли открыть рукой, опасен ли. */
  function cell(x, y, z) {
    const n = ((x - ox + 1048576) * 2097152 + (z - oz + 1048576)) * 1024 + (y + 512);
    let c = cache.get(n);
    if (c) return c;
    const b = blk(x, y, z);
    c = { k: `${x},${y},${z}`, at: [x, y, z], boxes: shapesOf(b, x, y, z), open: !!(b && OPENABLE.test(b.name) && !/^iron_/.test(b.name)), bad: !!(b && (BAD.test(b.name) || mv.blocksToAvoid.has(b.type))), b };
    cache.set(n, c);
    return c;
  }
  /** Коробки блока, если его открыть/закрыть (для дверей, калиток, люков; двери - обе половины). */
  function flipped(c) {
    if (c.flip) return c.flip;
    const pr = c.b.getProperties();
    const nb = Block.fromProperties(c.b.name, { ...pr, open: !(pr.open === true || pr.open === 'true') }, 0);
    c.flip = shapesOf(nb, ...c.at);
    return c.flip;
  }
  const boxesAt = (x, y, z, flip) => { const c = cell(x, y, z); return flip && flip.has(c.k) ? flipped(c) : c.boxes; };
  /** Есть ли у двери вторая половина, которую открывают вместе с этой: она тоже «перевёрнута». */
  function pairKey(c) { if (!/_door$/.test(c.b.name)) return null; const h = c.b.getProperties().half; return `${c.at[0]},${c.at[1] + (h === 'lower' ? 1 : -1)},${c.at[2]}`; }

  /** Блоки, которые пересекает тело с ногами на высоте fy в точке (px, pz). Возвращает клетки-помехи и опасность. */
  function body(px, fy, pz, flip) {
    const hit = [];
    let bad = false;
    for (let x = Math.floor(px - HALF + EPS); x <= Math.floor(px + HALF - EPS); x++)
      for (let z = Math.floor(pz - HALF + EPS); z <= Math.floor(pz + HALF - EPS); z++)
        for (let y = Math.floor(fy + EPS); y <= Math.floor(fy + H - EPS); y++) {
          const c = cell(x, y, z);
          if (c.bad) bad = true;
          for (const q of (flip && flip.has(c.k) ? flipped(c) : c.boxes))
            if (q.x0 < px + HALF - EPS && q.x1 > px - HALF + EPS && q.z0 < pz + HALF - EPS && q.z1 > pz - HALF + EPS && q.y0 < fy + H - EPS && q.y1 > fy + EPS) { hit.push(c); break; }
        }
    return { hit, bad };
  }
  /** Верхушки коробок под телом в точке (px, pz) от bottom до top, по убыванию: на что можно встать.
   *  В столбике ниже первой верхушки не выше stop (на неё встают шагом) не смотрим: ниже неё не встать. */
  function tops(px, pz, top, bottom, flip, stop = top) {
    const r = [];
    const x0 = Math.floor(px - HALF + EPS), x1 = Math.floor(px + HALF - EPS), z0 = Math.floor(pz - HALF + EPS), z1 = Math.floor(pz + HALF - EPS);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        col: for (let y = Math.floor(top); y >= Math.floor(bottom) - 1; y--) {
          const c = cell(x, y, z), bx = flip && flip.has(c.k) ? flipped(c) : c.boxes;
          let low = false;
          for (const q of bx)
            if (q.y1 <= top + EPS && q.y1 >= bottom - EPS && q.x0 < px + HALF - EPS && q.x1 > px - HALF + EPS && q.z0 < pz + HALF - EPS && q.z1 > pz - HALF + EPS) {
              if (!r.some((v) => Math.abs(v - q.y1) < EPS)) r.push(q.y1);
              if (q.y1 <= stop + EPS) low = true;
            }
          if (low) break col;
        }
    return r.length > 1 ? r.sort((a, b) => b - a) : r;
  }
  /** Высота ног, стоящих в точке (px, pz) не выше top: самая высокая опора. */
  const support = (px, pz, top, bottom, flip) => { const t = tops(px, pz, top, bottom, flip); return t.length ? t[0] : null; };

  /** «Прогулка» телом от (sx, sz) с высоты ног fy к центру (tx, tz). Итог: высота ног в конце, помехи, прыжок. */
  function walk(sx, fy, sz, tx, tz, flip) {
    // шаг 0,25: тело шириной 0,6 перекрывает соседние точки, тонкая стенка (люк 0,19) между ними не проскочит
    const n = Math.ceil(Math.hypot(tx - sx, tz - sz) / 0.25);
    let feet = fy, jumped = false, px = sx, pz = sz;
    const hit = new Map();
    const add = (r) => { for (const c of r.hit) hit.set(c.k, c); return r.bad; };
    for (let i = 1; i <= n; i++) {
      const nx = sx + (tx - sx) * i / n, nz = sz + (tz - sz) * i / n;
      // опора: шагом - любая до 0,6; прыжком (до 1,25) - только если телу там и над местом толчка хватает места,
      // иначе это не опора, а помеха на уровне груди или головы (люк в проёме, полка, край крыши)
      let s = null, jump = false;
      for (const t of tops(nx, nz, feet + JUMP, feet - mv.maxDropDown - 0.01, flip, feet + STEP)) {
        if (t <= feet + STEP + EPS) { s = t; break; }
        if (jumped) continue;
        if (!body(px, t, pz, flip).hit.length && !body(nx, t, nz, flip).hit.length) { s = t; jump = true; break; }
      }
      if (s === null) return null;                          // пропасть глубже допустимого
      if (jump) jumped = true;
      if (s < feet - EPS) for (let y = feet - 1; y > s; y -= 1) if (add(body(nx, y, nz, flip))) return null;   // столб падения
      feet = s; px = nx; pz = nz;
      if (add(body(nx, feet, nz, flip))) return null;
    }
    return { feet, jumped, hit: [...hit.values()] };
  }

  mv.getNeighbors = function (node) {
    if (Date.now() - cacheAt > 3000) { cache.clear(); cacheAt = Date.now(); ox = node.x; oz = node.z; }
    const out = [];
    // ходы модуля пути: с ломанием или стройкой, вертикальные (лестницы, лианы, столбы) и в воде - оставить
    for (const m of base(node)) {
      const vertical = m.x === node.x && m.z === node.z;
      const water = cell(m.x, m.y, m.z).bad || cell(node.x, node.y, node.z).bad || cell(m.x, m.y - 1, m.z).bad;
      const gate = m.toPlace.length && m.toPlace.every((p) => p.useOne);
      if (m.toBreak.length || (m.toPlace.length && !gate) || vertical || water) out.push(m);
    }
    // где на самом деле ноги: на кровати, люке, плите - не целая клетка
    const cx = node.x + 0.5, cz = node.z + 0.5;
    // стоит в проёме двери или люка - значит, их уже открыли, чтобы сюда войти: считать открытыми
    const inDoor = new Set();
    const fy0 = support(cx, cz, node.y + 0.99, node.y - 1);
    if (fy0 === null) return out;
    for (const c of body(cx, fy0, cz).hit) if (c.open) { inDoor.add(c.k); const p = pairKey(c); if (p) inDoor.add(p); }
    const fy = inDoor.size ? support(cx, cz, node.y + 0.99, node.y - 1, inDoor) : fy0;
    const open0 = inDoor.size ? inDoor : null;
    if (fy === null) return out;
    const seen = new Set();
    for (const [dx, dz] of DIRS) {
      const nx = node.x + dx, nz = node.z + dz;
      let w = walk(cx, fy, cz, nx + 0.5, nz + 0.5, open0), toPlace = [];
      if (w && w.hit.length) {
        // мешают только деревянные дверь, калитка, люк (не по диагонали): станет ли свободно, если их переключить
        if (dx && dz || !w.hit.every((c) => c.open) || w.hit.length > 2) continue;
        const flip = new Set([...inDoor, ...w.hit.map((c) => c.k)]);
        for (const c of w.hit) { const p = pairKey(c); if (p) flip.add(p); }
        const w2 = walk(cx, fy, cz, nx + 0.5, nz + 0.5, flip);
        if (!w2 || w2.hit.length) continue;
        const done = new Set();
        for (const c of w.hit) { const pk = pairKey(c); if (pk && done.has(pk)) continue; done.add(c.k); toPlace.push({ x: c.at[0], y: c.at[1], z: c.at[2], dx: 0, dy: 0, dz: 0, useOne: true }); }
        w = { ...w2, opened: true };
      }
      if (!w) continue;
      const ny = Math.floor(w.feet + EPS), rise = w.feet - fy;
      let cost = (dx && dz ? Math.SQRT2 : 1) + (w.jumped ? 1 : rise > EPS ? 0.3 : 0) + (rise < -1 ? -rise * 0.5 : 0) + (w.opened ? 2 : 0);
      const dest = blk(nx, ny, nz);
      cost += mv.exclusionStep(dest) + mv.getNumEntitiesAt(dest && dest.position, 0, 0, 0) * mv.entityCost;
      if (cost >= 100) continue;
      const k = `${nx},${ny},${nz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const m = new Move(nx, ny, nz, node.remainingBlocks, cost, [], toPlace);
      m.feet = w.feet; m.cell = [nx, nz];   // настоящая высота ног и клетка: точку маршрута ставим по ним (см. ниже)
      out.push(m);
    }
    return out;
  };
  mv._nav = { support, body, walk, cell };
  // Точки маршрута. Модуль пути после поиска ставит точку «на верх блока» в клетке; у открытого люка или двери у края
  // клетки это верх тонкой стенки - точка на блок выше пола и смещена к краю, бот до неё «не доходит» и стоит (сбой
  // по «stuck» через 3,5 с). Наши шаги знают настоящую высоту ног - ставим точку в центр клетки на эту высоту.
  if (bot && bot.on && !bot._navPoints) {
    bot._navPoints = true;
    bot.on('path_update', (r) => {
      // и после двери тоже: там модуль пути оставлял угол клетки вместо центра
      for (const p of r.path || []) if (p.cell) { p.x = p.cell[0] + 0.5; p.z = p.cell[1] + 0.5; p.y = p.feet; }
    });
  }
}

module.exports = { install };
