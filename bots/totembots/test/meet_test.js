// Встречи, «где дом», достать вещь - на модели тела без сервера.
const { EventEmitter } = require('events');
const { Senses } = require('../app/senses');
const { Perception } = require('../app/perception');
const { Obtain } = require('../app/obtain');
const res = [];
const ok = (n, c, i) => res.push([n, !!c, i]);
const mix = (...Ms) => { const t = new EventEmitter(); for (const M of Ms) for (const k of Object.getOwnPropertyNames(M.prototype)) if (k !== 'constructor') t[k] = M.prototype[k]; return t; };

// встречи
{ const t = mix(Senses); t.bot = { username: 'Alex' }; t.memory = { data: {}, save() {} };
  const got = []; t.on('reunion', (e) => got.push(e));
  const T0 = 1e12;
  t.metTick('Valghard', 20, T0);            // виден издалека - ещё не встреча
  t.metTick('Valghard', 8, T0 + 1000);      // подошёл - здороваемся (первая встреча)
  t.metTick('Valghard', 8, T0 + 60000);     // стоит рядом - не повторять
  t.metTick('Valghard', 8, T0 + 20 * 60000);
  ok('первая встреча - один привет', got.length === 1 && got[0].gap === null, JSON.stringify(got));
  t.metTick('Valghard', 8, T0 + 20 * 60000 + 4 * 3600000);   // 4 часа не виделись
  ok('через 4 часа - снова привет', got.length === 2 && got[1].gap >= 239, JSON.stringify(got[1])); }

// где дом
{ const t = mix(Perception); t.dimName = () => 'обычный мир';
  t.memory = { data: { places: { d: { name: 'мой дом', x: 288, y: 68, z: -573, dim: 'обычный мир', at: 1 } } } };
  t.bot = { entity: { position: { x: 271, y: 66, z: -536 } } };
  const far = t.homeText(); t.bot.entity.position = { x: 290, y: 68, z: -570 }; const home = t.homeText();
  ok('среди чужих домов - не дома', /НЕ дома.*4[01] бл\. на северо-восток/.test(far), far); ok('у дома - дома', /^ты дома/.test(home), home); }

// достать: уже есть - сразу; нигде нет - честно, где смотрела
(async () => {
  const t = mix(Obtain); t.dimName = () => 'обычный мир'; t.memory = { data: {}, save() {} }; t.check = () => {}; t.isCancel = () => false;
  t.bot = { entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [{ name: 'white_wool', count: 70 }] }, findBlocks: () => [] };
  ok('уже есть', /уже есть 70/.test(await t.obtain({ item: 'white_wool', count: 64 })));
  t.bot.inventory.items = () => [];
  try { await t.obtain({ item: 'white_wool', count: 64 }); ok('нигде нет', false); } catch (e) { ok('нигде нет - что дальше', /своего дома не знаю.*никто рядом не продаёт.*попроси у хозяина/.test(e.message), e.message); }
  const bad = res.filter((r) => !r[1]);
  for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
  console.log(`встречи, дом, достать: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
})();
