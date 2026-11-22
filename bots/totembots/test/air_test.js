const { Vec3 } = require(require('path').resolve(__dirname, '../node_modules') + '/vec3');
const { airTick } = require('../app/swim');
// океан: вода y 50..62, над ней воздух; днище корабля y 61..62 над x -5..5 (сплошь доски); бот под днищем в 0 58 0
const blockAt = (v) => { v = v.floored ? v.floored() : v; const hull = v.x >= -5 && v.x <= 5 && v.z >= -3 && v.z <= 3 && v.y >= 61 && v.y <= 64;
  const n = hull ? 'oak_planks' : v.y <= 62 && v.y >= 50 ? 'water' : v.y < 50 ? 'stone' : 'air'; return { name: n, position: new Vec3(v.x, v.y, v.z), boundingBox: n === 'air' || n === 'water' ? 'empty' : 'block' }; };
const ctl = {}, logs = [];
const tb = { bot: { entity: { position: new Vec3(0.5, 58, 0.5), velocity: new Vec3(0, 0, 0) }, blockAt, oxygenLevel: 5, food: 20, entities: {}, setControlState: (k, v) => { ctl[k] = v; }, getControlState: (k) => !!ctl[k], look: () => {} }, log: (t) => logs.push(t) };
const r = airTick(tb);
const g = tb._airEsc && tb._airEsc.goal, ok = r && g && (g.x < -5 || g.x > 6 || g.z < -3 || g.z > 4);
console.log((ok ? 'да ' : 'НЕТ') + ' под днищем, воздуха мало - всплывает мимо днища: ' + JSON.stringify(g));
console.log('--- воздух под водой: ' + (ok ? 1 : 0) + ' из 1'); process.exitCode = ok ? 0 : 1;

// 2. открытая вода, но прямо над головой лодка (шлюпка у борта) - всплывать не под ней (22.11: утонул под лодкой)
{
  const blockAt2 = (v) => { v = v.floored ? v.floored() : v; const n = v.y <= 62 && v.y >= 50 ? 'water' : v.y < 50 ? 'stone' : 'air'; return { name: n, position: new Vec3(v.x, v.y, v.z), boundingBox: n === 'air' || n === 'water' ? 'empty' : 'block' }; };
  const ctl2 = {};
  const tb2 = { bot: { entity: { position: new Vec3(20.5, 60, 20.5), velocity: new Vec3(0, 0, 0) }, blockAt: blockAt2, oxygenLevel: 5, food: 20,
    entities: { 7: { name: 'pale_oak_boat', position: new Vec3(20.5, 62.4, 20.5), width: 1.375, height: 0.5625 } }, setControlState: (k, v) => { ctl2[k] = v; }, getControlState: (k) => !!ctl2[k], look: () => {} }, log: () => {} };
  airTick(tb2);
  const g2 = tb2._airEsc && tb2._airEsc.goal, ok2 = g2 && (Math.abs(g2.x - 20.5) >= 1.5 || Math.abs(g2.z - 20.5) >= 1.5);
  console.log((ok2 ? 'да ' : 'НЕТ') + ' лодка над головой - всплывает рядом, не под ней: ' + JSON.stringify(g2));
  if (!ok2) process.exitCode = 1;
}
