// Лазы вниз с люками и лестницами (23.11, секретная комната владельца: три люка на разной высоте и в разных
// положениях, лестницы на разных стенах). Для каждого - путь нашей навигацией и проверка физикой игры.
// node test/shaft_test.js
const { world, find, replay, lastCtlOf, goals } = require('./navlib');

// камень вокруг лаза от 50 до 64, лаз (столб) вырезан
function rock(set, cols) {
  for (let x = -3; x <= 5; x++) for (let z = -3; z <= 3; z++) for (let y = 50; y <= 63; y++) set(x, y, z, 'stone');
  for (const [x, y, z] of cols) set(x, y, z, 'air');
}
const TD = (half, open, facing = 'north') => ['oak_trapdoor', { facing, half, open, powered: false, waterlogged: false }];
const LAD = (facing) => ['ladder', { facing, waterlogged: false }];

const CASES = {
  // люк в полу рядом с ботом (закрыт, у верха блока), под ним лестница на восточной стене до пола
  'люк сбоку, лестница': (set) => {
    const c = []; for (let y = 55; y <= 64; y++) c.push([1, y, 0]); rock(set, c);
    set(1, 64, 0, ...TD('top', false));
    for (let y = 55; y <= 63; y++) set(1, y, 0, ...LAD('west'));
  },
  // лаз с двумя закрытыми люками на разной высоте, лестница сначала на одной стене, потом на другой
  'два люка, лестницы на разных стенах': (set) => {
    const c = []; for (let y = 55; y <= 64; y++) c.push([1, y, 0]); rock(set, c);
    set(1, 64, 0, ...TD('top', false));
    for (let y = 61; y <= 63; y++) set(1, y, 0, ...LAD('west'));
    set(1, 60, 0, ...TD('bottom', false, 'east'));
    for (let y = 55; y <= 59; y++) set(1, y, 0, ...LAD('south'));
  },
  // открытый люк посреди лаза (стоит ребром у стенки) и закрытый внизу у пола
  'открытый люк в лазе': (set) => {
    const c = []; for (let y = 55; y <= 64; y++) c.push([1, y, 0]); rock(set, c);
    set(1, 64, 0, ...TD('top', true, 'east'));
    for (let y = 59; y <= 63; y++) set(1, y, 0, ...LAD('west'));
    set(1, 58, 0, ...TD('top', false));
    for (let y = 55; y <= 57; y++) set(1, y, 0, ...LAD('west'));
  },
};

let bad = 0;
for (const [name, build] of Object.entries(CASES)) {
  let r, why = null;
  try { r = find(world(build), [0, 65, 0], new goals.GoalBlock(1, 55, 0)); } catch (e) { why = 'поиск упал: ' + e.message; }
  if (!why && r.status !== 'success') why = `пути нет (${r.status}), дошёл до ${r.path.length ? Object.values(r.path[r.path.length - 1]).slice(0, 3).join(',') : '-'}`;
  if (!why) { try { why = replay(world(build), [0, 65, 0], r, lastCtlOf()); } catch (e) { why = 'проверка упала: ' + e.message; } }
  console.log(`${why ? 'НЕТ' : 'ДА '} ${name}${why ? ': ' + why : ''}${r && r.path ? '; путь ' + r.path.map((p) => `${p.x},${p.y},${p.z}${p.opens ? 'о' : ''}`).join(' ') : ''}`);
  if (why) bad++;
}
if (bad) process.exitCode = 1;
