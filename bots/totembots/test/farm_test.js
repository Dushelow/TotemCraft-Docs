// Огород на стенде: мотыга и семена -> вспахать и посадить 3 клетки. node test/farm_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1200, Y = 150, Z = 1000;
(async () => {
  rcon(`forceload add ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`);
  rcon(`fill ${X - 10} ${Y - 1} ${Z - 10} ${X + 10} ${Y - 1} ${Z + 10} grass_block`);
  rcon(`fill ${X - 10} ${Y} ${Z - 10} ${X + 10} ${Y + 5} ${Z + 10} air`);
  rcon(`setblock ${X + 2} ${Y - 1} ${Z} water`);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon('clear TbAlex'); rcon('give TbAlex wooden_hoe 1'); rcon('give TbAlex wheat_seeds 5');
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X} ${Y} ${Z}`); await sleep(3000);
  console.log('инвентарь:', tb.bot.inventory.items().map((i) => i.name + ' x' + i.count).join(', '));
  console.log(await tb.run([{ act: 'farm', item: 'wheat_seeds', count: 3 }], 'f'));
  tb.stop(); rcon(`forceload remove ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`); setTimeout(() => process.exit(0), 300);
})();
