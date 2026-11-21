// Модель без сервера: бассейн глубиной 6, путь по прямой на 30 блоков. Сравнить старое плавание (физика бота с
// «вперёд + прыжок») и новое (swim.js): сколько проплыл за 8 с, держится ли в воде, ровно ли идёт.
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const registry = require(R + '/prismarine-registry')('1.21.4');
const Block = require(R + '/prismarine-block')(registry);
const { Vec3 } = require(R + '/vec3');
const { Physics, PlayerState } = require(R + '/prismarine-physics');
const { swimTick } = require(path.resolve(__dirname, '../app/swim.js'));
const W = registry.blocksByName.water.defaultState, S = registry.blocksByName.stone.defaultState, A = registry.blocksByName.air.defaultState;
const world = { getBlock: (v) => { v = v.floored(); let st = A; if (v.y <= 55) st = S; else if (v.y <= 61 && v.x > -5 && v.x < 45 && Math.abs(v.z) < 6) st = W; else if (v.y <= 61) st = S; const b = Block.fromStateId(st, 0); b.position = v; return b; } };
function makeBot() {
  const control = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
  const bot = {
    registry, version: '1.21.4', food: 20, oxygenLevel: 20, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0,
    entity: { position: new Vec3(0.5, 59, 0.5), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: true, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: -Math.PI / 2, pitch: 0, effects: {}, attributes: {}, equipment: [] },
    inventory: { slots: [] }, game: { gameMode: 'survival' },
    blockAt: (v) => world.getBlock(v),
    setControlState: (k, v) => { control[k] = v; }, getControlState: (k) => control[k],
    look: (y, p) => { bot.entity.yaw = y; bot.entity.pitch = p; },
    pathfinder: { isMoving: () => true },
  };
  return { bot, control };
}
const physics = Physics(registry, world);
const nodes = []; for (let x = 1; x <= 35; x++) nodes.push({ x, y: 59, z: 0 });
function run(useNew) {
  const { bot, control } = makeBot();
  const tb = { bot, lastPath: { path: nodes } };
  let minY = 99, maxY = 0;
  for (let t = 0; t < 160; t++) {
    if (!(useNew && swimTick(tb))) { control.forward = true; control.jump = true; control.sprint = false; bot.entity.yaw = -Math.PI / 2; }
    physics.simulatePlayer(new PlayerState(bot, control), world).apply(bot);
    minY = Math.min(minY, bot.entity.position.y); maxY = Math.max(maxY, bot.entity.position.y);
  }
  const p = bot.entity.position;
  console.log(`${useNew ? 'новое' : 'старое'}: за 8 с проплыл ${(p.x - 0.5).toFixed(1)} бл., в сторону ${p.z.toFixed(2)}, высота от ${minY.toFixed(2)} до ${maxY.toFixed(2)}, рывок ${control.sprint}`);
}
run(false); run(true);
// поворот: 12 блоков на восток, потом 4 на юг (в бассейне шириной 10)
nodes.length = 0; for (let x = 1; x <= 12; x++) nodes.push({ x, y: 59, z: 0 }); for (let z = 1; z <= 4; z++) nodes.push({ x: 12, y: 59, z });
{ const { bot, control } = makeBot(); const tb = { bot, lastPath: { path: nodes } };
  for (let t = 0; t < 160; t++) { swimTick(tb); physics.simulatePlayer(new PlayerState(bot, control), world).apply(bot); }
  const p = bot.entity.position; console.log(`поворот: дошёл до ${p.x.toFixed(1)} ${p.z.toFixed(1)} (цель 12.5 4.5)`); }
