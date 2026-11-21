// Восприятие: состояние для мозга, взгляд, комната, осмотр вокруг.
// Вынесено из bot.js (разбивка большого файла, 21.11.2026): методы подмешиваются в TotemBot, this - тело бота.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { BUILT } = require('./skills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';

class Perception {
  /** Состояние по частям: core и near идут в каждом сообщении, остальное - когда меняется или когда бот посмотрит. */
  stateParts() {
    const s = this.state();
    if (s.status !== 'online') return null;
    const b = this.bot;
    const t = b.time && b.time.timeOfDay;
    const tod = t === undefined ? '' : t < 1000 ? 'утро' : t < 11500 ? 'день' : t < 13000 ? 'вечер' : t < 23000 ? 'ночь' : 'рассвет';
    // погода: флаг isRaining через ViaVersion застревал (19.11 «дождь» в доме и даже в Незере) - по силе дождя и только в обычном мире
    const over = /overworld/.test(b.game.dimension || '');
    const pk = this.precip();
    const weather = !over || !pk ? '' : (b.thunderState || 0) > 0.3 ? `, ${pk === 'снег' ? 'снег и гроза' : 'гроза'}` : `, ${pk}`;
    const ch = this.worldMap && this.worldMap.load(b.game.dimension).chunks[`${Math.floor(s.pos[0] / 16)},${Math.floor(s.pos[2] / 16)}`];
    // «под землёй» - только если над головой нет неба (свет неба у головы < 8, и над головой твёрдое в 40 блоках);
    // средняя высота чанка врёт у ледяных шипов, гор и деревьев (боевой 15.11: на льду «под землёй»)
    let under = '';
    {
      const head = b.blockAt(b.entity.position.offset(0, 1.6, 0));
      const sky = head && typeof head.skyLight === 'number' ? head.skyLight : null;
      let roof = null;
      for (let dy = 2; dy <= 40 && !roof; dy++) { const k = b.blockAt(b.entity.position.offset(0, dy, 0)); if (k && k.boundingBox === 'block' && !/leaves|glass|ice/.test(k.name)) roof = k; }
      // крыша - постройка (доски, кирпич...) или рядом стены постройки: это дом, а не «под землёй» (19.11 в доме - «под землёй»)
      const built = roof && (BUILT.test(roof.name) || !!this.skills.builtNear(b.entity.position.floored(), 2));
      if (!/overworld/.test(b.game.dimension || '')) under = '';   // в Незере и Энде неба нет всегда - не «под землёй»
      else if (roof && built && roof.position.y - b.entity.position.y < 8) under = ', в помещении (постройка)';
      else if (roof && (sky === null ? (ch && ch.h !== null && s.pos[1] < ch.h - 6) : sky < 8)) under = ', под землёй' + (ch && ch.h !== null && ch.h - s.pos[1] > 6 ? ` (поверхность около y ${ch.h}, ты на ${ch.h - s.pos[1]} ниже)` : '');
      // высоко над землёй (гора, башня, мост, небо) - тоже сказать: иначе «рядом» постройки и точки внизу путаются
      if (/overworld/.test(b.game.dimension || '') && ch && ch.h !== null && s.pos[1] - ch.h > 12 && !under) under = `, высоко: земля здесь около y ${ch.h}, ты на ${s.pos[1] - ch.h} выше`;
    }
    const doing = s.mode === 'follow' ? `идёшь за ${s.follow}` : s.mode === 'task' ? `выполняешь: ${s.task}` : s.mode === 'life' ? `тело само: ${s.task}` : s.mode === 'hold' ? 'стоишь и ждёшь (сказали ждать)' : 'стоишь';
    return {
      pos: s.pos,
      core: `${s.dim} ${s.pos.join(' ')}${/nether/.test(b.game.dimension || '') ? ` (это Незер; в обычном мире это около ${s.pos[0] * 8} ${s.pos[2] * 8})` : ''}${under}; ${tod}${weather}; здоровье ${s.health}/20, еда ${s.food}/20; ${doing}${this.errandText && this.errandText() ? '; ' + this.errandText() : ''}`,
      near: s.near.length ? 'рядом: ' + s.near.map((n) => `${n.name} ${n.dist} бл.`).join(', ') : 'рядом никого (48 бл.)',
      inv: Object.entries(s.items).map(([k, v]) => `${k} x${v}`).join(', ') || 'пусто',
      online: Object.keys(b.players || {}).filter((n) => n !== this.opts.name).sort(),
      sees: this.glance() + (this.villagersNear && this.villagersNear(24).length ? (() => { const k = this.tradesKnown(); return '; жителей рядом: ' + this.villagersNear(24).length + (k ? '; ' + k : ' (чем торгуют - !trades)'); })() : ''),
      map: () => (this.worldMap ? this.worldMap.summary(this) : 'карты нет'),
    };
  }

