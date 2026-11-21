// Сценарии ходьбы без сервера: модель мира + поиск пути по настоящей форме блоков (app/nav.js).
// Судья - физика самой игры (prismarine-physics, ей же ходит бот): каждый найденный путь проигрывается шаг за шагом,
// и если тело физически не проходит, это ошибка навигации, даже когда путь «нашёлся». Так модель не может
// обмануть себя, как было с заплатками (лестница под низким потолком: путь был, а пройти нельзя).
// Каждая ошибка из игры - сценарий здесь. node test/house_test.js
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const registry = require(R + '/prismarine-registry')('1.21.4');
const Block = require(R + '/prismarine-block')(registry);
const { Vec3 } = require(R + '/vec3');
const { Movements, goals } = require(R + '/mineflayer-pathfinder');
const AStar = require(R + '/mineflayer-pathfinder/lib/astar');
const Move = require(R + '/mineflayer-pathfinder/lib/move');
const { Physics, PlayerState } = require(R + '/prismarine-physics');
const { install } = require(path.resolve(__dirname, '../app/nav.js'));

function world(build) {
  const w = new Map();
  const set = (x, y, z, name, props) => w.set(`${x},${y},${z}`, props ? Block.fromProperties(name, props, 0).stateId : registry.blocksByName[name].defaultState);
  for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'stone');   // пол
  build(set);
  const blockAt = (v) => { v = v.floored(); const st = w.get(`${v.x},${v.y},${v.z}`); const b = Block.fromStateId(st ?? registry.blocksByName.air.defaultState, 0); b.position = v; return b; };
  const toggle = (x, y, z) => {
    const b = blockAt(new Vec3(x, y, z)), open = !b.getProperties().open;
    const s = (X, Y, Z) => w.set(`${X},${Y},${Z}`, Block.fromProperties(b.name, { ...blockAt(new Vec3(X, Y, Z)).getProperties(), open }, 0).stateId);
    s(x, y, z);
    if (/_door$/.test(b.name)) s(x, y + (b.getProperties().half === 'lower' ? 1 : -1), z);
  };
  return { registry, version: '1.21.4', entities: {}, game: { minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 65, 0.5) }, inventory: { items: () => [] }, blockAt, toggle };
}
let lastCtl = null;
function find(bot, from, goal, stepCost) {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = [];
  install(mv, bot);
  if (stepCost) mv.navStepCost = stepCost;
  lastCtl = mv._nav.leapControl;
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), mv, goal, 5000, 20000, -1, 0);
  return a.compute();
}

// Физика игры: тело идёт к центру следующей клетки (как бот), сначала без прыжка, потом с прыжком.
function walkTo(bot, ent, to) {
  const world = { getBlock: (p) => bot.blockAt(new Vec3(p.x, p.y, p.z)) };
  const physics = Physics(registry, world);
  for (const jump of [false, true]) {
    const e = { position: ent.position.clone(), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0, effects: {}, attributes: {} };
    const p = { entity: e, version: '1.21.4', jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, game: {}, inventory: { slots: [] }, registry };
    for (let t = 0; t < 60; t++) {
      const dx = to.x + 0.5 - e.position.x, dz = to.z + 0.5 - e.position.z;
      if (Math.abs(dx) <= 0.2 && Math.abs(dz) <= 0.2 && e.onGround) {
        if (Math.floor(e.position.y + 1e-3) === to.y) { ent.position = e.position; return true; }
        break;
      }
      e.yaw = Math.atan2(-dx, -dz);
      const st = new PlayerState(p, { forward: true, back: false, left: false, right: false, jump, sprint: false, sneak: false });
      physics.simulatePlayer(st, world); st.apply(p);
    }
  }
  return false;
}
function leapTo(bot, ent, m, ctl) {
  const world = { getBlock: (p) => bot.blockAt(new Vec3(p.x, p.y, p.z)) };
  const physics = Physics(registry, world);
  const e = { position: ent.position.clone(), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: Math.atan2(-m.leap.dx, -m.leap.dz), pitch: 0, effects: {}, attributes: {} };
  const p = { entity: e, version: '1.21.4', jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, game: {}, inventory: { slots: [] }, registry };
  let air = false;
  for (let t = 0; t < 40; t++) {
    const st = new PlayerState(p, ctl(e.position, e.onGround, m.leap, m.x + 0.5, m.z + 0.5));
    physics.simulatePlayer(st, world); st.apply(p);
    if (!e.onGround && t > 2) air = true;
    if (air && e.onGround) { ent.position = e.position; return Math.floor(e.position.x) === m.x && Math.floor(e.position.z) === m.z && Math.floor(e.position.y + 1e-3) === m.y; }
  }
  return false;
}
function replay(bot, from, r, ctl) {
  const ent = { position: new Vec3(from[0] + 0.5, from[1], from[2] + 0.5) };
  const g = bot.blockAt(new Vec3(from[0], from[1], from[2]));   // старт на кровати, плите, люке - ноги выше клетки
  if (g.shapes && g.shapes.length) ent.position.y = from[1] + Math.max(...g.shapes.map((s) => s[4]));
  for (const m of r.path) {
    for (const p of m.opens || []) bot.toggle(p.x, p.y, p.z);
    if (m.leap ? !leapTo(bot, ent, m, ctl) : !walkTo(bot, ent, m)) return `физически не прошла к ${m.x},${m.y},${m.z} (стоит на ${ent.position.x.toFixed(2)},${ent.position.y.toFixed(2)},${ent.position.z.toFixed(2)})`;
  }
  return null;
}

