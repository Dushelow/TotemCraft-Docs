// Проверка доработок по MATRIX.md на стенде tc-up: еда, урожай (тростник, арбуз, тыква-украшение, нарост),
// обход опасных блоков, всплытие, запретное место, удар от игрока. Запуск: node test/matrix_test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const mineflayer = require('mineflayer');
const { execSync } = require('child_process');
const { TotemBot, clickActionPacket } = require('../app/bot');
const { Memory } = require('../app/memory');

const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBlock = (x, y, z, b) => rcon(`execute if block ${x} ${y} ${z} ${b}`).includes('passed');
const X = 1300, Y = 150, Z = 1300;
const results = [];
const check = (name, ok, info = '') => { results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' - ' + info : ''}`); console.log(results[results.length - 1]); };

(async () => {
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  rcon(`fill ${X - 35} ${Y - 3} ${Z - 35} ${X + 35} ${Y - 1} ${Z + 35} stone`);   // fill - не больше 32768 блоков за раз
  rcon(`fill ${X - 35} ${Y} ${Z - 35} ${X + 35} ${Y + 6} ${Z + 35} air`);
  rcon(`minecraft:kill @e[type=item,x=${X},y=${Y},z=${Z},distance=..60]`);

  const memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbmem-'));
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.memory = new Memory(memDir);
  const events = [];
  tb.on('event', (e) => events.push(e.text));
  tb.on('log', (t) => { if (!/^\[чат\]|надел|тотем/.test(t)) console.log('   [бот]', t); });
  tb.start();
  await new Promise((r) => tb.once('event', r));
  const b = tb.bot;
  await sleep(1500);
  rcon(`tp TbAlex ${X} ${Y} ${Z}`);
  rcon('gamemode survival TbAlex');
  rcon('minecraft:clear TbAlex');
  rcon('effect clear TbAlex');
  await sleep(1500);

  // 1. Еда: голод, в инвентаре гнилая плоть, хорус, хлеб, стейк - съесть стейк, вредное не трогать
  console.log('== еда');
  rcon('minecraft:give TbAlex rotten_flesh 4'); rcon('minecraft:give TbAlex chorus_fruit 4');
  rcon('minecraft:give TbAlex bread 4'); rcon('minecraft:give TbAlex cooked_beef 4');
  rcon('difficulty easy');   // на мирной голод не тратится
  rcon('minecraft:effect give TbAlex hunger 20 255');
  for (let i = 0; i < 20 && b.food >= 14; i++) await sleep(500);
  await sleep(6000);
  const cnt = (n) => b.inventory.items().filter((i) => i.name === n).reduce((s, i) => s + i.count, 0);
  check('ест лучшее (стейк)', cnt('cooked_beef') < 4, `стейк ${cnt('cooked_beef')}/4, хлеб ${cnt('bread')}/4, голод ${b.food}`);
  rcon('difficulty peaceful');
  check('не ест хорус и гнилую плоть', cnt('chorus_fruit') === 4 && cnt('rotten_flesh') === 4);

  // 2. Урожай: тростник 3 в высоту у воды, арбуз у стебля, тыква-украшение без стебля, нарост на песке душ
  console.log('== урожай');
  rcon(`setblock ${X + 6} ${Y - 1} ${Z} sand`); rcon(`setblock ${X + 7} ${Y - 1} ${Z} water`);
  for (let i = 0; i < 3; i++) rcon(`setblock ${X + 6} ${Y + i} ${Z} sugar_cane`);
  // сначала арбуз, потом стебель: стебель без арбуза рядом сервер сразу делает обычным
  rcon(`setblock ${X + 6} ${Y - 1} ${Z + 4} farmland`); rcon(`setblock ${X + 7} ${Y} ${Z + 4} melon`);
  rcon(`setblock ${X + 6} ${Y} ${Z + 4} attached_melon_stem[facing=east]`);
  rcon(`setblock ${X + 4} ${Y} ${Z + 6} pumpkin`);   // украшение
  rcon(`setblock ${X + 2} ${Y - 1} ${Z + 6} soul_sand`); rcon(`setblock ${X + 2} ${Y} ${Z + 6} nether_wart[age=3]`);
  rcon('minecraft:give TbAlex iron_axe');
  await sleep(1000);
  console.log('   ', await tb.run([{ act: 'harvest', radius: 14 }], 'урожай'));
  check('тростник: верх срезан, низ на месте', isBlock(X + 6, Y, Z, 'sugar_cane') && !isBlock(X + 6, Y + 1, Z, 'sugar_cane'));
  check('арбуз у стебля собран, стебель цел', !isBlock(X + 7, Y, Z + 4, 'melon') && (isBlock(X + 6, Y, Z + 4, 'melon_stem') || isBlock(X + 6, Y, Z + 4, 'attached_melon_stem')));   // сорванный арбуз - стебель становится обычным
  check('тыква-украшение не тронута', isBlock(X + 4, Y, Z + 6, 'pumpkin'));
  check('нарост собран и посажен', isBlock(X + 2, Y, Z + 6, 'nether_wart[age=0]'));

  // 3. Опасные блоки: прямой путь через полосу магмы и огня, обход есть - не наступить
  console.log('== обход опасного');
  rcon(`fill ${X - 20} ${Y - 1} ${Z - 2} ${X - 20} ${Y - 1} ${Z + 2} magma_block`);
  rcon(`fill ${X - 20} ${Y} ${Z - 2} ${X - 20} ${Y} ${Z + 2} fire`);
  rcon(`tp TbAlex ${X - 15} ${Y} ${Z}`);
  await sleep(1500);
  let stepped = false;
  const where = [];
  const watch = () => { const under = b.blockAt(b.entity.position.offset(0, -0.5, 0)); const at = b.blockAt(b.entity.position); if ((under && under.name === 'magma_block') || (at && /fire/.test(at.name))) { stepped = true; where.push(b.entity.position.toString() + ' ' + (under && under.name) + '/' + (at && at.name)); } };
  b.on('physicsTick', watch);
  const hp0 = b.health;
  console.log('   ', await tb.run([{ act: 'goto', x: X - 25, y: Y, z: Z }], 'через магму'));
  b.removeListener('physicsTick', watch);
  check('не наступил на магму и огонь', !stepped && b.health >= hp0, `здоровье ${hp0} → ${b.health}; ${where.slice(0, 3).join(' | ')}`);

  // 4. Запретное место: «чужая база» на прямой линии - путь обходит 16 блоков вокруг
  console.log('== запретное место');
  tb.memory.place({ name: 'чужая база', x: X - 25, y: Y, z: Z + 15, dim: 'обычный мир', note: 'нельзя' }, 'тест');
  rcon(`tp TbAlex ${X - 25} ${Y} ${Z - 5}`);
  await sleep(1500);
  let minDist = 999;
  const watch2 = () => { const p = b.entity.position; minDist = Math.min(minDist, Math.max(Math.abs(p.x - (X - 25)), Math.abs(p.z - (Z + 15)))); };
  b.on('physicsTick', watch2);
  console.log('   ', await tb.run([{ act: 'goto', x: X - 25, y: Y, z: Z + 34 }], 'мимо чужой базы'));
  b.removeListener('physicsTick', watch2);
  check('обошёл чужую базу', minDist >= 15, `ближе всего ${minDist.toFixed(1)} блока (граница 16)`);

  // 5. Вода: бот на дне глубокой воды - всплывает
  console.log('== вода');
  rcon(`fill ${X + 14} ${Y - 11} ${Z + 14} ${X + 18} ${Y - 1} ${Z + 18} stone`);
  rcon(`fill ${X + 15} ${Y - 10} ${Z + 15} ${X + 17} ${Y - 1} ${Z + 17} water`);
  rcon(`tp TbAlex ${X + 16} ${Y - 9} ${Z + 16}`);
  await sleep(12000);
  check('всплыл', b.entity.position.y > Y - 3, `высота ${b.entity.position.y.toFixed(1)}, воздух ${b.oxygenLevel}, здоровье ${b.health}`);

  // 6. Удар от игрока - событие для мозга
  console.log('== удар от игрока');
  const owner = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'TbOwner', version: '1.21.11', auth: 'offline' });
  owner._client.on('show_dialog', (d) => { const id = (JSON.stringify(d).match(/"(authme:[^"]*submit)"/) || [])[1]; if (id) owner._client.writeRaw(clickActionPacket(id, { password: { type: 'string', value: 'Tb12345x' } })); });
  owner.on('physicsTick', () => { try { owner._client.write('tick_end', {}); } catch {} });
  await new Promise((r) => owner.once('spawn', r));
  await sleep(2000);
  rcon(`tp TbAlex ${X} ${Y} ${Z}`); rcon(`tp TbOwner ${X + 2} ${Y} ${Z}`); rcon('gamemode survival TbOwner');
  rcon('difficulty easy');   // на мирной здоровье восстанавливается мгновенно
  await sleep(2000);
  const target = owner.players.TbAlex && owner.players.TbAlex.entity;
  // удар как у клиента: поворот, на следующем тике удар внутри тика (иначе сервер его не засчитывает)
  if (target) {
    await owner.lookAt(target.position.offset(0, 1.5, 0), true);
    await new Promise((r) => owner.once('physicsTick', r));
    await new Promise((r) => owner.once('physicsTick', () => { owner.attack(target); r(); }));
  }
  await sleep(1500);
  if (b.health >= 20) {   // удар тестового робота сервер не засчитал - урон командой от его имени, взмах настоящий
    owner.swingArm();
    rcon('damage TbAlex 2 minecraft:player_attack by TbOwner');
  }
  await sleep(2000);
  console.log('   здоровье бота после удара:', b.health);
  if (b.health >= 20) results.push('НЕ ПРОВЕРЕНО заметил удар игрока - удар не прошёл (на стенде сервер отвечает «цель неуязвима» к урону от игрока)');
  else check('заметил удар игрока', events.some((t) => /TbOwner ударил/.test(t)), events.filter((t) => /ударил/.test(t)).join('; '));
  owner.quit();

  console.log('\nИТОГ:\n' + results.join('\n'));
  tb.stop();
  rcon(`forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  fs.rmSync(memDir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 1000);
})().catch((e) => { console.error(e); process.exit(1); });
