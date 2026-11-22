// Жесты (gestures.js) на модели: настоящие жесты узнаются, а те же движения в обычной игре (стройка у края, копание,
// бег с прыжками, бой, прошёл мимо) - нет. Ответы: незнакомым - только кивок на привет, прыжки - не у пашни.
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const { Vec3 } = require(R + '/vec3');
const { Gestures } = require('../app/gestures');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const T0 = 1e12;
const solid = { name: 'stone', boundingBox: 'block' }, air = { name: 'air', boundingBox: 'empty' };
// мир: пол на y=63 везде, кроме «обрыва» x > 20
const blockAt = (v) => (Math.floor(v.y) === 63 && Math.floor(v.x) <= 20 ? solid : air);
const mk = (extra = {}) => { const t = Object.create(Gestures.prototype); t.bot = { entity: { position: new Vec3(0, 64, 0) }, entities: {}, players: {}, blockAt, world: { raycast: () => null } }; t.guard = { isHostile: (e) => e.name === 'zombie' }; Object.assign(t, extra); return t; };
const P = (x = 0, z = -5) => ({ position: new Vec3(x, 64, z), yaw: Math.PI, pitch: 0 });
const g0 = () => ({ s: [], crouch: [], swing: [], said: {}, held: '', armor: 0 });
const trace = (g, n, f) => { for (let i = 0; i < n; i++) { const t = T0 - (n - i) * 100; g.s.push({ t, ground: true, x: 0, y: 64, z: -5, yaw: Math.PI, pitch: 0, ...f(i) }); } };
const read = (g, p = P(), t = mk()) => { const k = t.readGesture('V', g, p, T0) || t.readFollowMe('V', g, p, T0); return (k || {}).kind; };

// настоящие жесты
{ const g = g0(); trace(g, 25, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); ok('кивок - да', read(g) === 'да', read(g)); }
{ const g = g0(); trace(g, 25, (i) => ({ yaw: Math.PI + (i % 4 < 2 ? 0.5 : -0.5) })); ok('мотание - нет', read(g) === 'нет', read(g)); }
{ const g = g0(); trace(g, 25, (i) => ({ yaw: Math.PI + i * 0.6 })); ok('кружение', read(g) === 'кружится', read(g)); }
{ const g = g0(); trace(g, 25, () => ({})); g.crouch = [T0 - 900, T0 - 400]; ok('двойной присед стоя - привет', read(g) === 'привет', read(g)); }
{ const g = g0(); trace(g, 25, () => ({})); g.crouch = [T0 - 900, T0 - 400]; g.hitAt = T0 - 8000; const t = mk({ pvpAt: T0 - 8000 }); ok('после стычки - без обид', read(g, P(), t) === 'без обид', read(g, P(), t)); }
{ const g = g0(); trace(g, 25, () => ({})); g.crouch = [T0 - 1500, T0 - 900, T0 - 400]; const t = mk({ deadAt: { t: T0 - 3000, pos: new Vec3(0, 64, -5), player: true } }); ok('над убитым игроком - насмешка', read(g, P(), t) === 'насмешка'); }
{ const g = g0(); trace(g, 30, (i) => ({ y: i % 6 === 1 ? 64.4 : 64, ground: i % 6 === 0 })); ok('прыжки на месте - радость', read(g) === 'радость', read(g)); }
{ const g = g0(); trace(g, 46, (i) => (i < 30 ? { z: -2 - i * 0.15, yaw: 0 } : { z: -6.35 })); const k = read(g, P(0, -6.35)); ok('отошёл, встал и ждёт - за мной', k === 'за мной', k); }

