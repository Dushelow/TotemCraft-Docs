// Случайные миры для ходьбы (как фаззинг у опытных разработчиков): сотни случайных площадок со ступеньками, плитами,
// заборами, люками, дверями, кроватями, коврами, ямами, водой и стенами. Для каждой - путь нашей навигацией, и если
// он найден, его проходит физика самой игры. Ошибка навигации = путь есть, а тело не проходит, или поиск упал.
// Повторяемо: случайность по номеру мира (seed). node test/fuzz_nav.js [сколько миров]
const { world, find, replay, lastCtlOf, goals } = require('./navlib');

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const DIR = ['north', 'south', 'east', 'west'];
const PIECES = [
  (set, x, z) => set(x, 65, z, 'stone'),
  (set, x, z) => { set(x, 65, z, 'stone'); set(x, 66, z, 'stone'); },
  (set, x, z) => set(x, 65, z, 'oak_slab', { type: pick(['bottom', 'top']), waterlogged: false }),
  (set, x, z) => set(x, 65, z, 'oak_stairs', { facing: pick(DIR), half: 'bottom', shape: 'straight', waterlogged: false }),
  (set, x, z) => set(x, 65, z, 'oak_fence', { east: false, west: false, north: false, south: false, waterlogged: false }),
  (set, x, z) => set(x, 65, z, 'oak_trapdoor', { facing: pick(DIR), half: pick(['bottom', 'top']), open: rnd() < 0.5, powered: false, waterlogged: false }),
  (set, x, z) => set(x, 66, z, 'oak_trapdoor', { facing: pick(DIR), half: 'bottom', open: rnd() < 0.5, powered: false, waterlogged: false }),
  (set, x, z) => set(x, 65, z, 'red_carpet'),
  (set, x, z) => set(x, 65, z, 'red_bed', { facing: pick(DIR), part: 'foot', occupied: false }),
  (set, x, z) => { set(x, 64, z, 'air'); set(x, 63, z, rnd() < 0.3 ? 'water' : 'air'); set(x, 62, z, 'stone'); },
  (set, x, z) => { set(x, 64, z, 'farmland', { moisture: 7 }); },
  (set, x, z) => { const f = pick(DIR), o = rnd() < 0.5; set(x, 65, z, 'oak_door', { facing: f, half: 'lower', hinge: 'left', open: o, powered: false }); set(x, 66, z, 'oak_door', { facing: f, half: 'upper', hinge: 'left', open: o, powered: false }); },   // половины двери - в одном положении, как в игре
  (set, x, z) => set(x, 67, z, 'stone'),   // низкий потолок
  (set, x, z) => set(x, 65, z, 'lantern', { hanging: false, waterlogged: false }),
];

function gen(w) {
  seed = w * 7919;
  const pieces = [];
  for (let i = 0; i < 40; i++) pieces.push([Math.floor(rnd() * 15) - 3, Math.floor(rnd() * 11) - 5, Math.floor(rnd() * PIECES.length), seed]);
  return (set) => { for (const [x, z, k, s] of pieces) { if ((x === 0 && z === 0) || (x === 10 && z === 0)) continue; const keep = seed; seed = s; PIECES[k](set, x, z); seed = keep; } };
}
// разбор одного мира: node test/fuzz_nav.js show <мир> x,z;x,z
if (process.argv[2] === 'show') {
  const bot = world(gen(+process.argv[3])), { Vec3 } = require('vec3');
  for (const c of process.argv[4].split(';')) { const [x, z] = c.split(',').map(Number); const out = []; for (let y = 62; y <= 67; y++) { const b = bot.blockAt(new Vec3(x, y, z)); if (b.name !== 'air') out.push(y + ':' + b.name + (Object.keys(b.getProperties()).length ? JSON.stringify(b.getProperties()).replace(/"/g, '') : '')); } console.log(x, z, out.join(' ')); }
  process.exit(0);
}
const N = +process.argv[2] || 150;
let found = 0, none = 0, bad = 0, crashed = 0;
const fails = [];
for (let w = 1; w <= N; w++) {
  const build = gen(w);
  let r;
  try { r = find(world(build), [0, 65, 0], new goals.GoalNearXZ(10, 0, 1)); } catch (e) { crashed++; fails.push(`мир ${w}: поиск упал: ${e.message}`); continue; }
  if (r.status !== 'success') { none++; continue; }
  found++;
  let why = null;
  try { why = replay(world(build), [0, 65, 0], r, lastCtlOf()); } catch (e) { why = 'проверка упала: ' + e.message; }
  if (why) { bad++; fails.push(`мир ${w}: ${why}; путь ${r.path.slice(0, 8).map((p) => `${p.x},${p.y},${p.z}${p.leap ? 'п' : ''}${p.opens ? 'о' : ''}`).join(' ')}`); }
}
console.log(`--- случайные миры: ${N}, путь найден в ${found}, нет пути ${none}, физика не прошла ${bad}, поиск упал ${crashed}`);
for (const f of fails.slice(0, 8)) console.log('НЕТ ' + f);
if (bad || crashed) process.exitCode = 1;