const results = [];
function check(name, build, from, goal, wantPath, extra, stepCost) {
  const r = find(world(build), from, goal, stepCost);
  let ok = (r.status === 'success') === wantPath, note = '';
  if (r.status === 'success') {
    const bad = replay(world(build), from, r, lastCtl);
    if (bad) { ok = false; note = ' - ' + bad; }
    if (ok && extra) { const e = extra(r.path); if (e) { ok = false; note = ' - ' + e; } }
  }
  results.push(ok);
  console.log(`${ok ? 'да ' : 'НЕТ'} ${name}: ${r.status}${r.status === 'success' ? ' через ' + r.path.slice(0, 5).map((p) => `${p.x},${p.y},${p.z}${p.opens ? '(откр.)' : ''}${p.leap ? '(прыжок)' : ''}`).join(' ') : ''}${note}`);
}
const wall = (set, x, h = 3) => { for (let z = -6; z <= 6; z++) for (let y = 65; y < 65 + h; y++) set(x, y, z, 'stone'); };
const T = (half, open, facing = 'east') => ({ facing, half, open, powered: false, waterlogged: false });
const G = (x, y, z) => new goals.GoalBlock(x, y, z);
const avoidX = (x, z0, z1) => (p) => p.some((m) => m.x === x && m.z >= z0 && m.z <= z1) ? `прошла сквозь стену в ${x}` : null;
const FENCE = { east: false, west: false, north: true, south: true, waterlogged: false };
const DOOR = (name, half) => [name, { facing: 'east', half, hinge: 'left', open: false, powered: false }];

