// Проверка тела бота на стенде tc-up (порт 25566), без Qwen: вход и AuthMe, хождение за игроком,
// взять шерсть из сундука, отдать игроку. Запуск: node test/body_test.js
const mineflayer = require('mineflayer');
const { execSync } = require('child_process');
const { TotemBot, clickActionPacket } = require('../app/bot');

const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1300, Y = 150, Z = 1300;   // граница мира стенда ±1500

(async () => {
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  rcon(`fill ${X - 30} ${Y - 1} ${Z - 30} ${X + 30} ${Y - 1} ${Z + 30} stone`);
  rcon(`fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 4} ${Z + 30} air`);
  rcon(`setblock ${X + 10} ${Y} ${Z} chest`);
  // /item перехватывает Essentials, поэтому сундук наполняем через data merge
  rcon(`data merge block ${X + 10} ${Y} ${Z} {Items:[{Slot:0b,id:"minecraft:white_wool",count:64},{Slot:1b,id:"minecraft:white_wool",count:64},{Slot:2b,id:"minecraft:white_wool",count:64}]}`);

  // игрок-хозяин: простой робот, его двигаем телепортом
  const owner = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'TbOwner', version: '1.21.11', auth: 'offline' });
  owner.on('physicsTick', () => { try { owner._client.write('tick_end', {}); } catch {} });
  owner._client.on('show_dialog', (d) => { const id = (JSON.stringify(d).match(/"(authme:[^"]*submit)"/) || [])[1]; if (id) owner._client.writeRaw(clickActionPacket(id, { password: { type: 'string', value: 'Tb12345x' } })); });
  owner.on('messagestr', (m) => { if (/\/reg/i.test(m)) owner.chat('/register Tb12345x Tb12345x'); else if (/\/l(ogin)?\b/i.test(m)) owner.chat('/login Tb12345x'); });
  owner.on('kicked', (r) => console.log('хозяина кикнули', JSON.stringify(r).slice(0, 200)));
  await new Promise((r) => owner.once('spawn', r));
  console.log('хозяин зашёл');
  rcon('minecraft:clear TbOwner');   // шерсть с прошлых прогонов
  await sleep(4000);

  const bot = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566 });
  bot.on('log', (t) => console.log('[бот]', t));
  bot.on('event', (e) => console.log('[событие]', e.text));
  bot.on('chat', (t) => { if (/проверка/.test(t)) console.log('[сырой чат]', JSON.stringify(t), Object.keys(bot.bot.players)); });
  bot.on('player-chat', (m) => console.log('[чат игрока]', JSON.stringify(m)));
  bot.start();
  await new Promise((r) => bot.once('event', r));
  await sleep(5000);

  rcon(`execute in minecraft:overworld run tp TbOwner ${X} ${Y} ${Z}`);
  rcon(`execute in minecraft:overworld run tp TbAlex ${X - 5} ${Y} ${Z - 5}`);
  rcon('gamemode survival TbAlex');
  await sleep(3000);
  owner.chat('проверка чата TbAlex');
  await sleep(1500);

  console.log('1) follow:', await bot.run([{ act: 'follow', who: 'TbOwner' }]));
  rcon(`tp TbOwner ${X - 20} ${Y} ${Z + 15}`);
  await sleep(12000);
  const d1 = bot.bot.entity.position.distanceTo(bot.player('TbOwner').position);
  console.log('   расстояние до хозяина после его ухода на 25 блоков:', d1.toFixed(1), d1 < 5 ? 'OK' : 'FAIL');

  rcon(`tp TbOwner ${X} ${Y} ${Z - 10}`);
  await sleep(3000);
  const r2 = await bot.run([{ act: 'take', x: X + 10, y: Y, z: Z, item: 'white_wool', count: 128 }, { act: 'give', who: 'TbOwner', item: 'white_wool', count: 128 }], 'шерсть');
  console.log('2) take+give:', r2);
  await sleep(3000);
  await sleep(3000);
  console.log('   у хозяина по серверу:', (rcon('data get entity TbOwner Inventory').match(/white_wool[^}]*count: (\d+)/g) || []).join(' | '));
  console.log('   шерсть на земле:', rcon('execute if entity @e[type=item,nbt={Item:{id:"minecraft:white_wool"}}]'));
  const has = owner.inventory.items().filter((i) => i.name === 'white_wool').reduce((s, i) => s + i.count, 0);
  console.log('   у хозяина шерсти:', has, has === 128 ? 'OK' : 'FAIL');
  console.log('   в сундуке осталось:', rcon(`data get block ${X + 10} ${Y} ${Z} Items`).replace(/.*: /, '').slice(0, 120));
  console.log('3) состояние:', bot.stateText());
  bot.stop(); owner.quit();
  rcon(`forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  setTimeout(() => process.exit(0), 1000);
})().catch((e) => { console.error(e); process.exit(1); });
