// Живая проверка на стенде 26.3 (tc-up, порт 25566, Vulcan как на боевом): плавание за хозяином.
//   1) хозяин на дне бассейна глубиной 8 - бот должен нырнуть к нему;
//   2) хозяин на берегу - бот должен выйти из воды быстро;
//   3) всё время - сколько раз бот нажимал прыжок и отметки Vulcan.
// node test/live_swim_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1200, Y = 62, Z = 900;   // уровень воды - Y (верх воды на Y+0.9)
const res = []; const ok = (n, c, i) => { res.push([n, !!c]); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };

(async () => {
  const log0 = +execSync('docker exec tc-up sh -c "wc -l < /data/logs/latest.log"').toString().trim();
  try { rcon('authme register TbOwner Tb12345x'); } catch {}
  try { rcon('authme register TbAlex Tb12345x'); } catch {}
  rcon(`forceload add ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`);
  rcon(`fill ${X - 20} ${Y - 9} ${Z - 20} ${X + 20} ${Y + 8} ${Z + 20} air`);
  rcon(`fill ${X - 20} ${Y - 9} ${Z - 20} ${X + 20} ${Y - 9} ${Z + 20} sand`);
  rcon(`fill ${X - 20} ${Y - 8} ${Z - 20} ${X + 8} ${Y} ${Z + 20} water`);      // бассейн глубиной 8 (запад)
  rcon(`fill ${X + 9} ${Y - 8} ${Z - 20} ${X + 20} ${Y} ${Z + 20} sand`);        // берег (восток), вровень с водой
  const owner = new TotemBot({ name: 'TbOwner', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off', features: { companion: false, gestures: false } });
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  const logs = [];
  tb.on('log', (t) => { logs.push(t); if (/вод|берег|ныр|воздух|не видно|застрял/.test(t)) console.log('   бот:', t); });
  owner.start(); await new Promise((r) => owner.once('event', r)); await sleep(1500);
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon('gamemode creative TbOwner'); rcon('effect give TbOwner minecraft:water_breathing infinite 0 true');
  rcon('gamemode survival TbAlex'); rcon('effect clear TbAlex');
  // 1. хозяин на дне, бот на поверхности в 8 бл.
  owner.bot.physicsEnabled = false;   // «хозяин» стоит на дне сам, не всплывает (его тело не плавает)
  rcon(`execute in minecraft:overworld run minecraft:tp TbOwner ${X - 6} ${Y - 7} ${Z}`);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X + 2} ${Y + 0.3} ${Z}`);
  await sleep(2000);
  console.log('   хозяин на высоте', owner.bot.entity.position.y.toFixed(2));
  tb.follow('TbOwner');
  let minY = 99, jumps = 0, last = false, near = 0;
  for (let i = 0; i < 25 * 20; i++) {
    await sleep(50);
    const b = tb.bot; if (!b || !b.entity) continue;
    minY = Math.min(minY, b.entity.position.y);
    const j = b.getControlState('jump') && tb._waterBy === 'плыву'; if (j && !last) jumps++; last = j;   // прыжки в пути (всплыть за воздухом - не в счёт)
    const o = owner.bot && owner.bot.entity; if (o && b.entity.position.distanceTo(o.position) < 4) near++;
  }
  ok('нырнул к хозяину на дно (глубже 57)', minY < Y - 5, `самая низкая высота ${minY.toFixed(2)}, рядом с хозяином ${(near / 20).toFixed(1)} с`);
  ok('в пути не дёргает прыжок (меньше 8 нажатий за 25 с: держаться на плаву у поверхности - можно)', jumps < 8, `${jumps} нажатий`);
  // 2. хозяин на берегу - бот выходит
  rcon(`execute in minecraft:overworld run minecraft:tp TbOwner ${X + 12} ${Y + 1} ${Z}`);
  const t0 = Date.now(); let out = 0;
  for (let i = 0; i < 40 * 4; i++) { await sleep(250); const b = tb.bot; const f = b && b.entity && b.blockAt(b.entity.position); if (f && !/water/.test(f.name) && b.entity.onGround) { out = Date.now() - t0; break; } }
  ok('вышел на берег к хозяину (до 20 с)', out && out < 20000, out ? `${(out / 1000).toFixed(1)} с` : 'не вышел за 40 с');
  await sleep(1500);
  const fl = execSync(`docker exec tc-up sh -c "tail -n +${log0} /data/logs/latest.log | grep 'Vulcan\\] TbAlex' || true"`).toString().trim();
  // 3. стена из воды (борт), лианы на ней, хозяин наверху - залезть по лианам
  rcon(`fill ${X - 20} ${Y + 1} ${Z - 20} ${X + 20} ${Y + 8} ${Z + 20} air`);
  rcon(`fill ${X - 4} ${Y - 8} ${Z - 6} ${X - 4} ${Y + 6} ${Z + 6} oak_planks`);                 // борт
  rcon(`fill ${X - 10} ${Y + 6} ${Z - 6} ${X - 4} ${Y + 6} ${Z + 6} oak_planks`);                // палуба
  rcon(`fill ${X - 3} ${Y + 1} ${Z} ${X - 3} ${Y + 6} ${Z} minecraft:vine[west=true]`);           // лианы над водой
  rcon(`execute in minecraft:overworld run minecraft:tp TbOwner ${X - 7} ${Y + 7} ${Z}`);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X + 4} ${Y + 0.3} ${Z + 2}`);
  await sleep(1500); tb.follow('TbOwner');
  let up = 0; const t1 = Date.now();
  for (let i = 0; i < 45 * 4; i++) { await sleep(250); const b = tb.bot; if (b && b.entity && b.entity.position.y > Y + 6.5) { up = Date.now() - t1; break; } }
  ok('по лианам из воды на палубу к хозяину (до 30 с)', up && up < 30000, up ? `${(up / 1000).toFixed(1)} с` : 'не залез за 45 с');
  ok('отметок Vulcan нет', !fl, fl ? fl.split('\n').length + ': ' + fl.split('\n').slice(0, 5).join(' | ') : '');
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'local', 'logs', 'live_swim_test.log'), logs.join('\n'));
  console.log(`--- плавание на стенде: ${res.filter((r) => r[1]).length} из ${res.length}`);
  tb.stop(); owner.stop(); rcon(`forceload remove ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`);
  setTimeout(() => process.exit(0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
