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
  const blockAt = (v) => { v = v.floored(); const st = w.get(`${v.x},${v.y},${v.z}`); const b = Block.fromStateId(st ?? registry.blocksByName.air.defaultState, 0); b.position = v; try { b._properties = b.getProperties(); } catch {} return b; };   // физика смотрит _properties (люк-лестница)
  const toggle = (x, y, z, want) => {
    const b = blockAt(new Vec3(x, y, z)), open = want === undefined ? !b.getProperties().open : want;
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
    // спуск по лестнице - 0,15 бл. за такт: на высокий лаз нужно больше тактов
    for (let t = 0; t < 60 + 12 * Math.ceil(Math.abs(ent.position.y - to.y)); t++) {
      const dx = to.x + 0.5 - e.position.x, dz = to.z + 0.5 - e.position.z;
      const onLad = /^(ladder|vine|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/.test(bot.blockAt(e.position).name);
      if (Math.abs(dx) <= 0.3 && Math.abs(dz) <= 0.3 && onLad && Math.floor(e.position.y + 1e-3) === to.y) { ent.position = e.position; return true; }   // на лестнице тело висит, не стоит
      if (Math.abs(dx) <= 0.2 && Math.abs(dz) <= 0.2 && (e.onGround || (e.isInWater && Math.floor(e.position.y + 1e-3) === to.y))) {
        if (Math.floor(e.position.y + 1e-3) === to.y) { ent.position = e.position; return true; }
        // над целью, но ещё на высоте прошлого шага (сходит с края) - идти дальше, как модуль пути (|dy| < 1)
      }
      e.yaw = Math.atan2(-dx, -dz);
      const fbk = bot.blockAt(e.position), lad = /^(ladder|vine|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/.test(fbk.name), ladUp = lad || (/_trapdoor$/.test(fbk.name) && fbk.getProperties().open && bot.blockAt(e.position.offset(0, -1, 0)).name === 'ladder' && bot.blockAt(e.position.offset(0, -1, 0)).getProperties().facing === fbk.getProperties().facing);
      const tol = lad || !e.onGround ? 0.3 : 0.12;
      const down = to.y < e.position.y - (lad ? 0.05 : 0.9) && Math.abs(dx) <= tol && Math.abs(dz) <= tol;   // над спуском - не жать вперёд (как nav-вниз)
      const climb = ladUp && to.y > e.position.y + 0.3, col = Math.abs(dx) < 0.45 && Math.abs(dz) < 0.45;   // как nav-вниз: вверх - прыжок
      const wetUp = e.isInWater && to.y > e.position.y + 0.3 && !col;   // как water.js: к гребню прыжком, с гребня - вперёд
      const crest = e.position.y - Math.floor(e.position.y) >= 0.45;
      const st = new PlayerState(p, { forward: wetUp ? crest || !e.isCollidedHorizontally : climb ? !col : !down, back: false, left: false, right: false, jump: wetUp || climb || (jump && !down), sprint: false, sneak: false });
      physics.simulatePlayer(st, world); st.apply(p);
      if (/^(twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/.test(bot.blockAt(e.position).name) || (() => { const k = bot.blockAt(e.position), l = bot.blockAt(e.position.offset(0, -1, 0)); return /_trapdoor$/.test(k.name) && k.getProperties().open && l.name === 'ladder' && l.getProperties().facing === k.getProperties().facing; })()) { if (climb) e.velocity.y = Math.max(e.velocity.y, 0.2); else if (e.velocity.y < -0.15) e.velocity.y = -0.15; }   // как nav-лианы
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
  if (g.shapes && g.shapes.length && !/ladder|vine/.test(g.name)) ent.position.y = from[1] + Math.max(...g.shapes.map((s) => s[4]));
  for (const m of r.path) {
    for (const p of m.opens || []) bot.toggle(p.x, p.y, p.z, p.want);   // как тело: только в нужное положение
    if (m.leap ? !leapTo(bot, ent, m, ctl) : !walkTo(bot, ent, m)) return `физически не прошла к ${m.x},${m.y},${m.z} (стоит на ${ent.position.x.toFixed(2)},${ent.position.y.toFixed(2)},${ent.position.z.toFixed(2)})`;
  }
  return null;
}

module.exports = { world, find, replay, lastCtlOf: () => lastCtl, registry, Block, Vec3, goals };
