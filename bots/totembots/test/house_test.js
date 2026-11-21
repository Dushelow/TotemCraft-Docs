// Сценарии дома без сервера (модель мира + поиск пути с нашими правками): каждая ошибка из игры - проверка,
// чтобы не вернулась. node test/house_test.js
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const registry = require(R + '/prismarine-registry')('1.21.4');
const Block = require(R + '/prismarine-block')(registry);
const { Vec3 } = require(R + '/vec3');
const { Movements, goals } = require(R + '/mineflayer-pathfinder');
const AStar = require(R + '/mineflayer-pathfinder/lib/astar');
const Move = require(R + '/mineflayer-pathfinder/lib/move');
const { install } = require(path.resolve(__dirname, '../app/house-moves.js'));

function world(build) {
  const w = new Map();
  const set = (x, y, z, name, props) => w.set(`${x},${y},${z}`, props ? Block.fromProperties(name, props, 0).stateId : registry.blocksByName[name].defaultState);
  for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'stone');   // пол
  build(set);
  const bot = { registry, version: '1.21.4', entities: {}, game: { minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 65, 0.5) }, inventory: { items: () => [] },
    blockAt: (v) => { v = v.floored(); const st = w.get(`${v.x},${v.y},${v.z}`); const b = Block.fromStateId(st ?? registry.blocksByName.air.defaultState, 0); b.position = v; return b; } };
  return bot;
}
function find(bot, from, goal) {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = [];
  install(mv, bot);
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), mv, goal, 5000, 20000, -1, 0);
  return a.compute();
}
const wall = (set, x, h = 3) => { for (let z = -6; z <= 6; z++) for (let y = 65; y < 65 + h; y++) set(x, y, z, 'stone'); };
const T = (half, open, facing = 'east') => ({ facing, half, open, powered: false, waterlogged: false });
const results = [];
const check = (name, r, wantPath) => { const ok = (r.status === 'success') === wantPath; results.push(ok); console.log(`${ok ? 'да ' : 'НЕТ'} ${name}: ${r.status}${r.status === 'success' ? ' через ' + r.path.slice(0, 4).map((p) => `${p.x},${p.y},${p.z}`).join(' ') : ''}`); };

// 1. Выход из дома - люк-дверь в проёме стены: внизу пусто, люк на уровне головы (21.11, дом у 333 -432)
{ const bot = world((set) => { wall(set, 3); set(3, 65, 0, 'air'); set(3, 66, 0, 'pale_oak_trapdoor', T('bottom', false)); });
  check('люк-дверь в проёме - проход', find(bot, [0, 65, 0], new goals.GoalBlock(6, 65, 0)), true); }
// 2. Стена амбара из люков в два ряда (21.11, 315 65 -461) - стена, в проём не идти
{ const bot = world((set) => { wall(set, 3); set(3, 65, 0, 'acacia_trapdoor', T('bottom', true)); set(3, 66, 0, 'acacia_trapdoor', T('bottom', true)); });
  check('стена из люков - не проход', find(bot, [0, 65, 0], new goals.GoalBlock(6, 65, 0)), false); }
// 3. Закрытый люк в полу - по нему ходят
{ const bot = world((set) => { set(2, 64, 0, 'air'); set(2, 64, 0, 'oak_trapdoor', T('top', false)); });
  check('закрытый люк в полу - пол', find(bot, [0, 65, 0], new goals.GoalBlock(4, 65, 0)), true); }
// 4. Лестница под потолком на второй этаж (15-19.11, «ближе пути нет»)
{ const E = { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false };
  const bot = world((set) => { set(1, 65, 0, 'oak_stairs', E); set(2, 65, 0, 'stone'); set(2, 66, 0, 'oak_stairs', E); set(3, 65, 0, 'stone'); set(3, 66, 0, 'stone'); set(3, 67, 0, 'oak_stairs', E);
    for (let x = 4; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 67, z, 'oak_planks'); for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!(z === 0 && x >= 1)) set(x, 67, z, 'oak_planks'); for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 70, z, 'oak_planks'); });
  check('лестница под потолком', find(bot, [0, 65, 0], new goals.GoalBlock(5, 68, 0)), true); }
// 5. Сплошная стена без прохода - честно «пути нет» (а не пустой путь, принятый за «дошла»)
{ const bot = world((set) => wall(set, 3, 4));
  check('сплошная стена - пути нет', find(bot, [0, 65, 0], new goals.GoalBlock(6, 65, 0)), false); }
console.log(`--- дом: ${results.filter(Boolean).length} из ${results.length}`);
