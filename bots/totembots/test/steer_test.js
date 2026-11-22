// Ближнее чутьё (steer.js) на модели мира: куда отбежать, видит ли моба за стеной, удержится ли после толчка у лавы.
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const { Vec3 } = require(R + '/vec3');
const { world } = require('./navlib');
const { Steer } = require('../app/steer');
const mk = (build, at = [0.5, 65, 0.5]) => { const b = world(build); b.entity = { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), yaw: 0, height: 1.8 }; const t = Object.create(Steer.prototype); t.bot = b; return t; };
const res = [];
const ok = (name, cond, info) => res.push([name, !!cond, info]);

// 1. Чисто поле, крипер с запада - бежать на восток
{ const t = mk(() => {}); const r = t.steerAway([{ x: -2, y: 65, z: 0.5 }]); ok('поле: прочь от крипера', r && r.x > 2, JSON.stringify(r)); }
// 2. На востоке лава во всю ширину - не в лаву, а в сторону
{ const t = mk((set) => { for (let x = 3; x <= 6; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'lava'); });
  const r = t.steerAway([{ x: -2, y: 65, z: 0.5 }]);
  const lavaEnd = r && r.x >= 3 && r.x <= 6; ok('лава за спиной: не в лаву', r && !lavaEnd, JSON.stringify(r)); }
// 3. Стена на востоке вплотную - уйти вдоль неё (север или юг), а не упираться
{ const t = mk((set) => { for (let z = -6; z <= 6; z++) for (let y = 65; y <= 67; y++) set(2, y, z, 'stone'); });
  const r = t.steerAway([{ x: -2, y: 65, z: 0.5 }]); ok('стена за спиной: вдоль стены', r && Math.abs(r.z) >= 3 && r.x < 2, JSON.stringify(r)); }
// 4. Двое: с запада и с севера - на юго-восток
{ const t = mk(() => {}); const r = t.steerAway([{ x: -3, y: 65, z: 0.5 }, { x: 0.5, y: 65, z: -3 }]); ok('двое: на юго-восток', r && r.x > 1 && r.z > 1, JSON.stringify(r)); }
// 5. Обрыв (край пола x=12) на востоке близко: конец луча на полу, не в пустоте
{ const t = mk(() => {}, [10.5, 65, 0.5]); const r = t.steerAway([{ x: 8, y: 65, z: 0.5 }]); ok('обрыв: на полу', r && r.x <= 12 && t.standOk(r.x, r.y, r.z), JSON.stringify(r)); }
// 6. Линия взгляда: моб за стеной не виден, в чистом поле виден, за стеклом виден
{ const wall = mk((set) => { for (let z = -6; z <= 6; z++) for (let y = 65; y <= 68; y++) set(4, y, z, 'stone'); });
  const glass = mk((set) => { for (let z = -6; z <= 6; z++) for (let y = 65; y <= 68; y++) set(4, y, z, 'glass'); });
  const z = { id: 1, position: new Vec3(8.5, 65, 0.5), height: 1.95 };
  ok('за стеной не видно', !wall.seesEntity(z)); ok('за стеклом видно', glass.seesEntity({ ...z, id: 2 })); ok('в поле видно', mk(() => {}).seesEntity({ ...z, id: 3 })); }
// 7. Равновесие: толчок к лаве - без поправки в лаве, с поправкой нет
{ for (const lx of [2, 3, 4]) {
    const t = mk((set) => { for (let x = lx; x <= lx + 4; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'lava'); });
    t.bot.entity.velocity = new Vec3(0.45, 0.36, 0);
    const none = t.fallSim({}, 0), plan = t.balancePlan();
    console.log(`  лава с x=${lx}: без поправки ${none.danger} (x=${none.land && none.land.x.toFixed(2)}), план ${JSON.stringify(plan)}`);
  }
  const t = mk((set) => { for (let x = 3; x <= 8; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'lava'); });
  t.bot.entity.velocity = new Vec3(0.45, 0.36, 0);
  const plan = t.balancePlan(); ok('толчок к лаве: удержалась', plan && plan.back === 0 && plan.none > 0, JSON.stringify(plan));
  const safe = mk(() => {}); safe.bot.entity.velocity = new Vec3(0.45, 0.36, 0); ok('толчок в поле: ничего не делать', safe.balancePlan() === null); }

// 8. Чувства: зомби за стеной слабее пугает, чем такой же на виду; в сводке «за стеной»
{ const { Senses } = require('../app/senses');
  const both = (build) => { const t = mk(build); Object.assign(t, Senses.prototype); for (const k of Object.getOwnPropertyNames(Senses.prototype)) if (k !== 'constructor') t[k] = Senses.prototype[k];
    t.bot.registry = require(R + '/prismarine-registry')('1.21.4'); t.bot.time = { timeOfDay: 6000 }; t.bot.game.dimension = 'overworld'; t.bot.health = 20;
    const z = { id: 7, name: 'zombie', type: 'hostile', height: 1.95, position: new Vec3(10.5, 65, 0.5) }; t.bot.entities = { 7: z };
    t.sensesTick(); z.position = new Vec3(9.5, 65, 0.5); t.tracks.get(7).at -= 1000; t.sensesTick(); return t; };
  const open = both(() => {}), hid = both((set) => { for (let z = -6; z <= 6; z++) for (let y = 65; y <= 68; y++) set(5, y, z, 'stone'); });
  ok('за стеной угроза меньше', hid.threat().score < open.threat().score, open.threat().score + ' / ' + hid.threat().score);
  ok('сводка: за стеной', /за стеной/.test(hid.motion().join(' ')), hid.motion().join(' ')); }

const bad = res.filter((r) => !r[1]);
for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
console.log(`ближнее чутьё: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
