// Мелкие умения (chores.js) и подход к жителю (trade.js GoalReach): присед у обрыва, уворот, разведение с пределом.
const path = require('path');
const { Vec3 } = require(path.resolve(__dirname, '../node_modules') + '/vec3');
const { Chores } = require('../app/chores');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const W = new Map(); const set = (x, y, z, n) => W.set(`${x},${y},${z}`, n);
const blk = (v) => { const n = W.get(`${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`) || 'air'; return { name: n, position: new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)), boundingBox: n === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; };
for (let x = -5; x <= 0; x++) for (let z = -5; z <= 5; z++) set(x, 63, z, 'stone');   // площадка, восточнее x=0 обрыв
const ctl = {};
const t = Object.create(Chores.prototype);
Object.assign(t, { log() {}, bot: { entity: { position: new Vec3(0.8, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, pathfinder: { isMoving: () => false }, blockAt: blk, setControlState: (k, v) => { ctl[k] = v; }, getControlState: (k) => !!ctl[k], entities: {} }, standOk: (x, y, z) => blk(new Vec3(x, y - 1, z)).boundingBox === 'block' });
t.edgeTick(); ok('у обрыва стоит - присела', ctl.sneak === true);
t.bot.entity.position = new Vec3(-3.5, 64, 0.5); t.edgeTick(); ok('отошла от края - встала', ctl.sneak === false);
t.bot.pathfinder.isMoving = () => true; t.bot.entity.position = new Vec3(0.8, 64, 0.5); t.edgeTick(); ok('идёт - не приседает', ctl.sneak === false);
// стрела летит в неё с запада
t.bot.entity.position = new Vec3(-2.5, 64, 0.5); t.bot.entity.velocity = new Vec3(0, 0, 0);
t.bot.entities = { 1: { name: 'arrow', position: new Vec3(-12, 65, 0.5), velocity: new Vec3(1.5, 0, 0) } };
t.dodgeTick(); ok('стрела в неё - шаг вбок', Math.abs(t.bot.entity.velocity.z) > 0.2, t.bot.entity.velocity.z.toFixed(2));
t._dodgeAt = 0; t.bot.entity.velocity = new Vec3(0, 0, 0); t.bot.entities = { 1: { name: 'arrow', position: new Vec3(-12, 65, 6), velocity: new Vec3(1.5, 0, 0) } };
t.dodgeTick(); ok('стрела мимо - стоит', t.bot.entity.velocity.z === 0);
// разведение: в стаде предел
const cows = {}; for (let i = 0; i < 12; i++) cows[i] = { id: i, name: 'cow', position: new Vec3(i % 4, 64, Math.floor(i / 4)), metadata: [] };
Object.assign(t.bot, { entities: cows, inventory: { items: () => [{ name: 'wheat', count: 20 }] } });
t.breed({ animal: 'коровы' }, 0).then((r) => {
  ok('12 коров - не разводит', /уже 12/.test(r), r);
  // подход к жителю за прилавком: стена из полублоков не мешает, каменная - мешает
  const { GoalReach } = (() => { const m = require('../app/trade'); return { GoalReach: m.GoalReach }; })();
  if (GoalReach) {
    W.clear(); set(2, 64, 0, 'oak_slab');
    const vil = { position: new Vec3(3.5, 64, 0.5) };
    const g = new GoalReach({ blockAt: (v) => { const b = blk(v); if (/_slab/.test(b.name)) b.boundingBox = 'block'; return b; } }, vil);
    ok('через прилавок дотянуться можно', g.isEnd({ x: 1, y: 64, z: 0 }));
    set(2, 65, 0, 'stone'); set(2, 64, 0, 'stone');
    ok('через стену - нельзя', !g.isEnd({ x: 1, y: 64, z: 0 }));
  } else ok('GoalReach выгружен', false);
  const bad = res.filter((r) => !r[1]); for (const r of res) console.log(`${r[1] ? 'да ' : 'НЕТ'} ${r[0]}${r[2] !== undefined ? ' - ' + r[2] : ''}`);
  console.log(`--- мелкие умения: ${res.length - bad.length} из ${res.length}`);
  process.exitCode = bad.length ? 1 : 0;
});
