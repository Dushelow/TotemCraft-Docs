// Дальний путь через Незер на стенде. node test/travel_test.js
// Обычный мир: площадки A и B в 800 блоках, у каждой портал. Незер: туннель между выходами (x/8). Бот видел оба
// портала обычного мира (карта), выходов в Незере не знает. Ждём: план «через Незер», вход в портал A, в Незере -
// к расчётной точке выхода, находит портал, выходит у B, доходит до цели; обе пары порталов запомнены; второй план
// уже по точным парам. Плюс поиск блока по чанкам.
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { WorldMap } = require('../app/worldmap');
const { Travel } = require('../app/travel');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const nether = (c) => rcon('execute in minecraft:the_nether run ' + c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, what) => { console.log((cond ? 'OK   ' : 'FAIL ') + what); if (!cond) fails++; };

const Y = 150, Z = 1200;
const AX = -696, BX = 104;                 // кратны 8: выходы в Незере ровно -87 и 13
const PNX = AX / 8, QNX = BX / 8, NZ = Z / 8, NY = 100;

function platform(x) {
  rcon(`forceload add ${x - 16} ${Z - 16} ${x + 16} ${Z + 16}`);
  rcon(`fill ${x - 12} ${Y - 1} ${Z - 12} ${x + 12} ${Y - 1} ${Z + 12} stone`);
  rcon(`fill ${x - 12} ${Y} ${Z - 12} ${x + 12} ${Y + 6} ${Z + 12} air`);
  // портал (плоскость x-y на z+4): рама 4x5, внутри 2x3
  rcon(`fill ${x - 1} ${Y} ${Z + 4} ${x + 2} ${Y + 4} ${Z + 4} obsidian`);
  rcon(`fill ${x} ${Y + 1} ${Z + 4} ${x + 1} ${Y + 3} ${Z + 4} nether_portal[axis=x]`);
}

const logLines = () => +execSync('docker exec tc-up sh -c "wc -l < /data/logs/latest.log"').toString().trim();
const flagsSince = (n) => execSync(`docker exec tc-up sh -c "tail -n +${n} /data/logs/latest.log | grep -c 'Vulcan\] TbAlex' || true"`).toString().trim();
(async () => {
  const log0 = logLines();
  rcon('difficulty peaceful'); nether('difficulty peaceful');
  platform(AX); platform(BX);
  // туннель в Незере: полая коробка из обсидиана, внутри воздух; порталы на стенке z+2
  nether(`forceload add ${PNX - 8} ${NZ - 8} ${QNX + 8} ${NZ + 8}`);
  nether(`fill ${PNX - 4} ${NY - 1} ${NZ - 3} ${QNX + 5} ${NY + 5} ${NZ + 3} obsidian hollow`);
  for (const x of [PNX, QNX]) {
    nether(`fill ${x - 1} ${NY} ${NZ + 2} ${x + 2} ${NY + 4} ${NZ + 2} obsidian`);
    nether(`fill ${x} ${NY + 1} ${NZ + 2} ${x + 1} ${NY + 3} ${NZ + 2} nether_portal[axis=x]`);
  }
  nether(`kill @e[type=!player,x=${PNX - 10},y=${NY - 5},z=${NZ - 10},dx=${QNX - PNX + 20},dy=20,dz=20]`);
  rcon(`setblock ${AX + 6} ${Y - 1} ${Z - 6} diamond_ore`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbtravel-'));
  const map = new WorldMap(dir);
  const travel = new Travel(dir, map);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.worldMap = map; tb.travel = travel;
  tb.on('log', (t) => { if (/путь|портал|запомнил|прошёл|застрял/.test(t)) console.log('   бот:', t); });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  // бот «бывал» у B: видел портал, потом вернулся к A
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${BX} ${Y} ${Z - 6}`); await sleep(5000); await map.scan(tb);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${AX} ${Y} ${Z - 6}`); await sleep(5000); await map.scan(tb);
  const known = travel.portals('overworld');
  ok(known.length >= 2, `порталы обычного мира с карты: ${known.map((p) => p.x + ' ' + p.z).join('; ')}`);

  // поиск блока
  const f = map.find(tb, 'diamond_ore');
  console.log('поиск:', f);
  ok(new RegExp(`${AX + 6} ${Y - 1} ${Z - 6}`).test(f), 'поиск нашёл алмазную руду');

  const dest = { x: BX + 8, y: Y, z: Z - 8, dim: 'обычный мир' };
  const plan = travel.plan(tb.bot.entity.position, tb.bot.game.dimension, dest);
  console.log('план:', plan.text);
  ok(/через Незер/.test(plan.text) && plan.steps[1].do === 'find_portal', 'план: через Незер, выход в Незере по расчёту');

  const t0 = Date.now();
  if (process.env.TRACE_GOAL) { const sg = tb.bot.pathfinder.setGoal; tb.bot.pathfinder.setGoal = (g, d) => { console.log('   setGoal', g && g.constructor.name, new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map((l) => l.trim()).join(' | ')); return sg(g, d); }; }
  const trace = setInterval(() => { const q = tb.bot.entity.position; console.log(`   ${Math.round((Date.now() - t0) / 1000)} с: ${tb.dimName()} ${Math.floor(q.x)} ${Math.floor(q.y)} ${Math.floor(q.z)}`); }, 8000);
  const r = await tb.run([{ act: 'travel', x: dest.x, y: dest.y, z: dest.z }], 'travel');
  clearInterval(trace);
  console.log('итог:', r, `(${Math.round((Date.now() - t0) / 1000)} с)`);
  const p = tb.bot.entity.position;
  ok(/дошёл/.test(r) && Math.hypot(p.x - dest.x, p.z - dest.z) < 4 && tb.dimName() === 'обычный мир', `дошёл до цели в обычном мире: ${Math.floor(p.x)} ${Math.floor(p.z)}`);
  await sleep(2500);
  console.log('пары:', JSON.stringify(travel.links.map((l) => [l.a, l.b])));
  ok(travel.links.length >= 2, `запомнил пары порталов: ${travel.links.length}`);
  const plan2 = travel.plan({ x: AX, z: Z }, 'overworld', dest);
  console.log('план второй раз:', plan2.text);
  ok(plan2.steps.every((s) => s.do !== 'find_portal'), 'второй раз выход известен точно');
  const desc = travel.describe(tb.bot.entity.position, tb.bot.game.dimension);
  console.log('порталы для мозга:', desc);

  const fl = +flagsSince(log0);
  ok(fl === 0, `отметок античита Vulcan за проверку: ${fl}`);
  tb.stop();
  rcon(`forceload remove ${AX - 16} ${Z - 16} ${AX + 16} ${Z + 16}`); rcon(`forceload remove ${BX - 16} ${Z - 16} ${BX + 16} ${Z + 16}`);
  nether(`forceload remove ${PNX - 8} ${NZ - 8} ${QNX + 8} ${NZ + 8}`);
  console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : '\nвсё прошло');
  setTimeout(() => process.exit(fails ? 1 : 0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
