// Быстрые проверки без сервера (секунды): загрузка модулей, приказы, разбор ответов, модели лестницы, плавания,
// троп и разведки. node test/models.js
const { execFileSync } = require('child_process');
const path = require('path');
for (const t of ['house_test.js', 'errand_test.js', 'swim_test.js', 'scout_test.js']) {
  console.log('--- ' + t);
  process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, t)]).toString());
}
const B = require('../app/brain');
const cases = [['за мной', 'follow'], ['стой', 'hold'], ['жди тут', 'hold'], ['ближе', 'followDist'], ['не дерись', 'combat'], ['заходи в портал', 'portal'], ['садись в лодку', 'mount'], ['слезай', 'dismount'], ['выкинь всё', 'discardAll'], ['выложи лишнее', 'stash'], ['верни обратно', 'undoPut'], ['отбой', 'errandStop'], ['продолжай', 'errandGo']];
const bad = cases.filter(([t, a]) => { const r = B.quickOrder(t, 'V'); return !r || r[0].act !== a; });
console.log(`--- приказы хозяина: ${cases.length - bad.length} из ${cases.length}${bad.length ? ' НЕ ВЫШЛО: ' + bad.map((x) => x[0]).join(', ') : ''}`);
const os = require('os'), fs = require('fs');
const { Trails } = require('../app/travel');
const tr = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'tr'))), st = {};
for (let x = 0; x <= 100; x++) tr.step('nether', { x, y: 64, z: 0 }, st);
for (let z = 0; z <= 80; z++) tr.step('nether', { x: 100, y: 64, z }, st);
const r = tr.route('nether', { x: 2, y: 64, z: 1 }, { x: 99, y: 64, z: 79 });
console.log('--- тропы: ' + (r ? `маршрут ${Math.round(r.len)} бл. по ${r.points.length} точкам` : 'НЕТ МАРШРУТА'));

// жизнь тела: что выберет само в разных случаях
{
  const { needs } = require('../app/life');
  const mk = (time, health, freeSlots, foe) => ({
    bot: { entity: { position: { x: 0, y: 64, z: 0 } }, time: { timeOfDay: time }, game: { dimension: 'minecraft:overworld' }, health,
      inventory: { emptySlotCount: () => freeSlots }, entities: foe ? { 1: { position: { x: 3, y: 64, z: 0, distanceTo: () => 3 }, type: 'hostile' } } : {}, findBlock: () => null },
    memory: { data: { places: { d: { name: 'мой дом', x: 200, y: 64, z: 0, dim: 'обычный мир', at: 1 } } } }, dimName: () => 'обычный мир', skills: { builtNear: () => null } });
  const pick = (tb) => (needs(tb)[0] || { k: 'ничего' }).k;
  const r = [['день, всё хорошо', pick(mk(6000, 20, 20)), 'ничего'], ['ночь', pick(mk(15000, 20, 20)), 'ночь'], ['вечер', pick(mk(11500, 20, 20)), 'вечер'],
    ['полный инвентарь', pick(mk(6000, 20, 1)), 'тяжело'], ['ночь + враг + 5 здоровья', pick(mk(15000, 5, 20, true)), 'опасность']];
  const bad = r.filter((x) => x[1] !== x[2]);
  console.log(`--- жизнь тела: ${r.length - bad.length} из ${r.length}${bad.length ? ' НЕ ТАК: ' + bad.map((x) => x[0] + ' -> ' + x[1]).join(', ') : ''}`);
}

// умные предметы: правила тела
(async () => {
  const o = require('../app/objects');
  const { Vec3 } = require('vec3');
  const tb = (name, source) => ({ runSource: source, bot: { blockAt: (v) => ({ name, position: v }) } });
  const r = [];
  try { await o.use(tb('lever', 'self'), { x: 1, y: 64, z: 1 }); r.push(['рычаг сам', 'нажала']); } catch (e) { r.push(['рычаг сам', /по просьбе хозяина/.test(e.message) ? 'отказ' : e.message]); }
  try { await o.use(tb('anvil', 'master'), { x: 1, y: 64, z: 1 }); r.push(['наковальня', 'вышло']); } catch (e) { r.push(['наковальня', /не умею/.test(e.message) ? 'не умею' : e.message]); }
  const ok = r[0][1] === 'отказ' && r[1][1] === 'не умею';
  console.log(`--- умные предметы: ${ok ? 'правила соблюдены' : 'НЕ ТАК: ' + JSON.stringify(r)}`);
})();

