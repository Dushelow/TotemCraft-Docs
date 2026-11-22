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
  const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
  console.log(`присутствие: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
}, 50);
