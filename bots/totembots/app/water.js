// Вода: выход на берег, всплытие, поиск берега.
// Вынесено из bot.js (разбивка большого файла, 21.11.2026): методы подмешиваются в TotemBot, this - тело бота.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { BUILT } = require('./skills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';

class Water {
  // Выход из воды на уступ: в клиенте Minecraft, если в воде упираешься в блок, а над ним свободно, игрока
  // подбрасывает на 0,3 (outOfLiquidImpulse). Физика mineflayer это не делает (стенд 15.11: бот не мог выйти на
  // пляж). Даём тот же толчок, когда бот идёт вперёд или по пути; античит это видит как обычный выход (0 отметок).
  /**
   * Выбраться из воды на уступ (best - клетка, где встать), как игрок: прыжок держать, у стенки внизу волны - чуть назад,
   * на гребне - вперёд (упор на гребне - толчок через край, waterExitTick). pathfinder этот ход не умеет. true - вышел.
   */
  async climbOut(best) {
    const b = this.bot;
    this.busyLook = true;
    try {
      try { b.pathfinder.setGoal(null); } catch {}
      for (let i = 0; i < 240; i++) {   // до 12 с
        const f = b.blockAt(b.entity.position);
        if (!f || !/water|kelp|seagrass/.test(f.name)) break;
        const q = b.entity.position, crest = q.y - Math.floor(q.y) >= 0.45;
        if (i === 0) await b.lookAt(best.offset(0.5, 1.4, 0.5));
        b.setControlState('sprint', false);
        b.setControlState('jump', true);
        b.setControlState('forward', crest || !b.entity.isCollidedHorizontally);
        b.setControlState('back', !crest && b.entity.isCollidedHorizontally);
        await sleep(50);
      }
    } finally { b.clearControlStates(); this.busyLook = false; }
    const f = b.blockAt(b.entity.position);
    return !(f && /water/.test(f.name));
  }

