// Жесты (gestures.js) на модели: по следу движений игрока - правильный смысл, и без ложных срабатываний на ходьбу.
const path = require('path');
const { Vec3 } = require(path.resolve(__dirname, '../node_modules') + '/vec3');
const { Gestures } = require('../app/gestures');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const T0 = 1e12;
const mk = () => { const t = Object.create(Gestures.prototype); t.bot = { entity: { position: new Vec3(0, 64, 0) }, world: { raycast: () => null } }; return t; };
// игрок в 5 бл. к северу смотрит на бота (yaw = PI: вперёд = (0,0,+1)... в Minecraft вперёд (-sin yaw, -cos yaw))
const P = (x = 0, z = -5) => ({ position: new Vec3(x, 64, z), yaw: Math.PI, pitch: 0 });
const g0 = () => ({ s: [], crouch: [], swing: [], said: {}, held: '', armor: 0 });
const trace = (g, n, f) => { for (let i = 0; i < n; i++) { const t = T0 - (n - i) * 100; g.s.push({ t, ground: true, x: 0, y: 64, z: -5, yaw: Math.PI, pitch: 0, ...f(i) }); } };
const read = (g, p = P(), t = mk()) => (t.readGesture('V', g, p, T0) || {}).kind;
{ const g = g0(); trace(g, 12, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); ok('кивок - да', read(g) === 'да', read(g0())); }
{ const g = g0(); trace(g, 12, (i) => ({ yaw: Math.PI + (i % 4 < 2 ? 0.5 : -0.5) })); ok('мотание - нет', read(g) === 'нет'); }
{ const g = g0(); trace(g, 12, (i) => ({ yaw: Math.PI + i * 0.6 })); const k = read(g); ok('кружение', k === 'кружится', k); }
{ const g = g0(); trace(g, 6, () => ({})); g.crouch = [T0 - 900, T0 - 400]; ok('двойной присед - привет', read(g) === 'привет'); }
{ const g = g0(); trace(g, 6, () => ({})); g.crouch = [T0 - 900, T0 - 400]; const t = mk(); t.pvpAt = T0 - 5000; ok('после стычки - без обид', read(g, P(), t) === 'без обид'); }
{ const g = g0(); trace(g, 6, () => ({})); g.crouch = [T0 - 1500, T0 - 900, T0 - 400]; const t = mk(); t.deadAt = { t: T0 - 3000, pos: new Vec3(0, 64, -5) }; ok('над убитым - насмешка', read(g, P(), t) === 'насмешка'); }
{ const g = g0(); trace(g, 20, (i) => ({ y: i % 5 === 1 ? 64.4 : 64, ground: i % 5 === 0 })); ok('прыжки - радость', read(g) === 'радость', read(g)); }
{ const g = g0(); trace(g, 25, (i) => ({ z: -2 - i * 0.2 })); const k = read(g, P(0, -7)); ok('отошёл и оглянулся - за мной', k === 'за мной', k); }
{ const g = g0(); trace(g, 25, (i) => ({ z: -5 - i * 0.2, yaw: 0 })); const p = P(0, -10); p.yaw = 0; const k = read(g, p); ok('просто ушёл спиной - не жест', !k, k); }
{ const g = g0(); trace(g, 25, (i) => ({ x: i * 0.2, yaw: -Math.PI / 2 })); const p = P(5, -5); p.yaw = -Math.PI / 2; const k = read(g, p); ok('идёт мимо - не жест', !k, k); }
{ const g = g0(); trace(g, 12, (i) => ({ pitch: i % 4 < 2 ? 0.6 : -0.1 })); const t = mk(); read(g, P(), t); ok('повтор не чаще 4 с', !read(g, P(), t)); }
const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
console.log(`жесты: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
