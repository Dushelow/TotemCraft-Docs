// Сценарии ходьбы без сервера: модель мира + поиск пути по настоящей форме блоков (app/nav.js).
// Судья - физика самой игры (prismarine-physics, ей же ходит бот): каждый найденный путь проигрывается шаг за шагом,
// и если тело физически не проходит, это ошибка навигации, даже когда путь «нашёлся». Так модель не может
// обмануть себя, как было с заплатками (лестница под низким потолком: путь был, а пройти нельзя).
// Каждая ошибка из игры - сценарий здесь. node test/house_test.js
const path = require('path');
const { world, find, replay, lastCtlOf, Vec3, goals } = require('./navlib');
const results = [];
function check(name, build, from, goal, wantPath, extra, stepCost) {
  const r = find(world(build), from, goal, stepCost);
  let ok = (r.status === 'success') === wantPath, note = '';
  if (r.status === 'success') {
    const bad = replay(world(build), from, r, lastCtlOf());
    if (bad) { ok = false; note = ' - ' + bad; }
    if (ok && extra) { const e = extra(r.path); if (e) { ok = false; note = ' - ' + e; } }
  }
  results.push(ok);
  console.log(`${ok ? 'да ' : 'НЕТ'} ${name}: ${r.status}${r.status === 'success' ? ' через ' + r.path.slice(0, 5).map((p) => `${p.x},${p.y},${p.z}${p.opens ? '(откр.)' : ''}${p.leap ? '(прыжок)' : ''}`).join(' ') : ''}${note}`);
}
const wall = (set, x, h = 3) => { for (let z = -6; z <= 6; z++) for (let y = 65; y < 65 + h; y++) set(x, y, z, 'stone'); };
const T = (half, open, facing = 'east') => ({ facing, half, open, powered: false, waterlogged: false });
const G = (x, y, z) => new goals.GoalBlock(x, y, z);
const avoidX = (x, z0, z1) => (p) => p.some((m) => m.x === x && m.z >= z0 && m.z <= z1) ? `прошла сквозь стену в ${x}` : null;
const FENCE = { east: false, west: false, north: true, south: true, waterlogged: false };
const DOOR = (name, half) => [name, { facing: 'east', half, hinge: 'left', open: false, powered: false }];

// --- из игры 15-21.11
// 1. Выход из дома - люк-дверь в проёме стены: внизу пусто, люк на уровне головы (21.11, дом у 333 -432)
check('люк-дверь в проёме - открыть и пройти', (set) => { wall(set, 3); set(3, 65, 0, 'air'); set(3, 66, 0, 'pale_oak_trapdoor', T('bottom', false, 'north')); }, [0, 65, 0], G(6, 65, 0), true);
// 2. Стена амбара из люков в два ряда (21.11, 315 65 -461) - стена, в проём не идти
check('стена из люков в проёме - не проход', (set) => { wall(set, 3); set(3, 65, 0, 'acacia_trapdoor', T('bottom', true)); set(3, 66, 0, 'acacia_trapdoor', T('bottom', true)); }, [0, 65, 0], G(6, 65, 0), false);
// 3. Закрытый люк в полу - по нему ходят
check('закрытый люк в полу - пол', (set) => { set(2, 64, 0, 'oak_trapdoor', T('top', false)); }, [0, 65, 0], G(4, 65, 0), true);
// 4. Лестница на второй этаж: проём над лестницей начинается за клетку до неё - подняться можно
const STAIRS = (open0) => (set) => {
  const E = { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false };
  set(1, 65, 0, 'oak_stairs', E); set(2, 65, 0, 'stone'); set(2, 66, 0, 'oak_stairs', E); set(3, 65, 0, 'stone'); set(3, 66, 0, 'stone'); set(3, 67, 0, 'oak_stairs', E);
  for (let x = 4; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 67, z, 'oak_planks');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!(z === 0 && x >= open0)) set(x, 67, z, 'oak_planks');
  for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) set(x, 70, z, 'oak_planks');
};
check('лестница, проём с запасом', STAIRS(0), [0, 65, 0], G(5, 68, 0), true);
// 4б. Проём только над ступеньками: голова упирается в потолок - игрок тоже не поднимется (проверено физикой игры)
check('лестница, проём впритык - честно нет пути', STAIRS(1), [-1, 65, 0], G(5, 68, 0), false);
// 5. Сплошная стена без прохода - честно «пути нет» (а не пустой путь, принятый за «дошла»)
check('сплошная стена - пути нет', (set) => wall(set, 3, 4), [0, 65, 0], G(6, 65, 0), false);
// 6. Стоит на кровати (21.11 «стоит как дурак на кровати») - сойти и дойти
check('с кровати - дальше', (set) => { set(0, 65, 0, 'red_bed', { facing: 'east', part: 'foot', occupied: false }); set(1, 65, 0, 'red_bed', { facing: 'east', part: 'head', occupied: false }); }, [0, 65, 0], G(4, 65, 2), true);
// 7. Стена из открытых люков на открытом месте (21.11 «бился в стену из люков») - обойти, а не ломиться
check('забор из люков - обойти', (set) => { for (let z = -2; z <= 2; z++) { set(3, 65, z, 'spruce_trapdoor', T('bottom', true)); set(3, 66, z, 'spruce_trapdoor', T('bottom', true)); } }, [0, 65, 0], G(6, 65, 0), true, avoidX(3, -2, 2));