// --- из игры 15-21.11
// 1. Выход из дома - люк-дверь в проёме стены: внизу пусто, люк на уровне головы (21.11, дом у 333 -432)
check('люк-дверь в проёме - открыть и пройти', (set) => { wall(set, 3); set(3, 65, 0, 'air'); set(3, 66, 0, 'pale_oak_trapdoor', T('bottom', false, 'north')); }, [0, 65, 0], G(6, 65, 0), true);
// 2. Стена амбара из люков в два ряда (21.11, 315 65 -461) - стена, в проём не идти
check('стена из люков в проёме - не проход', (set) => { wall(set, 3); set(3, 65, 0, 'acacia_trapdoor', T('bottom', true)); set(3, 66, 0, 'acacia_trapdoor', T('bottom', true)); }, [0, 65, 0], G(6, 65, 0), false);
// 3. Закрытый люк в полу - по нему ходят
check('закрытый люк в полу - пол', (set) => { set(2, 64, 0, 'oak_trapdoor', T('top', false)); }, [0, 65, 0], G(4, 65, 0), true);
// 4. Лестница на второй этаж: проём над лестницей начинается за клетку до неё - подняться можно
const STAIRS = (open0) => (set) => {
  const E = { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false };
  set(1, 65, 0, 'oak_stairs', E); set(2, 65, 0, 'stone'); set(2, 66, 0, 'oak_stairs', E); set(3, 65, 0, 'stone'); set(3, 66, 0, 'stone'); set(3, 67, 0, 'oak_stairs', E);
  for (let x = 4; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 67, z, 'oak_planks');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!(z === 0 && x >= open0)) set(x, 67, z, 'oak_planks');
  for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 70, z, 'oak_planks');
};
check('лестница, проём с запасом', STAIRS(0), [0, 65, 0], G(5, 68, 0), true);
// 4б. Проём только над ступеньками: голова упирается в потолок - игрок тоже не поднимется (проверено физикой игры)
check('лестница, проём впритык - честно нет пути', STAIRS(1), [-1, 65, 0], G(5, 68, 0), false);
// 5. Сплошная стена без прохода - честно «пути нет» (а не пустой путь, принятый за «дошла»)
check('сплошная стена - пути нет', (set) => wall(set, 3, 4), [0, 65, 0], G(6, 65, 0), false);
// 6. Стоит на кровати (21.11 «стоит как дурак на кровати») - сойти и дойти
check('с кровати - дальше', (set) => { set(0, 65, 0, 'red_bed', { facing: 'east', part: 'foot', occupied: false }); set(1, 65, 0, 'red_bed', { facing: 'east', part: 'head', occupied: false }); }, [0, 65, 0], G(4, 65, 2), true);
// 7. Стена из открытых люков на открытом месте (21.11 «бился в стену из люков») - обойти, а не ломиться
check('забор из люков - обойти', (set) => { for (let z = -2; z <= 2; z++) { set(3, 65, z, 'spruce_trapdoor', T('bottom', true)); set(3, 66, z, 'spruce_trapdoor', T('bottom', true)); } }, [0, 65, 0], G(6, 65, 0), true, avoidX(3, -2, 2));

// --- формы блоков
check('плиты и ковёр - шагом', (set) => { set(1, 65, 0, 'oak_slab', { type: 'bottom', waterlogged: false }); set(2, 65, 0, 'stone'); set(3, 65, 0, 'stone'); set(3, 66, 0, 'red_carpet'); }, [0, 65, 0], G(3, 66, 0), true);
check('забор не перепрыгнуть', (set) => { for (let z = -6; z <= 6; z++) set(3, 65, z, 'oak_fence', FENCE); }, [0, 65, 0], G(6, 65, 0), false);
check('калитка в заборе - открыть', (set) => { for (let z = -6; z <= 6; z++) set(3, 65, z, 'oak_fence', FENCE); set(3, 65, 0, 'oak_fence_gate', { facing: 'east', in_wall: false, open: false, powered: false }); }, [0, 65, 0], G(6, 65, 0), true);
check('деревянная дверь - открыть', (set) => { wall(set, 3); set(3, 65, 0, ...DOOR('oak_door', 'lower')); set(3, 66, 0, ...DOOR('oak_door', 'upper')); }, [0, 65, 0], G(6, 65, 0), true);
check('железная дверь - рукой не открыть', (set) => { wall(set, 3); set(3, 65, 0, ...DOOR('iron_door', 'lower')); set(3, 66, 0, ...DOOR('iron_door', 'upper')); }, [0, 65, 0], G(6, 65, 0), false);
check('щель 1,5 под плитой - не пролезть', (set) => { wall(set, 3); set(3, 65, 0, 'air'); set(3, 66, 0, 'oak_slab', { type: 'top', waterlogged: false }); }, [0, 65, 0], G(6, 65, 0), false);
check('угол по диагонали - не срезать', (set) => { for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) if (!((x === 0 && z === 0) || (x === 1 && z === 1))) { set(x, 65, z, 'stone'); set(x, 66, z, 'stone'); } }, [0, 65, 0], G(1, 65, 1), false);
check('ступенька 1 блок - прыжком', (set) => { for (let x = 2; x <= 6; x++) set(x, 65, 0, 'stone'); }, [0, 65, 0], G(4, 66, 0), true);
check('потолок над прыжком - обойти', (set) => { set(2, 65, 0, 'stone'); set(1, 67, 0, 'stone'); set(0, 67, 0, 'stone'); }, [0, 65, 0], G(2, 66, 0), true);
// --- грядки (22.11): прыжок и падение на грядку её вытаптывают
const FARM = (set) => { for (let x = 2; x <= 4; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'farmland', { moisture: 7 }); };
check('грядки: поле во всю ширину - пройти шагом, не прыгая', (set) => FARM(set), [0, 65, 0], G(6, 65, 0), true,
  (p) => { const n = p.filter((m) => m.x >= 2 && m.x <= 4).length; return n > 3 ? `по грядкам ${n} шагов` : null; });
