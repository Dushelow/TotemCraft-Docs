const { world, find, goals, registry, Block } = require('./navlib');
// море: вода y 60..64 везде на x<=3; борт корабля x=4 (доски y 60..69), палуба x 4..10 на y 69 (стоять на 70);
// лианы на борту со стороны моря: клетки x=3, y 65..69 (над водой), прицеплены к востоку (к борту)
const vine = (set, y) => set(3, y, 0, 'vine', { east: true, north: false, south: false, west: false, up: false });
function build(gapFromWater) {
  return world((set) => {
    for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) { for (let y = 59; y <= 64; y++) set(x, y, z, x <= 3 ? 'water' : 'oak_planks'); }
    for (let z = -6; z <= 6; z++) for (let y = 65; y <= 69; y++) set(4, y, z, 'oak_planks');
    for (let x = 5; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 69, z, 'oak_planks');
    for (let y = 65 + gapFromWater; y <= 69; y++) vine(set, y);
  });
}
let okAll = true;
for (const gap of [0, 1]) {
  const b = build(gap);
  const r = find(b, [0, 64, 0], new goals.GoalBlock(6, 70, 0));
  const ok = r.status === 'success' && r.path.some((m) => m.y >= 69 && m.x === 3); okAll = okAll && ok;
  console.log(`${ok ? 'да ' : 'НЕТ'} из воды по лианам на палубу (лианы с высоты ${65 + gap}): ${r.path.map((m) => `${m.x},${m.y},${m.z}`).join(' ')}`);
}
// 3. как у корабля на спавне: у борта уступ (выступ днища) на уровне воды, лианы начинаются на 2 бл. выше уступа
{
  const b = world((set) => {
    for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) for (let y = 59; y <= 64; y++) set(x, y, z, x <= 2 ? 'water' : 'oak_planks');
    for (let z = -6; z <= 6; z++) { for (let y = 65; y <= 69; y++) set(4, y, z, 'oak_planks'); set(3, 64, z, 'oak_planks'); }
    for (let x = 5; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 69, z, 'oak_planks');
    for (let y = 66; y <= 69; y++) vine(set, y);
  });
  const r = find(b, [0, 64, 0], new goals.GoalBlock(6, 70, 0));
  const ok = r.status === 'success' && r.path.some((m) => m.y >= 69 && m.x === 3); okAll = okAll && ok;
  console.log(`${ok ? 'да ' : 'НЕТ'} лианы над уступом у воды - наверх: ${r.status} ${r.path.map((m) => `${m.x},${m.y},${m.z}`).join(' ')}`);
}
console.log('--- лианы: ' + (okAll ? 3 : 0) + ' из 3'); process.exitCode = okAll ? 0 : 1;
