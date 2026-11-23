// Типовые постройки игроков (входы в базы, лазы, лестницы, проходы): для каждой - путь нашей навигацией туда и
// обратно и проверка физикой игры. Механизмы (поршни, кнопки) физика стенда не двигает - их проверяет игра.
// node test/structures_test.js
const { world, find, replay, lastCtlOf, goals } = require('./navlib');

const solid = (set, x0, x1, y0, y1, z0, z1, b = 'stone') => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, b); };
const air = (set, x0, x1, y0, y1, z0, z1) => solid(set, x0, x1, y0, y1, z0, z1, 'air');
const LAD = (f) => ['ladder', { facing: f, waterlogged: false }];
const TD = (half, open, facing = 'west') => ['oak_trapdoor', { facing, half, open, powered: false, waterlogged: false }];
const ST = (f, half = 'bottom') => ['stone_stairs', { facing: f, half, shape: 'straight', waterlogged: false }];

// каждая постройка: build(set), откуда, куда (низ - y 55, верх - y 65 на полу 64)
const S = {
  'шахта с лестницей у стены': [(set) => { solid(set, -3, 5, 50, 63, -3, 3); air(set, 1, 1, 55, 64, 0, 0); for (let y = 55; y <= 64; y++) set(1, y, 0, ...LAD('west')); }, [0, 65, 0], [1, 55, 0]],
  'лестница без стен по бокам (столб у колонны)': [(set) => { solid(set, -3, 5, 50, 54, -3, 3); air(set, -3, 5, 55, 64, -3, 3); solid(set, 2, 2, 55, 63, 0, 0); for (let y = 55; y <= 63; y++) set(1, y, 0, ...LAD('west')); solid(set, 2, 4, 63, 63, -1, 1); }, [3, 64, 0], [1, 55, 0]],
  'верхняя ступенька срублена': [(set) => { solid(set, -3, 5, 50, 63, -3, 3); air(set, 1, 1, 55, 64, 0, 0); air(set, 2, 4, 64, 66, -1, 1); for (let y = 55; y <= 62; y++) set(1, y, 0, ...LAD('west')); }, [3, 64, 0], [1, 55, 0]],
  'люк в полу над лестницей': [(set) => { solid(set, -3, 5, 50, 63, -3, 3); air(set, 1, 1, 55, 64, 0, 0); set(1, 64, 0, ...TD('top', false)); for (let y = 55; y <= 63; y++) set(1, y, 0, ...LAD('west')); }, [0, 65, 0], [1, 55, 0]],
  'лестница по ступеням (пролёт)': [(set) => { solid(set, -3, 8, 50, 63, -3, 3); air(set, 0, 7, 56, 64, 0, 0); for (let i = 0; i < 8; i++) { set(7 - i, 56 + i, 0, ...ST('west')); } solid(set, 0, 7, 55, 55, 0, 0); }, [-1, 65, 0], [7, 57, 0]],
  'винтовая лестница': [(set) => { solid(set, -3, 5, 50, 63, -3, 3); air(set, 0, 2, 55, 64, -1, 1); set(1, 55, 0, 'stone'); set(1, 56, 0, 'stone'); set(1, 57, 0, 'stone'); set(1, 58, 0, 'stone'); set(1, 59, 0, 'stone'); set(1, 60, 0, 'stone'); set(1, 61, 0, 'stone'); set(1, 62, 0, 'stone'); set(1, 63, 0, 'stone');
    const ring = [[0, -1], [1, -1], [2, -1], [2, 0], [2, 1], [1, 1], [0, 1], [0, 0]]; for (let i = 0; i < 9; i++) { const [x, z] = ring[i % 8]; set(x, 55 + i, z, 'stone'); } }, [0, 65, -1], [2, 55, 1]],
  'лаз ползком 1 блок (люк сверху)': [(set) => { solid(set, -3, 8, 64, 66, -3, 3); air(set, -3, -1, 65, 66, -1, 1); air(set, 0, 5, 65, 65, 0, 0); air(set, 6, 8, 65, 66, -1, 1); set(0, 66, 0, ...TD('bottom', false)); }, [-2, 65, 0], [7, 65, 0]],
  'проход за дверью': [(set) => { solid(set, 2, 2, 65, 67, -3, 3); set(2, 65, 0, 'oak_door', { facing: 'east', half: 'lower', hinge: 'left', open: false, powered: false }); set(2, 66, 0, 'oak_door', { facing: 'east', half: 'upper', hinge: 'left', open: false, powered: false }); }, [0, 65, 0], [5, 65, 0]],
  'калитка в заборе': [(set) => { for (let z = -6; z <= 6; z++) set(2, 65, z, 'oak_fence', { east: false, west: false, north: true, south: true, waterlogged: false }); set(2, 65, 0, 'oak_fence_gate', { facing: 'east', open: false, powered: false, in_wall: false }); }, [0, 65, 0], [5, 65, 0]],
  'прыжок в воду с высоты': [(set) => { solid(set, -3, 8, 50, 63, -3, 3); air(set, 3, 5, 52, 64, -1, 1); for (let x = 3; x <= 5; x++) for (let z = -1; z <= 1; z++) for (let y = 52; y <= 54; y++) set(x, y, z, 'water'); solid(set, 6, 8, 52, 54, -1, 1); air(set, 6, 8, 55, 64, -1, 1); for (let y = 55; y <= 64; y++) set(8, y, 0, 'ladder', { facing: 'west', waterlogged: false }); }, [2, 65, 0], [7, 55, 0]],
  'лабиринт': [(set) => { solid(set, -3, 9, 65, 66, -3, 3); const cells = [[-2, 0], [-1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [2, -1], [2, -2], [3, -2], [4, -2], [4, -1], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0]]; for (const [x, z] of cells) air(set, x, x, 65, 66, z, z); }, [-2, 65, 0], [8, 65, 0]],
  'лианы по стене': [(set) => { solid(set, -3, 5, 50, 63, -3, 3); air(set, 1, 1, 55, 64, 0, 0); for (let y = 55; y <= 64; y++) set(1, y, 0, 'vine', { east: true, west: false, north: false, south: false, up: false }); }, [0, 65, 0], [1, 55, 0]],
};

let bad = 0, total = 0;
for (const [name, [build, top, bottom]] of Object.entries(S)) {
  for (const [dir, from, to] of [['туда', top, bottom], ['обратно', bottom, top]]) {
    total++;
    let r, why = null;
    try { r = find(world(build), from, new goals.GoalBlock(to[0], to[1], to[2])); } catch (e) { why = 'поиск упал: ' + e.message; }
    if (!why && r.status !== 'success') why = `пути нет (${r.status})`;
    if (!why) { try { why = replay(world(build), from, r, lastCtlOf()); } catch (e) { why = 'проверка упала: ' + e.message; } }
    if (why) bad++;
    console.log(`${why ? 'НЕТ' : 'ДА '} ${name} (${dir})${why ? ': ' + why.slice(0, 140) : ''}`);
  }
}
console.log(`--- построек ${Object.keys(S).length}, проходов ${total}, прошёл ${total - bad}`);
if (bad) process.exitCode = 1;
