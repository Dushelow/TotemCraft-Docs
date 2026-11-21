// Общее для сценариев ходьбы: модель мира, поиск пути нашей навигацией, проверка пути физикой игры.
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
        // над целью, но ещё на высоте прошлого шага (сходит с края) - идти дальше, как модуль пути (|dy| < 1)
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

module.exports = { world, find, replay, lastCtlOf: () => lastCtl, registry, Block, Vec3, goals };
