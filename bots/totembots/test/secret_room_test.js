// Секретная комната владельца в копии мира (стенд tc-up, 26.3): бот внизу у двери с плитой, задание «выйти наружу».
// Проход: дверь (плита с той стороны) -> лестница вверх с люками -> кнопка у секретной стены -> лестница -> наружу.
// node test/secret_room_test.js [x y z старта]
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const [SX, SY, SZ] = process.argv.length >= 5 ? process.argv.slice(2, 5).map(Number) : [205, 50, -579];

(async () => {
  try { rcon('authme register TbAlex Tb12345x'); } catch {}
  rcon('forceload add 180 -610 240 -550');
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off', version: '26.1' });
  { const { Memory } = require('../app/memory'); const d = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tbmem-')); tb.memory = new Memory(d); }
  const t0 = Date.now();
  tb.on('log', (t) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), t.slice(0, 200)));
  tb.start();
  for (let i = 0; i < 160 && !(tb.bot && tb.bot.entity && tb.bot.player); i++) await sleep(250);
  await sleep(2000);
  try { await tb.run([{ act: 'stand' }], 'стоять', 'master'); } catch {} tb.mode = 'hold';
  rcon('gamemode survival TbAlex'); rcon('effect give TbAlex minecraft:resistance 600 4 true');
  for (let i = 0; i < 10; i++) { rcon(`execute in minecraft:overworld run tp TbAlex ${SX + 0.5} ${SY} ${SZ + 0.5}`); await sleep(1000); const p = tb.bot.entity.position; if (Math.abs(p.x - SX - 0.5) < 1 && Math.abs(p.z - SZ - 0.5) < 1) break; }
  await sleep(3000);
  console.log('старт', tb.bot.entity.position.toString());
  let r;
  const ACT = process.env.ACT ? JSON.parse(process.env.ACT) : [{ act: 'outside' }];
  try { r = await tb.run(ACT, 'тест', 'master'); } catch (e) { r = 'ошибка: ' + e.message; }
  const p = tb.bot.entity.position;
  console.log('ИТОГ:', r, '| стою', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1));
  tb.stop && tb.stop();
  process.exit(0);
})();
