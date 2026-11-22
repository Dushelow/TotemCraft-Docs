// Умные предметы (как smart objects в The Sims и Skyrim): предмет сам «говорит», что это и как им пользоваться.
// Тело знает правила (кровать - ночью, сундук - свой/чужой/под замком, рычаг - только по просьбе хозяина),
// мозгу - одна команда !use(x, y, z) на всё.
const { goals } = require('mineflayer-pathfinder');
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [образец имени, что это, как пользоваться (для мозга), вид для тела]
const CATALOG = [
  [/_bed$/, 'кровать', 'лечь спать ночью или в грозу', 'bed'],
  [/^(chest|trapped_chest|barrel)$|shulker_box$/, 'сундук', 'свой - класть и брать; чужой - только по просьбе хозяина; под замком - нельзя', 'container'],
  [/^(furnace|smoker|blast_furnace)$/, 'печь', 'переплавить (!smelt), свободная чужая - тоже можно', 'furnace'],
  [/^crafting_table$/, 'верстак', 'крафт (!craft сам найдёт)', 'table'],
  [/_door$/, 'дверь', 'открыть или закрыть', 'toggle'],
  [/_fence_gate$/, 'калитка', 'открыть или закрыть', 'toggle'],
  [/_trapdoor$/, 'люк', 'открыть или закрыть (железный - только редстоуном)', 'toggle'],
  [/^lever$|_button$/, 'рычаг или кнопка', 'нажать - только по просьбе хозяина (это чужой редстоун)', 'redstone'],
  [/^bell$/, 'колокол', 'позвонить', 'toggle'],
  [/^(anvil|chipped_anvil|damaged_anvil|enchanting_table|brewing_stand|grindstone|smithing_table|loom|cartography_table|stonecutter)$/, 'мастерская', 'пока не умею пользоваться', 'none'],
];

function kindOf(name) { const c = CATALOG.find(([re]) => re.test(name)); return c ? { what: c[1], how: c[2], kind: c[3] } : null; }

/** Использовать предмет в точке (x, y, z). this - тело. source - кто велел (для рычагов). */
async function use(tb, a, tok) {
  const b = tb.bot;
  const { Vec3 } = require('vec3');
  const v = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
  const k = b.blockAt(v);
  if (!k || k.name === 'air') throw new Error(`в ${v.x} ${v.y} ${v.z} ничего нет`);
  const o = kindOf(k.name);
  if (!o || o.kind === 'none') throw new Error(`${k.name}: пока не умею этим пользоваться`);
  if (o.kind === 'redstone' && tb.runSource !== 'master') throw new Error(`${o.what} - чужой редстоун, нажимаю только по просьбе хозяина`);
  if (o.kind === 'bed') {
    await tb.toBed(k, tok, 60000);
    await b.sleep(k);
    return 'легла спать';
  }
  if (o.kind === 'container') {
    const c = await tb.openLocked(v.x, v.y, v.z, tok);
    try {
      // содержимое приходит отдельным пакетом после открытия: сразу после открытия бывает «пусто» (22.11: в бочке
      // лежала жареная рыба, а бот сказал «пусто»). Ждать до 1 с, пока придёт
      let items = c.containerItems();
      for (let i = 0; i < 10 && !items.length; i++) { await new Promise((r) => setTimeout(r, 100)); items = c.containerItems(); }
      const m = {}; for (const i of items) m[i.name] = (m[i.name] || 0) + i.count;
      const list = Object.entries(m).sort((p, q) => q[1] - p[1]).slice(0, 12).map(([n, x]) => `${n} ×${x}`).join(', ');
      const what = /barrel/.test(k.name) ? 'в бочке' : /shulker/.test(k.name) ? 'в шалкере' : /furnace|smoker/.test(k.name) ? 'в печи' : 'в сундуке';
      // рядом ещё не открытые - сказать, чтобы смотрела все, а не один (22.11: открыла один сундук с горшками и ушла)
      const seen = (tb._peeked = tb._peeked || new Map()); seen.set(`${v.x},${v.y},${v.z}`, Date.now());
      let more = '';
      try { more = b.findBlocks({ point: v, maxDistance: 8, count: 12, matching: (bl) => /^(chest|trapped_chest|barrel|.*shulker_box)$/.test(bl.name) }).filter((p) => !(Date.now() - (seen.get(`${p.x},${p.y},${p.z}`) || 0) < 600000)).slice(0, 5).map((p) => `${b.blockAt(p).name.replace(/_/g, ' ')} ${p.x} ${p.y} ${p.z}`).join('; '); } catch {}
      return `${what} ${v.x} ${v.y} ${v.z}: ${list || 'пусто'}${tb.skills.mine(v) ? ' (мой)' : ''}${more ? `; рядом ещё не открыты: ${more}` : ''}`;
    } finally { c.close(); }
  }
  if (o.kind === 'furnace' || o.kind === 'table') return `${o.what}: ${o.how}`;
  // открыть/закрыть, позвонить, нажать: подойти так, чтобы видеть, и правый клик
  try { await tb.goto(new goals.GoalLookAtBlock(k.position, b.world, { reach: 4 }), tok, 30000); } catch (e) { if (isCancel(e)) throw e; }
  tb.busyLook = true;
  try { await b.lookAt(k.position.offset(0.5, 0.5, 0.5), true); await b.activateBlock(k); await sleep(300); } finally { tb.busyLook = false; }
  const now = b.blockAt(v), pr = now && now.getProperties ? now.getProperties() : {};
  return pr.open !== undefined ? `${o.what} ${pr.open ? 'открыт(а)' : 'закрыт(а)'}` : `${o.what}: готово`;
}

/** Для мозга: предметы рядом (видимые, 8 бл.) с тем, как ими пользоваться. Коротко, по одному каждого вида. */
function describe(tb) {
  const b = tb.bot, me = b.entity.position, seen = new Map();
  for (const p of b.findBlocks({ matching: (bl) => !!kindOf(bl.name), maxDistance: 8, count: 60 })) {
    const k = b.blockAt(p), o = kindOf(k.name);
    if (!o || seen.has(o.what)) continue;
    if (b.canSeeBlock && !b.canSeeBlock(k)) continue;
    seen.set(o.what, `${o.what} ${p.x} ${p.y} ${p.z} - ${o.how}`);
  }
  return [...seen.values()].join('; ');
}

module.exports = { use, describe, kindOf, CATALOG };
