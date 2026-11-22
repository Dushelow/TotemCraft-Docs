const { world, find, goals } = require('./navlib');
// бассейн x 0..8, z -2..2, глубина 4 (y 61..64 вода, дно 60); посередине стена до верха (x=4) с проходом внизу (y 61-62)
const b = world((set) => {
  for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) for (let y = 60; y <= 64; y++) set(x, y, z, 'stone');
  for (let x = 0; x <= 8; x++) for (let z = -2; z <= 2; z++) for (let y = 61; y <= 64; y++) set(x, y, z, 'water');
  for (let z = -6; z <= 6; z++) for (let y = 63; y <= 70; y++) set(4, y, z, 'stone');   // стена: выше воды и вниз до 63
  for (let z = -6; z <= 6; z++) for (let x = -6; x <= 12; x++) if (x < 0 || x > 8 || z < -2 || z > 2) for (let y = 65; y <= 70; y++) set(x, y, z, 'stone');   // берег высокий - вокруг не обойти
});
const r = find(b, [1, 64, 0], new goals.GoalBlock(7, 64, 0));
const ok = r.status === 'success' && r.path.some((m) => m.x === 4 && m.y <= 62);
console.log((ok ? 'да ' : 'НЕТ') + ' поднырнуть под стену: ' + r.path.map((m) => `${m.x},${m.y},${m.z}`).join(' '));
console.log('--- плавание под водой: ' + (ok ? 1 : 0) + ' из 1');
process.exitCode = ok ? 0 : 1;