  /** Уступ рядом (до r блоков), где можно встать, - ближе к цели goal (если дана). */
  ledgeNear(r = 5, goal = null) {
    const b = this.bot, me = b.entity.position, lvl = Math.floor(me.y);
    const ok = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && !/water|leaves|glass/.test(k.name); };
    const free = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'empty' && !/water|lava/.test(k.name); };
    let best = null, bs = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 1; dy++) {
      const v = new Vec3(Math.floor(me.x) + dx, lvl + dy, Math.floor(me.z) + dz);
      if (!ok(v) || !free(v.offset(0, 1, 0)) || !free(v.offset(0, 2, 0))) continue;
      if ((this.badShore || []).some((x) => Date.now() - x.at < 10 * 60000 && x.v.distanceTo(v) < 1.5)) continue;   // сюда уже не вылез
      // проход к уступу: в клетке между ботом и уступом над водой есть место для головы (не ледяной потолок)
      const mx = Math.round((v.x + 0.5 + me.x) / 2 - 0.5), mz = Math.round((v.z + 0.5 + me.z) / 2 - 0.5);
      if (!free(new Vec3(mx, lvl + 2, mz)) && !(b.blockAt(new Vec3(mx, lvl + 2, mz)) || {}).name?.includes('water')) continue;
      const d = Math.hypot(v.x + 0.5 - me.x, v.z + 0.5 - me.z) + (goal ? Math.hypot(v.x - goal.x, v.z - goal.z) * 0.3 : 0);
      if (d < bs) { bs = d; best = v.offset(0, 1, 0); }
    }
    return best;
  }

  // Плавание как у игрока (pathfinder в воде дёргал бег на гребнях и бросал клавиши у берега, голова крутилась):
  // держать прыжок (ровно на поверхности, вниз - только если путь уходит вниз), без бега, вперёд к следующей точке
  // пути, которая хотя бы на полблока в стороне. Идёт после pathfinder в том же такте - его клавиши перекрываются.
  swimTick() {
    const b = this.bot, e = b.entity;
    if (!e || this.busyLook || !b.pathfinder.isMoving()) return;
    const p = e.position, feet = b.blockAt(p);
    if (!e.isInWater && !(feet && /water|kelp|seagrass|bubble_column/.test(feet.name))) return;
    const path = (this.lastPath || {}).path || [];
    if (!path.length) return;
    const c = (n) => ({ x: Number.isInteger(n.x) ? n.x + 0.5 : n.x, y: n.y, z: Number.isInteger(n.z) ? n.z + 0.5 : n.z });
    let i0 = 0, best = Infinity;
    path.forEach((n, i) => { const q = c(n), d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); if (d < best) { best = d; i0 = i; } });
    let nx = null;
    for (let i = i0; i < path.length; i++) { const q = c(path[i]); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.5) { nx = q; break; } }
    if (!nx) return;
    // Плавание как у игрока: голова под водой - рывок (sprint в воде = поза плавания, «рыбкой», а не шаги по дну
    // как утопленник), смотреть вверх или вниз по пути; на поверхности - ровно держаться прыжком.
    const head = b.blockAt(p.offset(0, 1.6, 0));
    const under = head && /water|kelp|seagrass|bubble_column/.test(head.name);
    const far = Math.hypot(nx.x - p.x, nx.z - p.z) > 1.5 || Math.abs(nx.y - p.y) > 1;
    b.setControlState('sprint', under && far && b.food > 6);
    b.setControlState('forward', true);
    b.setControlState('jump', nx.y >= Math.floor(p.y) || (b.oxygenLevel !== undefined && b.oxygenLevel < 8));
    const yaw = Math.atan2(-(nx.x - p.x), -(nx.z - p.z));
    const pitch = under ? Math.max(-0.9, Math.min(0.9, Math.atan2(nx.y - p.y, Math.hypot(nx.x - p.x, nx.z - p.z) || 1))) : 0;
    let dy = yaw - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(dy) > 0.05 || Math.abs(pitch - e.pitch) > 0.05) b.look(e.yaw + Math.max(-0.35, Math.min(0.35, dy)), e.pitch + Math.max(-0.2, Math.min(0.2, pitch - e.pitch)), true);   // плавно, без рывков
  }

  waterExitTick() {
    const b = this.bot, e = b.entity;
    if (!e || e.velocity.y > 0.2) return;
    const feet = b.blockAt(e.position);
    if (!feet || !/water|seagrass|kelp/.test(feet.name)) return;   // ноги в воде (isInWater у края бывает false)
    const p = e.position;
    if (process.env.TB_DEBUG) console.log('вода:', p.y.toFixed(2), 'fwd', b.getControlState('forward'), 'moving', b.pathfinder.isMoving(), 'yaw', e.yaw.toFixed(2));
    if (!b.getControlState('forward') && !b.pathfinder.isMoving()) return;
    if (b.pathfinder.isMoving()) {   // ведёт путь: толчок, только если следующая точка выше (вылезти), а не плывём вдоль берега
      const nx = ((this.lastPath || {}).path || [])[0];
      if (!nx || nx.y <= Math.floor(e.position.y)) return;
    }
    const yaw = e.yaw;
    const front = p.offset(-Math.sin(yaw) * 0.8, 0, -Math.cos(yaw) * 0.8).floored();
    const ledge = b.blockAt(front), up1 = b.blockAt(front.offset(0, 1, 0)), up2 = b.blockAt(front.offset(0, 2, 0));
    if (!ledge || ledge.boundingBox !== 'block' || !up1 || up1.boundingBox !== 'empty' || !up2 || up2.boundingBox !== 'empty') return;
    if (Math.hypot(front.x + 0.5 - p.x, front.z + 0.5 - p.z) > 1.3) return;   // уступ вплотную
    // как в клиенте: сначала всплыть повыше (прыжок в воде), с гребня - толчок 0,3 через край
    if (p.y - Math.floor(p.y) < 0.45) { b.setControlState('jump', true); return; }
    // один толчок на касание, не чаще раза в секунду: толчок каждый такт Vulcan видит как полёт (Flight F, бан на стенде)
    if (Date.now() - (this.exitAt || 0) < 2000) return;
    this.exitAt = Date.now();
    e.velocity.y = 0.3;
  }

  // Воздух кончается под водой - всплыть, даже посреди пути
  airTick() {
    const b = this.bot;
    const head = b.blockAt(b.entity.position.offset(0, 1.6, 0));
    const under = head && /water|bubble_column/.test(head.name);
    if (under && b.oxygenLevel !== undefined && b.oxygenLevel < 12) {
      b.setControlState('jump', true);
      this.surfacing = true;
    } else if (this.surfacing && !under) {
      b.setControlState('jump', false);
      this.surfacing = false;
    }
  }

  // Как человек: без дела в воде не болтается - через 15 с плывёт к ближайшему берегу (до 40 блоков).
  // Только когда стоит без задания и ни за кем не идёт: в задании и при слежке путь строит pathfinder.
  shoreTick() {
    const b = this.bot, me = b.entity.position;
    const feet = b.blockAt(me);
    const wet = feet && /water|bubble_column|kelp|seagrass/.test(feet.name);
    if (!wet || this.mode !== 'idle' || b.pathfinder.isMoving()) { this.wetSince = wet ? (this.wetSince || Date.now()) : 0; return; }
    if (!this.wetSince) this.wetSince = Date.now();
    if (Date.now() - this.wetSince < 15000 || Date.now() - (this.shoreTry || 0) < 10000) return;
    this.shoreTry = Date.now();
    // берег - природная земля (не чужие доски, лодки и причалы: туда из воды не залезть, да и не наше)
    const NATURAL = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|sand|red_sand|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|clay|mud|snow_block|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|ice|packed_ice|blue_ice)$/;
    const solid = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && NATURAL.test(k.name); };
    this.badShore = (this.badShore || []).filter((x) => Date.now() - x.at < 10 * 60000);
    const empty = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'empty' && !/water|lava/.test(k.name); };
    // сначала пологий берег (встать не выше уровня воды - выйти шагом), потом уступ в блок: из воды на уступ
    // физика mineflayer не подпрыгивает (проверено на стенде 15.11), поэтому уступ - запасной
    const lvl = Math.floor(me.y);
    let best = null;
    // сначала природный берег в 40 блоках; нет - любая твёрдая опора в 64 (причал, мостки - как игрок; не палуба над головой)
    const anySolid = (v) => { const k = b.blockAt(v); return k && k.boundingBox === 'block' && !/water|leaves|_glass|glass/.test(k.name); };
    for (const [maxUp, R, ok] of [[1, 40, solid], [1, 64, anySolid]]) {
    for (let r = 1; r <= R && !best; r += (r < 6 ? 1 : 2)) {
      for (let a = 0; a < 32; a++) {
        const x = Math.floor(me.x + Math.cos(a * Math.PI / 16) * (r + 0.3)), z = Math.floor(me.z + Math.sin(a * Math.PI / 16) * (r + 0.3));
        for (let y = Math.floor(me.y) + 2; y >= Math.floor(me.y) - 3; y--) {
          const v = new Vec3(x, y, z);
          if (v.y + 1 - lvl > maxUp) continue;
          if (ok(v) && empty(v.offset(0, 1, 0)) && empty(v.offset(0, 2, 0)) && !this.badShore.some((x) => x.v.distanceTo(v) < 3)) { best = v.offset(0, 1, 0); break; }
        }
        if (best) break;
      }
    }
    if (best) break;
    }
    if (!best && this.worldMap) {   // рядом нет - ближайшая суша по карте (вся прорисовка), плыть туда
      const m = this.worldMap.load(b.game.dimension), pcx = Math.floor(me.x / 16), pcz = Math.floor(me.z / 16);
      let bd = Infinity, land = null;
      for (const [k, c] of Object.entries(m.chunks)) {
        if (c.k !== 'g' || c.h === null || c.h < lvl) continue;
        const [cx, cz] = k.split(',').map(Number), d = Math.hypot(cx - pcx, cz - pcz);
        if (d < bd && d > 0) { bd = d; land = { x: cx * 16 + 8, z: cz * 16 + 8 }; }
      }
      if (land) {
        this.log(`берега рядом нет - плыву к суше по карте: ${land.x} ${land.z}`);
        this.mode = 'shore';
        this.goto(new goals.GoalNearXZ(land.x, land.z, 6), this.token, 120000).catch(() => {}).finally(() => { if (this.mode === 'shore') this.mode = 'idle'; });
        return;
      }
    }
    if (!best) { this.log('в воде, берега рядом не вижу'); return; }
    this.log(`выплываю на берег: ${best.x} ${best.y} ${best.z}`);
    this.mode = 'shore';   // пока плывёт - не «стоит без дела»
    // берег рядом - как игрок: лицом к суше, держать «вперёд» и «прыжок», пока не выйдет из воды (до 5 с)
    if (Math.hypot(best.x + 0.5 - me.x, best.z + 0.5 - me.z) <= 6) {
      this.climbOut(best).then((ok) => {
        if (!ok) { this.badShore.push({ v: best.offset(0, -1, 0), at: Date.now() }); this.log('на этот берег не вылез, поищу другой'); }
        else this.log('вышел на берег');
        if (this.mode === 'shore') this.mode = 'idle';
      });
      return;
    }
    const tok = this.token;
    this.goto(new goals.GoalNear(best.x, best.y, best.z, 1), tok, 40000)
      .catch(async (e) => {
        // у самого берега путь из воды на уступ не строится: как человек - лицом к берегу, вперёд с прыжком, один раз
        if (isCancel(e)) throw e;
        { const p0 = b.entity.position.floored(); const rows = [];
          for (let dy = -1; dy <= 2; dy++) { const r = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const k = b.blockAt(p0.offset(dx, dy, dz)); r.push(k ? k.name.replace(/_?(block|planks)$/, '').slice(0, 9) : '?'); } rows.push(`y${p0.y + dy}: ` + r.join(',')); }
          const ents = Object.values(b.entities).filter((x) => x !== b.entity && x.position.distanceTo(b.entity.position) < 3).map((x) => x.name);
          this.log(`у берега: я ${b.entity.position.x.toFixed(1)} ${b.entity.position.y.toFixed(1)} ${b.entity.position.z.toFixed(1)}, цель ${best.x} ${best.y} ${best.z}; ${rows.join(' | ')}; рядом: ${ents.join(',') || 'никого'}`); }
        if (b.entity.position.distanceTo(best) > 3.5) throw e;
        try { b.pathfinder.setGoal(null); } catch {}
        this.busyLook = true;
        try {
          await b.lookAt(best.offset(0.5, 1.2, 0.5), true);
          b.setControlState('forward', true); b.setControlState('jump', true);
          await sleep(1200);
        } finally { b.clearControlStates(); this.busyLook = false; }
        const feet = b.blockAt(b.entity.position);
        if (feet && /water/.test(feet.name)) throw e;
      })
      .then(() => this.log('выбрался на берег'))
      .catch((e) => { if (isCancel(e)) return; this.badShore.push({ v: best.offset(0, -1, 0), at: Date.now() }); this.log('к этому берегу не доплыл, поищу другой'); })
      .finally(() => { if (this.mode === 'shore') { this.mode = 'idle'; try { b.pathfinder.setGoal(null); } catch {} } });
  }

}

module.exports = { Water };