// атлас: ледяная ветка в Незере, которую бот только видел, становится тропой (маршрут по ней находится)
{
  const { Atlas } = require('../app/atlas');
  const { Trails } = require('../app/travel');
  const T = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'at')));
  const { Vec3 } = require('vec3');
  const tb = Object.create(Atlas.prototype);
  const ice = new Set(); for (let x = 0; x <= 200; x++) for (let z = 0; z <= 1; z++) ice.add(`${x},64,${z}`);
  let cx = 0;
  tb.travel = { trails: T };
  tb.bot = { blockAt: (p) => ({ name: ice.has(`${p.x},${p.y},${p.z}`) ? 'packed_ice' : 'air', boundingBox: ice.has(`${p.x},${p.y},${p.z}`) ? 'block' : 'empty' }),
    findBlocks: () => [...ice].map((k) => k.split(',').map(Number)).filter(([x]) => Math.abs(x - cx) <= 32).map(([x, y, z]) => new Vec3(x, y, z)) };
  for (cx = 0; cx <= 200; cx += 24) tb.iceRoads('nether');
  const r = T.route('nether', { x: 2, y: 65, z: 0 }, { x: 198, y: 65, z: 1 });
  console.log('--- атлас: ' + (r ? `ледяная ветка 200 бл. - маршрут ${Math.round(r.len)} бл. по ${r.points.length} точкам` : 'НЕТ МАРШРУТА ПО ЛЬДУ'));
}

// поселения: застроенные чанки рядом - один город; бот понимает, что он в городе (здесь всё чужое) или в диком месте
{
  const { WorldMap } = require('../app/worldmap');
  const wm = new WorldMap(fs.mkdtempSync(path.join(os.tmpdir(), 'wm')));
  const m = wm.load('overworld');
  for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) m.chunks[`${x},${z}`] = { t: Date.now(), k: 'g', b: 30, h: 70 };
  m.chunks['20,20'] = { t: Date.now(), k: 'g', b: 20, h: 70 };
  const at = (x, z) => ({ bot: { entity: { position: { x, y: 70, z } }, game: { dimension: 'overworld' } } });
  const inTown = wm.summary(at(30, 20)), wild = wm.summary(at(-400, -400));
  const ok = /ты в поселении игроков \(12/.test(inTown) && /дикой местности/.test(wild) && /поселения: поселение игроков \(12 чанков\)/.test(wild);
  console.log('--- поселения: ' + (ok ? 'город из 12 чанков узнан, внутри и снаружи - правильно' : 'НЕТ: ' + inTown + ' / ' + wild));
}

// карта по блокам: что сверху в каждой точке, высота, глубина воды (как у Xaero)
{
  const R = path.resolve(__dirname, '../node_modules');
  const registry = require(R + '/prismarine-registry')('1.21.4'); const Chunk = require(R + '/prismarine-chunk')(registry); const { Vec3 } = require(R + '/vec3');
  const col = new Chunk({ minY: -64, worldHeight: 384 }), id = (n) => registry.blocksByName[n].defaultState;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { col.setBlockStateId(new Vec3(x, 63, z), id('dirt')); col.setBlockStateId(new Vec3(x, 64, z), id(z < 4 ? 'water' : 'grass_block')); }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 4; z++) { col.setBlockStateId(new Vec3(x, 63, z), id('water')); col.setBlockStateId(new Vec3(x, 62, z), id('sand')); }
  for (let x = 4; x < 8; x++) for (let z = 8; z < 12; z++) col.setBlockStateId(new Vec3(x, 70, z), id('oak_planks'));
  for (let z = 4; z < 16; z++) col.setBlockStateId(new Vec3(12, 64, z), id('dirt_path'));
  const air = new Set(); for (const n of ['air', 'cave_air', 'void_air']) { const b = registry.blocksByName[n]; for (let i = b.minStateId; i <= b.maxStateId; i++) air.add(i); }
  const mg = require('../app/mapgrid'), d = mg.decode(mg.surface({ registry }, col, air, false));
  const at = (x, z) => `${mg.KINDS[d.k[z * 16 + x]][0]}@${d.h[z * 16 + x]}${d.d[z * 16 + x] ? '/' + d.d[z * 16 + x] : ''}`;
  const got = [at(0, 0), at(0, 6), at(5, 9), at(12, 6)].join(' '), want = 'water@64/1 grass@64 wood@70 path@64';
  console.log('--- карта по блокам: ' + (got === want ? 'вода с глубиной, трава, дом, тропа - верно' : 'НЕТ: ' + got));
}

