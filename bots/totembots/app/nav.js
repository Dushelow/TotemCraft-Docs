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
  // лианы - лестница, как в игре (в модуле пути строка с лианами закомментирована: по лианам на корабль не лез, 22.11)
  for (const n of ['vine', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'cave_vines', 'cave_vines_plant']) { const r = mv.bot.registry.blocksByName[n]; if (r) mv.climbables.add(r.id); }
  const base = mv.getNeighbors.bind(mv);
  const Block = require('prismarine-block')(mv.bot.registry);
  const cache = new Map();   // коробки блока по координатам; сбрасывается раз в 3 с и при изменении блока
  let cacheAt = 0, ox = 0, oz = 0;   // числовой ключ кэша - от точки отсчёта (строки в 5 раз медленнее)
  // чанк не загружен - блок из кэша проходимости (passcache.js, как у Baritone): путь через то, что видела раньше
  const fakes = {};
  const fake = (name, x, y, z) => { const f = Object.create(fakes[name] || (fakes[name] = Block.fromStateId(mv.bot.registry.blocksByName[name].defaultState, 0))); f.position = new Vec3(x, y, z); return f; };
  const blk = (x, y, z) => {
    const real = mv.bot.blockAt(new Vec3(x, y, z), false);
    if (real || !mv.passCache) return real;
    const c = mv.passCache.get(mv.passDim ? mv.passDim() : 'overworld', x, y, z);
    return c === undefined ? null : fake(['air', 'water', 'stone', 'lava'][c], x, y, z);
  };

  // Калитка, дверь, люк, за которыми заперты жители или скот (загон, палатка торговца, ячейка трейдхолла): открывать
  // в последнюю очередь - путь в обход дешевле на 40 шагов (23.11, владелец: «приоритет не заходить и не открывать,
  // если они заперты и выйти не могут, а открытие поможет им выйти; не помогает - пусть ходит»). Заперты ли - заливка
  // по клеткам от каждого существа рядом при закрытой калитке: упёрлась в 250 клеток - вольер не замкнут, неважно.
  const PENNED = /^(villager|wandering_trader|cow|sheep|pig|chicken|horse|donkey|mule|goat|rabbit|llama|trader_llama|mooshroom|camel|turtle|armadillo|sniffer|fox|cat|parrot|axolotl|frog|iron_golem)$/;
  const penCache = new Map();
  const solidAt = (x, y, z) => { const k = blk(x, y, z); return k ? k.boundingBox === 'block' : false; };
  const UNJUMP = /fence|wall|_gate|_bars|glass_pane|_door|trapdoor/;
  function confined(gx, gy, gz) {
    const mobs = Object.values(mv.bot.entities).filter((e) => e.position && PENNED.test(e.name || '') && Math.abs(e.position.y - gy) < 3 && Math.hypot(e.position.x - gx - 0.5, e.position.z - gz - 0.5) < 9).slice(0, 6);
    if (!mobs.length) return false;
    for (const e of mobs) {
      const y = Math.floor(e.position.y + 0.01), sx = Math.floor(e.position.x), sz = Math.floor(e.position.z);
      // клетка проходима для существа: на уровне ног пусто, либо блок высотой 1, через который прыгают (не забор)
      const pass = (x, z) => {
        if (x === gx && z === gz) return false;   // калитка закрыта
        const f = blk(x, y, z); if (!f) return true;   // не загружено - считать открытым (не запертым)
        if (f.boundingBox !== 'block') return !solidAt(x, y + 1, z);
        return !UNJUMP.test(f.name) && !solidAt(x, y + 1, z) && !solidAt(x, y + 2, z);
      };
      const seen = new Set([sx + ',' + sz]), q = [[sx, sz]];
      let touches = false, open = false;
      while (q.length) {
        const [x, z] = q.shift();
        if (Math.abs(x - gx) + Math.abs(z - gz) === 1) touches = true;
        if (seen.size > 250) { open = true; break; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (x + dx) + ',' + (z + dz);
          if (seen.has(k) || !pass(x + dx, z + dz)) continue;
          seen.add(k); q.push([x + dx, z + dz]);
        }
      }
      if (!open && touches) return true;
    }
    return false;
  }
  function penPenalty(list) {
    let p = 0;
    for (const g of list || []) {
      if (!g.want) continue;   // закрыть - не мешает
      const k = g.x + ',' + g.y + ',' + g.z, c = penCache.get(k);
      if (c && Date.now() - c.at < (c.v ? 20000 : 3000)) { p = Math.max(p, c.v); continue; }   // «никого» - ненадолго: существа подгружаются позже блоков
      let v = 0; try { v = confined(g.x, g.y, g.z) ? 40 : 0; } catch {}
      penCache.set(k, { at: Date.now(), v }); p = Math.max(p, v);
    }
    return p;
  }
  mv._penPenalty = penPenalty;

  // мебель и крыша (см. цену шага)
  const FURN = /_stairs$|_slab$|_trapdoor$|_fence$|_wall$|^(barrel|chest|trapped_chest|ender_chest|crafting_table|smithing_table|fletching_table|cartography_table|loom|stonecutter|grindstone|anvil|chipped_anvil|damaged_anvil|lectern|composter|cauldron|water_cauldron|lava_cauldron|brewing_stand|enchanting_table|furnace|blast_furnace|smoker|bookshelf|chiseled_bookshelf|decorated_pot|flower_pot|.*_bed|.*_shulker_box|shulker_box|jukebox|note_block|beehive|bell|.*_banner|scaffolding)$/;
  function roofedAt(x, y, z) { for (let dy = 2; dy <= 12; dy++) { const k = blk(x, y + dy, z); if (k && k.boundingBox === 'block') return true; } return false; }
  // пролёт лестницы: рядом ступень или полублок на уровень выше или ниже (стулья и диваны стоят на одном уровне с полом)
  function flight(x, sy, z, name) {
    if (!/_stairs$|_slab$/.test(name)) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [1, -1]) {
      const k = blk(x + dx, sy + dy, z + dz);
      if (k && /_stairs$|_slab$/.test(k.name)) return true;
      if (dy === 1 && k && k.boundingBox === 'block' && !FURN.test(k.name)) { const a1 = blk(x + dx, sy + 2, z + dz); if (a1 && a1.boundingBox === 'empty') return true; }   // ступень к полу второго этажа
    }
    return false;
  }

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
  /** Клетка - вода (или в воде: водоросли, пузыри, затопленное без коробки). */
  function waterAt(x, y, z) {
    const b = blk(x, y, z);
    if (!b) return false;
    if (/^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(b.name)) return true;
    try { return b.boundingBox === 'empty' && b.getProperties && b.getProperties().waterlogged === true; } catch { return false; }
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
          // опасное (вода, лава, огонь...) - только там, где тело реально стоит: на грядке ноги на 64,94, и клетка
          // яруса грядок с поливочной водой рядом не «тело в воде» (22.11: на поле все шаги отбрасывались)
          if (c.bad && y + 1 - fy > 0.2) bad = true;
          for (const q of (flip && flip.has(c.k) ? flipped(c) : c.boxes))
            if (q.x0 < px + HALF - EPS && q.x1 > px - HALF + EPS && q.z0 < pz + HALF - EPS && q.z1 > pz - HALF + EPS && q.y0 < fy + H - EPS && q.y1 > fy + EPS) { hit.push(c); break; }
        }
    return { hit, bad };
  }
  /** Верхушки коробок под телом в точке (px, pz) от bottom до top, по убыванию: на что можно встать.
   *  В столбике ниже первой верхушки не выше stop (на неё встают шагом) не смотрим: ниже неё не встать. */
  function tops(px, pz, top, bottom, flip, stop = top) {
    const r = [];
    // ширина опоры под телом по каждой верхушке (для прыжка: на ребро люка или двери 0,19 не запрыгнуть)
    tops.wide = new Map();
    const x0 = Math.floor(px - HALF + EPS), x1 = Math.floor(px + HALF - EPS), z0 = Math.floor(pz - HALF + EPS), z1 = Math.floor(pz + HALF - EPS);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        col: for (let y = Math.floor(top); y >= Math.floor(bottom) - 1; y--) {
          const c = cell(x, y, z), bx = flip && flip.has(c.k) ? flipped(c) : c.boxes;
          let low = false;
          for (const q of bx)
            if (q.y1 <= top + EPS && q.y1 >= bottom - EPS && q.x0 < px + HALF - EPS && q.x1 > px - HALF + EPS && q.z0 < pz + HALF - EPS && q.z1 > pz - HALF + EPS) {
              if (!r.some((v) => Math.abs(v - q.y1) < EPS)) r.push(q.y1);
              const ox = q.x1 - q.x0, oz = q.z1 - q.z0;   // размер самой опоры (ребро люка, двери - 0,19)
              const kk = Math.round(q.y1 * 1e4), w0 = tops.wide.get(kk) || [0, 0];
              tops.wide.set(kk, [Math.max(w0[0], ox), Math.max(w0[1], oz)]);
              if (q.y1 <= stop + EPS) low = true;
            }
          if (low) break col;
        }
    return r.length > 1 ? r.sort((a, b) => b - a) : r;
  }
  /** Высота ног, стоящих в точке (px, pz) не выше top: самая высокая опора. */
  const support = (px, pz, top, bottom, flip) => { const t = tops(px, pz, top, bottom, flip); return t.length ? t[0] : null; };

  /** Пол под ногами не даёт прыгнуть: мёд. */
  const noJumpFloor = (px, feet, pz) => { const k = mv.bot.blockAt(new Vec3(Math.floor(px), Math.floor(feet - 0.01), Math.floor(pz)), false); return !!(k && k.name === 'honey_block'); };
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
        // с медового блока толком не прыгнуть (прыжок вдвое ниже) - только шаг (22.11: стояла на мёде и прыгала на блок вверх
        // без конца - «застряла в пекарне»)
        if (noJumpFloor(px, feet, pz)) continue;
        // прыгать - только на опору шириной от 0,25 в обе стороны (не на ребро открытого люка или двери 0,19:
        // физика так не прыгает - 22.11 случайные миры)
        const wd = tops.wide.get(Math.round(t * 1e4)) || [0, 0];
        if (wd[0] < 0.25 || wd[1] < 0.25) continue;
        if (!body(px, t, pz, flip).hit.length && !body(nx, t, nz, flip).hit.length) { s = t; jump = true; break; }
      }
      if (s === null) return null;                          // пропасть глубже допустимого
      if (jump) jumped = true;
      // шаг вверх (без прыжка) - как физика бота (prismarine-physics): тело сначала поднимается на высоту шага,
      // насколько пускает потолок над ним, потом идёт вперёд. Впереди потолок ниже - упирается головой, хотя
      // по высоте помещается (22.11 случайные миры: коврик или люк в полу под низким потолком соседней клетки)
      if (!jump && s > feet + EPS) {
        let up = 0;
        for (const d of [STEP, 0.5, 0.4, 0.3, 0.2, 0.1, s - feet]) if (d >= s - feet - EPS && !body(px, feet + d, pz, flip).hit.length) { up = d; break; }
        if (!up || body(nx, feet + up, nz, flip).hit.length) { add({ hit: body(nx, feet + up || s, nz, flip).hit, bad: false }); if (!hit.size) return null; }
      }
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
      // промежуток с полом на блок ниже, а за ним выше или вровень (с листвы на бревно через щель, 22.11): игрок прыгает
      // сразу, а шаг вниз и потом вверх на 2 - невозможно; такой прыжок - только на 2 клетки и не ниже исходной высоты
      const shallow = s1 !== null && s1 < fy - 0.9;
      if (s1 !== null && !shallow) continue;
      for (let k = 2; k <= (shallow ? 2 : 4); k++) {
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
        if (shallow && f < fy - 0.1) continue;
        const ny = Math.floor(f + EPS);
        // на месте приземления стоит игрок или моб - не прыгать в него (22.11: прыгал туда, где стоял хозяин)
        try { if (mv.getNumEntitiesAt && mv.getNumEntitiesAt(new Vec3(nx, ny, nz), 0, 0, 0) > 0) continue; } catch {}
        const key = `${node.x},${node.y},${node.z}>${nx},${ny},${nz}`;
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

  // сбой своей навигации - не роняет поиск пути: ходы модуля пути по-старому, сбой считается (health.js)
  // Плавание под водой (22.11: «только над водой плавает, а под водой не может»): модуль пути под воду не ходит совсем
  // («dont go underwater»). Здесь ходы сквозь толщу воды во все стороны и вверх-вниз; ведёт их swim.js (рывком, в позе
  // плавания), воздух кончается - всплывает. Глубже поверхности - дороже, чтобы без нужды не нырял.
  function swimMoves(node, have) {
    const out = [];
    if (mv.navSwim === false || !waterAt(node.x, node.y, node.z)) return out;
    let surfY = node.y + 24; for (let y = node.y + 1; y < node.y + 24; y++) if (!waterAt(node.x, y, node.z)) { surfY = y; break; }
    // над клеткой потолок (днище корабля, лёд, свод пещеры) - всплыть некуда: такие клетки дорогие, чтобы путь шёл под
    // потолком только коротко (22.11: поплыл под днищем корабля и утонул)
    const ceiled = (x, y, z) => { for (let yy = y + 1; yy < y + 24; yy++) { if (waterAt(x, yy, z)) continue; return cell(x, yy, z).boxes.length > 0; } return true; };
    // из воды - на лиану или лестницу (корабль, стена, колодец): дальше по ним вверх ведёт обычный модуль пути
    { const up = cell(node.x, node.y + 1, node.z); const ub = up.b || blk(node.x, node.y + 1, node.z);
      void ub;
      // из воды на берег или уступ на блок выше (модуль пути из воды не выпрыгивает - «cant jump from water»): так
      // путь из моря шёл только «к ближайшей точке» и обрывался у борта (22.11, журнал движения: путь до днища и стоп)
      if (!waterAt(node.x, node.y + 1, node.z)) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const up of [0, 1]) {
        const x = node.x + ax, z = node.z + az, y = node.y + up, k = `${x},${y},${z}`;
        if (have.has(k) || waterAt(x, y, z)) continue;
        const under = cell(x, y - 1, z), at = cell(x, y, z), head = cell(x, y + 1, z);
        if (!under.boxes.length || under.bad || at.boxes.length || head.boxes.length || at.bad) continue;
        if (up && cell(node.x, node.y + 2, node.z).boxes.length) continue;   // над головой низко - не выпрыгнуть
        have.add(k); out.push(new Move(x, y, z, node.remainingBlocks, 2 + up, [], [])); break;
      }
      const CL = /^(vine|ladder|weeping_vines|twisting_vines|cave_vines|cave_vines_plant|weeping_vines_plant|twisting_vines_plant)$/;
      for (const [ax, az] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) for (const up of [1, 2]) {
        const x = node.x + ax, z = node.z + az, y = node.y + up, k = `${x},${y},${z}`;
        const v = blk(x, y, z);
        if (!v || !CL.test(v.name) || have.has(k)) continue;
        if (up === 2 && cell(x, y - 1, z).boxes.length && !waterAt(x, y - 1, z)) continue;   // между водой и лианой - твёрдое
        if ((ax || az) && cell(x, node.y + 1, z).boxes.length && !CL.test((blk(x, node.y + 1, z) || {}).name || '')) continue;
        have.add(k); const m = new Move(x, y, z, node.remainingBlocks, 1.5 + up * 0.5, [], []); m.swim = true; out.push(m); break;
      } }
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]) {
      const nx = node.x + dx, ny = node.y + dy, nz = node.z + dz, k = `${nx},${ny},${nz}`;
      if (have.has(k) || !waterAt(nx, ny, nz)) continue;
      const head = cell(nx, ny + 1, nz);
      if (head.boxes.length && !waterAt(nx, ny + 1, nz)) continue;   // над головой твёрдое - тело не пройдёт
      if (dx && dz && (cell(node.x + dx, ny, node.z).boxes.length || cell(node.x, ny, node.z + dz).boxes.length)) continue;   // угол не срезать
      const deep = Math.max(0, surfY - ny - 1);
      have.add(k);
      const m = new Move(nx, ny, nz, node.remainingBlocks, (dx && dz ? 1.5 : 1.1) + (dy ? 0.3 : 0) + Math.min(3, deep * 0.15) + (ceiled(nx, ny, nz) ? 6 : 0), [], []);
      m.swim = true;
      out.push(m);
    }
    return out;
  }
  mv.getNeighbors = function (node) {
    let r;
    try { r = navNeighbors(node); } catch (e) { if (bot && bot._tb && bot._tb.fault) bot._tb.fault('nav', e); r = base(node); }
    try {
      const have = new Set(r.map((m) => `${m.x},${m.y},${m.z}`)), extra = swimMoves(node, have);
      // под лианой или лестницей (начинается на уровне головы) - прыжок вверх в неё: лезть можно, только когда
      // ноги в лиане (так в игре), а модуль пути без этого считал, что вверх нельзя
      const CLB = /^(vine|ladder|weeping_vines|twisting_vines|cave_vines|cave_vines_plant|weeping_vines_plant|twisting_vines_plant)$/;
      const up = blk(node.x, node.y + 1, node.z), feet = blk(node.x, node.y, node.z);
      if (up && CLB.test(up.name) && !(feet && CLB.test(feet.name)) && !have.has(`${node.x},${node.y + 1},${node.z}`) && !cell(node.x, node.y + 2, node.z).boxes.length) extra.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks, 2, [], []));
      return r.concat(extra);
    } catch { return r; }
  };
  const navNeighbors = function (node) {
    if (Date.now() - cacheAt > 3000) { cache.clear(); cacheAt = Date.now(); ox = node.x; oz = node.z; cache.ox = ox; cache.oz = oz; }
    const out = [];
    // ходы модуля пути: с ломанием или стройкой, вертикальные (лестницы, лианы, столбы) и в воде - оставить
    for (const m of base(node)) {
      const vertical = m.x === node.x && m.z === node.z;
      const water = cell(m.x, m.y, m.z).bad || cell(node.x, node.y, node.z).bad || cell(m.x, m.y - 1, m.z).bad;
      const gate = m.toPlace.length && m.toPlace.every((p) => p.useOne);
      // вниз по лестнице сквозь закрытый люк модуль пути не умеет (не откроет) - этот ход делает hatches()
      if (vertical && m.y < node.y && [cell(node.x, node.y, node.z), cell(node.x, node.y - 1, node.z)].some((c) => isHatch(c) && !(c.b.getProperties().open === true || c.b.getProperties().open === 'true'))) continue;
      if (m.toBreak.length || (m.toPlace.length && !gate) || vertical || water) out.push(m);
    }
    // где на самом деле ноги: на кровати, люке, плите - не целая клетка
    const cx = node.x + 0.5, cz = node.z + 0.5;
    // стоит в проёме двери или люка - значит, их уже открыли, чтобы сюда войти: считать открытыми
    const inDoor = new Set();
    const fy0 = support(cx, cz, node.y + 0.99, node.y - 1);
    // Страховка: своя навигация не видит опоры или ни одного шага - ходить по-старому (ходы модуля пути), а не стоять
    // (22.11 на поле: «путь пустой» десятки раз, бот стоял). Почему так - пишется в журнал (mv._nav.explain).
    // люк в полу или потолке (спуск и подъём по лестнице через люк) - модуль пути считает закрытый люк сплошным
    // полом и не находит пути вовсе (22.11: на втором этаже, «нет пути» к хозяину внизу за долю секунды)
    const hatchMoves = hatches(node);
    const fallback = (why) => { if (trapCheck) return hatchMoves; if (hatchMoves.length) return hatchMoves.concat(base(node)); mv._navFallback = { at: Date.now(), node: `${node.x},${node.y},${node.z}`, why }; return base(node); };   // проверка ловушки - только свои ходы (модуль пути не знает мёда); люк - свои ходы + его
    if (fy0 === null) return fallback('нет опоры под ногами');
    for (const c of body(cx, fy0, cz).hit) if (c.open) { inDoor.add(c.k); const p = pairKey(c); if (p) inDoor.add(p); }
    // этим шагом открыли дверь или люк - дальше считать их открытыми (22.11 случайные миры: открыла, вошла, а
    // следующий шаг считался по закрытой двери - открытая встала поперёк)
    for (const o of node.opens || []) { const c = cell(o.x, o.y, o.z); inDoor.add(c.k); const p = c.b && pairKey(c); if (p) inDoor.add(p); }
    const fy = inDoor.size ? support(cx, cz, node.y + 0.99, node.y - 1, inDoor) : fy0;
    const open0 = inDoor.size ? inDoor : null;
    if (fy === null) return fallback('нет опоры (в проёме)');
    const seen = new Set();
    const n0 = out.length;
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
      // барная стойка, проход с люком: прошла бы прыжком или подъёмом через закрытый люк или калитку - открыть и
      // пройти по полу, как человек (22.11: «можно через люк, а не перепрыгивать тупо»)
      if (w && !w.opened && !(dx && dz) && (w.jumped || w.feet - fy > 0.3)) {
        const gates = [];
        for (const yy of [Math.floor(fy + EPS), Math.floor(fy + EPS) + 1]) { const c = cell(nx, yy, nz); if (c.open && c.b && !(inDoor.has(c.k))) gates.push(c); }
        if (gates.length) {
          const flip = new Set([...inDoor, ...gates.map((c) => c.k)]);
          for (const c of gates) { const pk = pairKey(c); if (pk) flip.add(pk); }
          const w2 = walk(cx, fy, cz, nx + 0.5, nz + 0.5, flip);
          if (w2 && !w2.hit.length && !w2.jumped && Math.abs(w2.feet - fy) <= STEP) {
            const done = new Set(); toPlace = [];
            for (const c of gates) { const pk = pairKey(c); if (pk && done.has(pk)) continue; done.add(c.k); const pr = c.b.getProperties(); toPlace.push({ x: c.at[0], y: c.at[1], z: c.at[2], want: !(pr.open === true || pr.open === 'true') }); }
            w = { ...w2, opened: true, gentle: true };
          }
        }
      }
      if (!w) continue;
      // по диагонали (как Baritone): обе соседние клетки свободны на высоте тела и без прыжка - иначе тело
      // шириной 0,6 цепляет угол ступеньки, забора, блока (22.11 случайные миры: путь был, а физика не проходит)
      if (dx && dz) {
        if (w.jumped || Math.abs(w.feet - fy) > STEP) continue;
        const lo = Math.min(fy, w.feet), clear = (x, z) => !body(x + 0.5, lo, z + 0.5, open0).hit.length && !body(x + 0.5, Math.max(fy, w.feet), z + 0.5, open0).hit.length;
        if (!clear(node.x + dx, node.z) || !clear(node.x, node.z + dz)) continue;
      }
      const ny = Math.floor(w.feet + EPS), rise = w.feet - fy;
      // под ногами в конце шага: грядку вытаптывает прыжок и падение на неё - такие шаги нельзя; ходить по ней - дорого
      const under = cell(nx, Math.floor(w.feet - 0.01), nz).b, uname = under ? under.name : '';
      if (uname === 'farmland' && (w.jumped || rise < -0.25)) continue;
      let cost = (dx && dz ? Math.SQRT2 : 1) + (w.jumped ? 1 : rise > EPS ? 0.3 : 0) + (rise < -1 ? -rise * 0.5 : 0) + (w.opened ? (w.gentle ? 0.5 : 2) + penPenalty(toPlace) : 0);
      // ловушка: спуск туда, откуда не выбраться (яма, загон, медовая яма) - только если цель там же (очень дорого)
      if (rise < -0.7 && !trapCheck && !escapable(nx, ny, nz, fy)) cost += 60;
      if (uname === 'farmland') cost += 3;
      // В помещении ходить по полу и не лезть на мебель (23.11, владелец: встаёт на стул у стола, на барную стойку в
      // пекарне). Мебель в Minecraft - ступеньки и полублоки (стулья, диваны, ступени-кресла), люки (тумбы, стены
      // шкафов), заборы с плитой (столы), бочки, сундуки, верстаки, наковальни, кафедры и любые блоки, на которые надо
      // подняться с пола. Шаг на неё под крышей - дорого; настоящая лестница на второй этаж - пролёт ступенек вверх -
      // обычной ценой (это не мебель).
      // на сундук, бочку, кровать, верстак, печь вставать незачем нигде - не пол (23.11: вставал на сундуки на втором этаже)
      if (!trapCheck && /chest|barrel|_bed$|crafting_table|furnace|smoker|anvil|lectern|composter|cauldron|brewing_stand|enchanting_table|shulker_box|bookshelf|loom|stonecutter|grindstone|smithing_table|cartography_table|fletching_table|beehive|decorated_pot/.test(uname)) cost += 6;
      if (!trapCheck && roofedAt(nx, ny, nz)) {
        const furn = FURN.test(uname) || (rise > 0.3 && !/_stairs$|_slab$|ladder|scaffolding/.test(uname));
        if (furn && !flight(nx, Math.floor(w.feet - 0.01), nz, uname)) cost += rise > 0.3 ? 8 : 5;
      }
      // цена клетки от тела (дороги дешевле, газоны у чужих домов дороже) - bot.js задаёт mv.navStepCost
      // ошибка в цене клетки не должна ломать поиск пути (22.11: падение -> «путь пустой» десятки раз, бот дёргался)
      if (mv.navStepCost) { try { cost *= mv.navStepCost(nx, ny, nz, uname) || 1; } catch (e) { if (!mv._costErr) { mv._costErr = 1; console.error('nav: цена клетки', e.message); } } }
      const dest = blk(nx, ny, nz);
      // нажимная плита и растяжка - спусковой крючок ловушек и механизмов: обходить, если можно
      if (dest && /pressure_plate|^tripwire$/.test(dest.name)) cost += 8;
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

    for (const m of hatchMoves) if (!seen.has(`${m.x},${m.y},${m.z}`)) { seen.add(`${m.x},${m.y},${m.z}`); out.push(m); }
    if (out.length === n0) return fallback('ни одного шага');
    return out;
  };
  const CLIMB = /^(ladder|vine|scaffolding|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/;
  const isHatch = (c) => c && c.b && /_trapdoor$/.test(c.b.name) && !/^iron_/.test(c.b.name);
  const passable = (c, flip) => c && !c.bad && (!c.b || c.b.boundingBox === 'empty' || CLIMB.test(c.b.name) || flip);
  /**
   * Ходы через люк: вниз - стоит на люке (или над открытым), под ним лестница или пустота до пола (с лестницей до 24 бл.,
   * без - до 3); вверх - в столбе лестницы над головой люк, над ним пол рядом: выйти на соседнюю клетку.
   * Ход помнит люк в opens (want: открыт) - тело открывает его само (physicsTick ниже).
   */
  function hatches(node) {
    const out = [], x = node.x, z = node.z, y = node.y;
    // вниз: люк в клетке пола под ногами (или нижний люк в своей же клетке - стоит на нём)
    const own = cell(x, y, z), ownHatch = isHatch(own) && own.b.getProperties().half === 'bottom';
    const ty = ownHatch ? y : y - 1, t = ownHatch ? own : cell(x, y - 1, z);
    if (isHatch(t)) {
      let ladder = false, yy = ty - 1, land = null;
      for (let i = 0; i < 26; i++, yy--) {
        const c = cell(x, yy, z);
        if (c.b && CLIMB.test(c.b.name)) { ladder = true; continue; }
        if (passable(c)) continue;
        if (c.bad) break;
        if (c.b && c.b.boundingBox === 'block') { land = yy + 1; break; }
        break;
      }
      if (land !== null && (ladder || y - land <= 3) && passable(cell(x, land, z)) && passable(cell(x, land + 1, z))) {
        const m = new Move(x, land, z, node.remainingBlocks, 2 + (y - land) * 0.3, [], []);
        m.opens = [{ x, y: ty, z, want: true }]; m.feet = land; m.cell = [x, z]; m.hatch = 'down';
        out.push(m);
      }
    }
    // вверх: в лестнице (или под ней), над головой через 1-6 клеток люк; над люком свободно и рядом пол
    const here = cell(x, y, z), up1 = cell(x, y + 1, z);
    if ((here.b && CLIMB.test(here.b.name)) || (up1.b && CLIMB.test(up1.b.name))) {
      for (let h = 1; h <= 24; h++) {
        const c = cell(x, y + h, z);
        if (isHatch(c)) {
          const yt = y + h;
          if (!passable(cell(x, yt + 1, z)) || !passable(cell(x, yt + 2, z))) break;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const fl = cell(x + dx, yt, z + dz);
            if (!fl.b || fl.b.boundingBox !== 'block' || isHatch(fl)) continue;
            if (!passable(cell(x + dx, yt + 1, z + dz)) || !passable(cell(x + dx, yt + 2, z + dz))) continue;
            const m = new Move(x + dx, yt + 1, z + dz, node.remainingBlocks, 2 + h * 0.4, [], []);
            m.opens = [{ x, y: yt, z, want: true }]; m.feet = yt + 1; m.cell = [x + dx, z + dz]; m.hatch = 'up';
            out.push(m);
          }
          break;
        }
        if (!(c.b && CLIMB.test(c.b.name)) && !passable(c)) break;
      }
    }
    return out;
  }
  /**
   * Выберусь ли из клетки (x, y, z), если спущусь туда с высоты fromY: поиск в ширину по своим же шагам (с открыванием
   * дверей и калиток, с копанием природного - как модуль пути) до 70 клеток. Да - если дошла до высоты fromY или ушла
   * на 6+ блоков вбок. Нет - это ловушка: яма глубже прыжка, загон без калитки, медовая яма, огороженный пятачок
   * (22.11: «куда прыгнет и не вылезет»). Кэш на 3 с, как у клеток.
   */
  let trapCheck = false;
  const trapCache = new Map();
  function escapable(x, y, z, fromY) {
    const key = `${x},${y},${z},${Math.floor(fromY)}`;
    if (Date.now() - (trapCache.at || 0) > 3000) { trapCache.clear(); trapCache.at = Date.now(); }
    if (trapCache.has(key)) return trapCache.get(key);
    trapCheck = true;
    let ok = false;
    try {
      const q = [{ x, y, z, remainingBlocks: 0 }], seen = new Set([`${x},${y},${z}`]);
      for (let i = 0; i < q.length && i < 70 && !ok; i++) {
        let nb = [];
        try { nb = navNeighbors(q[i]); } catch { nb = []; }
        for (const m of nb) {
          if (m.y >= Math.floor(fromY + EPS) || Math.hypot(m.x - x, m.z - z) >= 6) { ok = true; break; }
          const k = `${m.x},${m.y},${m.z}`;
          if (!seen.has(k)) { seen.add(k); q.push({ x: m.x, y: m.y, z: m.z, remainingBlocks: 0, opens: m.opens }); }
        }
      }
    } finally { trapCheck = false; }
    trapCache.set(key, ok);
    return ok;
  }
  /** Почему из клетки нет шагов: опора, и по каждой стороне - что мешает. Для журнала (разбор игры). */
  function explain(x, y, z) {
    const cx = x + 0.5, cz = z + 0.5, parts = [];
    const names = (yy) => [-1, 0, 1].map((d) => { const c = cell(x, yy + d, z); return `${yy + d}:${c.b ? c.b.name : '?'}`; }).join(' ');
    const fy = support(cx, cz, y + 0.99, y - 1);
    parts.push(`клетка ${x} ${y} ${z} [${names(y)}], ноги ${fy === null ? 'нет опоры' : fy.toFixed(2)}`);
    if (fy === null) return parts.join('; ');
    for (const [dx, dz] of DIRS.slice(0, 4)) {
      const w = walk(cx, fy, cz, x + dx + 0.5, z + dz + 0.5);
      const c0 = cell(x + dx, Math.floor(fy), z + dz).b, c1 = cell(x + dx, Math.floor(fy) - 1, z + dz).b;
      parts.push(`${dx},${dz}: ${!w ? 'нет опоры или опасно' : w.hit.length ? 'мешает ' + w.hit.map((c) => c.b.name).join('+') : 'можно (ноги ' + w.feet.toFixed(2) + ')'} [${c0 ? c0.name : '?'} над ${c1 ? c1.name : '?'}]`);
    }
    return parts.join('; ');
  }
  mv._nav = { support, body, walk, cell, leapControl, explain, escapable };
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
    const safe = (name, fn) => () => { try { fn(); } catch (e) { if (bot._tb && bot._tb.fault) bot._tb.fault(name, e); } };
    bot.on('physicsTick', safe('nav-прыжок', () => {
      const path = bot._navPath, m = path && path[0];
      if (!m || !m.leap || !bot.entity || !bot.pathfinder.isMoving()) return;
      const [sx, sz] = m.leap.from, { dx, dz } = m.leap, p = bot.entity.position;
      const prog = (p.x - sx) * dx + (p.z - sz) * dz;
      if (prog < -0.6 || Math.abs((p.x - sx) * dz) + Math.abs((p.z - sz) * dx) > 0.6) return;   // ещё не в клетке разбега
      bot.look(Math.atan2(-dx, -dz), 0, true);
      const c = leapControl(p, bot.entity.onGround, m.leap, m.cell[0] + 0.5, m.cell[1] + 0.5);
      for (const k of ['forward', 'back', 'sprint', 'jump']) bot.setControlState(k, c[k]);
    }));
    // двери, калитки, люки на ближайших шагах: открыть (закрыть), только если сейчас не в нужном положении
    const tog = new Map(), opened = new Map();
    // прошла дверь - вернуть, как было (закрыть за собой), когда отошла на 2+ бл. и она больше не на пути
    bot.on('physicsTick', safe('nav-двери-закрыть', () => {
      if (!opened.size || !bot.entity) return;
      const me = bot.entity.position, ahead = new Set();
      for (const m of (bot._navPath || []).slice(0, 3)) for (const o of m.opens || []) ahead.add(`${o.x},${o.y},${o.z}`);
      for (const [k, d] of opened) {
        if (ahead.has(k)) continue;
        const dist = Math.hypot(d.x + 0.5 - me.x, d.z + 0.5 - me.z);
        if (dist > 12) { opened.delete(k); continue; }   // ушла далеко - не возвращаться
        // ещё в проёме (тело задевает клетку двери) - рано; прошёл - закрыть сразу, даже стоя рядом (23.11 стенд: встал в
        // палатке в 1,5 бл. от калитки и не закрыл - правило было «отойти на 2 бл.»)
        const inCell = Math.abs(me.x - d.x - 0.5) < 0.85 && Math.abs(me.z - d.z - 0.5) < 0.85 && me.y < d.y + 1 && me.y + 1.8 > d.y;
        if (dist > 5) continue;   // сервер даёт щёлкнуть до ~5,5 бл. от глаз до блока - 5 по горизонтали с запасом
        if (inCell) {
          // встал в самом проёме (дошёл за хозяином и остановился) - дверь не закрыть, житель или скот выйдут мимо (стенд
          // 23.11). Как игрок: шаг дальше, в ту сторону, куда шёл, потом закрыть
          const bl = bot.blockAt(new Vec3(d.x, d.y, d.z));
          if (d.from && !d.stepped && bl && !/trapdoor/.test(bl.name) && !bot.pathfinder.isMoving() && !bot.vehicle) {
            d.idle = d.idle || Date.now();
            if (Date.now() - d.idle > 600) {
              let ux = d.x + 0.5 - d.from.x, uz = d.z + 0.5 - d.from.z;
              if (Math.abs(ux) > Math.abs(uz)) { ux = Math.sign(ux); uz = 0; } else { uz = Math.sign(uz); ux = 0; }
              const tx = d.x + ux, tz = d.z + uz, f1 = bot.blockAt(new Vec3(tx, d.y, tz)), f2 = bot.blockAt(new Vec3(tx, d.y + 1, tz));
              d.stepped = true;
              if (f1 && f2 && f1.boundingBox === 'empty' && f2.boundingBox === 'empty') {
                bot.lookAt(new Vec3(tx + 0.5, me.y + 1.6, tz + 0.5), true).catch(() => {});
                bot.setControlState('forward', true);
                setTimeout(() => { try { bot.setControlState('forward', false); } catch {} }, 400);
              }
            }
          } else if (bot.pathfinder.isMoving()) d.idle = 0;
          continue;
        }
        // в проёме кто-то: игрок (хозяин идёт следом) - ждать до 10 с; житель или скот - не больше 1,5 с, потом закрыть:
        // они стоят у калитки как раз чтобы выйти (23.11 стенд: житель встал в проёме, калитка так и осталась открытой)
        const inWay = Object.values(bot.entities).find((e) => e !== bot.entity && e.position && e.name !== 'item' && e.name !== 'experience_orb' && Math.abs(e.position.x - d.x - 0.5) < 0.9 && Math.abs(e.position.z - d.z - 0.5) < 0.9 && Math.abs(e.position.y - d.y) < 2);
        if (inWay) { d.wait = d.wait || Date.now(); if (Date.now() - d.wait < (inWay.type === 'player' ? 10000 : 1500)) continue; } else d.wait = 0;
        const b = bot.blockAt(new Vec3(d.x, d.y, d.z));
        if (!b || !OPENABLE.test(b.name)) { opened.delete(k); continue; }
        const pr = b.getProperties(), now = pr.open === true || pr.open === 'true';
        if (now === d.was) { opened.delete(k); continue; }   // уже как было - готово
        // щелчок не всегда доходит (взгляд не успел, сервер отверг) - проверить через 0,8 с и повторить, до 3 раз
        if (d.clickAt && Date.now() - d.clickAt < 800) continue;
        if ((d.tries = (d.tries || 0) + 1) > 3) { opened.delete(k); continue; }
        d.clickAt = Date.now(); tog.set(k, Date.now());
        bot._navToggle = true;
        bot.lookAt(new Vec3(d.x + 0.5, d.y + 0.5, d.z + 0.5), true).then(() => { bot._navToggle = true; return bot.activateBlock(b); }).catch(() => {});
      }
    }));
    bot.on('physicsTick', safe('nav-двери', () => {
      const path = bot._navPath, me = bot.entity && bot.entity.position;
      if (!path || !me) return;
      for (const m of path.slice(0, 2)) for (const o of m.opens || []) {
        if (Math.hypot(o.x + 0.5 - me.x, o.z + 0.5 - me.z) > 3) continue;
        const k = `${o.x},${o.y},${o.z}`, b = bot.blockAt(new Vec3(o.x, o.y, o.z));
        if (!b || !OPENABLE.test(b.name)) continue;
        const pr = b.getProperties(), open = pr.open === true || pr.open === 'true';
        // уже открытая дверь или калитка на пути (открыл хозяин, 23.11 «двери не закрывает») - закрыть за собой
        if (open && o.want && !opened.has(k) && /_door$|_fence_gate$/.test(b.name)) opened.set(k, { x: o.x, y: o.y, z: o.z, was: false, from: me.clone() });
        if (open === o.want || Date.now() - (tog.get(k) || 0) < 1500) continue;
        tog.set(k, Date.now());
        if (!opened.has(k)) opened.set(k, { x: o.x, y: o.y, z: o.z, was: open, from: me.clone() });   // какой была до бота - закрыть потом
        bot._navToggle = true; bot.activateBlock(b).catch(() => {});   // эти закрывает путь сам (выше), не chores
      }
    }));
  }
}

module.exports = { install };
