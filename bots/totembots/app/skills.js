// Навыки живого игрока: копать, крафтить, ставить блоки. Свобода как у человека, правила сервера - жёстко в коде:
// ломать только природное (камень, земля, руда, деревья с листвой...) и только вдали от чужих построек; ставить
// блоки - не вплотную к чужому. Чужие сундуки и так закрыты правилом «брать только по просьбе хозяина».
// Копание - обычным bot.dig (честное время ломания по инструменту, как у игрока: античит видит обычного игрока).
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

// что в природе бывает само (игроки из этого строят редко, а если строят - рядом будут их рукотворные блоки)
const NATURAL = /^(stone|deepslate|tuff|andesite|diorite|granite|calcite|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|sand|red_sand|gravel|clay|mud|snow|snow_block|ice|netherrack|soul_sand|soul_soil|basalt|blackstone|end_stone|.*_ore|ancient_debris|amethyst_cluster|.*_log|.*_stem|.*_leaves|short_grass|tall_grass|fern|large_fern|dead_bush|.*_mushroom|kelp|kelp_plant|seagrass|sugar_cane|bamboo|cactus|pumpkin|melon|sweet_berry_bush|vine|moss_block|.*_tulip|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony)$/;
// рукотворное: рядом с таким не ломаем и не ставим (как BUILT в worldmap.js)
const BUILT = /(_planks|_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|glass|glass_pane|bricks|_brick|_wool|_carpet|_concrete|terracotta|_wall|bookshelf|lantern|torch|crafting_table|furnace|barrel|chest|_bed|ladder|scaffolding|polished_|smooth_|chiseled_|cut_|quartz_block|iron_bars|chain|_banner|flower_pot|smoker|anvil|lectern|loom|composter|beehive|campfire|^rail|_rail|_sign|hopper|piston|repeater|comparator|lever|_button|_pressure_plate|cobblestone|farmland|hay_block|.*_block_of|shulker_box)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Skills {
  constructor(tb) { this.tb = tb; }
  get b() { return this.tb.bot; }

  /** Свои блоки (поставил сам) - их можно ломать обратно. */
  placedList() {
    const m = this.tb.memory;
    if (!m) return (this.tb.placed = this.tb.placed || []);
    const me = m.bot(this.tb.opts.name);
    return (me.placed = me.placed || []);
  }
  mine(pos) { return this.placedList().some((p) => p.x === pos.x && p.y === pos.y && p.z === pos.z); }

  /** Есть ли рядом рукотворное (кроме своего): r блоков вокруг. */
  builtNear(pos, r = 6) {
    const b = this.b;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const p = pos.offset(dx, dy, dz);
      const k = b.blockAt(p, false);
      if (k && BUILT.test(k.name) && !this.mine(p)) return k;
    }
    return null;
  }

  /** Можно ли сломать этот блок по правилам сервера. Возвращает '' или причину. */
  whyNot(block) {
    if (!block) return 'блока нет';
    if (this.mine(block.position)) return '';
    if (!NATURAL.test(block.name)) return `${block.name} - не природный блок`;
    if (/_log$|_stem$/.test(block.name)) {   // бревно - только из дерева (рядом листва), не из чужого сруба
      let leaves = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -1; dy <= 6; dy++) for (let dz = -3; dz <= 3; dz++) {
        const k = this.b.blockAt(block.position.offset(dx, dy, dz), false);
        if (k && /_leaves$|wart_block|shroomlight/.test(k.name)) leaves++;
      }
      if (leaves < 4) return 'бревно не похоже на дерево (нет листвы)';
    }
    const near = this.builtNear(block.position, 6);
    if (near) return `рядом чужая постройка (${near.name} ${near.position.x} ${near.position.y} ${near.position.z})`;
    return '';
  }

  bestTool(block) {
    const b = this.b;
    let best = null, bt = Infinity;
    for (const it of [null, ...b.inventory.items()]) {
      const t = block.digTime(it ? it.type : null, false, false, false, [], b.entity.effects || {});
      if (t < bt) { bt = t; best = it; }
    }
    return best;
  }

  /** Сломать один блок честно (как игрок) и подобрать, что выпало. */
  async digOne(block, tok) {
    const b = this.b, tb = this.tb;
    const why = this.whyNot(block);
    if (why) throw new Error('не ломаю: ' + why);
    await tb.goto(new goals.GoalLookAtBlock(block.position, b.world, { reach: 4 }), tok, 60000);
    const tool = this.bestTool(block);
    if (tool) await b.equip(tool, 'hand');
    tb.busyLook = true;
    try {
      await b.lookAt(block.position.offset(0.5, 0.5, 0.5));
      await b.dig(block, true);
    } finally { tb.busyLook = false; }
    const pl = this.placedList(), i = pl.findIndex((p) => p.x === block.position.x && p.y === block.position.y && p.z === block.position.z);
    if (i >= 0) { pl.splice(i, 1); if (tb.memory) tb.memory.save(); }
    await sleep(250);
    await tb.pickup({ x: block.position.x + 0.5, y: block.position.y, z: block.position.z + 0.5, radius: 4 }, tok).catch(() => {});
  }

  /** Добыть count блоков такого вида поблизости (дерево - целиком снизу вверх). */
  async gather(a, tok) {
    const b = this.b, tb = this.tb;
    const q = String(a.block || a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const want = Math.max(1, Math.min(64, +a.count || 8));
    const ids = Object.values(b.registry.blocksByName).filter((bl) => bl.name === q || bl.name.endsWith('_' + q) || (q === 'log' && /_log$/.test(bl.name)) || (q === 'wood' && /_log$/.test(bl.name))).map((bl) => bl.id);
    if (!ids.length) throw new Error(`не знаю блок «${q}»`);
    const radius = Math.min(48, +a.radius || 32);
    let got = 0, skipped = new Set(), lastWhy = '';
    for (let round = 0; got < want && round < want * 3; round++) {
      tb.check(tok);
      const me = b.entity.position;
      const cands = b.findBlocks({ matching: ids, maxDistance: radius, count: 60 })
        .filter((p) => !skipped.has(p.toString()))
        .sort((p1, p2) => p1.distanceTo(me) - p2.distanceTo(me));
      let target = null;
      for (const p of cands) {
        const k = b.blockAt(p);
        // открытый блок (анти-иксрей прячет руду внутри камня и шлёт подделки - их не копаем)
        const open = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => { const n = b.blockAt(p.offset(x, y, z)); return n && n.boundingBox === 'empty'; });
        const why = !open ? 'закрыт со всех сторон' : this.whyNot(k);
        if (why) { skipped.add(p.toString()); lastWhy = why; continue; }
        target = k; break;
      }
      if (!target) break;
      try { await this.digOne(target, tok); got++; }
      catch (e) { if (tb.isCancel(e)) throw e; skipped.add(target.position.toString()); lastWhy = e.message; }
    }
    const have = b.inventory.items().filter((it) => ids.some((id) => b.registry.blocks[id].name === it.name || (b.registry.blocks[id].drops || []).includes(it.type))).reduce((s, it) => s + it.count, 0);
    if (!got) throw new Error(`не добыл ${q}${lastWhy ? ': ' + lastWhy : ' - рядом нет'}`);
    return `добыл ${q}: ${got}${got < want ? ' из ' + want + (lastWhy ? ' (дальше: ' + lastWhy + ')' : '') : ''}${have ? '' : ''}`;
  }

  /** Скрафтить: сам найдёт верстак рядом или поставит свой, если он в инвентаре. */
  async craft(a, tok) {
    const b = this.b, tb = this.tb;
    const name = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const item = b.registry.itemsByName[name];
    if (!item) throw new Error(`не знаю предмет «${name}»`);
    const count = Math.max(1, Math.min(64, +a.count || 1));
    let recipes = b.recipesFor(item.id, null, 1, null);
    let table = null;
    if (!recipes.length) {
      const tableId = b.registry.blocksByName.crafting_table.id;
      table = b.findBlock({ matching: tableId, maxDistance: 24 });
      if (!table && b.inventory.items().some((it) => it.name === 'crafting_table')) { await this.place({ block: 'crafting_table' }, tok); table = b.findBlock({ matching: tableId, maxDistance: 6 }); }
      recipes = table ? b.recipesFor(item.id, null, 1, table) : [];
      if (!recipes.length) {
        const all = b.recipesAll(item.id, null, true);
        if (!all.length) throw new Error(`${name} не крафтится`);
        const need = {};
        for (const ing of (all[0].delta || []).filter((d) => d.count < 0)) { const n = b.registry.items[ing.id]; need[n ? n.name : ing.id] = -ing.count; }
        throw new Error(`для ${name} не хватает: ${Object.entries(need).map(([k, v]) => k + ' x' + v).join(', ')}${all[0].requiresTable && !table ? ' (и нужен верстак)' : ''}`);
      }
      await tb.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), tok, 30000);
    }
    const r = recipes[0];
    const times = Math.ceil(count / (r.result.count || 1));
    let made = 0;
    for (let i = 0; i < times; i++) {
      tb.check(tok);
      if (!b.recipesFor(item.id, null, 1, table).length) break;
      await b.craft(r, 1, table);
      made += r.result.count || 1;
      await sleep(200);
    }
    if (!made) throw new Error(`не хватило материалов на ${name}`);
    return `скрафтил ${name} x${made}`;
  }

  /** Поставить блок из инвентаря: в точку (x,y,z) или рядом с собой. Не вплотную к чужим постройкам. */
  async place(a, tok) {
    const b = this.b, tb = this.tb;
    const name = String(a.block || a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const it = b.inventory.items().find((x) => x.name === name);
    if (!it) throw new Error(`нет в инвентаре: ${name}`);
    let at;
    if (a.x !== undefined) at = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
    else {   // рядом: свободная клетка на земле в 1-2 блоках
      const me = b.entity.position.floored();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [1, 1], [-1, -1]]) {
        const p = me.offset(dx, 0, dz), k = b.blockAt(p), under = b.blockAt(p.offset(0, -1, 0));
        if (k && k.boundingBox === 'empty' && under && under.boundingBox === 'block') { at = p; break; }
      }
      if (!at) throw new Error('некуда поставить рядом');
    }
    const near = this.builtNear(at, 3);
    if (near && !a.master) throw new Error(`не ставлю вплотную к чужой постройке (${near.name})`);
    const cur = b.blockAt(at);
    if (cur && cur.boundingBox !== 'empty' && !/water|short_grass|tall_grass|snow$/.test(cur.name)) throw new Error(`место занято: ${cur.name}`);
    // опора: любой твёрдый сосед
    const dirs = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    let ref = null, face = null;
    for (const [x, y, z] of dirs) { const k = b.blockAt(at.offset(x, y, z)); if (k && k.boundingBox === 'block') { ref = k; face = new Vec3(-x, -y, -z); break; } }
    if (!ref) throw new Error('не к чему приставить блок');
    if (b.entity.position.distanceTo(at.offset(0.5, 0.5, 0.5)) > 4) await tb.goto(new goals.GoalNear(at.x, at.y, at.z, 3), tok, 60000);
    if (b.entity.position.floored().equals(at) || b.entity.position.floored().offset(0, 1, 0).equals(at)) throw new Error('стою на этом месте');
    await b.equip(it, 'hand');
    tb.busyLook = true;
    try { await b.lookAt(at.offset(0.5, 0.5, 0.5)); await b.placeBlock(ref, face); } finally { tb.busyLook = false; }
    const pl = this.placedList();
    pl.push({ x: at.x, y: at.y, z: at.z });
    if (pl.length > 3000) pl.shift();
    if (tb.memory) tb.memory.save();
    return `поставил ${name} на ${at.x} ${at.y} ${at.z}`;
  }

  /** Сломать один блок в точке (свой поставленный или природный вдали от чужого). */
  async breakAt(a, tok) {
    const p = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
    const k = this.b.blockAt(p);
    if (!k || k.boundingBox === 'empty') return 'там пусто';
    await this.digOne(k, tok);
    return `сломал ${k.name} на ${p.x} ${p.y} ${p.z}`;
  }
}

module.exports = { Skills, NATURAL, BUILT };
