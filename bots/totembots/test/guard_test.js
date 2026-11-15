// Защита на стенде tc-up: бот с железным мечом идёт за хозяином, рядом зомби, крипер, зомби-пиглин.
// Ждём: зомби убиты, от крипера бот отошёл, пиглина не тронул, броня и тотем надеты сами. Запуск: node test/guard_test.js
const mineflayer = require('mineflayer');
const { execSync } = require('child_process');
const { TotemBot, clickActionPacket } = require('../app/bot');

const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1300, Y = 150, Z = 1300;
const count = (sel) => +((rcon(`execute if entity ${sel}`).match(/Count: (\d+)/) || [])[1] || 0);

(async () => {
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  rcon(`fill ${X - 30} ${Y - 1} ${Z - 30} ${X + 30} ${Y - 1} ${Z + 30} stone`);
  rcon(`fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 4} ${Z + 30} air`);
  rcon('difficulty peaceful');   // мобы с прошлых прогонов исчезают
  rcon('minecraft:kill @e[type=!player,distance=..60,x=1300,y=150,z=1300]');

  const owner = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'TbOwner', version: '1.21.11', auth: 'offline' });
  owner._client.on('show_dialog', (d) => { const id = (JSON.stringify(d).match(/"(authme:[^"]*submit)"/) || [])[1]; if (id) owner._client.writeRaw(clickActionPacket(id, { password: { type: 'string', value: 'Tb12345x' } })); });
  owner.on('physicsTick', () => { try { owner._client.write('tick_end', {}); } catch {} });
  await new Promise((r) => owner.once('spawn', r));
  await sleep(2000);
  rcon(`tp TbOwner ${X} ${Y} ${Z}`);
  rcon('gamemode creative TbOwner');   // мобы целятся в бота

  await sleep(4000);   // сервер не пускает два входа подряд чаще раза в 4 с
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566 });
  tb.on('log', (t) => { if (!/^\[чат\]/.test(t)) console.log('[бот]', t); });
  tb.start();
  await new Promise((r) => tb.once('event', r));
  await sleep(2000);
  rcon(`tp TbAlex ${X + 2} ${Y} ${Z}`);
  rcon('gamemode survival TbAlex');
  rcon('minecraft:clear TbAlex');
  rcon('effect clear TbAlex');
  rcon('minecraft:give TbAlex iron_sword');
  rcon('minecraft:give TbAlex iron_chestplate');
  rcon('minecraft:give TbAlex iron_helmet');
  rcon('minecraft:give TbAlex totem_of_undying');
  rcon('minecraft:give TbAlex bread 16');
  await sleep(3000);   // броня и тотем надеваются раз в 3 с
  await sleep(4000);
  console.log('follow:', tb.follow('TbOwner'));
  rcon('difficulty normal');

  console.log('\n== зомби x3 и зомби-пиглин');
  rcon(`summon zombified_piglin ${X - 6} ${Y} ${Z + 6} {Tags:["gt"],PersistenceRequired:1b}`);
  for (let i = 0; i < 3; i++) rcon(`summon zombie ${X + 7 + i} ${Y} ${Z - 5} {Tags:["gt","gz"],PersistenceRequired:1b}`);
  await sleep(25000);
  console.log('зомби живы:', count('@e[tag=gz]'), '| пиглин жив:', count('@e[type=zombified_piglin,tag=gt]'),
    '| здоровье бота:', Math.round(tb.bot.health), '| броня:', tb.bot.inventory.slots.slice(5, 9).map((s) => s && s.name).join(','),
    '| вторая рука:', tb.bot.inventory.slots[45] && tb.bot.inventory.slots[45].name);

  console.log('\n== крипер');
  const p0 = tb.bot.entity.position.clone();
  rcon(`summon creeper ${Math.floor(p0.x) + 3} ${Y} ${Math.floor(p0.z) + 3} {Tags:["gt","gc"],PersistenceRequired:1b}`);
  await sleep(6000);
  const c = rcon('data get entity @e[tag=gc,limit=1] Pos');
  const m = c.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
  const dist = m ? Math.hypot(+m[1] - tb.bot.entity.position.x, +m[3] - tb.bot.entity.position.z).toFixed(1) : 'крипера нет (взорвался?)';
  console.log('расстояние до крипера через 6 с:', dist, '| здоровье бота:', Math.round(tb.bot.health));

  rcon('difficulty peaceful');
  rcon('minecraft:kill @e[tag=gt]');
  tb.stop(); owner.quit();
  rcon(`forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  setTimeout(() => process.exit(0), 1000);
})().catch((e) => { console.error(e); process.exit(1); });
