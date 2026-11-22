// Присутствие (presence.js) на модели: крадётся за хозяином, симпатия, еда раненому хозяину, предмет в руке к занятию.
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const { Vec3 } = require(R + '/vec3');
const registry = require(R + '/prismarine-registry')('1.21.4');
const { Presence } = require('../app/presence');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const ctl = {}; let tossed = null, held = null;
const inv = [{ name: 'bread', type: 1, count: 5 }, { name: 'book', type: 2, count: 1 }, { name: 'wheat', type: 3, count: 8 }];
const b = { registry, entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, inventory: { items: () => inv }, setControlState: (k, v) => { ctl[k] = v; }, pathfinder: { isMoving: () => false, setGoal() {} },
  lookAt: async () => {}, toss: async (type, m, n) => { tossed = { type, n }; }, equip: async (i) => { held = i.name; }, heldItem: null, blockAt: () => null, chat() {} };
const t = Object.create(Presence.prototype); Object.assign(t, { bot: b, mode: 'follow', followName: 'V', log() {}, say() {}, memory: { data: {}, save() {} }, comp: { barkAt: 0, topic: {} } });
const hpIdx = registry.entitiesByName.player.metadataKeys.indexOf('health');
const owner = { username: 'V', position: new Vec3(2, 64, 0), crouching: true, yaw: 0, metadata: { [hpIdx]: 5 }, equipment: [] };
const realNow = Date.now; let now = realNow(); Date.now = () => now;
t.stealthTick(owner); now += 1500; t.stealthTick(owner); ok('хозяин крадётся - крадусь', ctl.sneak === true);
owner.crouching = false; t.stealthTick(owner); ok('встал - встала', ctl.sneak === false);
t.helpTick(owner, now, { helpAt: 0 });
Date.now = realNow;
setTimeout(async () => {
  ok('мало здоровья у хозяина - бросила еду', tossed && tossed.type === 1, JSON.stringify(tossed));
  t.affinityAdd('Griefer', -35, 'ударил'); t.affinityAdd('Friend', 45, 'подарки');
  ok('симпатия словами', t.affinityWord('Griefer') === 'плохое' && t.affinityWord('Friend') === 'тёплое' && t.affinityWord('Nobody') === 'нейтральное');
  const sb = { what: 'разглядываю книги' }; await t.propOn(sb); ok('у кафедры - книга в руке', held === 'book', held);
  const sb2 = { what: 'глажу sheep', ent: { name: 'sheep' } }; await t.propOn(sb2); ok('у овцы - пшеница в руке', held === 'wheat', held);
  { const { world } = require('./navlib'); const { Steer } = require('../app/steer'); const { Companion } = require('../app/companion');
    const mkp = (build) => { let goal = null; const w = world(build); w.entity = { position: new Vec3(0.5, 65, 3.5) }; w.pathfinder = { setGoal: (g) => { goal = g; } };
      const t2 = Object.create(Presence.prototype); for (const M of [Steer, Companion]) for (const k of Object.getOwnPropertyNames(M.prototype)) if (k !== 'constructor') t2[k] = M.prototype[k];
      Object.assign(t2, { bot: w, mode: 'follow', followDist: () => 3 });
      t2.formationTick({ position: new Vec3(0.5, 65, 0.5), velocity: new Vec3(0, 0, 0.2) }, Date.now()); return goal; };
    const g1 = mkp(() => {}); ok('впереди хозяина - пост сзади-сбоку', g1 && g1.z < 0.5, g1 && JSON.stringify({ x: g1.x, z: g1.z }));
    const g2 = mkp((set) => { for (let x = -6; x <= 6; x++) for (let y = 65; y <= 67; y++) set(x, y, -1, 'stone'); });
    ok('сзади стена - пост сбоку, не за стеной', g2 && g2.z > -1 && Math.abs(g2.x - 0.5) >= 1.5, g2 && JSON.stringify({ x: g2.x, z: g2.z })); }
  { const mk2 = (head, vel, threat) => { const t3 = Object.create(Presence.prototype); Object.assign(t3, { followName: 'V', player: () => ({ velocity: new Vec3(vel, 0, 0) }), threat: () => ({ level: threat }), bot: { entity: { position: new Vec3(0, 64, 0) }, players: {}, blockAt: (v) => (v.y >= 66 && head ? { boundingBox: 'block', skyLight: 0 } : { boundingBox: 'empty', skyLight: 15 }) } }); return t3.comfortShift(); };
    ok('в доме - ближе, на просторе бегом - дальше, опасно - ближе', mk2(true, 0, 'спокойно') < 0 && mk2(false, 0.3, 'спокойно') > 0 && mk2(false, 0, 'опасно') < 0, [mk2(true, 0, 'спокойно'), mk2(false, 0.3, 'спокойно'), mk2(false, 0, 'опасно')].join(',')); }
  const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
  console.log(`присутствие: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
}, 50);
