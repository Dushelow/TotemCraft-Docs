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
    let q = String(a.block || a.item || '').toLowerCase().replace(/^minecraft:/, '');
    // просят то, что выпадает, а не блок в мире: булыжник - это камень, сланцевый булыжник - глубинный сланец
    const SRC = { cobblestone: 'stone', cobbled_deepslate: 'deepslate', flint: 'gravel', clay_ball: 'clay', snowball: 'snow_block', wheat_seeds: 'short_grass', seeds: 'short_grass', planks: 'log', wood: 'log' };
    if (SRC[q]) q = SRC[q];
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
        const fakeable = /_ore$|ancient_debris|chest/.test(k.name);   // анти-иксрей подделывает руду и сундуки, не камень
        const why = !open && fakeable ? 'закрыт со всех сторон (может быть подделкой анти-иксрея)' : this.whyNot(k);
        if (why) { skipped.add(p.toString()); lastWhy = why; continue; }
        target = k; break;
      }
      if (!target) break;
      try { await this.digOne(target, tok); got++; }
      catch (e) { if (tb.isCancel(e)) throw e; skipped.add(target.position.toString()); lastWhy = e.message; }
    }
    const have = b.inventory.items().filter((it) => ids.some((id) => b.registry.blocks[id].name === it.name || (b.registry.blocks[id].drops || []).includes(it.type))).reduce((s, it) => s + it.count, 0);
    if (!got) throw new Error(`не добыл ${q}${lastWhy ? ': ' + lastWhy : ' - рядом нет'}${/log|wood/.test(q) ? '. Рядом только брёвна построек - уйди от построек (!wander) и найди дерево с листвой (!find(oak_log))' : ''}`);
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
      table = b.findBlock({ matching: tableId, maxDistance: 32 });   // любой верстак рядом, и чужой: им можно пользоваться
      if (!table && b.inventory.items().some((it) => it.name === 'crafting_table')) { await this.place({ block: 'crafting_table' }, tok); table = b.findBlock({ matching: tableId, maxDistance: 6 }); }
      recipes = table ? b.recipesFor(item.id, null, 1, table) : [];
      if (!recipes.length) {
        const all = b.recipesAll(item.id, null, true);
        if (!all.length) throw new Error(`${name} не крафтится`);
        // рецепт, которому меньше всего не хватает (а не первый попавшийся: «нужны cherry_planks», когда есть дубовые)
        const have = new Map(); for (const it of b.inventory.items()) have.set(it.name, (have.get(it.name) || 0) + it.count);
        const lack = (r) => (r.delta || []).filter((d) => d.count < 0).reduce((s, d) => { const n = (b.registry.items[d.id] || {}).name; return s + Math.max(0, -d.count - (have.get(n) || 0)); }, 0);
        const best = all.slice().sort((x, y) => lack(x) - lack(y))[0];
        const generic = (n) => (/_planks$/.test(n) ? 'любые доски' : /^(cobblestone|cobbled_deepslate|blackstone)$/.test(n) ? 'булыжник (cobblestone или cobbled_deepslate)' : /_log$/.test(n) ? 'любые брёвна' : n);
        const need = {};
        for (const ing of (best.delta || []).filter((d) => d.count < 0)) { const n = (b.registry.items[ing.id] || {}).name || ing.id; const k = generic(n); const miss = Math.max(0, -ing.count - (have.get(n) || 0)); if (miss) need[k] = (need[k] || 0) + miss; }
        const list = Object.entries(need).map(([k, v]) => k + ' x' + v).join(', ');
        throw new Error(`для ${name} ${list ? 'не хватает: ' + list : 'нужен верстак рядом'}${best.requiresTable && !table ? (list ? ' (и нужен верстак)' : '') : ''}`);
      }
      await tb.goto(new goals.GoalLookAtBlock(table.position, b.world, { reach: 4 }), tok, 30000);
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
  /**
   * Свободные места по карте: чанки суши без построек (и соседи без построек), ближние первыми.
   * Возвращает [{x, y, z, d, dir}] - точка на земле в середине чанка.
   */
  freeSpots(max = 5) {
    const b = this.b, wm = this.tb.worldMap;
    if (!wm) return [];
    const m = wm.load(b.game.dimension), me = b.entity.position;
    const out = [];
    for (const [k, c] of Object.entries(m.chunks)) {
      if (c.k !== 'g' || c.h === null) continue;
      const [cx, cz] = k.split(',').map(Number);
      const x = cx * 16 + 8, z = cz * 16 + 8;
      if (this.builtChunk(new Vec3(x, c.h, z))) continue;
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < 8) continue;
      out.push({ x, y: c.h + 1, z, d });
    }
    const { compass } = require('./worldmap');
    return out.sort((p, q) => p.d - q.d).slice(0, max).map((p) => ({ ...p, dir: compass(p.x - me.x, p.z - me.z) }));
  }

  /** Встать на свободное место (нет построек вокруг) - по карте, а не наугад. */
  async goToFreeSpot(tok) {
    const s = this.freeSpots(1)[0];
    if (!s) throw new Error('на карте нет мест без построек - !wander, чтобы разведать');
    this.tb.log(`иду на свободное место по карте: ${s.x} ${s.z} (${Math.round(s.d)} бл. на ${s.dir})`);
    await this.tb.goto(new goals.GoalNearXZ(s.x, s.z, 3), tok, 180000);
    return s;
  }

  async place(a, tok) {
    const b = this.b, tb = this.tb;
    const name = String(a.block || a.item || '').toLowerCase().replace(/^minecraft:/, '');
    // семена как блок не ставятся (Server refused to place wheat_seeds, 4 раза 15.11) - это посадка на грядку
    if (/_seeds$|^(carrot|potato|beetroot_seeds|melon_seeds|pumpkin_seeds|torchflower_seeds)$/.test(name)) return this.plant({ item: name, x: a.x, y: a.y !== undefined ? +a.y - 1 : undefined, z: a.z }, tok).catch(async (e) => { if (/нет вспаханной/.test(e.message)) return this.farm({ item: name, count: 1 }, tok); throw e; });
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
    let near = this.builtNear(at, 3);
    // место не названо, а рядом чужое - сам дойти до свободного места по карте и поставить там (не искать наугад)
    if (near && !a.master && a.x === undefined && !a._moved) {
      await this.goToFreeSpot(tok);
      return this.place({ ...a, _moved: true }, tok);
    }
    if (near && !a.master) throw new Error(`не ставлю вплотную к чужой постройке (${near.name})${a.x !== undefined ? ' - !place без координат сам найдёт свободное место' : ''}`);
    const cur = b.blockAt(at);
    if (cur && cur.boundingBox !== 'empty' && !/water|short_grass|tall_grass|snow$/.test(cur.name)) throw new Error(`место занято: ${cur.name}`);
    // опора: любой твёрдый сосед
    const dirs = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    let ref = null, face = null;
    for (const [x, y, z] of dirs) { const k = b.blockAt(at.offset(x, y, z)); if (k && k.boundingBox === 'block') { ref = k; face = new Vec3(-x, -y, -z); break; } }
    if (!ref) throw new Error('не к чему приставить блок');
    if (b.entity.position.distanceTo(at.offset(0.5, 0.5, 0.5)) > 4) await tb.goto(new goals.GoalNear(at.x, at.y, at.z, 3), tok, 60000);
    // блок не должен задеть бота даже краем (иначе сервер выталкивает - античит видит прыжок и полёт, бан на стенде)
    const inMe = () => { const q = b.entity.position; return at.x < q.x + 0.35 && at.x + 1 > q.x - 0.35 && at.z < q.z + 0.35 && at.z + 1 > q.z - 0.35 && at.y < q.y + 1.85 && at.y + 1 > q.y - 0.05; };
    if (inMe()) {
      try { await tb.goto(new goals.GoalInvert(new goals.GoalNear(at.x, at.y, at.z, 2)), tok, 6000); } catch (e) { if (tb.isCancel(e)) throw e; }
      try { b.pathfinder.setGoal(null); } catch {}
      await sleep(300);
      if (inMe()) throw new Error('стою на этом месте');
    }
    await b.equip(it, 'hand');
    tb.busyLook = true;
    // как человек: повернуться, чуть подождать, поставить, пауза (быстрые ставки подряд Vulcan видит как Bad Packets M)
    try {
      await b.lookAt(ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true);
      await sleep(180);
      await b.placeBlock(ref, face);
      await sleep(250);
    } finally { tb.busyLook = false; }
    const pl = this.placedList();
    pl.push({ x: at.x, y: at.y, z: at.z });
    if (pl.length > 3000) pl.shift();
    if (tb.memory) tb.memory.save();
    tb.log(`поставил ${name} на ${at.x} ${at.y} ${at.z}`);
    return `поставил ${name} на ${at.x} ${at.y} ${at.z}`;
  }

  /** Земля под грядку рядом: dirt/grass, сверху воздух, не у чужих построек (своё можно). */
  soilNear(r = 6, at = null) {
    const b = this.b;
    if (at) return [b.blockAt(at)].filter(Boolean);
    const me = b.entity.position.floored();
    return b.findBlocks({ matching: (bl) => /^(dirt|grass_block|dirt_path|coarse_dirt|rooted_dirt)$/.test(bl.name), maxDistance: r, count: 60 })
      .map((p) => b.blockAt(p)).filter((k) => { const up = b.blockAt(k.position.offset(0, 1, 0)); return up && up.boundingBox === 'empty' && !/water|lava/.test(up.name) && !this.builtNear(k.position, 2); })
      .sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me));
  }

  /** Вспахать мотыгой (как игрок: правый клик мотыгой по земле). */
  async till(a, tok) {
    const b = this.b, tb = this.tb;
    const hoe = b.inventory.items().find((i) => /_hoe$/.test(i.name));
    if (!hoe) throw new Error('нет мотыги (wooden_hoe: 2 доски + 2 палки на верстаке)');
    const at = a.x !== undefined ? new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z)) : null;
    const soil = this.soilNear(6, at)[0];
    if (!soil || !/dirt|grass/.test(soil.name)) throw new Error('рядом нет земли или травы под грядку (сверху должен быть воздух)');
    await tb.goto(new goals.GoalNear(soil.position.x, soil.position.y + 1, soil.position.z, 2), tok, 30000);
    await b.equip(hoe, 'hand');
    tb.busyLook = true;
    try { await b.lookAt(soil.position.offset(0.5, 1, 0.5)); await b.activateBlock(soil, new Vec3(0, 1, 0)); await sleep(400); } finally { tb.busyLook = false; }
    const now = b.blockAt(soil.position);
    if (!now || now.name !== 'farmland') throw new Error(`не вспахалось (${now && now.name})`);
    return `вспахал ${soil.position.x} ${soil.position.y} ${soil.position.z}`;
  }

  /** Посадить на грядку (семена, морковь, картошка, свёкла). */
  async plant(a, tok) {
    const b = this.b, tb = this.tb;
    const name = String(a.item || a.seed || 'wheat_seeds').toLowerCase().replace(/^minecraft:/, '');
    const seed = b.inventory.items().find((i) => i.name === name) || b.inventory.items().find((i) => /seeds$|^carrot$|^potato$/.test(i.name));
    if (!seed) throw new Error('нечего сажать (wheat_seeds - с травы, carrot, potato, beetroot_seeds)');
    const me = b.entity.position;
    let land = a.x !== undefined ? b.blockAt(new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z))) : null;
    if (!land) land = b.findBlocks({ matching: b.registry.blocksByName.farmland.id, maxDistance: 8, count: 40 }).map((p) => b.blockAt(p))
      .filter((k) => { const up = b.blockAt(k.position.offset(0, 1, 0)); return up && up.name === 'air'; }).sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me))[0];
    if (!land || land.name !== 'farmland') throw new Error('нет вспаханной грядки - сначала !till');
    await tb.goto(new goals.GoalNear(land.position.x, land.position.y + 1, land.position.z, 2), tok, 30000);
    await b.equip(seed, 'hand');
    tb.busyLook = true;
    try { await b.lookAt(land.position.offset(0.5, 1, 0.5)); await b.activateBlock(land, new Vec3(0, 1, 0)); await sleep(400); } finally { tb.busyLook = false; }
    const up = b.blockAt(land.position.offset(0, 1, 0));
    if (!up || up.name === 'air') throw new Error('не посадилось');
    return `посадил ${seed.name} на ${land.position.x} ${land.position.y} ${land.position.z}`;
  }

  /** Огород: вспахать и засадить n клеток рядом. */
  async farm(a, tok) {
    const n = Math.max(1, Math.min(16, +a.count || 4));
    let done = 0, why = '';
    for (let i = 0; i < n; i++) {
      this.tb.check(tok);
      try { await this.till({}, tok); await this.plant({ item: a.item }, tok); done++; } catch (e) { if (this.tb.isCancel(e)) throw e; why = e.message; break; }
    }
    if (!done) throw new Error('огород не вышел: ' + why);
    return `засадил грядок: ${done}${done < n ? ' (дальше: ' + why + ')' : ''}`;
  }

  /** Сломать один блок в точке (свой поставленный или природный вдали от чужого). */
  async breakAt(a, tok) {
    const p = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
    const k = this.b.blockAt(p);
    if (!k || k.boundingBox === 'empty') return 'там пусто';
    await this.digOne(k, tok);
    return `сломал ${k.name} на ${p.x} ${p.y} ${p.z}`;
  }
  // ---------- копание по дороге (Baritone allowBreak): только природное и не там, где на карте постройки
  builtChunk(p) {
    const wm = this.tb.worldMap;
    if (!wm) return false;
    const m = wm.load(this.b.game.dimension);
    const cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = m.chunks[`${cx + dx},${cz + dz}`]; if (c && (c.b || 0) >= 12) return true; }
    return false;
  }

  digMovements() {
    if (this._mv) return this._mv;
    const { Movements } = require('mineflayer-pathfinder');
    const b = this.b, base = this.tb.movements;
    const mv = new Movements(b);
    require('./house-moves').install(mv, b);
    Object.assign(mv, { canDig: true, allow1by1towers: false, scafoldingBlocks: [], allowParkour: true, allowSprinting: true, canOpenDoors: true, maxDropDown: 3 });
    if (base) { mv.blocksToAvoid = base.blocksToAvoid; mv.entitiesToAvoid = base.entitiesToAvoid; mv.exclusionAreasStep = base.exclusionAreasStep; }
    // ломать по пути можно только природное (брёвна - нет: их только с дерева через gather)
    for (const bl of Object.values(b.registry.blocksByName)) if (!NATURAL.test(bl.name) || /_log$|_stem$|_leaves$/.test(bl.name)) mv.blocksCantBreak.add(bl.id);
    mv.exclusionAreasBreak = [(block) => (this.builtChunk(block.position) ? 100 : 0)];
    return (this._mv = mv);
  }

  async withDig(fn) {
    const b = this.b;
    b.pathfinder.setMovements(this.digMovements());
    try { return await fn(); } finally { try { b.pathfinder.setMovements(this.tb.movements); } catch {} }
  }

  exposed(p) {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => { const n = this.b.blockAt(p.offset(x, y, z)); return n && n.boundingBox === 'empty'; });
  }

  /** Видимая руда рядом (открытая: анти-иксрей прячет закрытую) - выкопать. */
  async pickVisible(ids, radius, max, tok) {
    const b = this.b;
    let got = 0;
    for (let i = 0; i < max; i++) {
      this.tb.check(tok);
      const me = b.entity.position;
      const p = b.findBlocks({ matching: ids, maxDistance: radius, count: 40 }).filter((q) => this.exposed(q) && !this.whyNot(b.blockAt(q)))
        .sort((p1, p2) => p1.distanceTo(me) - p2.distanceTo(me))[0];
      if (!p) break;
      try { await this.digOne(b.blockAt(p), tok); got++; } catch (e) { if (this.tb.isCancel(e)) throw e; break; }
    }
    return got;
  }

  /**
   * Шахта (Baritone MineProcess в режиме legit): сначала видимая руда рядом; не хватило - спуститься на её высоту
   * и копать ветку-туннель 1x2, по дороге забирая всё, что туннель открыл. Только природное, не у построек.
   */
  async mineOre(a, tok) {
    const b = this.b, tb = this.tb;
    const q = String(a.block || a.ore || '').toLowerCase().replace(/^minecraft:/, '').replace(/_ore$/, '');
    const want = Math.max(1, Math.min(64, +a.count || 8));
    const ids = Object.values(b.registry.blocksByName).filter((bl) => bl.name === q + '_ore' || bl.name === 'deepslate_' + q + '_ore' || bl.name === q || (q === 'debris' && bl.name === 'ancient_debris')).map((bl) => bl.id);
    if (!ids.length) throw new Error(`не знаю руду «${q}»`);
    const LEVEL = { diamond: -58, redstone: -58, lapis: 0, gold: -16, iron: 16, copper: 48, coal: 48, emerald: 100, ancient_debris: 15, quartz: 40, nether_gold: 40 };
    let got = 0;
    const left = Date.now() + Math.min(20, +a.minutes || 8) * 60000;
    return this.withDig(async () => {
      got += await this.pickVisible(ids, 24, want, tok);
      if (got >= want) return `накопал ${q}: ${got}`;
      const y = a.y !== undefined ? +a.y : (LEVEL[q] !== undefined ? LEVEL[q] : Math.floor(b.entity.position.y));
      const me = b.entity.position.floored();
      if (Math.abs(me.y - y) > 3) {
        tb.log(`спускаюсь в шахту на высоту ${y}`);
        await tb.goto(new goals.GoalNear(me.x + 2, y, me.z + 2, 1), tok, Math.max(30000, left - Date.now()));
      }
      const dirs = { 'север': [0, -1], 'юг': [0, 1], 'восток': [1, 0], 'запад': [-1, 0] };
      let [dx, dz] = dirs[a.dir] || Object.values(dirs)[Math.floor(Math.random() * 4)];
      let dug = 0;
      while (got < want && Date.now() < left) {
        tb.check(tok);
        const p = b.entity.position.floored();
        try { await tb.goto(new goals.GoalBlock(p.x + dx * 3, p.y, p.z + dz * 3), tok, 30000); }
        catch (e) { if (tb.isCancel(e)) throw e; [dx, dz] = [-dz, dx]; if (++dug > 8) break; continue; }   // упёрлись (вода, лава, постройка) - поворот
        got += await this.pickVisible(ids, 5, want - got, tok);
      }
      if (!got) throw new Error(`руды ${q} не нашёл за время`);
      return `накопал ${q}: ${got}${got < want ? ' из ' + want : ''}`;
    });
  }

  /** Подняться на поверхность (Baritone #surface): лестницей вверх, копая природное. */
  async surface(a, tok) {
    const b = this.b, tb = this.tb;
    const me = b.entity.position.floored();
    let top = null;
    for (let y = me.y + 1; y < me.y + 120; y++) { const k = b.blockAt(new Vec3(me.x, y, me.z)); if (!k) break; if (k.skyLight === 15 || (k.boundingBox === 'empty' && y > 62 && b.blockAt(new Vec3(me.x, y + 1, me.z)) && b.blockAt(new Vec3(me.x, y + 1, me.z)).skyLight === 15)) { top = y; break; } }
    if (top === null) { const c = tb.worldMap && tb.worldMap.load(b.game.dimension).chunks[`${Math.floor(me.x / 16)},${Math.floor(me.z / 16)}`]; top = c && c.h ? c.h + 1 : me.y + 30; }
    await this.withDig(() => tb.goto(new goals.GoalY(top), tok, 180000));
    const p = b.entity.position;
    return `поднялся на поверхность: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;
  }

  /** Рыбалка (Meteor AutoFish): удочка, открытая вода рядом. */
  async fish(a, tok) {
    const b = this.b, tb = this.tb;
    const rod = b.inventory.items().find((i) => i.name === 'fishing_rod');
    if (!rod) throw new Error('нет удочки (fishing_rod: 3 палки + 2 нити)');
    const water = b.findBlock({ matching: (bl) => bl.name === 'water', maxDistance: 20, useExtraInfo: false });
    if (!water) throw new Error('рядом нет воды');
    const ws = b.findBlocks({ matching: b.registry.blocksByName.water.id, maxDistance: 20, count: 200 })
      .filter((p) => { const up = b.blockAt(p.offset(0, 1, 0)); return up && up.name === 'air'; })
      .sort((p1, p2) => p1.distanceTo(b.entity.position) - p2.distanceTo(b.entity.position));
    if (!ws.length) throw new Error('нет открытой воды рядом');
    const w = ws[0];
    await tb.goto(new goals.GoalNear(w.x, w.y + 1, w.z, 3), tok, 60000);
    const times = Math.max(1, Math.min(20, +a.count || 5));
    let caught = 0;
    tb.busyLook = true;
    try {
      for (let i = 0; i < times; i++) {
        tb.check(tok);
        await b.equip(rod, 'hand');
        await b.lookAt(w.offset(0.5, 1, 0.5));
        try { await Promise.race([b.fish(), sleep(60000).then(() => { throw new Error('не клюёт'); })]); caught++; }
        catch (e) { if (/не клюёт/.test(e.message)) { try { b.activateItem(); } catch {} } else if (!/cancel/i.test(e.message)) throw e; }
        await sleep(600);
      }
    } finally { tb.busyLook = false; }
    await tb.pickup({ radius: 6 }, tok).catch(() => {});
    return `порыбачил: поймал ${caught} из ${times}`;
  }

  /** Своя печь (Meteor AutoSmelter): найти свою или поставить (скрафтить из булыжника), топливо, сырьё, забрать. */
  async smelt(a, tok) {
    const b = this.b, tb = this.tb;
    const inName = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const input = b.inventory.items().find((i) => i.name === inName);
    if (!input) throw new Error(`нет в инвентаре: ${inName}`);
    // партия до 8 штук: 64 сразу - это 11 минут стоять у печи (16.11 стояла у чужой коптильни и смотрела в стену)
    const count = Math.min(input.count, 8, Math.max(1, +a.count || 8));
    const FUEL = ['coal', 'charcoal', 'coal_block', 'lava_bucket', 'blaze_rod', 'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'stick'];
    const fuel = FUEL.map((n) => b.inventory.items().find((i) => i.name === n && i.name !== inName)).find(Boolean);
    if (!fuel) throw new Error('нет топлива (уголь, доски, брёвна)');
    // Печь: своя или любая свободная рядом, в том числе чужая (как игрок: зашёл, переплавил своё, забрал своё).
    // Свободная - все три ячейки пусты: чужое топливо и чужую переплавку не трогаем. Под замком LWC - не откроется, следующая.
    // Еду лучше в коптильне, руду - в плавильне: они быстрее и подходят тоже.
    const kinds = ['furnace', /^(beef|porkchop|chicken|mutton|rabbit|cod|salmon|potato|kelp)$/.test(inName) ? 'smoker' : 'blast_furnace']
      .map((n) => b.registry.blocksByName[n]).filter(Boolean).map((x) => x.id);
    const cands = () => b.findBlocks({ matching: kinds, maxDistance: 32, count: 20 }).map((p) => b.blockAt(p))
      .sort((p, q) => (this.mine(q.position) - this.mine(p.position)) || p.position.distanceTo(b.entity.position) - q.position.distanceTo(b.entity.position));
    let f = null, fb = null, why = '';
    for (const k of cands()) {
      tb.check(tok);
      try {
        await tb.goto(new goals.GoalLookAtBlock(k.position, b.world, { reach: 4 }), tok, 30000);   // видеть печь, не сквозь стену
        const ff = await b.openFurnace(k);
        if (!this.mine(k.position) && (ff.inputItem() || ff.fuelItem() || ff.outputItem())) { ff.close(); why = 'печи рядом заняты'; continue; }
        if (this.mine(k.position) && ff.outputItem()) await ff.takeOutput();
        f = ff; fb = k; break;
      } catch (e) { if (tb.isCancel(e)) throw e; why = 'печь не открылась (под замком?)'; }
    }
    if (!f) {
      tb.log(`свободной печи рядом нет (${why || 'не нашёл'}) - ставлю свою`);
      if (!b.inventory.items().some((i) => i.name === 'furnace')) await this.craft({ item: 'furnace' }, tok);
      await this.place({ block: 'furnace' }, tok);
      fb = b.findBlocks({ matching: b.registry.blocksByName.furnace.id, maxDistance: 6, count: 10 }).map((p) => b.blockAt(p)).find((k) => this.mine(k.position));
      if (!fb) throw new Error('печь не встала');
      await tb.goto(new goals.GoalNear(fb.position.x, fb.position.y, fb.position.z, 2), tok, 30000);
      f = await b.openFurnace(fb);
    } else tb.log(`переплавляю в ${this.mine(fb.position) ? 'своей' : 'чужой свободной'} печи ${fb.position.x} ${fb.position.y} ${fb.position.z}`);
    try {
      const perFuel = /coal|charcoal/.test(fuel.name) ? 8 : /log|planks/.test(fuel.name) ? 1.5 : /block/.test(fuel.name) ? 80 : 0.5;
      await f.putFuel(fuel.type, null, Math.min(fuel.count, Math.ceil(count / perFuel)));
      await f.putInput(input.type, null, count);
      const fast = /smoker|blast_furnace/.test(fb.name);   // коптильня и плавильня - вдвое быстрее
      const until = Date.now() + count * (fast ? 5300 : 10500) + 3000;
      let out = 0;
      while (Date.now() < until) {
        tb.check(tok);
        await sleep(2000);
        if (f.outputItem()) { const it = f.outputItem(); out += it.count; await f.takeOutput(); }
        if (out >= count) break;
      }
      if (f.outputItem()) { out += f.outputItem().count; await f.takeOutput(); }
      // в чужой печи своё не оставлять: недоплавленное и остаток топлива - забрать
      if (!this.mine(fb.position)) { try { if (f.inputItem()) await f.takeInput(); if (f.fuelItem()) await f.takeFuel(); } catch {} }
      return `переплавил ${inName}: получил ${out}`;
    } finally { f.close(); }
  }

  /** Дикое животное поблизости (не у построек, без имени - не чьё-то). */
  wild(e) {
    return e && e.isValid && !e.customName && !this.builtChunk(e.position) && !this.builtNear(e.position.floored(), 5);
  }

  /** Охота (Mindcraft hunting): на дикое животное ради еды; удары - честным боем (guard). Чужой скот у построек не трогаем. */
  async hunt(a, tok) {
    const b = this.b, tb = this.tb;
    const kind = String(a.animal || a.mob || 'cow').toLowerCase().replace(/^minecraft:/, '');
    const want = Math.max(1, Math.min(8, +a.count || 1));
    let killed = 0, refused = 0;
    for (let i = 0; i < want; i++) {
      tb.check(tok);
      const me = b.entity.position;
      const all = Object.values(b.entities).filter((e) => (e.name || '') === kind && e.position.distanceTo(me) < 40);
      const t = all.filter((e) => this.wild(e)).sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
      if (!t) { refused = all.length; break; }
      tb.guard.prey = t.id;
      const until = Date.now() + 45000;
      try {
        while (t.isValid && Date.now() < until) {
          tb.check(tok);
          if (t.position.distanceTo(b.entity.position) > 2.5) { try { await tb.goto(new goals.GoalFollow(t, 2), tok, 5000); } catch (e) { if (tb.isCancel(e)) throw e; } }
          await sleep(300);
        }
      } finally { tb.guard.prey = null; try { b.pathfinder.setGoal(null); } catch {} }
      if (!t.isValid) killed++;
      await sleep(500);
      await tb.pickup({ radius: 6 }, tok).catch(() => {});
    }
    if (!killed) throw new Error(refused ? `${kind} рядом только у чужих построек или с именем - это чужое` : `диких ${kind} рядом нет`);
    return `охота: ${kind} ${killed}`;
  }

  /** Стрижка диких овец (Meteor AutoShearer). */
  async shear(a, tok) {
    const b = this.b, tb = this.tb;
    const sh = b.inventory.items().find((i) => i.name === 'shears');
    if (!sh) throw new Error('нет ножниц (2 железа)');
    let n = 0;
    for (let i = 0; i < Math.min(10, +a.count || 4); i++) {
      tb.check(tok);
      const me = b.entity.position;
      const s = Object.values(b.entities).filter((e) => e.name === 'sheep' && this.wild(e) && e.position.distanceTo(me) < 32 && !(e.metadata && (e.metadata[17] & 0x10)))
        .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
      if (!s) break;
      await tb.goto(new goals.GoalFollow(s, 2), tok, 20000).catch((e) => { if (tb.isCancel(e)) throw e; });
      await b.equip(sh, 'hand');
      await b.lookAt(s.position.offset(0, 0.8, 0));
      await b.activateEntity(s);
      n++;
      await sleep(600);
    }
    await tb.pickup({ radius: 6 }, tok).catch(() => {});
    if (!n) throw new Error('диких нестриженых овец рядом нет');
    return `постриг овец: ${n}`;
  }

  /** Выбросить лишнее из инвентаря (Baritone throwaway / InventoryTweaks). */
  async toss(a) {
    const b = this.b;
    const name = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const it = b.inventory.items().find((i) => i.name === name);
    if (!it) throw new Error(`нет в инвентаре: ${name}`);
    const n = Math.min(it.count, Math.max(1, +a.count || it.count));
    await b.toss(it.type, null, n);
    return `выбросил ${name} x${n}`;
  }

  /**
   * Постройка (Baritone BuilderProcess, простые формы): house - стены, проём под дверь, крыша; wall, floor, pillar.
   * x y z - угол на уровне пола (по умолчанию в 2 блоках от себя), w d h - размер. Блоки - из инвентаря.
   */
  async build(a, tok) {
    const b = this.b, tb = this.tb;
    const block = String(a.block || 'oak_planks').toLowerCase().replace(/^minecraft:/, '');
    const shape = String(a.shape || 'house');
    const w = Math.max(1, Math.min(9, +a.w || 5)), d = Math.max(1, Math.min(9, +a.d || 5)), h = Math.max(1, Math.min(6, +a.h || 3));
    const me = b.entity.position.floored();
    const o = a.x !== undefined ? new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z)) : me.offset(2, 0, 2);
    const cells = [];
    if (shape === 'floor') { for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push(o.offset(x, 0, z)); }
    else if (shape === 'pillar') { for (let y = 0; y < h; y++) cells.push(o.offset(0, y, 0)); }
    else if (shape === 'wall') { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(o.offset(x, y, 0)); }
    else {   // house: стены по периметру, проём 1x2 посередине передней стены, плоская крыша
      const door = Math.floor(w / 2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
        const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
        if (!edge || (z === 0 && x === door && y < 2)) continue;
        cells.push(o.offset(x, y, z));
      }
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push(o.offset(x, h, z));
    }
    const todo = cells.filter((p) => { const k = b.blockAt(p); return k && (k.boundingBox === 'empty' || /water|short_grass|tall_grass|snow$/.test(k.name)); });
    const have = b.inventory.items().filter((i) => i.name === block).reduce((s, i) => s + i.count, 0);
    if (have < todo.length) throw new Error(`на ${shape} ${w}x${d}x${h} нужно ${block} x${todo.length}, есть ${have}`);
    for (const p of todo) { const near = this.builtNear(p, 2); if (near) throw new Error(`здесь рядом чужая постройка (${near.name}) - выбери другое место`); }
    let done = 0, skip = 0;
    // встать снаружи перед будущим проёмом (2 блока от стены), чтобы не замуровать себя
    if (shape === 'house') { try { await tb.goto(new goals.GoalNear(o.x + Math.floor(w / 2), o.y, o.z - 2, 0), tok, 30000); } catch (e) { if (tb.isCancel(e)) throw e; } }
    // снизу вверх, по высоте; бот отходит наружу, если мешает
    todo.sort((p1, p2) => p1.y - p2.y);
    for (const p of todo) {
      tb.check(tok);
      try { await this.place({ block, x: p.x, y: p.y, z: p.z }, tok); done++; }
      catch (e) {
        if (tb.isCancel(e)) throw e;
        if (/стою на этом месте/.test(e.message)) { await tb.goto(new goals.GoalInvert(new goals.GoalNear(p.x, p.y, p.z, 1)), tok, 8000).catch(() => {}); try { await this.place({ block, x: p.x, y: p.y, z: p.z }, tok); done++; continue; } catch {} }
        skip++;
      }
    }
    return `построил ${shape} ${w}x${d}x${h} из ${block} у ${o.x} ${o.y} ${o.z}: поставлено ${done}${skip ? ', не вышло ' + skip : ''}`;
  }

}

module.exports = { Skills, NATURAL, BUILT };
