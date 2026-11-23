// Инструменты «узнать» (survey.js) на модели: связи мест и «как пройти», поиск существ и блоков, обследование.
// node test/survey_test.js
const { Vec3 } = require('vec3');
const { Survey } = require('../app/survey');
const res = []; const ok = (n, c, i) => { res.push(!!c); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };

function make() {
  const t = Object.create(Survey.prototype);
  const places = {};
  t.memory = { data: { places }, save() {}, findPlace: (n) => places[String(n).toLowerCase()] };
  t.dimName = () => 'Незер';
  t.bot = {
    entity: { position: new Vec3(0, 32, 0) }, game: { dimension: 'minecraft:the_nether' },
    entities: {
      1: { name: 'villager', position: new Vec3(5, 32, 3) }, 2: { name: 'villager', position: new Vec3(-20, 32, 9) },
      3: { type: 'player', username: 'Odin', position: new Vec3(2, 32, 2) }, 4: { name: 'zombie', position: new Vec3(30, 32, 0) },
    },
    registry: { blocksByName: { nether_portal: { id: 1, name: 'nether_portal' }, chest: { id: 2, name: 'chest' } } },
    findBlocks: ({ matching }) => ((Array.isArray(matching) ? matching : [matching]).includes(2) ? [new Vec3(3, 32, 1), new Vec3(9, 31, 4)] : []),
    blockAt: () => ({ name: 'chest' }),
  };
  t.bot.entities[0] = t.bot.entity;
  t.guard = { isHostile: (e) => e.name === 'zombie' };
  t.check = () => {}; t.isCancel = () => false; t.log = () => {};
  return t;
}

(async () => {
  const t = make();
  // связи: хаб - северная ветка - выход - замок
  t.link({ a: 'незерхаб', b: 'выход к замку', how: 'по северной ледяной ветке' });
  t.link({ a: 'выход к замку', b: 'замок', how: 'портал наверх, потом 50 бл. на восток' });
  const h = t.howTo({ to: 'замок', from: 'незерхаб' });
  ok('«как пройти»: цепочка связей хаб -> выход -> замок', /незерхаб -> выход к замку.*выход к замку -> замок/.test(h), h);
  ok('незнакомое место - честно «не знаю» и что делать', /не знаю.*survey/.test(t.howTo({ to: 'атлантида' })));
  const fe = t.findEntity({ who: 'жители' });
  ok('где жители: 2, ближайший первым', /villager: 2|жители: 2/.test(fe) && fe.indexOf('5 32 3') < fe.indexOf('-20'), fe);
  ok('враги рядом', /zombie/.test(t.findEntity({ who: 'враги' })));
  const sc = t.scanBlocks({ block: 'chest' });
  ok('сундуки: сколько и где', /chest: 2/.test(sc), sc);
  // обследование: два прохода, по каждому пройти и вернуться; связи записаны
  let scene = { roads: [
    { kind: 'тоннель', mat: ['netherrack'], e1: { x: 0, z: -3 }, e2: { x: 0, z: -40 }, more: true },
    { kind: 'мост', mat: ['blue_ice'], e1: { x: 3, z: 0 }, e2: { x: 40, z: 0 }, more: true },
  ], marks: [], signs: [] };
  t.featuresTick = () => { t._scene = scene; };
  const went = [];
  t.goto = async (g) => { went.push([g.x, g.z]); t.bot.entity.position = new Vec3(g.x ?? 0, 32, g.z ?? 0); };
  const r = await t.survey({ radius: 40 }, 0);
  ok('обследование: оба прохода пройдены, отчёт с направлениями', /тоннель из netherrack на север/.test(r) && /мост из blue_ice на восток/.test(r), r.slice(0, 220));
  ok('вернулся туда, откуда начал', went.length >= 3 && Math.hypot(t.bot.entity.position.x, t.bot.entity.position.z) < 3);
  ok('связи из обследования записаны', (t.memory.data.links || []).length >= 4, (t.memory.data.links || []).length + ' связей');
  console.log(`--- инструменты «узнать»: ${res.filter(Boolean).length} из ${res.length}`);
})();
