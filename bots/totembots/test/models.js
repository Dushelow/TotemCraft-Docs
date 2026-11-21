// Быстрые проверки без сервера (секунды): загрузка модулей, приказы, разбор ответов, модели лестницы, плавания,
// троп и разведки. node test/models.js
const { execFileSync } = require('child_process');
const path = require('path');
for (const t of ['house_test.js', 'swim_test.js', 'scout_test.js']) {
  console.log('--- ' + t);
  process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, t)]).toString());
}
const B = require('../app/brain');
const cases = [['за мной', 'follow'], ['стой', 'hold'], ['жди тут', 'hold'], ['ближе', 'followDist'], ['не дерись', 'combat'], ['заходи в портал', 'portal'], ['садись в лодку', 'mount'], ['слезай', 'dismount'], ['выкинь всё', 'discardAll'], ['выложи лишнее', 'stash'], ['верни обратно', 'undoPut']];
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
