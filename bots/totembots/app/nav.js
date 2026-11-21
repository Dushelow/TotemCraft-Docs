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
  const cache = new Map();   // коробки блока по координатам; сбрасывается раз в 3 с и при изменении блока
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

  // ---- Паркур: прыжок с разбега через яму. Ход появляется, только если физика самой игры (prismarine-physics -
  // ей же ходит бот) подтверждает, что тело с места, разбежавшись внутри своей клетки и оттолкнувшись у края,
  // приземлится в нужной клетке. Над лавой и пропастью (глубже maxDropDown) не прыгает.
  const LEAP_AT = 0.62;   // толчок, когда центр тела прошёл столько от центра клетки к краю
  let physics = null;
  /** Управление прыжком (одно для проверки и для тела): разбег, толчок у края, в воздухе над целью - тормоз. */
  function leapControl(pos, onGround, lp, tx, tz) {
    const prog = (pos.x - lp.from[0]) * lp.dx + (pos.z - lp.from[1]) * lp.dz;
    const over = ((pos.x - tx) * lp.dx + (pos.z - tz) * lp.dz) > -0.5;   // уже над целевой клеткой
    const brake = !onGround && prog > LEAP_AT && over;
    return { forward: !brake, back: brake, left: false, right: false, sprint: lp.sprint && !brake, sneak: false, jump: onGround && prog >= LEAP_AT };
  }
  /** Проверка физикой игры: с места, шагом или бегом. Возвращает true/false для режима lp.sprint. */
  function simLeap(sy, lp, tx, ty, tz) {
    try {
      const { Physics, PlayerState } = require('prismarine-physics');
      const world = { getBlock: (p) => mv.bot.blockAt(new Vec3(p.x, p.y, p.z), false) };
      physics = physics || Physics(mv.bot.registry, world);
      const e = { position: new Vec3(lp.from[0], sy, lp.from[1]), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: Math.atan2(-lp.dx, -lp.dz), pitch: 0, effects: {}, attributes: {} };
      const fake = { entity: e, version: mv.bot.version, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, game: {}, inventory: { slots: [] }, registry: mv.bot.registry };
      let air = false;
      for (let t = 0; t < 40; t++) {
        const st = new PlayerState(fake, leapControl(e.position, e.onGround, lp, tx, tz));
        physics.simulatePlayer(st, world); st.apply(fake);
        if (e.position.y < sy - 2.5) return false;
        const prog = (e.position.x - lp.from[0]) * lp.dx + (e.position.z - lp.from[1]) * lp.dz;
        if (!e.onGround && prog >= 0.5) air = true;
        if (air && e.onGround) return Math.floor(e.position.x) === Math.floor(tx) && Math.floor(e.position.z) === Math.floor(tz) && Math.floor(e.position.y + 1e-3) === ty;
      }
    } catch { return false; }
    return false;
  }
  const leapCache = new Map();
  function leaps(node, fy, out, seen) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // первая клетка - яма (опоры на уровне ног нет), иначе это обычный шаг
      // (спуск на блок - обычный шаг: яма - это где пола нет и на 1,2 ниже)
      const s1 = support(node.x + dx + 0.5, node.z + dz + 0.5, fy + 0.6, fy - 1.2);
      if (s1 !== null) continue;
      for (let k = 2; k <= 4; k++) {
        const nx = node.x + dx * k, nz = node.z + dz * k;
        // клетки ямы: что под ними (лава - нельзя, дна в пределах maxDropDown нет - пропасть, нельзя)
        let bad = false;
        for (let i = 1; i < k && !bad; i++) {
          const gx = node.x + dx * i, gz = node.z + dz * i;
          if (i > 1 && support(gx + 0.5, gz + 0.5, fy + 0.6, fy - 0.5) !== null) { bad = true; break; }
          const floor = support(gx + 0.5, gz + 0.5, fy - 0.5, fy - mv.maxDropDown - 1);
          if (floor === null) bad = true;
          for (let y = Math.floor(fy) - 1; y >= Math.floor(fy) - 4 && !bad; y--) if (cell(gx, y, gz).bad) bad = true;
        }
        if (bad) break;
        const f = support(nx + 0.5, nz + 0.5, fy + 1.0, fy - 1.0);
        if (f === null) continue;
        const ny = Math.floor(f + EPS), key = `${node.x},${node.y},${node.z}>${nx},${ny},${nz}`;
        if (seen.has(`${nx},${ny},${nz}`)) break;
        let lp = leapCache.get(key);
        if (lp === undefined) {
          lp = null;
          for (const sprint of [false, true]) {   // сначала шагом (короткий прыжок), не вышло - с бегом
            const t = { from: [node.x + 0.5, node.z + 0.5], dx, dz, sprint };
            if (simLeap(fy, t, nx + 0.5, ny, nz + 0.5)) { lp = t; break; }
          }
          leapCache.set(key, lp); if (leapCache.size > 5000) leapCache.clear();
        }
        if (!lp) continue;
        const m = new Move(nx, ny, nz, node.remainingBlocks, k + 3 + (f > fy ? 1 : 0), [], []);
        m.feet = f; m.cell = [nx, nz]; m.leap = lp;
        seen.add(`${nx},${ny},${nz}`); out.push(m);
        break;   // ближайшая достижимая посадка
      }
    }
  }

  mv.getNeighbors = function (node) {
    if (Date.now() - cacheAt > 3000) { cache.clear(); cacheAt = Date.now(); ox = node.x; oz = node.z; cache.ox = ox; cache.oz = oz; }
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
        // не через toPlace модуля пути: у него после открытия ошибка, путь пересчитывается, и калитка закрывалась
        // обратно (21.11 спам открыть-закрыть). Ход помнит нужное положение, открывает тело само (ниже).
        for (const c of w.hit) { const pk = pairKey(c); if (pk && done.has(pk)) continue; done.add(c.k); const pr = c.b.getProperties(); toPlace.push({ x: c.at[0], y: c.at[1], z: c.at[2], want: !(pr.open === true || pr.open === 'true') }); }
        w = { ...w2, opened: true };
      }
      if (!w) continue;
      const ny = Math.floor(w.feet + EPS), rise = w.feet - fy;
      // под ногами в конце шага: грядку вытаптывает прыжок и падение на неё - такие шаги нельзя; ходить по ней - дорого
      const under = cell(nx, Math.floor(w.feet - 0.01), nz).b, uname = under ? under.name : '';
      if (uname === 'farmland' && (w.jumped || rise < -0.25)) continue;
      let cost = (dx && dz ? Math.SQRT2 : 1) + (w.jumped ? 1 : rise > EPS ? 0.3 : 0) + (rise < -1 ? -rise * 0.5 : 0) + (w.opened ? 2 : 0);
      if (uname === 'farmland') cost += 3;
      // цена клетки от тела (дороги дешевле, газоны у чужих домов дороже) - bot.js задаёт mv.navStepCost
      // ошибка в цене клетки не должна ломать поиск пути (22.11: падение -> «путь пустой» десятки раз, бот дёргался)
      if (mv.navStepCost) { try { cost *= mv.navStepCost(nx, ny, nz, uname) || 1; } catch (e) { if (!mv._costErr) { mv._costErr = 1; console.error('nav: цена клетки', e.message); } } }
      const dest = blk(nx, ny, nz);
      cost += mv.exclusionStep(dest) + mv.getNumEntitiesAt(dest && dest.position, 0, 0, 0) * mv.entityCost;
      if (cost >= 100) continue;
      const k = `${nx},${ny},${nz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const m = new Move(nx, ny, nz, node.remainingBlocks, cost, [], []);
      if (toPlace.length) m.opens = toPlace;
      m.feet = w.feet; m.cell = [nx, nz];   // настоящая высота ног и клетка: точку маршрута ставим по ним (см. ниже)
      out.push(m);
    }
    if (mv.navLeaps !== false) leaps(node, fy, out, seen);
    return out;
  };
  mv._nav = { support, body, walk, cell, leapControl };
  if (bot) (bot._navCaches = bot._navCaches || []).push(cache);
  // Точки маршрута. Модуль пути после поиска ставит точку «на верх блока» в клетке; у открытого люка или двери у края
  // клетки это верх тонкой стенки - точка на блок выше пола и смещена к краю, бот до неё «не доходит» и стоит (сбой
  // по «stuck» через 3,5 с). Наши шаги знают настоящую высоту ног - ставим точку в центр клетки на эту высоту.
  if (bot && bot.on && !bot._navPoints) {
    bot._navPoints = true;
    bot.on('path_update', (r) => {
      // и после двери тоже: там модуль пути оставлял угол клетки вместо центра
      for (const p of r.path || []) if (p.cell) { p.x = p.cell[0] + 0.5; p.z = p.cell[1] + 0.5; p.y = p.feet; }
      bot._navPath = r.path;
    });
    // блок изменился (открыли калитку) - забыть его старую форму сразу, а не через 3 с
    bot.on('blockUpdate', (o, n) => { const v = (n || o) && (n || o).position; if (v) for (const c of bot._navCaches || []) c.delete(((v.x - c.ox + 1048576) * 2097152 + (v.z - c.oz + 1048576)) * 1024 + (v.y + 512)); });
    // прыжок через яму: модуль пути перед ямой стоит без клавиш - разбег и толчок делает тело (тем же правилом,
    // что проверяла физика при поиске пути)
    bot.on('physicsTick', () => {
      const path = bot._navPath, m = path && path[0];
      if (!m || !m.leap || !bot.entity || !bot.pathfinder.isMoving()) return;
      const [sx, sz] = m.leap.from, { dx, dz } = m.leap, p = bot.entity.position;
      const prog = (p.x - sx) * dx + (p.z - sz) * dz;
      if (prog < -0.6 || Math.abs((p.x - sx) * dz) + Math.abs((p.z - sz) * dx) > 0.6) return;   // ещё не в клетке разбега
      bot.look(Math.atan2(-dx, -dz), 0, true);
      const c = leapControl(p, bot.entity.onGround, m.leap, m.cell[0] + 0.5, m.cell[1] + 0.5);
      for (const k of ['forward', 'back', 'sprint', 'jump']) bot.setControlState(k, c[k]);
    });
    // двери, калитки, люки на ближайших шагах: открыть (закрыть), только если сейчас не в нужном положении
    const tog = new Map();
    bot.on('physicsTick', () => {
      const path = bot._navPath, me = bot.entity && bot.entity.position;
      if (!path || !me) return;
      for (const m of path.slice(0, 2)) for (const o of m.opens || []) {
        if (Math.hypot(o.x + 0.5 - me.x, o.z + 0.5 - me.z) > 3) continue;
        const k = `${o.x},${o.y},${o.z}`, b = bot.blockAt(new Vec3(o.x, o.y, o.z));
        if (!b || !OPENABLE.test(b.name)) continue;
        const pr = b.getProperties(), open = pr.open === true || pr.open === 'true';
        if (open === o.want || Date.now() - (tog.get(k) || 0) < 1500) continue;
        tog.set(k, Date.now());
        bot.activateBlock(b).catch(() => {});
      }
    });
  }
}

module.exports = { install };
