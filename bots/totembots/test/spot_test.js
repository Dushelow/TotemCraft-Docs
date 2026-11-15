// Свободное место по карте: у базы (постройки) !place без координат - сам идёт на место без построек и ставит.
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { WorldMap } = require('../app/worldmap');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbspot-'));
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.worldMap = new WorldMap(dir);
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon('clear TbAlex'); rcon('give TbAlex crafting_table 1');
  rcon('execute in minecraft:overworld run minecraft:tp TbAlex 506 69 -588'); await sleep(5000);
  await tb.worldMap.scan(tb);
  console.log(await tb.run([{ act: 'findSpot' }], 'f'));
  const t0 = Date.now();
  console.log(await tb.run([{ act: 'place', block: 'crafting_table' }], 'p'), Math.round((Date.now() - t0) / 1000) + ' с');
  tb.stop(); setTimeout(() => process.exit(0), 300);
})();
