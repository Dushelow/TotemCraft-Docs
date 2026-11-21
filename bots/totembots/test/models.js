// Быстрые проверки без сервера (секунды): загрузка модулей, приказы, разбор ответов, модели лестницы, плавания,
// троп и разведки. node test/models.js
const { execFileSync } = require('child_process');
const path = require('path');
for (const t of ['stairs_test.js', 'swim_test.js', 'scout_test.js']) {
  console.log('--- ' + t);
  process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, t)]).toString());
}
const B = require('../app/brain');
const cases = [['за мной', 'follow'], ['стой', 'hold'], ['жди тут', 'hold'], ['ближе', 'followDist'], ['не дерись', 'combat'], ['заходи в портал', 'portal'], ['садись в лодку', 'mount'], ['слезай', 'dismount'], ['выкинь всё', 'discardAll'], ['выложи лишнее', 'stash']];
const bad = cases.filter(([t, a]) => { const r = B.quickOrder(t, 'V'); return !r || r[0].act !== a; });
console.log(`--- приказы хозяина: ${cases.length - bad.length} из ${cases.length}${bad.length ? ' НЕ ВЫШЛО: ' + bad.map((x) => x[0]).join(', ') : ''}`);
const os = require('os'), fs = require('fs');
const { Trails } = require('../app/travel');
const tr = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'tr'))), st = {};
for (let x = 0; x <= 100; x++) tr.step('nether', { x, y: 64, z: 0 }, st);
for (let z = 0; z <= 80; z++) tr.step('nether', { x: 100, y: 64, z }, st);
const r = tr.route('nether', { x: 2, y: 64, z: 1 }, { x: 99, y: 64, z: 79 });
console.log('--- тропы: ' + (r ? `маршрут ${Math.round(r.len)} бл. по ${r.points.length} точкам` : 'НЕТ МАРШРУТА'));
