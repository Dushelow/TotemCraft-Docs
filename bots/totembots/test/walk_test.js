// Ходьба на копии мира (стенд tc-up): TbSteve - «хозяин» ходит по базе, Алекс (TbAlex) идёт за ним, потом сам по точкам.
// Пишет все «застрял» с разбором. node test/walk_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const { goals } = require('mineflayer-pathfinder');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POINTS = [[406, 64, -691], [333, 63, -705], [505, 69, -590], [420, 64, -650], [333, 67, -777]];
(async () => {
  rcon('difficulty peaceful'); rcon('time set day');
  const stuck = [];
  const alex = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  alex.on('log', (t) => { if (/застрял:/.test(t)) { stuck.push(t); console.log('   ' + t.slice(0, 200)); } });
  let forced = 0; setTimeout(() => alex.bot.on('forcedMove', () => forced++), 8000); process.on('exit', () => console.log('откатов сервера: ' + forced));
  const steve = new TotemBot({ name: 'TbSteve', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  alex.start(); steve.start();
  await Promise.all([new Promise((r) => alex.once('event', r)), new Promise((r) => steve.once('event', r))]);
  await sleep(2000);
  rcon('execute in minecraft:overworld run minecraft:tp TbSteve 400 64 -690'); rcon('execute in minecraft:overworld run minecraft:tp TbAlex 404 64 -688');
  await sleep(4000);
  console.log('--- Алекс идёт за Стивом, Стив ходит по точкам');
  alex.run([{ act: 'follow', who: 'TbSteve' }], 'f');
  for (const [x, y, z] of POINTS.slice(0, 3)) {
    const t0 = Date.now();
    try { await steve.goto(new goals.GoalNear(x, y, z, 2), steve.token, 120000); } catch (e) { console.log('   Стив не дошёл:', e.message); }
    const d = alex.bot.entity.position.distanceTo(steve.bot.entity.position);
    console.log(`Стив у ${x} ${z} за ${Math.round((Date.now() - t0) / 1000)} с, Алекс в ${d.toFixed(1)} бл.`);
    await sleep(8000);   // Стив стоит - Алекс не должен «застревать»
  }
  alex.run([{ act: 'stop' }], 's');
  console.log('--- Алекс сам по точкам');
  for (const [x, y, z] of POINTS) {
    const t0 = Date.now();
    const r = await alex.run([{ act: 'goto', x, y, z }], 'g');
    const p = alex.bot.entity.position;
    console.log(`к ${x} ${y} ${z}: ${r.slice(0, 60)} за ${Math.round((Date.now() - t0) / 1000)} с (стоит ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)})`);
  }
  console.log(`\nзастреваний: ${stuck.length}`);
  alex.stop(); steve.stop(); setTimeout(() => process.exit(0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