// обычная игра - не жест
{ const g = g0(); trace(g, 25, () => ({ x: 20.5 })); g.crouch = [T0 - 900, T0 - 400]; const p = P(20.5, -5); ok('присед у края (стройка мостом) - не жест', !read(g, p), read(g, p)); }
{ const g = g0(); trace(g, 25, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); g.digAt = T0 - 500; ok('кивки при копании - не жест', !read(g), read(g)); }
{ const g = g0(); trace(g, 25, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); g.buildAt = T0 - 500; ok('кивки при стройке - не жест', !read(g), read(g)); }
{ const g = g0(); trace(g, 30, (i) => ({ z: -5 + i * 0.25, y: i % 6 === 1 ? 64.4 : 64, ground: i % 6 === 0 })); const k = read(g, P(0, 2.5)); ok('бег с прыжками - не радость', k !== 'радость', k); }
{ const g = g0(); trace(g, 30, (i) => ({ y: 64 + Math.floor(i / 6), ground: i % 6 === 0 })); const k = read(g, P(0, -5)); ok('столб из блоков - не радость', k !== 'радость', k); }
{ const g = g0(); trace(g, 25, (i) => ({ yaw: Math.PI + (i % 4 < 2 ? 0.5 : -0.5) })); const t = mk(); t.bot.entities = { 9: { name: 'zombie', type: 'hostile', position: new Vec3(1, 64, -6) } }; ok('мотает головой в бою - не жест', !read(g, P(), t), read(g, P(), t)); }
{ const g = g0(); trace(g, 40, (i) => ({ z: -5 - i * 0.2, yaw: 0 })); const p = P(0, -13); p.yaw = 0; ok('просто ушёл - не за мной', !read(g, p), read(g, p)); }
{ const g = g0(); trace(g, 40, (i) => ({ x: -4 + i * 0.2, yaw: -Math.PI / 2 })); const p = P(4, -5); p.yaw = -Math.PI / 2; ok('прошёл мимо - не жест', !read(g, p), read(g, p)); }
{ const g = g0(); trace(g, 25, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); const t = mk({ seesEntity: () => false }); ok('за стеной - не жест', !read(g, P(), t)); }
{ const g = g0(); trace(g, 25, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); const t = mk(); read(g, P(), t); ok('повтор не чаще 4 с', !read(g, P(), t)); }

{ const g = g0(); trace(g, 25, (i) => ({ yaw: Math.PI + (i < 12 ? i * 0.15 : 1.8 - (i - 12) * 0.12), pitch: (i % 7) * 0.05 })); ok('осматривается по сторонам - не жест', !read(g), read(g)); }
{ const g = g0(); trace(g, 25, (i) => ({ yaw: Math.PI + 1.2, pitch: i % 4 < 2 ? 0.6 : -0.1 })); ok('кивает, глядя в сторону - не да', !read(g), read(g)); }
{ const g = g0(); trace(g, 46, (i) => (i < 30 ? { z: -2 - i * 0.15, yaw: 0 } : { z: -6.35 })); const t = mk({ mode: 'follow' }); const k = read(g, P(0, -6.35), t); ok('идёт следом - «за мной» не нужно', k !== 'за мной', k); }
// ответы
{ const said = []; const t = mk({ log() {}, emit() {}, attend() {}, gesture: async (k) => said.push(k), mode: 'idle', affinity: () => 0, isMasterName: (n) => n === 'Boss' });
  t.onGesture('Stranger', { kind: 'привет', text: '' }, P(), T0); t.onGesture('Stranger', { kind: 'радость', text: '' }, P(), T0 + 6000);
  ok('незнакомому на привет - кивок, на радость - ничего', said.join(',') === 'кивок', said.join(','));
  said.length = 0; t.onGesture('Boss', { kind: 'привет', text: '' }, P(), T0 + 12000); ok('хозяину - присед в ответ', said[0] === 'привет', said.join(',')); }
{ const t = mk(); t.bot.entity.position = new Vec3(0.5, 64, 0.5); t.bot.blockAt = (v) => (Math.floor(v.y) === 63 ? { name: 'farmland', boundingBox: 'block' } : air); ok('на пашне не прыгает', !t.safeToJump()); }

const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
console.log(`жесты: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
