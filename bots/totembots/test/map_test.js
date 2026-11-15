// Карта бота на стенде: домик (постройка + сундук), ферма, портал - видит и описывает. node test/map_test.js
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { WorldMap } = require('../app/worldmap');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1300, Y = 150, Z = 1300;
(async () => {
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  rcon(`fill ${X - 35} ${Y - 3} ${Z - 35} ${X + 35} ${Y - 1} ${Z + 35} stone`);
  rcon(`fill ${X - 35} ${Y} ${Z - 35} ${X + 35} ${Y + 6} ${Z + 35} air`);
  rcon(`fill ${X + 20} ${Y} ${Z - 25} ${X + 26} ${Y + 4} ${Z - 19} oak_planks hollow`);   // домик к северо-востоку
  rcon(`setblock ${X + 23} ${Y} ${Z - 22} chest`);
  rcon(`fill ${X - 25} ${Y - 1} ${Z + 15} ${X - 18} ${Y - 1} ${Z + 22} farmland`);        // ферма на юго-запад
  rcon(`fill ${X} ${Y} ${Z + 30} ${X + 3} ${Y + 4} ${Z + 30} obsidian`);
  rcon(`fill ${X + 1} ${Y + 1} ${Z + 30} ${X + 2} ${Y + 3} ${Z + 30} nether_portal[axis=x]`);  // портал на юг
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbmap-'));
  const map = new WorldMap(dir);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.worldMap = map;
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`tp TbAlex ${X} ${Y} ${Z}`); await sleep(4000);
  // самая долгая непрерывная пауза цикла событий во время скана - сколько бот «замирает»
  let worst = 0, last = Date.now(); const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 20); last = n; }, 20);
  for (let i = 0; i < 3; i++) { const t1 = Date.now(); tb.worldMap.relief(tb, 6); console.log('шаг: 6 чанков с поиском', Date.now() - t1, 'мс'); await sleep(200); }
  const t0 = Date.now(); await map.scan(tb, (v) => console.log('в память:', v.kind)); console.log('полный скан за', Date.now() - t0, 'мс, самая долгая заморозка', worst, 'мс');
  clearInterval(iv);
  console.log(map.summary(tb));
  const v = map.view(tb); console.log('для панели: чанков', v.chunks.length, 'точек', v.poi.length, 'построек', v.chunks.filter((c) => c[3] >= 30).length);
  tb.stop(); fs.rmSync(dir, { recursive: true, force: true });
  rcon(`forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  setTimeout(() => process.exit(0), 800);
})().catch((e) => { console.error(e); process.exit(1); });
