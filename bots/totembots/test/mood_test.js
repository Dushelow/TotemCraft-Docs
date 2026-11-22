// Настроение как у Сераны (mood.js): оси сдвигаются и возвращаются; реплика при входе в место - одна, тон по настроению; музыка - танец.
const path = require('path');
const { Vec3 } = require(path.resolve(__dirname, '../node_modules') + '/vec3');
const { Mood } = require('../app/mood');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const said = [], gest = [];
let cave = false;
const t = Object.create(Mood.prototype);
Object.assign(t, { bot: { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, time: { timeOfDay: 6000 }, isRaining: false }, comp: { barkAt: 0, topic: {} }, mode: 'follow', followName: 'V',
  say: (x) => said.push(x), log() {}, threat: () => ({ level: 'спокойно' }), gesture: async (k) => gest.push(k), inCave: () => cave, nearCave: () => false, nearStruct: () => false, inVillage: () => false, inPlayerTown: () => false, atHome: () => false });
const owner = { position: new Vec3(2, 64, 0) };
let now = 1e12;
t.moodShift('play', 0.8); t.moodShift('open', 0.6);
ok('игривая и открытая', t.moodWord() === 'открытая, игривая', t.moodWord());
t.mood().at = now; for (let i = 0; i < 300; i++) { now += 1000; t.moodTick(null, now); }
ok('через 5 мин - ровнее', t.mood().play < 0.4, t.mood().play.toFixed(2));
t.moodShift('play', -0.9);
now += 31000; t.moodTick(owner, now); cave = true; now += 31000; t.moodTick(owner, now);
ok('вошла в пещеру - реплика, серьёзная', said.length === 1 && /тяжёлый|слушай/.test(said[0]), said.join(' | '));
now += 31000; t.moodTick(owner, now); ok('в той же пещере - не повторяет', said.length === 1);
t.musicAt = now; now += 500; t.moodTick(owner, now); ok('музыка рядом - танцует', gest.length === 1, gest.join(','));
const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
console.log(`настроение: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
