const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [sx, sy, sz, tx, ty, tz] = process.argv.slice(2).map(Number);
(async () => {
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.on('log', (t) => /застрял:/.test(t) && console.log(t.slice(0, 260)));
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${sx} ${sy} ${sz}`); await sleep(3000);
  const b = tb.bot; let forced = 0; b.on('forcedMove', () => forced++);
  let n = 0; const iv = setInterval(() => { if (n++ % 5 === 0) console.log('  ', b.entity.position.x.toFixed(1), b.entity.position.y.toFixed(2), b.entity.position.z.toFixed(1), 'gnd', b.entity.onGround, 'fwd', b.getControlState('forward'), 'jump', b.getControlState('jump'), 'путь', (tb.lastPath || {}).status, ((tb.lastPath || {}).path || []).length); }, 200);
  const t0 = Date.now();
  const r = await tb.run([{ act: 'goto', x: tx, y: ty, z: tz }], 'g');
  clearInterval(iv); console.log(r, Math.round((Date.now() - t0) / 1000) + ' с', 'откатов', forced);
  tb.stop(); setTimeout(() => process.exit(0), 300);
})();
