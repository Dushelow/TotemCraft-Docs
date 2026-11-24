// Понимание места (23.11, владелец: «он как будто не понимает структуры, формы объектов - отсюда казусы»). Раз в 2 с
// тело разбирает окрестности, как игрок глазами:
//   - внутри или снаружи (крыша над головой, стены вокруг);
//   - что за место: корабль (дерево над водой), пещера (природный камень сверху), постройка, открытое место;
//   - комната: клетки, где можно стоять, на уровне ног в 12 бл. (заливка до стен) - размер и выходы:
//     двери, люки, лестницы вверх/вниз, проёмы под открытое небо, ступени на другой уровень;
//   - края: откуда спрыгнуть в воду (борт, причал), где обрыв.
// Итог - короткий текст для нейросети ([место]) и данные для тела (выход наружу, в воду).
const { Vec3 } = require('vec3');

const NATURAL = /^(stone|deepslate|tuff|andesite|diorite|granite|dirt|coarse_dirt|gravel|sand|sandstone|calcite|cobbled_deepslate|netherrack|basalt|blackstone|clay|mud|grass_block|snow_block|ice|packed_ice|.*_ore)$/;
const WOOD = /_planks$|_log$|_wood$|_stairs$|_slab$|_fence|_trapdoor$|_door$/;
const CL = /^(ladder|vine|scaffolding|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/;

class Scene {
  /** Небо над клеткой: до 40 бл. вверх нет твёрдого. */
  skyAt(x, y, z) {
    const b = this.bot;
    for (let yy = y + 1; yy < y + 40; yy++) { const k = b.blockAt(new Vec3(x, yy, z)); if (!k) return true; if (k.boundingBox === 'block' && !/glass|leaves/.test(k.name)) return false; }
    return true;
  }

  /** Можно ли стоять в клетке (ноги в x,y,z). */
  standAt(x, y, z) {
    const b = this.bot, f = b.blockAt(new Vec3(x, y - 1, z)), a = b.blockAt(new Vec3(x, y, z)), h = b.blockAt(new Vec3(x, y + 1, z));
    if (!f || !a || !h) return false;
    const pass = (k) => k.boundingBox === 'empty' || CL.test(k.name) || /_door$|_trapdoor$|_carpet$|_pressure_plate$|_button$|torch|_sign$/.test(k.name) && (k.getProperties().open === true || k.getProperties().open === 'true' || !/_door$/.test(k.name));
    return (f.boundingBox === 'block' || /water/.test(f.name) || CL.test(f.name)) && pass(a) && pass(h);
  }

  /** Полный разбор места вокруг (не чаще раза в 2 с; иначе - последний). */
  sceneNow(force) {
    if (!force && this._sceneNow && Date.now() - this._sceneNow.at < 2000) return this._sceneNow;
    const b = this.bot;
    if (!b || !b.entity) return null;
    const me = b.entity.position.floored();
    const S = { at: Date.now(), inside: false, kind: 'открытое место', roomSize: 0, exits: [], waterEdges: [], dropEdges: [] };
    // крыша и что над головой
    let roof = null;
    for (let yy = me.y + 2; yy < me.y + 30; yy++) { const k = b.blockAt(new Vec3(me.x, yy, me.z)); if (!k) break; if (k.boundingBox === 'block') { roof = k; break; } }
    // стены: 8 лучей по горизонтали на уровне головы, сколько упираются в 8 бл.
    let walls = 0;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
      for (let t = 1; t <= 8; t++) { const k = b.blockAt(new Vec3(Math.floor(me.x + 0.5 + dx * t), me.y + 1, Math.floor(me.z + 0.5 + dz * t))); if (k && k.boundingBox === 'block') { walls++; break; } }
    }
    S.inside = !!roof && walls >= 5;
    // комната: заливка клеток, где можно стоять, на уровне ног (±1 по ступеням), до 12 бл., не больше 600 клеток
    const seen = new Set([me.x + ',' + me.y + ',' + me.z]), q = [[me.x, me.y, me.z]], cells = [];
    while (q.length && cells.length < 600) {
      const [x, y, z] = q.shift(); cells.push([x, y, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
        const nx = x + dx, ny = y + dy, nz = z + dz, k = nx + ',' + ny + ',' + nz;
        if (seen.has(k) || Math.abs(nx - me.x) > 12 || Math.abs(nz - me.z) > 12 || Math.abs(ny - me.y) > 3) continue;
        if (!this.standAt(nx, ny, nz)) continue;
        seen.add(k); q.push([nx, ny, nz]); break;
      }
    }
    S.roomSize = cells.length;
    // выходы: по краю комнаты - двери, люки, лестницы, проёмы под небо (если сами внутри)
    const exits = new Map();
    // один выход на столб лестницы или лиан (а не на каждую ступеньку): вверх, вниз или вверх и вниз
    const addExit = (kind, x, y, z, note) => {
      const lad = /^лестница/.test(kind), k = (lad ? 'лестница' : kind) + x + ',' + z, old = exits.get(k);
      if (!old) exits.set(k, { kind, x, y, z, note });
      else if (lad && old.kind !== kind) old.kind = 'лестница вверх и вниз';
    };
    for (const [x, y, z] of cells) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
        for (const dy of [0, 1, -1]) {
          const k = b.blockAt(new Vec3(x + dx, y + dy, z + dz)); if (!k) continue;
          if (/_door$/.test(k.name) && dy >= 0) addExit('дверь', k.position.x, k.position.y, k.position.z, k.getProperties().open === true || k.getProperties().open === 'true' ? 'открыта' : 'закрыта');
          else if (/_trapdoor$/.test(k.name) && dy <= 0 && !dx && !dz) addExit('люк', k.position.x, k.position.y, k.position.z, 'в полу');
          else if (CL.test(k.name) && dy === -1) addExit('лестница вниз', k.position.x, k.position.y, k.position.z, '');
          else if (CL.test(k.name) && dy >= 0) addExit('лестница вверх', k.position.x, k.position.y, k.position.z, '');
        }
      }
      if (S.inside && this.skyAt(x, y, z)) addExit('проём наружу', x, y, z, 'под небом');
    }
    S.exits = [...exits.values()].sort((u, v) => Math.hypot(u.x - me.x, u.z - me.z) - Math.hypot(v.x - me.x, v.z - me.z)).slice(0, 8);
    // края: с клетки комнаты шаг в сторону - пусто вниз; под ним вода (спрыгнуть) или глубокий обрыв
    for (const [x, y, z] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ex = x + dx, ez = z + dz;
      const a0 = b.blockAt(new Vec3(ex, y, ez)), a1 = b.blockAt(new Vec3(ex, y + 1, ez));
      if (!a0 || !a1 || a0.boundingBox !== 'empty' || a1.boundingBox !== 'empty') continue;
      let yy = y - 1, n = 0;
      while (n < 40) { const k = b.blockAt(new Vec3(ex, yy, ez)); if (!k || k.boundingBox !== 'empty' || /water/.test(k.name)) break; yy--; n++; }
      const bot0 = b.blockAt(new Vec3(ex, yy, ez));
      if (n < 1) continue;
      if (bot0 && /water/.test(bot0.name)) S.waterEdges.push({ x, y, z, ex, ez, wy: yy, h: n });
      else if (n >= 4) S.dropEdges.push({ x, y, z, ex, ez, h: n });
    }
    S.waterEdges.sort((u, v) => Math.hypot(u.x - me.x, u.z - me.z) - Math.hypot(v.x - me.x, v.z - me.z));
    // что за место
    const around = b.findBlocks({ matching: (bl) => bl.boundingBox === 'block', maxDistance: 8, count: 400 }).map((p) => b.blockAt(p)).filter(Boolean);
    const wood = around.filter((k) => WOOD.test(k.name)).length, nat = around.filter((k) => NATURAL.test(k.name)).length;
    const waterNear = b.findBlocks({ matching: (bl) => bl.name === 'water', maxDistance: 10, count: 60 }).length;
    if (wood > 120 && waterNear > 30) S.kind = 'корабль';
    else if (roof && NATURAL.test(roof.name) && nat > wood * 2) S.kind = 'пещера или подземелье';
    else if (S.inside || wood > 80) S.kind = 'постройка';
    S.roof = roof ? roof.name : '';
    this._sceneNow = S;
    return S;
  }

  /** Коротко для нейросети: где я, внутри или снаружи, выходы и края. */
  sceneNowText() {
    const S = this.sceneNow(); if (!S) return '';
    const me = this.bot.entity.position.floored();
    const dir = (x, z) => { const a = Math.atan2(z - me.z, x - me.x); return ['восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад', 'север', 'северо-восток'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; };
    const parts = [`${S.kind}, ${S.inside ? 'внутри (крыша: ' + S.roof + ')' : 'снаружи, над головой небо'}`];
    if (S.roomSize) parts.push(`место вокруг ~${S.roomSize} клеток`);
    if (S.exits.length) parts.push('выходы: ' + S.exits.slice(0, 5).map((e) => `${e.kind}${e.note ? ' (' + e.note + ')' : ''} ${Math.round(Math.hypot(e.x - me.x, e.z - me.z))} бл. на ${dir(e.x, e.z)}`).join('; '));
    if (S.waterEdges.length) { const w = S.waterEdges[0]; parts.push(`край к воде: ${Math.round(Math.hypot(w.x - me.x, w.z - me.z))} бл. на ${dir(w.ex, w.ez)}, прыжок ${w.h} бл. - в воду можно спрыгнуть`); }
    return parts.join('; ');
  }
}

module.exports = { Scene };
