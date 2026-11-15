// Плавание: бассейн 24 блока, проплыть поперёк; пишет высоту, скорость, клавиши, откаты сервера.
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1100, Y = 62, Z = 800;
(async () => {
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`);
  rcon(`fill ${X - 14} ${Y - 5} ${Z - 4} ${X + 14} ${Y + 6} ${Z + 4} air`);
  rcon(`fill ${X - 14} ${Y - 5} ${Z - 4} ${X + 14} ${Y - 5} ${Z + 4} sand`);
  rcon(`fill ${X - 12} ${Y - 4} ${Z - 4} ${X + 12} ${Y} ${Z + 4} water`);
  rcon(`fill ${X - 14} ${Y - 4} ${Z - 4} ${X - 13} ${Y} ${Z + 4} sand`); rcon(`fill ${X + 13} ${Y - 4} ${Z - 4} ${X + 14} ${Y} ${Z + 4} sand`);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X - 14} ${Y + 1} ${Z}`); await sleep(3000);
  const b = tb.bot; let forced = 0; b.on('forcedMove', () => forced++);
  const rows = []; const iv = setInterval(() => { const p = b.entity.position, v = b.entity.velocity; rows.push(`${p.x.toFixed(2)} y${p.y.toFixed(2)} vx${v.x.toFixed(2)} vy${v.y.toFixed(2)} ${b.getControlState('forward') ? 'F' : '-'}${b.getControlState('jump') ? 'J' : '-'}${b.getControlState('sprint') ? 'S' : '-'} yaw${b.entity.yaw.toFixed(2)} inW${b.entity.isInWater ? 1 : 0} f${forced}`); }, 100);
  const t0 = Date.now();
  const r = await tb.run([{ act: 'goto', x: X + 14, y: Y + 1, z: Z }], 'g');
  clearInterval(iv);
  console.log(rows.filter((_, i) => i % 3 === 0).join('\n'));
  console.log(r, Math.round((Date.now() - t0) / 1000) + ' с', 'откатов', forced);
  tb.stop(); rcon(`forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`); setTimeout(() => process.exit(0), 300);
})();
