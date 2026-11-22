// Ближнее чутьё тела (идеи из игр и роботов, 22.11, по докладу владельца; всё на точных блоках мира, без нейросети):
// 1) Контекстное руление (как жуки в Deep Rock Galactic): куда отбежать - не «прочь по прямой» (там могла быть
//    стена, обрыв или лава), а веер из 16 лучей по земле: каждый луч - насколько далеко можно уйти безопасно,
//    сколько там лавы рядом, ближе или дальше от всех врагов. Выбирается лучший конец, путь к нему строит навигация.
// 2) Линия взгляда (как лучи у NPC в стелс-играх): видит ли бот моба или он за стеной. Мобов за стеной тело не
//    гоняет (не роет к пещерному зомби под землёй) и учитывает слабее - как человек, который их не видит.
// 3) Равновесие (как Unitree после толчка): ударили и отбросило - физика игры заранее считает, куда упадёт тело.
//    Если туда лава, обрыв или пустота - в воздухе тянуть обратно (в Minecraft в полёте можно чуть рулить).
const { Vec3 } = require('vec3');

const BAD_UNDER = /lava|magma_block|fire|campfire|cactus|sweet_berry|powder_snow|pointed_dripstone|wither_rose/;
const BAD_AT = /lava|fire|sweet_berry|powder_snow|cobweb|wither_rose|cactus/;
const SEE_THROUGH = /glass|pane|leaves|fence|iron_bars|chain|ladder|vine|scaffolding|door|trapdoor|slab|stairs|wall|torch|sign|banner|carpet|rail|button|lever|pressure_plate|flower|grass|fern|sapling|kelp|seagrass|cobweb|ice$/;

class Steer {
  /** Можно ли стоять ногами в клетке (x, y, z): ноги и голова свободны и не опасны, под ногами твёрдое и не жжёт. */
  standOk(x, y, z) {
    const b = this.bot, at = (dy) => b.blockAt(new Vec3(x, y + dy, z));
    const u = at(-1), f = at(0), h = at(1);
    if (!u || !f || !h) return false;
    if (u.boundingBox !== 'block' || BAD_UNDER.test(u.name)) return false;
    return f.boundingBox === 'empty' && h.boundingBox === 'empty' && !BAD_AT.test(f.name) && !BAD_AT.test(h.name);
  }

  /** Высота ног в соседней клетке при шаге с высоты y: та же, на блок выше (если над головой свободно) или до 3 ниже. */
  stepY(x, y, z, fromX, fromZ) {
    if (this.standOk(x, y, z)) return y;
    const b = this.bot;
    const over = b.blockAt(new Vec3(fromX, y + 2, fromZ));
    if (this.standOk(x, y + 1, z) && over && over.boundingBox === 'empty') return y + 1;
    for (let d = 1; d <= 3; d++) {
      const k = b.blockAt(new Vec3(x, y - d + 1, z));
      if (!k || k.boundingBox !== 'empty' || BAD_AT.test(k.name)) return null;
      if (this.standOk(x, y - d, z)) return y - d;
    }
    return null;
  }