// подземный слой: срез на высоте бота - видит ходы пещеры (восток длинный, север короткий), а не крышу
{
  const R = path.resolve(__dirname, '../node_modules');
  const registry = require(R + '/prismarine-registry')('1.21.4'); const Chunk = require(R + '/prismarine-chunk')(registry); const { Vec3 } = require(R + '/vec3');
  const { WorldMap } = require('../app/worldmap');
  const cols = new Map(), id = (n) => registry.blocksByName[n].defaultState;
  for (let cx = -2; cx <= 3; cx++) for (let cz = -2; cz <= 2; cz++) {
    const col = new Chunk({ minY: -64, worldHeight: 384 });
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 30; y <= 70; y++) {
      const X = cx * 16 + x, Z = cz * 16 + z;
      const tunnel = (y === 40 || y === 41) && ((Z === 0 && X >= -10 && X <= 45) || (X === 0 && Z <= 0 && Z >= -12));
      col.setBlockStateId(new Vec3(x, y, z), id(tunnel ? 'air' : y === 70 ? 'grass_block' : 'stone'));
    }
    cols.set(`${cx},${cz}`, col);
  }
  const wm = new WorldMap(fs.mkdtempSync(path.join(os.tmpdir(), 'cv')));
  wm.airIds = new Set(); for (const n of ['air', 'cave_air', 'void_air']) { const b = registry.blocksByName[n]; for (let i = b.minStateId; i <= b.maxStateId; i++) wm.airIds.add(i); }
  wm.load('overworld').chunks['0,0'] = { t: Date.now(), k: 'g', h: 70, b: 0 };
  const tb = { bot: { registry, entity: { position: new Vec3(0.5, 40, 0.5) }, game: { dimension: 'overworld' }, world: { getColumn: (x, z) => cols.get(`${x},${z}`) } } };
  const t = wm.tunnels(tb);
  const ok = /восток 4\d бл/.test(t) && /север 1\d бл/.test(t) && /запад 10 бл/.test(t) && /подземный слой/.test(wm.layerMode(tb));
  console.log('--- подземный слой: ' + (ok ? 'ходы пещеры видны (' + t + ')' : 'НЕТ: ' + t));
}

// метки из чата: название + координаты от хозяина - место; приказы и количества - нет
{
  const { parse } = require('../app/chatpoints');
  const cases = [['наш портал 250 64 -300', 'наш портал'], ['база в незере 120 -40', 'база'], ['запомни склад 1200 70 -560', 'склад'], ['ферма слизней: 1500, -2300', 'ферма слизней'],
    ['иди на 100 200', null], ['дай 2 стака 64', null], ['кинь 64 и 32 шерсти', null], ['привет как дела', null]];
  const bad = cases.filter(([t, n]) => { const r = parse(t); return n === null ? r !== null : !r || r.name !== n; });
  const nether = parse('база в незере 120 -40');
  console.log(`--- метки из чата: ${cases.length - bad.length} из ${cases.length}${bad.length ? ' НЕТ: ' + bad.map((x) => x[0]).join(', ') : ''}${nether && nether.dim === 'Незер' ? '' : ' НЕТ: незер не узнан'}`);
}