  /** Снимок для зрения: вид глазами + карта сверху (PNG). */
  snapshot() { const { Vision } = require('./vision'); return new Vision(this.bot).snapshot(); }

  /** Взгляд (каждое сообщение, дёшево): под ногами, перед собой, в руке, мобы и вещи в 16 блоках. */
  glance() {
    const b = this.bot, e = b.entity, p = e.position;
    const nm = (v) => { const k = b.blockAt(v); return k ? k.name.replace(/^minecraft:/, '') : '?'; };
    const fwd = p.offset(-Math.sin(e.yaw) * 1.5, 0, -Math.cos(e.yaw) * 1.5);
    const mobs = {};
    let drops = 0;
    for (const x of Object.values(b.entities)) {
      if (x === e || !x.position || x.type === 'player') continue;
      if (x.position.distanceTo(p) > 16) continue;
      if (x.name === 'item') drops++; else if (x.name && x.type !== 'object' && x.type !== 'orb') mobs[x.name] = (mobs[x.name] || 0) + 1;
    }
    const ml = Object.entries(mobs).sort((a2, b2) => b2[1] - a2[1]).slice(0, 5).map(([k, v]) => v > 1 ? `${k} x${v}` : k).join(', ');
    const held = b.heldItem ? b.heldItem.name : 'пусто';
    const room = this.houseText() || this.roomText();
    let objs = ''; try { objs = require('./objects').describe(this); } catch {}
    return `под ногами ${nm(p.offset(0, -0.5, 0))}, впереди ${nm(fwd)}/${nm(fwd.offset(0, 1, 0))}, в руке ${held}` + (ml ? `; мобы: ${ml}` : '') + (drops ? `; вещей на земле ${drops}` : '') + (room ? `\n[комната] ${room}` : '') + (objs ? `\n[предметы] ${objs} (пользоваться: !use(x, y, z))` : '');
  }

