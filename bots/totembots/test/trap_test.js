// Ловушки и стойки (nav.js) на модели: через барную стойку - открыв люк, а не прыжком; в яму, загон, медовую яму,
// откуда не выбраться, - не спускаться (если цель не там).
const path = require('path');
const R = path.resolve(__dirname, '../node_modules');
const { Vec3 } = require(R + '/vec3');
const { Movements, goals } = require(R + '/mineflayer-pathfinder');
const { world, find, replay } = require('./navlib');
const { install } = require('../app/nav');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const nav = (b) => { const mv = new Movements(b); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []; install(mv, b); return mv; };
const esc = (build, x, y, z, from) => { const b = world(build); const mv = nav(b); return mv._nav.escapable(x, y, z, from); };

// 1. барная стойка: стена из блоков поперёк, в проёме - закрытый люк сверху (на высоте стойки)
{
  const b = world((set) => { for (let z = -6; z <= 6; z++) if (z !== 0) set(2, 65, z, 'oak_planks'); set(2, 65, 0, 'oak_trapdoor', { facing: 'north', half: 'top', open: false, powered: false, waterlogged: false }); for (let z = -6; z <= 6; z++) set(2, 66, z, 'air'); });
  const r = find(b, [0, 65, 0], new goals.GoalBlock(4, 65, 0));
  const through = r.path.find((m) => m.x === 2);
  ok('стойка: через люк, открыв его', r.status === 'success' && through && through.opens && through.y === 65, r.path.map((m) => `${m.x},${m.y},${m.z}${m.opens ? '(открыть)' : ''}`).join(' '));
  if (r.status === 'success') { const err = replay(b, [0, 65, 0], r, require('./navlib').lastCtl ? undefined : undefined); ok('стойка: физика проходит', !err, err); }
}
// 2. яма 2 блока глубиной (не выпрыгнуть) - ловушка; ступенька в 1 блок - нет
ok('яма в 2 блока - ловушка', !esc((set) => { set(3, 64, 0, 'air'); set(3, 63, 0, 'air'); set(3, 62, 0, 'stone'); }, 3, 63, 0, 65));
ok('ступенька вниз на 1 - выбраться можно', esc((set) => { set(3, 64, 0, 'air'); set(3, 63, 0, 'stone'); }, 3, 64, 0, 65));
// 3. медовая яма в 1 блок: с мёда не выпрыгнуть
ok('медовая яма в 1 блок - ловушка', !esc((set) => { set(3, 64, 0, 'air'); set(3, 63, 0, 'honey_block'); }, 3, 64, 0, 65));
// 4. загон из заборов: без калитки - ловушка, с калиткой - нет
const pen = (gate) => (set) => { for (let x = 2; x <= 6; x++) for (let z = -2; z <= 2; z++) if (x === 2 || x === 6 || z === -2 || z === 2) set(x, 65, z, gate && x === 2 && z === 0 ? 'oak_fence_gate' : 'oak_fence', gate && x === 2 && z === 0 ? { facing: 'east', open: false, in_wall: false, powered: false } : undefined); };
ok('загон без калитки - ловушка', !esc(pen(false), 4, 65, 0, 66.5));
ok('загон с калиткой - выбраться можно', esc(pen(true), 4, 65, 0, 66.5));
// 5. путь в обход ямы: цель за ямой - не прыгать в яму
{
  const b = world((set) => { for (let z = -1; z <= 1; z++) { set(3, 64, z, 'air'); set(3, 63, z, 'air'); set(3, 62, z, 'stone'); } });
  const r = find(b, [0, 65, 0], new goals.GoalBlock(6, 65, 0));
  ok('цель за ямой - обходит, не спускается', r.status === 'success' && !r.path.some((m) => m.y < 65), r.path.map((m) => `${m.x},${m.y},${m.z}`).join(' '));
}
const bad = res.filter((r) => !r[1]); for (const r of bad) console.log('  НЕ ТАК: ' + r[0] + ' ' + (r[2] || ''));
console.log(`ловушки и стойки: ${res.length - bad.length} из ${res.length}${bad.length ? ' - НЕТ' : ''}`);