check('грядка посреди пути - обойти', (set) => { for (let x = 2; x <= 4; x++) for (let z = -1; z <= 1; z++) set(x, 64, z, 'farmland', { moisture: 7 }); }, [0, 65, 0], G(6, 65, 0), true,
  (p) => (p.some((m) => m.x >= 2 && m.x <= 4 && Math.abs(m.z) <= 1) ? 'пошла по грядке' : null));
check('с уступа на грядку не прыгать', (set) => { for (let x = -6; x <= 1; x++) for (let z = -6; z <= 6; z++) set(x, 65, z, 'stone'); for (let x = 2; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'farmland', { moisture: 7 }); },
  [0, 66, 0], G(6, 65, 0), false);
// --- дороги (22.11): у построек идёт по дорожке, а не по газону
check('по дорожке, а не по газону', (set) => { for (let x = 0; x <= 8; x++) set(x, 64, -2, 'stone_bricks'); for (let z = -2; z <= 0; z++) { set(0, 64, z, 'stone_bricks'); set(8, 64, z, 'stone_bricks'); } },
  [0, 65, 0], G(8, 65, 0), true, (p) => { const off = p.filter((m) => !(m.z === -2 || m.x === 0 || m.x === 8)).length; return off > 2 ? `по газону ${off} шагов` : null; },
  (x, y, z, u) => (u === 'stone_bricks' ? 1 : 1.6));
// --- паркур (22.11): прыжок через яму, если физика игры подтверждает; над лавой и пропастью - нет
// канава шириной w и глубиной depth: дно - камень на 64-depth (в модели мира один слой пола - без дна была бы пропасть)
const DITCH = (w, depth, fill) => (set) => { for (let x = 2; x < 2 + w; x++) for (let z = -6; z <= 6; z++) { for (let y = 64; y > 64 - depth; y--) set(x, y, z, y === 64 - depth + 1 && fill ? fill : 'air'); if (depth < 6) set(x, 64 - depth, z, 'stone'); } };
const leapUsed = (p) => (p.some((m) => m.leap) ? null : 'без прыжка');
check('канава 1 блок - перепрыгнуть', DITCH(1, 2), [0, 65, 0], G(5, 65, 0), true, leapUsed);
check('канава 2 блока - перепрыгнуть', DITCH(2, 2), [0, 65, 0], G(6, 65, 0), true, leapUsed);
check('канава 3 блока - с разбега', DITCH(3, 2), [0, 65, 0], G(7, 65, 0), true, leapUsed);
check('канава 1 блок над лавой - нельзя', DITCH(1, 2, 'lava'), [0, 65, 0], G(5, 65, 0), false);
check('пропасть 2 блока шириной, глубина 10 - нельзя', DITCH(2, 10), [0, 65, 0], G(6, 65, 0), false);
check('ошибка в цене клетки не ломает путь', () => {}, [0, 65, 0], G(6, 65, 0), true, null, () => { throw new Error('сбой'); });
// поле с поливом (22.11 «застряла» на пшенице): грядки, посередине канал воды на уровне грядок - по рядам ходить можно
check('поле с поливочной водой - пройти по рядам', (set) => { for (let x = -3; x <= 8; x++) for (let z = -4; z <= 4; z++) { set(x, 64, z, z === 0 ? 'water' : 'farmland', z === 0 ? undefined : { moisture: 7 }); if (z !== 0) set(x, 65, z, 'wheat', { age: 7 }); } },
  [0, 65, 1], new goals.GoalNear(6, 65, 1, 1), true);
console.log(`--- ходьба: ${results.filter(Boolean).length} из ${results.length}`);
if (results.some((x) => !x)) process.exitCode = 1;