  /**
   * Комната вокруг (19.11: «не видит стены, не понимает, в помещении ли, не может осознать структуру дома»).
   * Только когда над головой крыша в 6 блоках. Стены по сторонам света на уровне головы, потолок, двери и калитки
   * (открыта/закрыта), люки, ступеньки и лестницы с тем, куда ведут (выше/ниже), сундуки, кровати, окна.
   */
  roomText() {
    const b = this.bot, p = b.entity.position.floored();
    let ceil = 0;
    for (let dy = 2; dy <= 6 && !ceil; dy++) { const k = b.blockAt(p.offset(0, dy, 0)); if (k && k.boundingBox === 'block') ceil = dy; }
    if (!ceil) return '';
    const { compass } = require('./worldmap');
    const solid = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && !/_door$|_gate$/.test(k.name); };
    const walls = [];
    for (const [dx, dz, nm] of [[0, -1, 'С'], [1, 0, 'В'], [0, 1, 'Ю'], [-1, 0, 'З']]) {
      let d = 0;
      for (let i = 1; i <= 8; i++) { if (solid(p.offset(dx * i, 1, dz * i))) { d = i; break; } }
      walls.push(`${nm} ${d ? d + ' бл.' : 'открыто'}`);
    }
    const seen = [], mark = new Set();
    const R = 6;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (let dy = -3; dy <= 4; dy++) {
      const v = p.offset(dx, dy, dz), k = b.blockAt(v);
      if (!k) continue;
      const n = k.name;
      let what = '';
      const pr = () => (k.getProperties ? k.getProperties() : {});
      if (/_door$/.test(n)) { if (pr().half === 'upper') continue; what = `дверь (${pr().open ? 'открыта' : 'закрыта'})`; }
      else if (/_fence_gate$/.test(n)) what = `калитка (${pr().open ? 'открыта' : 'закрыта'})`;
      else if (/_trapdoor$/.test(n)) what = `люк (${pr().open ? 'открыт' : 'закрыт'})`;
      else if (/_stairs$/.test(n)) { if (dy < -1 || dy > 3) continue; what = 'ступеньки'; }
      else if (n === 'ladder' || n === 'scaffolding') what = 'лестница-приставная';
      else if (/^(chest|trapped_chest|barrel)$|shulker_box$/.test(n)) what = 'сундук';
      else if (/_bed$/.test(n)) { if (pr().part === 'head') continue; what = 'кровать'; }
      else if (/^(furnace|smoker|blast_furnace|crafting_table)$/.test(n)) what = n === 'crafting_table' ? 'верстак' : 'печь';
      else continue;
      const key = what.split(' ')[0] + Math.round(dx / 2) + ',' + Math.round(dy / 2) + ',' + Math.round(dz / 2);
      if (mark.has(key)) continue;
      mark.add(key);
      const d = Math.round(Math.hypot(dx, dz));
      const lvl = dy >= 2 ? `, выше на ${dy}` : dy <= -2 ? `, ниже на ${-dy}` : '';
      seen.push({ d, t: `${what} ${d ? d + ' бл. на ' + compass(dx, dz) : 'здесь'}${lvl} (${v.x} ${v.y} ${v.z})` });
    }
    // ступеньки: куда ведут - вверх, если дальше по лестнице блоки выше
    const stairs = seen.filter((x) => x.t.startsWith('ступеньки'));
    const up = stairs.some((x) => / выше на /.test(x.t)) ? '; ступеньки ведут на этаж выше' : '';
    const list = seen.sort((a, c) => a.d - c.d).slice(0, 10).map((x) => x.t).join('; ');
    return `в помещении: потолок ${ceil} бл.; стены на уровне головы: ${walls.join(', ')}${up}${list ? '; рядом: ' + list : ''}`;
  }

  /** Осмотреться: мобы и животные, вещи на земле, приметные блоки в 10 блоках, биом. По запросу мозга. */
  lookAround() {
    const b = this.bot;
    if (!b || !b.entity) return 'ты не на сервере';
    const me = b.entity.position;
    const mobs = {}, players = [];
    let drops = 0;
    for (const e of Object.values(b.entities)) {
      if (e === b.entity || !e.position) continue;
      const d = e.position.distanceTo(me);
      if (d > 24) continue;
      if (e.type === 'player') players.push(`${e.username} ${Math.round(d)} бл.`);
      else if (e.name === 'item') drops++;
      else if (['hostile', 'mob', 'animal', 'passive', 'water_creature', 'ambient'].includes(e.type) || e.kind) mobs[e.name] = (mobs[e.name] || 0) + 1;
    }
    const blocks = {};
    try {
      const NOTABLE = /(chest|barrel|shulker_box|crafting_table|furnace|smoker|_door|_bed|anvil|enchanting_table|brewing_stand|wheat|carrots|potatoes|beetroots|farmland|sugar_cane|melon|pumpkin|nether_portal|spawner|_sign|lantern|torch|_ore|bell|composter|lectern)$/;
      const HID = /^(.*_ore|raw_\w+_block|mossy_cobblestone|obsidian|chest|ender_chest|clay)$/;
      const open = (p) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => { const n = b.blockAt(p.offset(x, y, z)); return n && n.boundingBox !== 'block'; });
      let rays = 0;
      for (const p of b.findBlocks({ matching: (bl) => NOTABLE.test(bl.name), maxDistance: 10, count: 400 }).sort((u, v) => u.distanceTo(me) - v.distanceTo(me))) {
        const k = b.blockAt(p);
        // видно ли глазами: луч от глаз до блока (как зрение NPC); сквозь стены не «видит», не больше 150 лучей
        if (rays++ < 150 && b.canSeeBlock && !b.canSeeBlock(k)) continue;
        // анти-иксрей сервера шлёт поддельные руды и сундуки внутри камня ниже y 64 - их нет (19.11: «шахта с алмазами», которой нет)
        if (HID.test(k.name) && p.y < 64 && !open(p)) continue;
        const nm = k.name.replace(/^wall_|_wall(?=_)/, '');
        blocks[nm] = (blocks[nm] || 0) + 1;
      }
    } catch {}
    let biome = '';
    try { const bl = b.blockAt(me); biome = bl && bl.biome && bl.biome.name ? bl.biome.name : ''; } catch {}
    const list = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => v > 1 ? `${k} x${v}` : k).join(', ');
    return [biome && `биом ${biome}`, players.length && `игроки: ${players.join(', ')}`, `мобы и звери (24 бл.): ${list(mobs) || 'нет'}`,
      drops && `вещей на земле: ${drops}`, `блоки рядом (10 бл.): ${list(blocks) || 'ничего приметного'}`].filter(Boolean).join('; ');
  }

  stateText() {
    const s = this.state();
    if (s.status !== 'online') return 'ты не на сервере';
    const inv = Object.entries(s.items).map(([k, v]) => `${k} x${v}`).join(', ') || 'пусто';
    const near = s.near.map((n) => `${n.name} (${n.dist} бл.)`).join(', ') || 'никого (в 48 блоках)';
    const online = Object.keys(this.bot.players || {}).filter((n) => n !== this.opts.name);
    const doing = s.mode === 'follow' ? `идёшь за ${s.follow}` : s.mode === 'task' ? `выполняешь: ${s.task}` : 'стоишь';
    return `измерение: ${s.dim}, координаты ${s.pos.join(' ')}, здоровье ${s.health}/20, еда ${s.food}/20, сейчас ${doing}; ` +
      `инвентарь: ${inv}; рядом: ${near}; на сервере онлайн ${online.length}: ${online.slice(0, 30).join(', ') || 'никого'}`
      + (this.worldMap ? '; ' + this.worldMap.summary(this) : '');
  }

}

module.exports = { Perception };
