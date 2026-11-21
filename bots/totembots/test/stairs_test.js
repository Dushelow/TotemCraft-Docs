// Проверка без сервера: лестница под потолком. Пол y=64 (камень), ступеньки на (1,65),(2,66),(3,67) по +x,
// потолок (доски) y=67 над x=0..2 кроме проёма над ступеньками x>=2. Ищем путь с (0,65) на (4,68).
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const registry = require(R + '/prismarine-registry')('1.21.4');
const Block = require(R + '/prismarine-block')(registry);
const { Vec3 } = require(R + '/vec3');
const { Movements, goals } = require(R + '/mineflayer-pathfinder');
const { install } = require(path.resolve(__dirname, '../app/house-moves.js'));
const world = new Map();
const set = (x, y, z, name, props) => { const st = props ? Block.fromProperties(name, props, 0).stateId : registry.blocksByName[name].defaultState; world.set(`${x},${y},${z}`, st); };
for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 64, z, 'stone');
const E = { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false }; set(1, 65, 0, 'oak_stairs', E); set(2, 66, 0, 'oak_stairs', E); set(3, 67, 0, 'oak_stairs', E);
for (let x = 2; x <= 3; x++) for (let y = 65; y <= 66; y++) if (!(x === 2 && y === 66)) set(x, y, 0, 'stone');   // опоры под ступеньками
set(3,65,0,'stone'); set(3,66,0,'stone');
for (let x = 4; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 67, z, 'oak_planks');   // пол второго этажа
for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!(z === 0 && x >= 1)) set(x, 67, z, 'oak_planks');   // потолок первого
for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 70, z, 'oak_planks');   // крыша
const bot = { registry, version: '1.21.4', entities: {}, game: { minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 65, 0.5) }, inventory: { items: () => [] },
  blockAt: (v) => { v = v.floored(); const st = world.get(`${v.x},${v.y},${v.z}`); const b = Block.fromStateId(st ?? registry.blocksByName.air.defaultState, 0); b.position = v; return b; } };
function run(withFix) {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = [];
  if (withFix) install(mv, bot);
  const AStar = require(R + '/mineflayer-pathfinder/lib/astar');
  const start = new (require(R + '/mineflayer-pathfinder/lib/move'))(0, 65, 0, 0, 0);
  const a = new AStar(start, mv, new goals.GoalBlock(5, 68, 0), 5000, 20000, -1, 0);
  const r = a.compute();
  console.log(withFix ? 'с правкой:' : 'без правки:', r.status, r.path.map((p) => `${p.x},${p.y},${p.z}`).join(' '));
}
run(false); run(true);