// --- формы блоков
check('плиты и ковёр - шагом', (set) => { set(1, 65, 0, 'oak_slab', { type: 'bottom', waterlogged: false }); set(2, 65, 0, 'stone'); set(3, 65, 0, 'stone'); set(3, 66, 0, 'red_carpet'); }, [0, 65, 0], G(3, 66, 0), true);
check('забор не перепрыгнуть', (set) => { for (let z = -6; z <= 6; z++) set(3, 65, z, 'oak_fence', FENCE); }, [0, 65, 0], G(6, 65, 0), false);
check('калитка в заборе - открыть', (set) => { for (let z = -6; z <= 6; z++) set(3, 65, z, 'oak_fence', FENCE); set(3, 65, 0, 'oak_fence_gate', { facing: 'east', in_wall: false, open: false, powered: false }); }, [0, 65, 0], G(6, 65, 0), true);
check('деревянная дверь - открыть', (set) => { wall(set, 3); set(3, 65, 0, ...DOOR('oak_door', 'lower')); set(3, 66, 0, ...DOOR('oak_door', 'upper')); }, [0, 65, 0], G(6, 65, 0), true);
check('железная дверь - рукой не открыть', (set) => { wall(set, 3); set(3, 65, 0, ...DOOR('iron_door', 'lower')); set(3, 66, 0, ...DOOR('iron_door', 'upper')); }, [0, 65, 0], G(6, 65, 0), false);
check('щель 1,5 под плитой - не пролезть', (set) => { wall(set, 3); set(3, 65, 0, 'air'); set(3, 66, 0, 'oak_slab', { type: 'top', waterlogged: false }); }, [0, 65, 0], G(6, 65, 0), false);
check('угол по диагонали - не срезать', (set) => { for (let x = -6; x <= 12; x++) for (let z = -6; z <= 6; z++) if (!((x === 0 && z === 0) || (x === 1 && z === 1))) { set(x, 65, z, 'stone'); set(x, 66, z, 'stone'); } }, [0, 65, 0], G(1, 65, 1), false);
check('ступенька 1 блок - прыжком', (set) => { for (let x = 2; x <= 6; x++) set(x, 65, 0, 'stone'); }, [0, 65, 0], G(4, 66, 0), true);
check('потолок над прыжком - обойти', (set) => { set(2, 65, 0, 'stone'); set(1, 67, 0, 'stone'); set(0, 67, 0, 'stone'); }, [0, 65, 0], G(2, 66, 0), true);
// --- грядки (22.11): прыжок и падение на грядку её вытаптывают
const FARM = (set) => { for (let x = 2; x <= 4; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'farmland', { moisture: 7 }); };
check('грядки: поле во всю ширину - пройти шагом, не прыгая', (set) => FARM(set), [0, 65, 0], G(6, 65, 0), true,
  (p) => { const n = p.filter((m) => m.x >= 2 && m.x <= 4).length; return n > 3 ? `по грядкам ${n} шагов` : null; });
