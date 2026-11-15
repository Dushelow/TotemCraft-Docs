// Знание мира (как GITM и Mindcraft !getCraftingPlan): полный план «что добыть и что скрафтить по порядку» для
// любого предмета - из рецептов игры (реестр mineflayer) с учётом того, что уже лежит в инвентаре.

// переплавка (рецептов печи в реестре нет)
const SMELT = {
  iron_ingot: 'raw_iron', gold_ingot: 'raw_gold', copper_ingot: 'raw_copper', glass: 'sand', stone: 'cobblestone',
  smooth_stone: 'stone', charcoal: 'oak_log', brick: 'clay_ball', netherite_scrap: 'ancient_debris',
  cooked_beef: 'beef', cooked_porkchop: 'porkchop', cooked_chicken: 'chicken', cooked_mutton: 'mutton',
  cooked_cod: 'cod', cooked_salmon: 'salmon', baked_potato: 'potato', dried_kelp: 'kelp',
};
// откуда берутся сырые вещи (подсказка нейросети, какой командой)
const SOURCE = [
  [/_log$/, (n) => `!collect(${n}, k) - рубить дерево`],
  [/^cobblestone$/, () => '!collect(stone, k) - копать камень (нужна кирка)'],
  [/^cobbled_deepslate$/, () => '!collect(deepslate, k) - глубже y 0 (нужна кирка)'],
  [/^coal$/, () => '!mine(coal, k) - нужна кирка'],
  [/^raw_iron$/, () => '!mine(iron, k) - нужна каменная кирка'],
  [/^raw_gold$/, () => '!mine(gold, k) - нужна железная кирка'],
  [/^raw_copper$/, () => '!mine(copper, k) - нужна каменная кирка'],
  [/^diamond$/, () => '!mine(diamond, k) - нужна железная кирка'],
  [/^redstone$/, () => '!mine(redstone, k) - нужна железная кирка'],
  [/^lapis_lazuli$/, () => '!mine(lapis, k) - нужна каменная кирка'],
  [/^(sand|gravel|dirt|clay_ball|snowball)$/, (n) => `!collect(${n === 'clay_ball' ? 'clay' : n === 'snowball' ? 'snow' : n}, k) - лопатой быстрее`],
  [/^flint$/, () => '!collect(gravel, k) - иногда выпадает кремень'],
  [/^string$/, () => '!attack(spider) или паутина'],
  [/^(leather|beef)$/, () => '!hunt(cow, k)'],
  [/^(porkchop)$/, () => '!hunt(pig, k)'],
  [/^(feather|chicken)$/, () => '!hunt(chicken, k)'],
  [/^(white_wool|mutton)$/, () => '!shear(k) или !hunt(sheep, k)'],
  [/^(wheat|wheat_seeds|carrot|potato|beetroot)$/, () => '!harvest() на ферме или найти'],
  [/^sugar_cane$/, () => '!collect(sugar_cane, k) у воды'],
  [/^bone$/, () => '!attack(skeleton)'],
  [/^gunpowder$/, () => '!attack(creeper) (осторожно)'],
  [/^(egg)$/, () => 'подобрать у кур'],
];
const how = (n) => { for (const [re, f] of SOURCE) if (re.test(n)) return f(n); return 'найти или добыть'; };

