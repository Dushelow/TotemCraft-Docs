// Компаньон без нейросети (22.11, по докладу владельца о Серане из Skyrim и Элизабет из BioShock Infinite): живое
// поведение в паузах делает тело за миллисекунды, а не мозг за 10-30 с. Нейросеть остаётся для разговоров и больших дел.
//
// 1) Песочница (sandboxing Сераны): хозяин остановился на несколько секунд - бот не стоит столбом, а подходит к
//    «точке возможности» рядом с ним (костёр, верстак, книжные полки, варочная стойка, наковальня, колокол,
//    животное, житель) и занимается ею: смотрит, «работает» рукой, греется, поглядывает на хозяина. Хозяин пошёл -
//    сразу назад следом. Без хозяина и без дел (idle) - то же самое у своих мест, недалеко.
// 2) Внимание (как взгляд Элли): смотрит не по случайной точке, а на интересное - на хозяина (зрительный контакт),
//    куда смотрит хозяин (общее внимание), на звук, на того, кто заговорил, на движение рядом.
// 3) Жесты: хозяин присел два раза - присесть в ответ (приветствие игроков).
// 4) Короткие реплики по шаблонам (бантеры BG3/Fallout): стемнело, дождь, крипер, ранена, деревня. Редко: не
//    чаще раза в 4 мин и только при хозяине рядом; одна тема - не чаще раза в 20 мин.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// [что за блок, чем занята (для журнала и мозга), вес, жест рукой]
const OPP = [
  [/^(campfire|soul_campfire)$/, 'греюсь у костра', 3, false],
  [/^(enchanting_table|lectern|chiseled_bookshelf|bookshelf)$/, 'разглядываю книги', 2, false],
  [/^(brewing_stand|cauldron|water_cauldron)$/, 'смотрю на варочную стойку', 1.5, true],
  [/^(crafting_table|smithing_table|fletching_table|cartography_table|loom|stonecutter|grindstone)$/, 'вожусь у верстака', 1.4, true],
  [/^(anvil|chipped_anvil|damaged_anvil)$/, 'стучу по наковальне', 1, true],
  [/^(furnace|smoker|blast_furnace)$/, 'грею руки у печи', 1.2, false],
  [/^(bell|jukebox|note_block)$/, 'разглядываю колокол', 1, false],
  [/^(flower_pot|potted_.*|poppy|dandelion|cornflower|allium|azure_bluet|oxeye_daisy|lily_of_the_valley|.*_tulip|blue_orchid)$/, 'нюхаю цветы', 0.8, false],
];
const PETS = /^(cat|wolf|parrot|fox|rabbit|sheep|cow|pig|chicken|horse|donkey|llama|axolotl|goat|frog|bee|turtle|allay|camel|armadillo)$/;
const BARKS = {
  ночь: ['темнеет. может, к дому?', 'ночь скоро, мобы полезут', 'солнце садится'],
  дождь: ['о, дождь пошёл', 'дождь... ну отлично'],
  гроза: ['гроза! осторожнее'],
  крипер: ['крипер!', 'осторожно, крипер рядом'],
  ранена: ['ай... мне бы подлечиться', 'больно, надо поесть'],
  деревня: ['о, деревня', 'жители! можно поторговать'],
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

class Companion {
  /** Раз в секунду (slowTick): хозяин стоит - песочница; жесты; реплики; idle - свои места. */
  companionTick() {
    const b = this.bot;
    if (!b || !b.entity || this.status !== 'online') return;
    const now = Date.now();
    const C = (this.comp = this.comp || { stillSince: now, last: null, spots: [], barkAt: 0, topic: {}, crouchSeen: 0 });
    const owner = this.followName ? this.player(this.followName) : null;
    // хозяин стоит? (сдвинулся меньше чем на 1,5 бл. от места остановки)
    if (owner) {
      if (!C.stop || owner.position.distanceTo(C.stop) > 1.5) { C.stop = owner.position.clone(); C.stillSince = now; }
    } else C.stop = null;
    this.gestureTick(owner, now);
    this.barkTick(owner, now);
    if (this.presenceTick) this.presenceTick(owner, now);   // тихий шаг, личное место, помощь, комментарии (presence.js)
    // сидит рядом с хозяином (gestures.js): хозяин встал и пошёл - встать и следом
    if (this.seat) {
      const up = !owner || now - C.stillSince < 1500 || owner.position.distanceTo(b.entity.position) > 8 || this.mode !== 'follow';
      if (up || !b.vehicle) { this.standUp().then(() => { if (this.mode === 'follow' && owner) try { b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); } catch {} }).catch(() => {}); }
      return;
    }
    // хозяин стоит давно (20+ с) - иногда присесть рядом на ступеньку или подушку, как по РП
    if (owner && this.mode === 'follow' && this.sitNear && !this.sandbox && now - C.stillSince > 20000 && now - (C.sitTry || 0) > 60000 && Math.random() < 0.1) {
      C.sitTry = now; this.sitNear(owner.position).catch(() => {});
    }
    const busy = this.mode === 'task' || this.mode === 'life' || this.mode === 'hold' || this._errandBusy || this.travelling || this.eating || b.isSleeping || b.vehicle
      || (this.guard && (this.guard.fighting || this.guard.fleeing)) || (this.threat && this.threat().level !== 'спокойно') || b.entity.isInWater;
    const sb = this.sandbox;
    if (sb) {
      // конец занятия: хозяин пошёл, отошли далеко, пришло дело, время вышло
      const gone = owner && (owner.position.distanceTo(C.stop || owner.position) > 1.5 || now - C.stillSince < 1000 || owner.position.distanceTo(b.entity.position) > 14);
      if (busy || sb.token !== this.token || gone || now > sb.until || (this.mode === 'follow' && !owner)) { this.sandboxEnd(gone ? 'хозяин пошёл' : ''); return; }
      if (sb.phase === 'go' && b.entity.position.distanceTo(sb.spot) < 1.3) { sb.phase = 'at'; this.task = sb.what; this.log('сама: ' + sb.what); }
      if (sb.phase === 'go' && now - sb.at > 12000) { this.sandboxEnd('не дошла'); return; }
      if (sb.phase === 'at') {
        if (this.propOn) this.propOn(sb).catch(() => {});
        if (this.opportunityAct) this.opportunityAct(sb).catch(() => {});
        // смотреть на дело, иногда на хозяина; рукой - у верстака и наковальни
        this.lookTarget = owner && Math.random() < 0.2 ? owner.position.offset(0, 1.6, 0) : sb.look;
        if (sb.hand && Math.random() < 0.35) { try { b.swingArm('right'); } catch {} }
      }
      return;
    }
    if (busy) return;
    // начать: следом за хозяином, он стоит 6+ с - иногда (не каждый раз, чтобы было живо, а не по таймеру)
    const ownerStill = owner && this.mode === 'follow' && now - C.stillSince > 6000 && owner.position.distanceTo(b.entity.position) < 10;
    const idle = !owner && this.mode === 'idle' && now - (this.lastRunAt || 0) > 30000 && now - (C.endAt || 0) > 20000;
    if (!(ownerStill || idle) || Math.random() > (ownerStill ? 0.3 : 0.08)) return;
    const center = ownerStill ? owner.position : b.entity.position;
    const o = this.findOpportunity(center, ownerStill ? 9 : 10);
    if (o) this.sandboxStart(o, owner);
  }

  /** Точки возможностей рядом с центром: блоки-занятия и животные/жители. Взвешенный случайный выбор, без повторов. */
  findOpportunity(center, r = 9) {
    const b = this.bot, C = this.comp || { spots: [] }, out = [];
    const recent = (p) => C.spots.some((s) => s.x === p.x && s.y === p.y && s.z === p.z);
    let pts = [];
    try { pts = b.findBlocks({ point: center, matching: (bl) => OPP.some(([re]) => re.test(bl.name)), maxDistance: r, count: 30 }); } catch {}
    for (const p of pts) {
      if (Math.abs(p.y - center.y) > 4 || recent(p)) continue;
      const bl = b.blockAt(p);
      const o = bl && OPP.find(([re]) => re.test(bl.name));
      if (!o) continue;
      if (/campfire/.test(bl.name) && bl.getProperties && bl.getProperties().lit === false) continue;
      const spot = this.standNear(p);
      if (spot) out.push({ w: o[2], what: o[1], hand: o[3], look: p.offset(0.5, 0.6, 0.5), spot, key: p });
    }
    for (const e of Object.values(b.entities)) {
      if (!e.position || e === b.entity || e.position.distanceTo(center) > r) continue;
      if (PETS.test(e.name || '') || e.name === 'villager') {
        const p = e.position.floored();
        if (recent(p)) continue;
        out.push({ w: e.name === 'villager' ? 1 : 1.2, what: e.name === 'villager' ? 'разглядываю жителя' : `глажу ${e.name}`, hand: e.name !== 'villager', look: e.position.offset(0, (e.height || 1) * 0.8, 0), spot: null, ent: e, key: p });
      }
    }
    if (this.moreOpportunities) try { out.push(...this.moreOpportunities(center, r, recent, !!(this.followName && this.player(this.followName)))); } catch {}
    if (!out.length) return null;
    let t = Math.random() * out.reduce((s, o) => s + o.w, 0);
    for (const o of out) { t -= o.w; if (t <= 0) return o; }
    return out[0];
  }

  /** Свободная клетка рядом с блоком (1-2 бл.), где можно стоять. */
  standNear(p) {
    if (!this.standOk) return null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      for (const dy of [0, 1, -1]) if (this.standOk(p.x + dx, p.y + dy, p.z + dz)) return new Vec3(p.x + dx + 0.5, p.y + dy, p.z + dz + 0.5);
    }
    return null;
  }

  sandboxStart(o, owner) {
    const b = this.bot, C = this.comp;
    const spot = o.spot || (o.ent ? o.ent.position.clone() : null);
    if (!spot) return;
    C.spots.push(o.key); if (C.spots.length > 5) C.spots.shift();
    this.sandbox = { phase: 'go', spot, look: o.look, what: o.what, hand: o.hand, token: this.token, at: Date.now(), until: Date.now() + rnd(15000, 40000), ent: o.ent || null, water: o.water || null, chest: o.chest || null, lay: !!o.lay };
    try { b.pathfinder.setGoal(o.ent ? new goals.GoalFollow(o.ent, 1.5) : new goals.GoalNear(spot.x, spot.y, spot.z, 0.6), !!o.ent); } catch { this.sandbox = null; }
  }

  sandboxEnd(why) {
    const b = this.bot, sb = this.sandbox;
    this.sandbox = null;
    if (this.comp) this.comp.endAt = Date.now();
    if (!sb) return;
    if (this.propOff) this.propOff(sb).catch(() => {});
    if (sb.lay && this.pose) this.poseEnd();
    if (this.task === sb.what) this.task = '';
    if (why) this.log(`закончила: ${sb.what} (${why})`);
    if (sb.token !== this.token) return;   // пришло новое дело - его цель не трогать
    try {
      if (this.mode === 'follow' && this.followName) { const e = this.player(this.followName); if (e) b.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true); }
      else if (this.mode === 'idle') b.pathfinder.setGoal(null);
    } catch {}
  }

  /** Хозяин присел дважды за 2 с - присесть в ответ. */
  gestureTick(owner, now) {
    const C = this.comp, b = this.bot;
    if (!owner || !this.gestures) return;
    const gs = this.gestures.get(this.followName);
    if (!gs) return;
    const n = gs.crouch.filter((t) => now - t < 2500 && t > C.crouchSeen).length;
    if (n >= 2 && owner.position.distanceTo(b.entity.position) < 10) {
      C.crouchSeen = now;
      this.attend(this.followName, 3000);
      let k = 0;
      const step = () => { try { b.setControlState('sneak', k % 2 === 0); } catch {} if (++k < 4) setTimeout(step, 220); else try { b.setControlState('sneak', false); } catch {} };
      setTimeout(step, 300);
    }
  }

  /** Посмотреть на игрока (заговорил, позвал) на ms миллисекунд - раньше, чем ответит мозг. */
  attend(name, ms = 5000) {
    const e = this.player && this.player(name);
    if (!e) return;
    this.attendUntil = Date.now() + ms;
    this.attendTo = name;
    this.lookTarget = e.position.offset(0, 1.6, 0);
  }

  /**
   * Куда смотреть (раз в секунду вместо случайной точки): кто заговорил; звук; куда смотрит хозяин; движение рядом;
   * хозяин. Возвращает точку или null (оставить как есть).
   */
  gazePick() {
    const b = this.bot, now = Date.now(), me = b.entity.position;
    if (this.attendUntil > now) { const e = this.player(this.attendTo); if (e) return e.position.offset(0, 1.6, 0); }
    if (this.sandbox && this.sandbox.phase === 'at') return null;   // занята делом - смотрит на дело
    if (this.heardPrime && now - this.heardPrime.at < 2500 && this.heardPrime.pos) return this.heardPrime.pos.offset ? this.heardPrime.pos.offset(0, 1, 0) : null;
    const owner = this.followName ? this.player(this.followName) : null;
    const r = Math.random();
    if (owner && r < 0.25) {
      // общее внимание: куда смотрит хозяин (блок по лучу его взгляда до 16 бл.)
      try {
        const eye = owner.position.offset(0, 1.62, 0), yaw = owner.yaw, pitch = owner.pitch;
        const dir = new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const hit = b.world.raycast(eye, dir, 16);
        if (hit && hit.position) return hit.position.offset(0.5, 0.5, 0.5);
      } catch {}
    }
    if (r < 0.5) {
      // движение рядом: ближайшее живое, что сейчас идёт (не стоит)
      let best = null, bd = 12;
      for (const t of (this.tracks || new Map()).values()) {
        const sp = Math.hypot(t.vx || 0, t.vz || 0);
        if (sp > 0.6 && t.d < bd && t.name !== (owner && owner.username)) { bd = t.d; best = t; }
      }
      if (best) return best.pos.offset(0, 1.2, 0);
    }
    if (owner) return owner.position.offset(0, 1.6, 0);
    if (r < 0.8) return me.offset(rnd(-8, 8), rnd(0, 3), rnd(-8, 8));
    return null;
  }

  /** Короткая реплика по шаблону: редко, только при хозяине рядом. */
  barkTick(owner, now) {
    const b = this.bot, C = this.comp;
    if (!owner || owner.position.distanceTo(b.entity.position) > 16 || now - C.barkAt < 240000) return;
    const say = (topic) => {
      if (now - (C.topic[topic] || 0) < 20 * 60000) return false;
      C.topic[topic] = now; C.barkAt = now;
      try { this.say(pick(BARKS[topic]), 'local'); this.log(`сама сказала (${topic})`); } catch {}
      return true;
    };
    const t = b.time && b.time.timeOfDay, over = /overworld/.test(b.game.dimension || '');
    if (over && t !== undefined) { if (C.prevT !== undefined && C.prevT < 12300 && t >= 12300 && t < 13500 && say('ночь')) { C.prevT = t; return; } C.prevT = t; }
    if (over && b.isRaining && !C.wasRain) { C.wasRain = true; if (say(b.thunderState > 0 ? 'гроза' : 'дождь')) return; }
    if (!b.isRaining) C.wasRain = false;
    if (b.health <= 8 && (C.prevHp || 20) > 8 && say('ранена')) { C.prevHp = b.health; return; }
    C.prevHp = b.health;
    const cr = Object.values(b.entities).find((e) => e.name === 'creeper' && e.position.distanceTo(b.entity.position) < 10 && (!this.seesEntity || this.seesEntity(e)));
    if (cr && say('крипер')) return;
    try {
      const v = this.worldMap && this.worldMap.settlements ? this.worldMap.settlements(this, 64).find((s) => s.inside) : null;
      if (v && /деревн/.test(v.kind || v.name || '') && say('деревня')) return;
    } catch {}
  }
}

module.exports = { Companion, OPP, BARKS };