check('грядка посреди пути - обойти', (set) => { for (let x = 2; x <= 4; x++) for (let z = -1; z <= 1; z++) set(x, 64, z, 'farmland', { moisture: 7 }); }, [0, 65, 0], G(6, 65, 0), true,
  (p) => (p.some((m) => m.x >= 2 && m.x <= 4 && Math.abs(m.z) <= 1) ? 'пошла по грядке' : null));
check('с уступа на грядку не прыгать', (set) => { for (let x = -6; x <= 1; x++) for (let z = -6; z <= 6; z++) set(x, 65, z, 'stone'); for (let x = 2; x <= 12; x++) for (let z = -6; z <= 6; z++) set(x, 64, z, 'farmland', { moisture: 7 }); },
  [0, 66, 0], G(6, 65, 0), false);
// --- дороги (22.11): у построек идёт по дорожке, а не по газону
check('по дорожке, а не по газону', (set) => { for (let x = 0; x <= 8; x++) set(x, 64, -2, 'stone_bricks'); for (let z = -2; z <= 0; z++) { set(0, 64, z, 'stone_bricks'); set(8, 64, z, 'stone_bricks'); } },
  [0, 65, 0], G(8, 65, 0), true, (p) => { const off = p.filter((m) => !(m.z === -2 || m.x === 0 || m.x === 8)).length; return off > 2 ? `по газону ${off} шагов` : null; },
  (x, y, z, u) => (u === 'stone_bricks' ? 1 : 1.6));
// --- паркур (22.11): прыжок через яму, если физика игры подтверждает; над лавой и пропастью - нет
// канава шириной w и глубиной depth: дно - камень на 64-depth (в модели мира один слой пола - без дна была бы пропасть)
const DITCH = (w, depth, fill) => (set) => { for (let x = 2; x < 2 + w; x++) for (let z = -6; z <= 6; z++) { for (let y = 64; y > 64 - depth; y--) set(x, y, z, y === 64 - depth + 1 && fill ? fill : 'air'); if (depth < 6) set(x, 64 - depth, z, 'stone'); } };
const leapUsed = (p) => (p.some((m) => m.leap) ? null : 'без прыжка');
check('канава 1 блок - перепрыгнуть', DITCH(1, 2), [0, 65, 0], G(5, 65, 0), true, leapUsed);
check('канава 2 блока - перепрыгнуть', DITCH(2, 2), [0, 65, 0], G(6, 65, 0), true, leapUsed);
check('канава 3 блока - с разбега', DITCH(3, 2), [0, 65, 0], G(7, 65, 0), true, leapUsed);
check('канава 1 блок над лавой - нельзя', DITCH(1, 2, 'lava'), [0, 65, 0], G(5, 65, 0), false);
check('пропасть 2 блока шириной, глубина 10 - нельзя', DITCH(2, 10), [0, 65, 0], G(6, 65, 0), false);
check('ошибка в цене клетки не ломает путь', () => {}, [0, 65, 0], G(6, 65, 0), true, null, () => { throw new Error('сбой'); });
// поле с поливом (22.11 «застряла» на пшенице): грядки, посередине канал воды на уровне грядок - по рядам ходить можно
check('поле с поливочной водой - пройти по рядам', (set) => { for (let x = -3; x <= 8; x++) for (let z = -4; z <= 4; z++) { set(x, 64, z, z === 0 ? 'water' : 'farmland', z === 0 ? undefined : { moisture: 7 }); if (z !== 0) set(x, 65, z, 'wheat', { age: 7 }); } },
  [0, 65, 1], new goals.GoalNear(6, 65, 1, 1), true);
console.log(`--- ходьба: ${results.filter(Boolean).length} из ${results.length}`);
if (results.some((x) => !x)) process.exitCode = 1;
