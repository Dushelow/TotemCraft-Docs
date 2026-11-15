// Свобода: срубить дерево, скрафтить доски и верстак, поставить; чужое не ломать; отметок Vulcan 0. node test/free_test.js
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { Memory } = require('../app/memory');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, w) => { console.log((c ? 'OK   ' : 'FAIL ') + w); if (!c) fails++; };
const X = 1200, Y = 150, Z = 900;
(async () => {
  const log0 = +execSync('docker exec tc-up sh -c "wc -l < /data/logs/latest.log"').toString().trim();
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 20} ${Z - 20} ${X + 20} ${Z + 20}`);
  rcon(`fill ${X - 20} ${Y - 1} ${Z - 20} ${X + 20} ${Y - 1} ${Z + 20} grass_block`);
  rcon(`fill ${X - 20} ${Y} ${Z - 20} ${X + 20} ${Y + 12} ${Z + 20} air`);
  await sleep(1500); console.log(rcon(`place feature minecraft:oak ${X + 5} ${Y} ${Z}`));
  rcon(`fill ${X - 8} ${Y} ${Z - 2} ${X - 6} ${Y + 2} ${Z} oak_planks`);   // «чужой» сруб с бревном внутри
  rcon(`setblock ${X - 7} ${Y + 3} ${Z - 1} oak_log`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbfree-'));
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.memory = new Memory(dir);
  tb.on('log', (t) => { if (/добыл|скрафтил|поставил|не ломаю|сломал/.test(t)) console.log('   бот:', t); });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`clear TbAlex`);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X} ${Y} ${Z}`); await sleep(4000);
  let r = await tb.run([{ act: 'gather', block: 'log', count: 4 }], 'g'); console.log('итог:', r);
  const logs = tb.bot.inventory.items().filter((i) => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
  ok(logs >= 4, `срубил брёвен: ${logs}`);
  ok(/oak_log/.test(rcon(`execute if block ${X - 7} ${Y + 3} ${Z - 1} minecraft:oak_log`) ? 'oak_log' : '') , 'бревно на чужом срубе цело');
  r = await tb.run([{ act: 'craft', item: 'oak_planks', count: 8 }, { act: 'craft', item: 'crafting_table' }, { act: 'place', block: 'crafting_table' }], 'c'); console.log('итог:', r);
  ok(/поставил crafting_table/.test(r), 'доски, верстак скрафчены и поставлены');
  r = await tb.run([{ act: 'break', x: X - 7, y: Y + 1, z: Z - 2 }], 'b'); console.log('итог:', r);
  ok(/не ломаю/.test(r), 'чужие доски ломать отказался');
  await sleep(2000);
  const fl = execSync(`docker exec tc-up sh -c "tail -n +${log0} /data/logs/latest.log | grep 'Vulcan\] TbAlex' || true"`).toString().trim();
  ok(!fl, 'отметок Vulcan нет' + (fl ? ':\n' + fl : ''));
  tb.stop(); rcon(`forceload remove ${X - 20} ${Z - 20} ${X + 20} ${Z + 20}`);
  console.log(fails ? `НЕ ПРОШЛО: ${fails}` : 'всё прошло'); setTimeout(() => process.exit(fails ? 1 : 0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
