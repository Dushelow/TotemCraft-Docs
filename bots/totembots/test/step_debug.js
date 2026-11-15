const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1200, Y = 150, Z = 1000;
(async () => {
  rcon(`forceload add ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`);
  rcon(`fill ${X - 10} ${Y - 1} ${Z - 10} ${X + 10} ${Y - 1} ${Z + 10} stone`);
  rcon(`fill ${X - 10} ${Y} ${Z - 10} ${X + 10} ${Y + 5} ${Z + 10} air`);
  if (!process.env.FLAT) rcon(`fill ${X + 3} ${Y} ${Z - 10} ${X + 10} ${Y} ${Z + 10} stone`);   // ступенька в 1 блок на востоке
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X} ${Y} ${Z}`); await sleep(3000);
  const b = tb.bot;
  let forced = 0; b.on('forcedMove', () => { forced++; }); b._client.on('position', (p) => { if (forced < 4) console.log('   пакет position', JSON.stringify(p).slice(0, 300)); });
  let n = 0; const iv = setInterval(() => { if (n++ < 60) console.log(b.entity.position.x.toFixed(2), b.entity.position.y.toFixed(2), 'gnd', b.entity.onGround, 'jump', b.getControlState('jump'), 'fwd', b.getControlState('forward'), 'vy', b.entity.velocity.y.toFixed(2)); }, 100);
  const r = await tb.run([{ act: 'goto', x: X + 6, y: process.env.FLAT ? Y : Y + 1, z: Z }], 'g');
  clearInterval(iv); console.log(r, b.entity.position.toString(), 'поправок сервера:', forced);
  tb.stop(); rcon(`forceload remove ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`); setTimeout(() => process.exit(0), 300);
})();