// радар: враги со стороной и расстоянием, животные, жители по профессиям
{
  const { Perception } = require('../app/perception');
  const { Vec3 } = require('vec3');
  const registry = require('prismarine-registry')('1.21.4');
  const tb = Object.create(Perception.prototype);
  const ent = (name, x, z, extra = {}) => ({ name, type: 'mob', position: new Vec3(x, 64, z), metadata: [], ...extra });
  tb.bot = { registry, entity: { position: new Vec3(0, 64, 0) }, entities: { 1: ent('zombie', 0, -10), 2: ent('skeleton', 20, 0), 3: ent('cow', 5, 5), 4: ent('cow', 6, 5), 5: ent('villager', 3, 3, { metadata: [null, { villagerType: 2, villagerProfession: 5, level: 1 }] }), 6: ent('villager', 4, 3, { metadata: [{ villagerProfession: 'minecraft:librarian' }] }) } };
  const r = tb.radar();
  const ok = /враги: zombie, skeleton \(ближе всех zombie 10 бл. на север\)/.test(r.text) && /животные: cow x2/.test(r.text) && /жители: фермер, библиотекарь/.test(r.text) && r.list.length === 6;
  console.log('--- радар: ' + (ok ? r.text : 'НЕТ: ' + r.text));
}

// биомы вокруг и тёмные места
{
  const { WorldMap } = require('../app/worldmap');
  const { Perception } = require('../app/perception');
  const { Vec3 } = require('vec3');
  const wm = new WorldMap(fs.mkdtempSync(path.join(os.tmpdir(), 'bi')));
  const m = wm.load('overworld');
  m.chunks['0,0'] = { h: 64, bi: 'taiga' }; m.chunks['0,10'] = { h: 64, bi: 'desert' }; m.chunks['-8,0'] = { h: 64, bi: 'snowy_plains' }; m.chunks['0,30'] = { h: 64, bi: 'desert' };
  const bt = wm.biomes({ bot: { entity: { position: { x: 8, y: 64, z: 8 } }, game: { dimension: 'overworld' } } });
  const okB = bt === 'биом: taiga; рядом: snowy_plains 128 бл. на запад, desert 160 бл. на юг';
  // тёмный подвал: пол из камня, свет 0 везде
  const tb = Object.create(Perception.prototype);
  tb.bot = { time: { timeOfDay: 6000 }, entity: { position: new Vec3(0, 65, 0) }, blockAt: (v) => (v.y === 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty', light: 0, skyLight: 0 }) };
  const dk = tb.darkness();
  console.log('--- биомы и темнота: ' + (okB && /темно: 81 из 81/.test(dk) ? 'биомы рядом и тёмный подвал узнаны' : 'НЕТ: ' + bt + ' / ' + dk));
}

// районы по названиям: место от хозяина рядом и таблички
{
  const { Perception } = require('../app/perception');
  const { Vec3 } = require('vec3');
  const tb = Object.create(Perception.prototype);
  tb.memory = { data: { places: { a: { name: 'торговый зал', x: 10, y: 64, z: 0, dim: 'обычный мир' }, b: { name: 'мой дом', x: 2, y: 64, z: 0, dim: 'обычный мир' } }, signs: { s: { text: 'Спавн TotemCraft', x: 5, y: 65, z: 5, dim: 'обычный мир' } } } };
  tb.bot = { entity: { position: new Vec3(0, 64, 0) } }; tb.dimName = () => 'обычный мир';
  const d = tb.district();
  console.log('--- районы: ' + (d === 'ты у места «торговый зал»; таблички рядом: «Спавн TotemCraft»' ? d : 'НЕТ: ' + d));
}

// слух: шипение крипера сзади - в мозг сразу и рефлекс отбежать; бытовые звуки - не говорить
{
  const { Hearing } = require('../app/hearing');
  const { Vec3 } = require('vec3');
  const tb = Object.create(Hearing.prototype), events = [];
  tb.bot = { entity: { position: new Vec3(0, 64, 0), yaw: 0 } }; tb.event = (t) => events.push(t);
  tb.hear('entity.creeper.primed', new Vec3(0, 64, 4));   // yaw 0 - смотрит на север (-z), звук с юга - сзади
  tb.hear('block.wooden_door.open', new Vec3(3, 64, 0));
  tb.hear('entity.zombie.ambient', new Vec3(-10, 64, 0));
  const t = tb.heardText();
  const ok = events[0] === 'слышу: шипит крипер сзади 4 бл.' && tb.heardPrime && /шипит крипер сзади 4 бл., зомби (слева|справа) 10 бл./.test(t) && !/дверь/.test(t);
  console.log('--- слух: ' + (ok ? t : 'НЕТ: ' + events.join('|') + ' / ' + t));
}

// чувства: кто приближается и откуда, угроза одним словом, короткая память о тех, кто ушёл из виду
{
  const { Senses } = require('../app/senses');
  const { Hearing } = require('../app/hearing');
  const { Vec3 } = require('vec3');
  const registry = require('prismarine-registry')('1.21.4');
  const tb = Object.create(Senses.prototype); tb.sideOf = Hearing.prototype.sideOf;
  const ents = { 1: { id: 1, name: 'zombie', type: 'mob', position: new Vec3(0, 64, 12) }, 2: { id: 2, name: 'creeper', type: 'mob', position: new Vec3(-5, 64, 0) }, 3: { id: 3, type: 'player', username: 'Steve', position: new Vec3(20, 64, 0) } };
  tb.bot = { registry, health: 20, time: { timeOfDay: 6000 }, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0), yaw: 0 }, entities: ents };
  const realNow = Date.now; let t = realNow();
  Date.now = () => t;
  tb.sensesTick();
  t += 1000; ents[1].position = new Vec3(0, 64, 8); ents[2].position = new Vec3(-3, 64, 0);
  tb.sensesTick();
  const mv = tb.motion(), th = tb.threat();
  t += 2000; delete ents[3]; tb.sensesTick();
  const rl = tb.recentLive();
  Date.now = realNow;
  const ok = mv.some((x) => /zombie приближается сзади, 8 бл/.test(x)) && mv.some((x) => /creeper приближается слева, 3 бл/.test(x)) && th.level === 'опасно' && /Steve был у 20 64 0/.test(rl.join());
  console.log('--- чувства: ' + (ok ? `${th.level}; ${mv.join('; ')}; помнит: ${rl.join()}` : 'НЕТ: ' + th.level + ' / ' + mv.join('; ') + ' / ' + rl.join()));
}