  /**
   * Куда отбежать от угроз (точки или сущности с position): 16 лучей по земле до reach блоков.
   * Возвращает { x, y, z, len, score, dir } - конец лучшего луча, или null, если уйти некуда.
   */
  steerAway(threats, reach = 10) {
    const b = this.bot;
    if (!b || !b.entity) return null;
    const me = b.entity.position, fx = Math.floor(me.x), fz = Math.floor(me.z), fy = Math.floor(me.y + 1e-3);
    const pts = threats.map((t) => (t.position || t)).filter(Boolean);
    if (!pts.length) return null;
    // желание: прочь от всех, ближние весят больше
    let px = 0, pz = 0;
    for (const t of pts) { const dx = me.x - t.x, dz = me.z - t.z, d2 = Math.max(0.5, dx * dx + dz * dz); px += dx / d2; pz += dz / d2; }
    const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let cx = fx, cz = fz, cy = fy, len = 0, lava = 0, end = null;
      for (let k = 1; k <= reach; k++) {
        const nx = Math.floor(me.x + dx * k), nz = Math.floor(me.z + dz * k);
        if (nx === cx && nz === cz) continue;
        // по диагонали - через боковую клетку (иначе луч «проходит» сквозь угол стены)
        if (nx !== cx && nz !== cz && this.stepY(nx, cy, cz, cx, cz) === null && this.stepY(cx, cy, nz, cx, cz) === null) break;
        const ny = this.stepY(nx, cy, nz, cx, cz);
        if (ny === null) break;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const ay of [-1, 0]) { const q = b.blockAt(new Vec3(nx + ax, ny + ay, nz + az)); if (q && q.name === 'lava') lava++; }
        cx = nx; cz = nz; cy = ny; len = k; end = { x: nx, y: ny, z: nz };
      }
      if (!end || len < 2) continue;
      // опасность в конце: насколько близко к каждому врагу (ближе 6 бл. - плохо)
      let near = 0;
      for (const t of pts) { const d = Math.hypot(end.x + 0.5 - t.x, end.z + 0.5 - t.z); if (d < 6) near += (6 - d) / 6; }
      const want = dx * px + dz * pz;
      const score = want * 2 + (len / reach) * 1.5 - Math.min(2, lava * 0.25) - near * 1.5 - Math.max(0, fy - end.y) * 0.2;
      if (!best || score > best.score) best = { ...end, len, score: Math.round(score * 100) / 100, dir: i };
    }
    return best;
  }

  /** Видит ли бот сущность (луч из глаз до головы или ног не упирается в непрозрачный блок). Кэш на 0,5 с. */
  seesEntity(e) {
    const b = this.bot;
    if (!b || !b.entity || !e || !e.position) return false;
    this.losCache = this.losCache || new Map();
    const c = this.losCache.get(e.id), now = Date.now();
    if (c && now - c.at < 500) return c.v;
    const eye = b.entity.position.offset(0, 1.62, 0), h = e.height || 1.8;
    let v = false;
    for (const to of [e.position.offset(0, h * 0.85, 0), e.position.offset(0, Math.min(0.3, h / 2), 0)]) {
      const d = to.minus(eye), len = d.norm();
      if (len > 40) { v = true; break; }   // так далеко лучи не считаем: видно, если есть в мире
      const st = d.scaled(1 / Math.max(1, Math.ceil(len / 0.3)));
      const n = Math.ceil(len / 0.3);
      let clear = true, p = eye.clone(), last = '';
      for (let i = 1; i < n; i++) {
        p = p.plus(st);
        const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
        if (k === last) continue; last = k;
        const bl = b.blockAt(p);
        if (bl && bl.boundingBox === 'block' && !SEE_THROUGH.test(bl.name)) { clear = false; break; }
      }
      if (clear) { v = true; break; }
    }
    this.losCache.set(e.id, { at: now, v });
    if (this.losCache.size > 300) this.losCache.clear();
    return v;
  }

  /**
   * Куда упадёт тело с текущей скоростью (физика игры) при управлении ctl с поворотом yaw: { danger, land }.
   * danger: 0 - безопасно, больше - хуже (лава, высота падения, пустота).
   */
  fallSim(ctl, yaw, ticks = 30) {
    const b = this.bot;
    try {
      const { Physics, PlayerState } = require('prismarine-physics');
      const world = { getBlock: (p) => b.blockAt(new Vec3(p.x, p.y, p.z), false) };
      this.balancePhys = this.balancePhys || Physics(b.registry, world);
      const s = b.entity;
      const e = { position: s.position.clone(), velocity: s.velocity.clone(), onGround: false, isInWater: !!s.isInWater, isInLava: !!s.isInLava, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw, pitch: 0, effects: {}, attributes: {} };
      const fake = { entity: e, version: b.version, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, game: {}, inventory: { slots: [] }, registry: b.registry };
      const y0 = s.position.y, minY = (b.game && b.game.minY !== undefined ? b.game.minY : -64);
      let danger = 0, top = y0;
      for (let t = 0; t < ticks; t++) {
        const st = new PlayerState(fake, { forward: !!ctl.forward, back: false, left: false, right: false, jump: false, sprint: !!ctl.sprint, sneak: false });
        this.balancePhys.simulatePlayer(st, world); st.apply(fake);
        top = Math.max(top, e.position.y);
        const at = b.blockAt(e.position.floored());
        if (at && /lava|fire/.test(at.name)) return { danger: 10, land: e.position, t };
        if (e.position.y < minY + 2) return { danger: 20, land: e.position, t };
        if (t > 1 && e.onGround) {
          const u = b.blockAt(e.position.offset(0, -0.5, 0).floored());
          if (u && BAD_UNDER.test(u.name)) danger = 8;
          danger += Math.max(0, top - e.position.y - 3);   // урон от падения
          return { danger, land: e.position, t };
        }
      }
      return { danger: Math.max(0, top - e.position.y - 3) + 2, land: e.position, t: ticks };   // всё ещё летит
    } catch { return { danger: 0, land: null, t: 0 }; }
  }

  /** План при толчке: null - и так безопасно; иначе { yaw, ticks } - тянуть против скорости. */
  balancePlan() {
    const e = this.bot.entity, v = e.velocity;
    const hv = Math.hypot(v.x, v.z);
    if (hv < 0.12) return null;
    const none = this.fallSim({}, e.yaw);
    if (none.danger <= 0) return null;
    const yaw = Math.atan2(v.x, v.z);   // лицом против полёта: «вперёд» = назад, к месту удара
    const back = this.fallSim({ forward: true, sprint: true }, yaw);
    if (back.danger >= none.danger) return null;
    return { yaw, ticks: Math.max(4, Math.min(20, back.t || 10)), none: none.danger, back: back.danger };
  }

  /** Подключить равновесие (из bot.js при входе): после своего толчка тело в полёте тянет прочь от опасности. */
  balanceAttach(bot) {
    let kicked = false, hold = null;
    bot._client.on('entity_velocity', (p) => {
      if (bot.entity && p.entityId === bot.entity.id && p.velocity && Math.abs(p.velocity.x) < 20 && Math.hypot(p.velocity.x, p.velocity.z) > 0.12) kicked = true;
    });
    const run = () => {
      if (!bot.entity) return;
      if (kicked) {
        kicked = false;
        if (!bot.entity.isInWater && !bot.entity.elytraFlying && !bot.vehicle) {
          const plan = this.balancePlan();
          if (plan) {
            hold = { n: plan.ticks, n0: plan.ticks, yaw: plan.yaw };
            this.log && this.log(`толкнули к опасности - удерживаюсь (без поправки ${plan.none}, с поправкой ${plan.back})`);
          }
        }
      }
      if (!hold) return;
      if (hold.n-- <= 0 || (bot.entity.onGround && hold.n < hold.n0 - 2)) {
        hold = null; bot.setControlState('forward', false); bot.setControlState('sprint', false); return;
      }
      bot.entity.yaw = hold.yaw;   // поворот тела сразу (пакет взгляда уйдёт со следующим шагом)
      bot.setControlState('forward', true); bot.setControlState('sprint', true);
    };
    const safe = this.fault ? () => { try { run(); } catch (e) { this.fault('равновесие', e); } } : run;
    bot.on('physicsTick', safe);
  }
}

module.exports = { Steer, SEE_THROUGH };
