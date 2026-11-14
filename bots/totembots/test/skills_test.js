// Навыки на стенде tc-up без Qwen: урожай с посадкой обратно, подбор вещей у места смерти, переподключение после кика.
// Запуск: node test/skills_test.js
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1300, Y = 150, Z = 1300;
const blockAt = (x, y, z) => (rcon(`execute if block ${x} ${y} ${z} wheat[age=0]`).includes('passed') ? 'росток' : rcon(`execute if block ${x} ${y} ${z} wheat[age=7]`).includes('passed') ? 'спелая' : 'пусто');

(async () => {
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  rcon(`fill ${X - 30} ${Y - 1} ${Z - 30} ${X + 30} ${Y - 1} ${Z + 30} stone`);
  rcon(`fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 4} ${Z + 30} air`);
  rcon('minecraft:kill @e[type=item,x=1300,y=150,z=1300,distance=..60]');
  // грядка 3x3 вокруг воды, спелая пшеница; рядом дубовые доски (постройка, трогать нельзя)
  rcon(`fill ${X + 4} ${Y - 1} ${Z + 4} ${X + 6} ${Y - 1} ${Z + 6} farmland[moisture=7]`);
  rcon(`setblock ${X + 5} ${Y - 1} ${Z + 5} water`);
  rcon(`fill ${X + 4} ${Y} ${Z + 4} ${X + 6} ${Y} ${Z + 6} wheat[age=7]`);
  rcon(`setblock ${X + 5} ${Y} ${Z + 5} air`);
  rcon(`setblock ${X + 8} ${Y} ${Z + 5} oak_planks`);

  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566 });
  tb.on('log', (t) => { if (!/^\[чат\]|надел|тотем/.test(t)) console.log('[бот]', t); });
  tb.start();
  await new Promise((r) => tb.once('event', r));
  await sleep(2000);
  rcon(`tp TbAlex ${X} ${Y} ${Z}`);
  rcon('gamemode survival TbAlex');
  rcon('minecraft:clear TbAlex');
  await sleep(2000);

  console.log('\n== урожай');
  console.log(await tb.run([{ act: 'harvest', radius: 12 }], 'урожай'));
  let ok = 0;
  for (let dx = 4; dx <= 6; dx++) for (let dz = 4; dz <= 6; dz++) if (!(dx === 5 && dz === 5) && blockAt(X + dx, Y, Z + dz) === 'росток') ok++;
  console.log('посажено обратно (ростков):', ok, 'из 8 | доски целы:', rcon(`execute if block ${X + 8} ${Y} ${Z + 5} oak_planks`).includes('passed'));
  const inv = {}; for (const i of tb.bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
  console.log('в инвентаре:', JSON.stringify(inv));

  console.log('\n== вещи у места смерти');
  tb.deathPoint = { x: X - 10, y: Y, z: Z - 10, dim: tb.bot.game.dimension, at: Date.now() };
  rcon(`summon item ${X - 10} ${Y} ${Z - 10} {Item:{id:"minecraft:diamond_pickaxe",count:1}}`);
  rcon(`summon item ${X - 12} ${Y} ${Z - 9} {Item:{id:"minecraft:iron_ingot",count:20}}`);
  rcon(`summon item ${X - 8} ${Y} ${Z - 11} {Item:{id:"minecraft:bread",count:5}}`);
  console.log(await tb.run([{ act: 'recover' }], 'вещи'));
  console.log('кирка у бота:', !!tb.bot.inventory.items().find((i) => i.name === 'diamond_pickaxe'), '| на земле осталось:',
    rcon(`execute if entity @e[type=item,x=${X - 10},y=${Y},z=${Z - 10},distance=..8]`));

  console.log('\n== переподключение после кика');
  rcon('kick TbAlex проверка');
  await sleep(1000);
  for (let i = 0; i < 40 && tb.status !== 'online'; i++) await sleep(1000);
  await sleep(2000);
  console.log('снова на сервере:', tb.status === 'online');
  tb.stop();
  rcon(`forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  setTimeout(() => process.exit(0), 1000);
})().catch((e) => { console.error(e); process.exit(1); });
