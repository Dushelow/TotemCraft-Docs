// Свобода воли, «посмотреть» и постройки под землёй - на стенде, Qwen подставной. node test/will_test.js
// 1) карта: дом на поверхности и дом под землёй - постройки; шахта и подземелье - природные, не постройки;
// 2) сообщения в Qwen: [я] всегда, инвентарь/онлайн/карта - только при изменении или по просьбе;
// 3) look: бот попросил осмотреться - следующим сообщением приходит [смотрю];
// 4) свободное время: без меню; выбранная прогулка правда ведёт бота; момент без слушателей - тишина.
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { WorldMap } = require('../app/worldmap');
const { Brain } = require('../app/brain');
const { Memory } = require('../app/memory');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, what) => { console.log((cond ? 'OK   ' : 'FAIL ') + what); if (!cond) fails++; };

const X = 1300, Y = 150, Z = 1100;   // стенд: каменный массив Y-30..Y-1, сверху площадка
(async () => {
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  rcon(`fill ${X - 15} ${Y - 30} ${Z - 15} ${X + 15} ${Y - 1} ${Z + 15} stone`);
  rcon(`fill ${X - 15} ${Y} ${Z - 15} ${X + 15} ${Y + 8} ${Z + 15} air`);
  rcon(`fill ${X - 40} ${Y - 1} ${Z - 40} ${X + 40} ${Y - 1} ${Z - 16} stone`);
  rcon(`fill ${X - 40} ${Y - 1} ${Z + 16} ${X + 40} ${Y - 1} ${Z + 40} stone`);
  // дом под землёй (чанк X-12..-6, Z-12..-6), на 20 блоков ниже поверхности
  rcon(`fill ${X - 12} ${Y - 25} ${Z - 12} ${X - 6} ${Y - 21} ${Z - 6} spruce_planks hollow`);
  rcon(`fill ${X - 12} ${Y - 23} ${Z - 9} ${X - 12} ${Y - 22} ${Z - 8} glass`);
  rcon(`setblock ${X - 10} ${Y - 24} ${Z - 10} crafting_table`);
  rcon(`setblock ${X - 8} ${Y - 24} ${Z - 10} chest`);
  rcon(`setblock ${X - 10} ${Y - 22} ${Z - 8} lantern`);
  rcon(`setblock ${X - 9} ${Y - 24} ${Z - 7} furnace`);
  // шахта (X+5..+12, Z+8): доски, заборы, рельсы, паутина
  rcon(`fill ${X + 3} ${Y - 25} ${Z + 7} ${X + 13} ${Y - 23} ${Z + 9} air`);
  rcon(`fill ${X + 3} ${Y - 22} ${Z + 7} ${X + 13} ${Y - 22} ${Z + 9} oak_planks`);
  for (const dx of [4, 8, 12]) { rcon(`setblock ${X + dx} ${Y - 25} ${Z + 7} oak_fence`); rcon(`setblock ${X + dx} ${Y - 24} ${Z + 7} oak_fence`); rcon(`setblock ${X + dx} ${Y - 25} ${Z + 9} oak_fence`); rcon(`setblock ${X + dx} ${Y - 24} ${Z + 9} oak_fence`); }
  rcon(`fill ${X + 3} ${Y - 25} ${Z + 8} ${X + 13} ${Y - 25} ${Z + 8} rail`);
  rcon(`setblock ${X + 6} ${Y - 23} ${Z + 9} cobweb`); rcon(`setblock ${X + 10} ${Y - 23} ${Z + 7} cobweb`);
  // подземелье (X+5..+11, Z-12..-6): булыжник и замшелый булыжник, спавнер, сундук
  rcon(`fill ${X + 5} ${Y - 25} ${Z - 12} ${X + 11} ${Y - 21} ${Z - 6} cobblestone hollow`);
  rcon(`fill ${X + 5} ${Y - 25} ${Z - 12} ${X + 11} ${Y - 25} ${Z - 6} mossy_cobblestone`);
  rcon(`setblock ${X + 8} ${Y - 24} ${Z - 9} spawner`);
  rcon(`setblock ${X + 6} ${Y - 24} ${Z - 11} chest`);
  // дом на поверхности к северо-востоку (за пределами массива, на площадке)
  rcon(`fill ${X + 22} ${Y} ${Z - 30} ${X + 28} ${Y + 4} ${Z - 24} oak_planks hollow`);
  rcon(`setblock ${X + 25} ${Y} ${Z - 27} chest`);
  rcon(`fill ${X + 22} ${Y + 2} ${Z - 28} ${X + 22} ${Y + 2} ${Z - 26} glass_pane`);
  rcon(`setblock ${X + 24} ${Y + 3} ${Z - 27} torch`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbwill-'));
  const map = new WorldMap(dir);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.worldMap = map;
  tb.memory = new Memory(dir);
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X} ${Y} ${Z}`); await sleep(4000);
  await map.scan(tb);

  // --- 1. карта
  const ch = (x, z) => map.load(tb.bot.game.dimension).chunks[`${Math.floor(x / 16)},${Math.floor(z / 16)}`] || {};
  const home = ch(X - 9, Z - 9), shaft = ch(X + 8, Z + 8), dung = ch(X + 8, Z - 9), house = ch(X + 25, Z - 27);
  console.log('чанки: подземный дом', home, '| шахта', shaft, '| подземелье', dung, '| дом', house);
  ok(home.b >= 12 && home.u === 1, 'дом под землёй - постройка, помечен «под землёй»');
  ok(house.b >= 12 && !house.u, 'дом на поверхности - постройка');
  ok(!shaft.b, 'шахта - не постройка');
  ok(!dung.b, 'подземелье - не постройка');
  const poi = Object.values(map.load(tb.bot.game.dimension).poi).map((p) => p.kind);
  ok(poi.includes('шахта') && poi.includes('подземелье'), 'шахта и подземелье - на карте как сооружения: ' + [...new Set(poi)].join(', '));
  const sum = map.summary(tb);
  console.log('сводка карты:', sum);
  ok(/постройка под землёй/.test(sum), 'в сводке есть «постройка под землёй»');

  // --- 2-4. мозг с подставным Qwen
  const sent = [];
  let answers = [];
  const bridge = { ask: async (chatId, msg) => { sent.push(msg); return { answer: answers.shift() || '```json\n{"actions":[]}\n```', chatId: 'test-chat' }; } };
  const cfg = { masters: ['Valghard'], qwen: {}, initiative: { enabled: true, minutes: 4 } };
  const botCfg = { name: 'TbAlex', chatId: '' };
  const logs = [];
  const brain = new Brain({ body: tb, bridge, cfg: () => cfg, botCfg, save: () => {}, log: (t) => logs.push(t) });
  brain.memory = tb.memory;
  const until = async (cond, ms = 15000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(200); return cond(); };
  const idleBrain = () => until(() => !brain.busy && !brain.pending.length);

  brain.push('[чат рядом] Valghard (хозяин) (3 бл. от тебя): привет', true, 'Valghard', 'local');
  await idleBrain();
  const first = sent[sent.length - 1];
  console.log('--- первое сообщение:\n' + first);
  ok(/\[я\]/.test(first) && /\[инвентарь\]/.test(first) && /\[онлайн/.test(first) && /\[карта\]/.test(first), 'первое сообщение: [я], инвентарь, онлайн, карта');
  brain.push('[чат рядом] Valghard (хозяин) (3 бл. от тебя): как дела', true, 'Valghard', 'local');
  await idleBrain();
  const second = sent[sent.length - 1];
  console.log('--- второе сообщение:\n' + second);
  ok(/\[я\]/.test(second) && !/\[инвентарь\]|\[онлайн|\[карта\]/.test(second), 'второе: только [я] (ничего не изменилось)');
  ok(second.length < first.length / 2, `второе короче первого: ${second.length} против ${first.length} знаков`);

  // look
  answers = ['сейчас гляну\n```json\n{"actions":[{"act":"look","what":["around","inventory"]}]}\n```'];
  const n0 = sent.length;
  brain.push('[чат рядом] Valghard (хозяин) (3 бл. от тебя): что вокруг видишь?', true, 'Valghard', 'local');
  await until(() => sent.length >= n0 + 2); await idleBrain();
  const looked = sent[n0 + 1] || '';
  console.log('--- после look:\n' + looked);
  ok(/\[смотрю\]/.test(looked) && /\[вокруг тебя\]/.test(looked) && /\[инвентарь\]/.test(looked), 'look: пришло [смотрю] с вокруг и инвентарём');
  // зацикливание: бот всё время просит look - не больше 2 раз подряд
  answers = Array(6).fill('```json\n{"actions":[{"act":"look","what":"map"}]}\n```');
  const n1 = sent.length;
  brain.push('[чат рядом] Valghard (хозяин) (3 бл. от тебя): а ещё?', true, 'Valghard', 'local');
  await sleep(9000); await idleBrain();
  ok(sent.length - n1 <= 3, `look не зацикливается: ${sent.length - n1} сообщений`);
  answers = [];

  // свободное время: без меню, нейросеть придумывает сама
  answers = ['```json\n{"actions":[{"act":"wander","dir":"юг","radius":24}]}\n```'];
  const n2 = sent.length;
  const start = tb.bot.entity.position.clone();
  brain.lastEvent = Date.now() - 5 * 60000;
  brain.idle();
  await until(() => sent.length > n2); await idleBrain();
  console.log('--- свободное время:\n' + sent[n2]);
  ok(/\[свободное время\]/.test(sent[n2] || '') && !/Варианты|Можно ничего/.test(sent[n2] || ''), 'пришло [свободное время] без готового меню и без «можно ничего»');
  // момент без слушателей - молчит
  const n4 = sent.length; brain.lastMoment = 0; tb.emit('moment', { kind: 'ночь', text: 'стемнело' }); await sleep(300);
  ok(sent.length === n4 && !brain.pending.length, 'момент, когда рядом никого, не отправляется');
  await until(() => tb.mode !== 'task' && tb.bot.entity.position.distanceTo(start) > 5, 60000);
  await until(() => tb.mode !== 'task', 60000);
  await sleep(800); await idleBrain();
  ok(sent.some((m) => /\[итог задания \(сам\)\]/.test(m)), 'итог своей прогулки пришёл в Qwen');
  const moved = tb.bot.entity.position.distanceTo(start);
  console.log('итог:', logs.filter((l) => /итог|прогулял/.test(l)).slice(-2));
  ok(moved > 8 && tb.bot.entity.position.z > start.z, `сам пошёл гулять на юг: ${moved.toFixed(0)} бл.`);
  // ничего не выбрал два раза - спрашивает реже
  answers = ['```json\n{"actions":[]}\n```', '```json\n{"actions":[]}\n```'];
  await idleBrain(); brain.idleSkips = 0;
  for (let i = 0; i < 2; i++) { brain.lastEvent = Date.now() - 30 * 60000; brain.idle(); await sleep(300); await idleBrain(); }
  const n3 = sent.length;
  brain.lastEvent = Date.now() - 5 * 60000; brain.idle(); await sleep(500);
  ok(brain.idleSkips === 2 && sent.length === n3, `дважды ничего не выбрал - через 5 мин уже не спрашивает (пропусков ${brain.idleSkips})`);

  brain.stop(); tb.stop();
  rcon(`forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`);
  console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : '\nвсё прошло');
  setTimeout(() => process.exit(fails ? 1 : 0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
