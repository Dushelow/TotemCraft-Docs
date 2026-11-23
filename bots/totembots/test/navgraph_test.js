// Карта связей, край знаний, показ маршрута (navgraph.js) на модели, без сервера.
//  1) увиденная дорога (features) становится частью графа троп - маршрут по ней находится;
//  2) цель за краем графа - путь к ближайшей к цели известной точке;
//  3) «покажу дорогу»: точки пути хозяина с порталом записываются, маршрут сохраняется под именем и местом,
//     повтор идёт с ближайшей точки и входит в портал, где в записи сменился мир.
// node test/navgraph_test.js
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');
const { NavGraph } = require('../app/navgraph');
const { Trails } = require('../app/travel');
const res = []; const ok = (n, c, i) => { res.push(!!c); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };

function make() {
  const t = Object.create(NavGraph.prototype);
  t.travel = { trails: new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'tbng-'))) };
  t.bot = { game: { dimension: 'minecraft:overworld' }, entity: { position: new Vec3(0, 64, 0) } };
  const places = {};
  t.memory = { data: { places }, place(p) { places[p.name.toLowerCase()] = p; return 'ok'; }, save() {}, findPlace: (n) => places[String(n).toLowerCase()] };
  t.opts = { name: 'T', masters: ['Odin'] }; t.log = () => {}; t.dimName = () => (t.bot.game.dimension === 'minecraft:the_nether' ? 'Незер' : 'обычный мир');
  t.check = () => {};
  return t;
}
const { dkey } = require('../app/travel');

// 1-2
{
  const t = make(), d = dkey('minecraft:overworld');
  t.graphFeed([{ e1: { x: 0, z: 0 }, e2: { x: 0, z: -200 }, y: 64, len: 200 }]);   // увиденная дорога на север
  const r = t.travel.trails.route(d, { x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: -190 });
  ok('увиденная дорога - в графе, путь по ней есть', r && r.points.length > 10, r && `${r.points.length} точек, ${Math.round(r.len)} бл.`);
  const fr = t.frontierRoute(d, { x: 0, y: 64, z: 0 }, { x: 30, z: -600 });
  const last = fr && fr.points[fr.points.length - 1];
  ok('цель за краем графа - путь к ближайшей к цели известной точке', last && last.z < -180, last && `до ${last.x} ${last.z}, оттуда до цели ${Math.round(fr.left)} бл.`);
  ok('цель в другую сторону - край не предлагается', !t.frontierRoute(d, { x: 0, y: 64, z: 0 }, { x: 0, z: 400 }));
}
// 3
{
  const t = make();
  let owner = { position: new Vec3(0, 64, 0) };
  t.player = () => owner; t.follow = () => {};
  ok('«покажу дорогу до замка» - запись началась', /запоминаю/.test(t.teachStart({ name: 'замок', who: 'Odin' })));
  for (let z = 0; z >= -40; z -= 2) { owner = { position: new Vec3(0, 64, z) }; t.teachTick(); }
  t.bot.game.dimension = 'minecraft:the_nether';   // хозяин прошёл в портал
  for (let z = -5; z >= -60; z -= 2) { owner = { position: new Vec3(0, 40, z) }; t.teachTick(); }
  const msg = t.teachStop();
  ok('«пришли» - дорога сохранена, через два мира', /запомнил дорогу «замок».*обычный мир -> Незер/.test(msg), msg);
  ok('конец дороги - место «замок»', t.memory.findPlace('замок') && t.memory.findPlace('замок').dim === 'Незер');
  // повтор: стоим в обычном мире на середине дороги
  t.bot.game.dimension = 'minecraft:overworld'; t.bot.entity.position = new Vec3(0, 64, -20);
  const walked = [], acts = [];
  t.walkTo = async (p) => { walked.push(p); t.bot.entity.position = new Vec3(p.x, p.y, p.z); };
  t.run = async (a) => { acts.push(a[0].act); t.bot.game.dimension = 'minecraft:the_nether'; return 'ok'; };
  t.routeRun({ name: 'замок' }, 0).then((r) => {
    ok('повтор с ближайшей точки, портал там, где сменился мир', walked[0].z <= -20 && acts.includes('portal') && walked[walked.length - 1].z <= -55, `${r}; первая точка z=${walked[0].z}, портал: ${acts.includes('portal')}, последняя z=${walked[walked.length - 1].z}`);
    console.log(`--- карта связей и маршруты: ${res.filter(Boolean).length} из ${res.length}`);
  });
}