/** План для предмета: шаги по порядку. */
function plan(bot, itemName, count = 1) {
  const reg = bot.registry;
  const name = String(itemName || '').toLowerCase().replace(/^minecraft:/, '');
  if (!reg.itemsByName[name]) return `не знаю предмет «${name}» (нужен id Minecraft: iron_pickaxe, torch, bread...)`;
  const have = new Map();
  for (const it of bot.inventory.items()) have.set(it.name, (have.get(it.name) || 0) + it.count);
  const logs = [...have.keys()].filter((n) => /_log$/.test(n));
  const wood = logs.length ? logs[0].replace(/_log$/, '') : 'oak';
  const tableNear = !!bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 24 });
  let tableNeeded = false, furnaceNeeded = false;
  const raw = new Map(), steps = [];
  const add = (key, n, text) => { const s = steps.find((x) => x.key === key); if (s) s.n += n; else steps.push({ key, n, text }); };

  function need(item, qty, stack) {
    const got = Math.min(have.get(item) || 0, qty);
    if (got) have.set(item, have.get(item) - got);
    qty -= got;
    if (qty <= 0 || stack.length > 10) return;
    if (SMELT[item] && !stack.includes(SMELT[item])) {
      const src = SMELT[item] === 'oak_log' ? `${wood}_log` : SMELT[item];
      need(src, qty, stack.concat(item));
      furnaceNeeded = true;
      add('smelt:' + item, qty, (n) => `!smelt(${src}, ${n}) -> ${item}`);
      return;
    }
    // сырьё (руда, брёвна, мясо...) - добывается, а не крафтится из блоков
    if (SOURCE.some(([re]) => re.test(item))) { raw.set(item, (raw.get(item) || 0) + qty); return; }
    const id = reg.itemsByName[item] && reg.itemsByName[item].id;
    let recs = id !== undefined ? bot.recipesAll(id, null, true) : [];
    // без циклов (слиток <-> блок <-> самородки) и предпочитать доски из того дерева, что есть
    recs = recs.filter((r) => !r.delta.some((d) => d.count < 0 && stack.includes(reg.items[d.id] && reg.items[d.id].name)));
    if (!recs.length) { raw.set(item, (raw.get(item) || 0) + qty); return; }
    const missing = (r) => r.delta.filter((d) => d.count < 0).reduce((s, d) => { const n = reg.items[d.id].name; return s + Math.max(0, -d.count - (have.get(n) || 0)) + (n.startsWith(wood) || !/_planks$|_log$/.test(n) ? 0 : 0.5) + (/deepslate|blackstone|crimson|warped|bamboo|quartz/.test(n) && !have.get(n) ? 3 : 0); }, 0);
    recs.sort((a, b) => missing(a) - missing(b));
    const r = recs[0];
    const per = r.result.count || 1, times = Math.ceil(qty / per);
    for (const d of r.delta.filter((x) => x.count < 0)) need(reg.items[d.id].name, -d.count * times, stack.concat(item));
    if (r.requiresTable && item !== 'crafting_table') tableNeeded = true;
    add('craft:' + item, times * per, (n) => `!craft(${item}, ${n})${r.requiresTable ? ' (на верстаке)' : ''}`);
    if (times * per > qty) have.set(item, (have.get(item) || 0) + times * per - qty);
  }

  // два прохода: первый узнаёт, нужен ли верстак; если нужен и рядом нет - второй считает его первым шагом
  const inv0 = new Map(have);
  need(name, Math.max(1, +count || 1), []);
  if (tableNeeded && !tableNear && !(inv0.get('crafting_table') > 0)) {
    have.clear(); for (const [k, v] of inv0) have.set(k, v);
    raw.clear(); steps.length = 0; furnaceNeeded = false;
    need('crafting_table', 1, []);
    need(name, Math.max(1, +count || 1), []);
  }
  const out = [];
  for (const [n, k] of raw) out.push(`добыть ${n} x${k}: ${how(n).replace('k)', k + ')')}`);
  for (const s of steps) out.push(s.text(s.n));
  if (furnaceNeeded) out.push('для переплавки нужна печь (8 булыжника) и топливо (уголь, доски, брёвна) - !smelt сам сделает печь');
  if (!out.length) return `${name}: всё уже есть в инвентаре`;
  return `план для ${name} x${count || 1} (с учётом инвентаря): ` + out.map((t, i) => `${i + 1}) ${t}`).join('; ');
}

/** Что можно скрафтить прямо сейчас (из инвентаря; с верстаком, если он рядом). */
function craftable(bot) {
  const reg = bot.registry;
  const table = bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 6 });
  const out = [];
  for (const id of Object.keys(reg.recipes || {})) {
    try { if (bot.recipesFor(+id, null, 1, table || null).length) out.push(reg.items[id].name); } catch {}
    if (out.length >= 60) break;
  }
  return out.length ? `можно скрафтить${table ? ' (верстак рядом)' : ' (без верстака)'}: ${out.join(', ')}` : 'из того, что есть, скрафтить нечего';
}

module.exports = { plan, craftable, SMELT };