// метки по ситуации: слова хозяина без координат, слияние одинаковых рядом, временные истекают, хозяйские не вытесняются
{
  const { Memory } = require('../app/memory');
  const { Marks } = require('../app/marks');
  const { Vec3 } = require('vec3');
  const mem = new Memory(fs.mkdtempSync(path.join(os.tmpdir(), 'mk')));
  const tb = Object.create(Marks.prototype);
  Object.assign(tb, { memory: mem, opts: { name: 'Alex' }, log() {}, dimName: () => 'обычный мир', bot: { entity: { position: new Vec3(0, 64, 0) } },
    player: (n) => (n === 'Valghard' ? { position: new Vec3(30, 70, -20) } : null) });
  const w1 = tb.markFromWords('это мой склад', 'Valghard'), w2 = tb.markFromWords('запомни это место как шахта', 'Valghard'), w3 = tb.markFromWords('это круто', 'Valghard');
  const sklad = mem.findPlace('мой склад');
  tb.autoMark('овцы', { x: 10, y: 64, z: 10 }, { kind: 'стадо sheep', radius: 64 });
  tb.autoMark('овцы', { x: 30, y: 64, z: 10 }, { kind: 'стадо sheep', radius: 64 });
  const sheep = Object.values(mem.data.places).filter((p) => p.kind === 'стадо sheep');
  tb.autoMark('Steve: точка', { x: 500, y: 64, z: -300 }, { kind: 'от Steve', ttl: -1 });
  const expired = !mem.findPlace('Steve: точка');
  for (let i = 0; i < 200; i++) tb.autoMark('ресурс ' + i, { x: i * 100, y: 64, z: 0 }, { kind: 'r' + i });
  const kept = !!mem.findPlace('мой склад');
  const ok = w1 && w2 && !w3 && sklad && sklad.x === 30 && sheep.length === 1 && sheep[0].x === 30 && expired && kept;
  console.log('--- метки по ситуации: ' + (ok ? 'склад и шахта со слов хозяина, стадо слилось, временная истекла, хозяйские не вытеснены' : `НЕТ: ${w1}|${w2}|${w3}|${sklad && sklad.x}|${sheep.length}|${expired}|${kept}`));
}

