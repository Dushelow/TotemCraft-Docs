// Понимание местности на модели (features.js): без сервера, мир - словарь блоков.
//  1) Незер-хаб: пол незеррак, ледяная дорога шириной 3 на север, перед ней синяя стрелка из разных синих блоков,
//     острием на север - дорога должна получить имя «синяя», направление «север», место «ветка синяя» в памяти;
//  2) город: газон, тропа из dirt_path и гравия шириной 2 - дорога; площадь из камня 12x12 - не дорога;
//  3) красное пятно без направления у другой дороги - подписывает её «красная».
// node test/features_test.js
const { Vec3 } = require('vec3');
const { Features } = require('../app/features');
const res = []; const ok = (n, c, i) => { res.push(!!c); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };

function world(fill) {
  const W = new Map(), set = (x, y, z, n) => W.set(`${x},${y},${z}`, n);
  fill(set);
  const blockAt = (v) => { const n = W.get(`${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`) || (v.y < 64 ? 'stone' : 'air'); return { name: n, boundingBox: /^(air|.*carpet)$/.test(n) ? 'empty' : 'block' }; };
  return blockAt;
}
function make(blockAt, pos) {
  const t = Object.create(Features.prototype);
  const places = {};
  t.bot = { entity: { position: new Vec3(pos[0], 64, pos[1]) }, blockAt };
  t.memory = { data: { places }, place(p) { places[p.name] = p; return 'ok'; }, save() {} };
  t.opts = { name: 'T' }; t.log = (s) => console.log('   лог:', s); t.dimName = () => 'Незер';
  return t;
}

// 1. хаб в Незере
{
  const blockAt = world((set) => {
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(x, 63, z, 'netherrack');
    for (let x = -1; x <= 1; x++) for (let z = -30; z <= -4; z++) set(x, 63, z, 'packed_ice');   // дорога на север
    // стрелка острием на север (z меньше): широкое основание у z=1, острие у z=-2
    const arrow = [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 0], [0, 0], [1, 0], [0, -1], [0, -2]];
    arrow.forEach(([x, z], i) => set(x, 63, z, ['blue_concrete', 'light_blue_wool', 'cyan_terracotta'][i % 3]));
  });
  const t = make(blockAt, [0, 6]);
  t.featuresTick(true);
  const rd = t._scene.roads.find((r) => /ice/.test(r.mat[0]));
  ok('ледяная дорога найдена', rd, rd && `${rd.mat} шир. ${rd.width}, ${rd.len} бл.`);
  ok('синяя стрелка подписала дорогу, ведёт на север', rd && rd.label === 'синяя' && rd.toward === 'север', rd && `${rd.label} на ${rd.toward}`);
  ok('в памяти место «ветка синяя»', t.memory.data.places['ветка синяя']);
  ok('строка мозгу', /ветка синяя/.test(t.sceneText()), t.sceneText());
}
// 2. город: газон, тропа, площадь
{
  const blockAt = world((set) => {
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(x, 63, z, 'grass_block');
    for (let x = -25; x <= 25; x++) for (const z of [0, 1]) set(x, 63, z, x % 3 ? 'dirt_path' : 'gravel');   // тропа
    for (let x = 5; x <= 16; x++) for (let z = 8; z <= 19; z++) set(x, 63, z, 'stone_bricks');            // площадь
  });
  const t = make(blockAt, [0, 4]); t.dimName = () => 'обычный мир';
  t.featuresTick(true);
  const path = t._scene.roads.find((r) => r.mat.includes('dirt_path'));
  ok('тропа из dirt_path и гравия - дорога', path, path && `${path.mat} ${path.len} бл.`);
  ok('площадь 12x12 - не дорога', !t._scene.roads.some((r) => r.mat[0] === 'stone_bricks'));
  ok('по тропе - «на дороге», по газону - нет', t.onKnownRoad(10, 0) && !t.onKnownRoad(10, -6));
}
// 3. пятно без направления подписывает дорогу
{
  const blockAt = world((set) => {
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(x, 63, z, 'netherrack');
    for (let x = 4; x <= 30; x++) for (let z = -1; z <= 1; z++) set(x, 63, z, 'blue_ice');   // дорога на восток
    for (const [x, z] of [[1, -1], [2, -1], [1, 0], [2, 0], [1, 1], [2, 1]]) set(x, 63, z, 'red_wool');
  });
  const t = make(blockAt, [-3, 0]);
  t.featuresTick(true);
  const rd = t._scene.roads[0];
  ok('красное пятно у начала дороги - «ветка красная» на восток', rd && rd.label === 'красная' && rd.toward === 'восток', rd && `${rd.label} ${rd.toward}`);
}
// 4. тоннель в незерраке - без цвета и табличек, только форма: узкий длинный проход в сплошной породе
{
  const blockAt = world((set) => {
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = 63; y <= 68; y++) set(x, y, z, 'netherrack');
    for (let x = -1; x <= 0; x++) for (let z = -28; z <= 3; z++) { set(x, 64, z, 'air'); set(x, 65, z, 'air'); set(x, 66, z, 'air'); }   // тоннель 2x3 на север
  });
  const t = make(blockAt, [0, 2]);
  t.featuresTick(true);
  const tn = t._scene.roads.find((r) => r.kind === 'тоннель');
  ok('тоннель найден по форме (без цвета и табличек)', tn, tn && `${tn.kind} шир. ${tn.width}, ${tn.len} бл.`);
}
// 5. табличка «Энд налево» у развилки подписывает проход, что уходит налево от читающего
{
  const W = world((set) => {
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(x, 63, z, 'grass_block');
    for (let x = -25; x <= -2; x++) for (const z of [0, 1]) set(x, 63, z, 'stone_bricks');   // дорога на запад
    for (let x = 2; x <= 25; x++) for (const z of [0, 1]) set(x, 63, z, 'stone_bricks');      // дорога на восток
  });
  const t = make(W, [0, 4]); t.dimName = () => 'обычный мир';
  // табличка у 0 64 -1 смотрит на юг (к читающему, который стоит южнее и смотрит на север): «налево» - запад
  t.bot.findBlocks = () => [new Vec3(0, 64, -1)];
  const real = t.bot.blockAt;
  t.bot.blockAt = (v, e) => (Math.floor(v.x) === 0 && Math.floor(v.y) === 64 && Math.floor(v.z) === -1 ? { name: 'oak_sign', boundingBox: 'empty', getProperties: () => ({ rotation: 0 }), getSignText: () => ['Энд налево', 'столовая направо'] } : real(v, e));
  t.featuresTick(true);
  const w = t._scene.roads.find((r) => r.label === 'Энд'), e = t._scene.roads.find((r) => r.label === 'столовая');
  ok('«Энд налево» - дорога на запад, «столовая направо» - на восток', w && w.toward === 'запад' && e && e.toward === 'восток', `${w ? w.toward : '-'} / ${e ? e.toward : '-'}`);
}
console.log(`--- понимание местности: ${res.filter(Boolean).length} из ${res.length}`);
