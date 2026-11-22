// Компаньон (companion.js) на модели: хозяин стоит - занятие у верстака или костра; пошёл - снова следом; присел дважды - присела в ответ.
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const { Vec3 } = require(R + '/vec3');
const { world } = require('./navlib');
const { Companion } = require('../app/companion');
const { Steer } = require('../app/steer');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const b = world((set) => { set(4, 65, 2, 'crafting_table'); set(-3, 65, -2, 'campfire', { lit: true, facing: 'north', signal_fire: false, waterlogged: false }); });
b.entity = { position: new Vec3(0.5, 65, 0.5), velocity: new Vec3(0, 0, 0), yaw: 0, height: 1.8, isInWater: false };
b.findBlocks = ({ point, matching, maxDistance }) => { const out = []; for (let x = -10; x <= 10; x++) for (let y = -3; y <= 3; y++) for (let z = -10; z <= 10; z++) { const p = new Vec3(Math.floor(point.x) + x, Math.floor(point.y) + y, Math.floor(point.z) + z); if (p.distanceTo(point) <= maxDistance && matching(b.blockAt(p))) out.push(p); } return out; };
let goal = null, ctl = {}; b.pathfinder = { setGoal: (g) => { goal = g; } }; b.setControlState = (k, v) => { ctl[k] = (ctl[k] || []).concat(v); }; b.swingArm = () => {}; b.time = { timeOfDay: 6000 }; b.game.dimension = 'overworld'; b.health = 20;
const owner = { username: 'V', position: new Vec3(2.5, 65, 0.5), height: 1.8, yaw: 0, pitch: 0 };
const t = Object.create(Companion.prototype); for (const k of Object.getOwnPropertyNames(Steer.prototype)) if (k !== 'constructor') t[k] = Steer.prototype[k];
Object.assign(t, { bot: b, status: 'online', mode: 'follow', followName: 'V', token: 1, player: () => owner, followDist: () => 3, log: () => {}, say: () => {}, threat: () => ({ level: 'спокойно' }), gestures: new Map([['V', { crouch: [] }]]) });
const realNow = Date.now; let now = realNow(); Date.now = () => now;
const rnd = Math.random; Math.random = () => 0.1;
for (let i = 0; i < 10; i++) { now += 1000; t.companionTick(); }
ok('хозяин стоит - занятие', t.sandbox && /верстак|костр/.test(t.sandbox.what), t.sandbox && t.sandbox.what);
ok('пошла к месту', goal && goal.constructor.name === 'GoalNear', goal && goal.constructor.name);
owner.position = new Vec3(8.5, 65, 0.5); now += 1000; t.companionTick();
ok('хозяин пошёл - снова следом', !t.sandbox && goal && goal.constructor.name === 'GoalFollow', goal && goal.constructor.name);
t.mode = 'task'; owner.position = new Vec3(8.5, 65, 0.5); for (let i = 0; i < 10; i++) { now += 1000; t.companionTick(); }
ok('занята делом - песочницы нет', !t.sandbox);
t.mode = 'follow'; t.gestures.get('V').crouch.push(now - 500, now - 200); now += 100; t.companionTick();
Date.now = realNow; Math.random = rnd;
setTimeout(() => {
  ok('присела в ответ', (ctl.sneak || []).includes(true), JSON.stringify(ctl.sneak));
  const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
  console.log(`компаньон: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
}, 1500);