// кэш проходимости (как Baritone): упаковка чанка, чтение, особые блоки, сохранение и загрузка с диска,
// путь через выгруженный чанк по кэшу
{
  const R = path.resolve(__dirname, '../node_modules');
  const registry = require(R + '/prismarine-registry')('1.21.4'); const Chunk = require(R + '/prismarine-chunk')(registry); const Block = require(R + '/prismarine-block')(registry);
  const { Vec3 } = require(R + '/vec3'); const { Movements, goals } = require(R + '/mineflayer-pathfinder'); const AStar = require(R + '/mineflayer-pathfinder/lib/astar'); const Move = require(R + '/mineflayer-pathfinder/lib/move');
  const { PassCache } = require('../app/passcache');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc'));
  const pc = new PassCache(dir), id = (n) => registry.blocksByName[n].defaultState;
  const cols = new Map();
  for (let cx = 0; cx <= 3; cx++) {
    const col = new Chunk({ minY: -64, worldHeight: 384 });
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { for (let y = -64; y < 64; y++) col.setBlockStateId(new Vec3(x, y, z), id('stone')); }
    if (cx === 2) { col.setBlockStateId(new Vec3(3, 64, 3), id('chest')); col.setBlockStateId(new Vec3(5, 64, 5), id('lava')); }
    cols.set(cx, col); pc.pack(registry, 'overworld', cx, 0, col);
  }
  const t0 = Date.now(); for (let i = 0; i < 10; i++) pc.pack(registry, 'overworld', 9, 9, cols.get(2)); const packMs = (Date.now() - t0) / 10;
  const okGet = pc.get('overworld', 40, 63, 5) === 2 && pc.get('overworld', 40, 64, 5) === 0 && pc.get('overworld', 37, 64, 5) === 3 && pc.get('overworld', 200, 64, 5) === undefined;
  const near = pc.nearest('overworld', 'chest', { x: 0, y: 64, z: 0 });
  pc.saveAll(); const pc2 = new PassCache(dir); const okDisk = pc2.get('overworld', 40, 63, 5) === 2 && pc2.nearest('overworld', 'chest', { x: 0, y: 64, z: 0 })[0].x === 35;
  // мир, где загружен только чанк 0 - путь до x=55 (чанк 3) строится по кэшу
  const bot = { registry, version: '1.21.4', entities: {}, game: { minY: -64, height: 384, dimension: 'overworld' }, entity: { position: new Vec3(2.5, 64, 2.5) }, inventory: { items: () => [] },
    blockAt: (v) => { v = v.floored(); if (v.x < 0 || v.x > 15) return null; const st = cols.get(0).getBlockStateId(new Vec3(v.x & 15, v.y, v.z & 15)); const b = Block.fromStateId(st, 0); b.position = v; return b; } };
  const mv = new Movements(bot); mv.canDig = false; mv.scafoldingBlocks = []; require('../app/nav').install(mv, bot);
  const r0 = new AStar(new Move(2, 64, 2, 0, 0), mv, new goals.GoalNearXZ(55, 2, 1), 5000, 20000, -1, 0).compute();
  mv.passCache = pc; mv.passDim = () => 'overworld';
  const mv2 = new Movements(bot); mv2.canDig = false; mv2.scafoldingBlocks = []; require('../app/nav').install(mv2, bot); mv2.passCache = pc; mv2.passDim = () => 'overworld';
  const r1 = new AStar(new Move(2, 64, 2, 0, 0), mv2, new goals.GoalNearXZ(55, 2, 1), 5000, 20000, -1, 0).compute();
  const ok = okGet && near[0].x === 35 && okDisk && r1.status === 'success' && r0.status !== 'success';
  console.log('--- кэш проходимости: ' + (ok ? `чтение, особые блоки, диск - верно; путь через выгруженные чанки: без кэша ${r0.status}, с кэшем ${r1.status} (${r1.path.length} шагов); упаковка чанка ${packMs.toFixed(0)} мс` : `НЕТ: get ${okGet} near ${JSON.stringify(near)} disk ${okDisk} пути ${r0.status}/${r1.status}`));
}
