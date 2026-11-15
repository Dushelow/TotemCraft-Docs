// Выход из воды на уступ: сам доплывает до берега и выходит; отметок Vulcan 0. node test/shore_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1100, Y = 62, Z = 800;
(async () => {
  const log0 = +execSync('docker exec tc-up sh -c "wc -l < /data/logs/latest.log"').toString().trim();
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`);
  rcon(`fill ${X - 12} ${Y - 4} ${Z - 12} ${X + 12} ${Y + 8} ${Z + 12} air`);
  rcon(`fill ${X - 12} ${Y - 4} ${Z - 12} ${X + 12} ${Y - 4} ${Z + 12} sand`);
  rcon(`fill ${X - 12} ${Y - 3} ${Z - 12} ${X} ${Y} ${Z + 12} water`);
  rcon(`fill ${X + 1} ${Y - 3} ${Z - 12} ${X + 12} ${Y} ${Z + 12} sand`);
  rcon(`fill ${X - 3} ${Y - 3} ${Z - 12} ${X} ${Y - 1} ${Z + 12} sand`);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.on('log', (t) => /берег|вылез|вышел/.test(t) && console.log('   бот:', t));
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X - 2} ${Y} ${Z}`);
  for (let i = 0; i < 60; i++) { await sleep(1000); const f = tb.bot.blockAt(tb.bot.entity.position); if (f && f.name !== 'water' && i > 3) break; }
  const f = tb.bot.blockAt(tb.bot.entity.position);
  console.log((f.name !== 'water' ? 'OK   ' : 'FAIL ') + 'вышел на берег: ' + f.name);
  await sleep(2000);
  const fl = execSync(`docker exec tc-up sh -c "tail -n +${log0} /data/logs/latest.log | grep 'Vulcan\] TbAlex' || true"`).toString().trim();
  console.log((!fl ? 'OK   ' : 'FAIL ') + 'отметок Vulcan ' + (fl ? fl.split('\n').length + ':\n' + fl : 'нет'));
  tb.stop(); rcon(`forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`); setTimeout(() => process.exit(0), 300);
})();
