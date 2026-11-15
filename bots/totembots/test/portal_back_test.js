// Портал туда и сразу обратно (после перехода бот стоит в портале). Порталы - из travel_test. node test/portal_back_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  rcon('forceload add -712 1188 -680 1220'); rcon('execute in minecraft:the_nether run forceload add -95 140 25 160');
  rcon('execute in minecraft:the_nether run difficulty peaceful');
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon('execute in minecraft:overworld run minecraft:tp TbAlex -696 150 1198'); await sleep(4000);
  for (let i = 1; i <= 3; i++) { const r = await tb.run([{ act: 'portal' }], 'p'); console.log(i, r); }
  tb.stop(); setTimeout(() => process.exit(0), 300);
})();
