// Защита бота и хозяина от мобов. Идеи взяты из модулей Meteor (KillAura, AutoArmor, AutoTotem, AutoEat),
// код свой: удар только при полном откате оружия, только враждебные мобы, нейтральных, именованных и игроков не трогаем,
// от крипера отходим, при малом здоровье уходим к хозяину. Блоки не ломаем.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// Нейтральные: бьём, только если сами напали на бота (злые пиглины и т.п. сюда попадают через hurtBy)
const NEUTRAL = new Set(['zombified_piglin', 'piglin', 'enderman', 'wolf', 'iron_golem', 'snow_golem', 'llama', 'trader_llama',
  'polar_bear', 'bee', 'panda', 'dolphin', 'goat', 'spider', 'cave_spider']);
const FLEE = new Set(['creeper', 'warden']);
// откат удара в тиках (20 тиков = 1 с) по типу оружия
const COOLDOWN = { sword: 13, axe: 20, trident: 19, mace: 34, spear: 20, hand: 5 };
const WEAPON_SCORE = { netherite_sword: 8, diamond_sword: 7, netherite_axe: 7.5, diamond_axe: 7, iron_sword: 6, iron_axe: 6.5,
  stone_sword: 5, stone_axe: 6, golden_sword: 4, wooden_sword: 4, copper_sword: 5.5, copper_axe: 6.2, trident: 6, mace: 5 };
const RANGED = /^(skeleton|stray|bogged|pillager|witch|blaze)$/;
// опасность врага (примерно: урон и живучесть) - для оценки «по силам ли бой»
const DANGER = { creeper: 4, skeleton: 3, stray: 3, bogged: 3, pillager: 3, witch: 4, blaze: 4, vindicator: 5, evoker: 6, ravager: 8, zombie: 2, husk: 2, drowned: 2.5, spider: 2, cave_spider: 2.5, enderman: 4, piglin_brute: 6, wither_skeleton: 5, hoglin: 4, zoglin: 4, slime: 1.5, magma_cube: 2, phantom: 2.5, vex: 3, silverfish: 1, endermite: 1, guardian: 3, elder_guardian: 6, breeze: 4, warden: 99 };
const ARMOR_PTS = { leather: [1, 3, 2, 1], golden: [2, 5, 3, 1], chainmail: [2, 5, 4, 1], copper: [2, 4, 3, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3], netherite: [3, 8, 6, 3] };
const ARMOR_TIER = ['leather', 'golden', 'chainmail', 'copper', 'iron', 'diamond', 'netherite'];
const SLOTS = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };

class Guard {
  constructor(tb) {
    this.tb = tb;            // TotemBot
    this.mode = 'defend';    // defend | flee | off
    this.target = null;
    this.lastHit = 0;
    this.tick = 0;
    this.hurtBy = new Map(); // id моба -> время, когда он ударил бота
    this.fighting = false;
  }

  get bot() { return this.tb.bot; }

  attach() {
    const b = this.bot;
    b.on('physicsTick', () => { this.tick++; if (this.tick % 2 === 0) this.step().catch(() => {}); });
    b.on('entityHurt', (e) => { if (e === b.entity) this.onHurt(); });
    this.gearTimer = setInterval(() => this.gear().catch(() => {}), 3000);
    b.once('end', () => clearInterval(this.gearTimer));
  }

  name(e) { return e && (e.name || '').replace(/^minecraft:/, ''); }

  isHostile(e) {
    if (!e || e === this.bot.entity || e.type === 'player') return false;
    const n = this.name(e);
    const info = this.bot.registry.entitiesByName[n];
    return !!info && /hostile/i.test(info.category || '') ;
  }

  onHurt() {
    // кто рядом и враждебен или нейтрален - считаем обидчиком
    const b = this.bot;
    // обидчик - ближайший моб (раньше - все в 6 блоках: доставалось и мирным, бот бил их, а не шёл за хозяином, 16.11)
    const me = b.entity.position, now = Date.now();
    // ударил игрок (рядом махнул рукой только что) - мобы ни при чём (22.11: хозяин ткнул бота, а бот избил жителя)
    const G = this.tb.gx;
    if (G) for (const pl of Object.values(b.players)) {
      const p = pl.entity, g = G.get(pl.username);
      if (p && p !== b.entity && g && p.position.distanceTo(me) < 4.8 && g.swing.some((t) => now - t < 700)) return;
    }
    // обидчиком может быть только тот, кто вообще нападает: враждебные и нейтральные, но не жители, животные, големы-друзья
    const PEACE = /^(villager|wandering_trader|cow|sheep|pig|chicken|horse|donkey|mule|llama|trader_llama|cat|parrot|rabbit|fox|turtle|axolotl|frog|camel|sniffer|armadillo|allay|strider|squid|glow_squid|cod|salmon|tropical_fish|bat|mooshroom|ocelot|snow_golem|item_frame|glow_item_frame|armor_stand|painting|.*boat|.*minecart|experience_orb|arrow|item)$/;
    const near = Object.values(b.entities).filter((e) => e !== b.entity && e.type !== 'player' && e.position && !PEACE.test(this.name(e)) && e.position.distanceTo(me) < 5)
      .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
    if (near) this.hurtBy.set(near.id, now);
  }

  /** Враг стоит на пути (впереди по ходу, ближе 3 бл., не крипер): в дороге его выгоднее ударить, чем стоять. */
  blocking(e, d) {
    if (d > 3 || FLEE.has(this.name(e))) return false;
    const path = this.bot._navPath, me = this.bot.entity.position, next = path && path.find((p) => Math.hypot(p.x - me.x, p.z - me.z) > 1.5);
    if (!next) return false;
    const ax = next.x - me.x, az = next.z - me.z, bx = e.position.x - me.x, bz = e.position.z - me.z;
    const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
    return cos > 0.5;   // в пределах ~60° от направления пути
  }

  owner() { return this.tb.followName ? this.tb.player(this.tb.followName) : null; }

  pick() {
    const b = this.bot, me = b.entity.position, own = this.owner();
    let best = null, bestD = Infinity;
    for (const e of Object.values(b.entities)) {
      if (!e.isValid || e === b.entity || (e.type === 'player' && this.prey !== e.id)) continue;   // игрок - только соперник в дуэли по приказу хозяина
      const n = this.name(e);
      const d = e.position.distanceTo(me);
      if (d > 16) continue;
      const angry = (this.hurtBy.get(e.id) || 0) > Date.now() - 15000 || this.prey === e.id;   // prey - добыча на охоте
      const hostile = this.isHostile(e) && !NEUTRAL.has(n);
      if (!hostile && !angry) continue;
      // летающих стрелков (гаст, фантом высоко) мечом не догнать: за ними не бегать, идти дальше своей дорогой
      if (/^(ghast|phantom)$/.test(n) && (e.position.y - me.y > 2.5 || n === 'ghast')) continue;
      // в дороге (поручение, дальний путь) не отвлекаться: драться только с тем, кто бьёт сейчас и стоит вплотную;
      // остальные - идти дальше (22.11: вместо путешествия стояла и дралась с мобами рядом)
      if (this.tb.travelling && this.mode !== 'off' && !(((this.hurtBy.get(e.id) || 0) > Date.now() - 5000 && d < 4) || this.prey === e.id || this.blocking(e, d) || (own && e.position.distanceTo(own.position) < 5 && d < 10))) continue;   // враг у хозяина - бить и в дороге (23.11: магма-куб рядом с хозяином, бот пробежал мимо)
      if (e.customName && !angry) continue;
      // защищаем: себя (до 8 блоков) и хозяина (моб в 6 блоках от него)
      const nearOwner = own && e.position.distanceTo(own.position) < 6;
      // не видно (за стеной, под землёй) и не бьёт, не у хозяина - не гнаться: человек бы о нём не знал, а путь к нему - копать
      if (!angry && !nearOwner && d > 3 && this.tb.seesEntity && !this.tb.seesEntity(e)) continue;
      if (d > 8 && !nearOwner) continue;
      // идём за хозяином и он отошёл - драться только с тем, кто бьёт сейчас (5 с) или рядом с хозяином
      if (this.tb.mode === 'follow' && own && own.position.distanceTo(me) > 6 && !nearOwner && !((this.hurtBy.get(e.id) || 0) > Date.now() - 5000) && this.prey !== e.id) continue;
      const score = d - (angry ? 4 : 0) - (nearOwner ? 2 : 0);
      if (score < bestD) { best = e; bestD = score; }
    }
    return best;
  }

  /** Очки брони сейчас (0-20). */
  armorPts() {
    const b = this.bot; let a = 0;
    [5, 6, 7, 8].forEach((sl, i) => { const it = b.inventory.slots[sl]; if (it) { const t = it.name.split('_')[0]; if (ARMOR_PTS[t]) a += ARMOR_PTS[t][i]; } });
    return a;
  }
  has(re) { return this.bot.inventory.items().find((i) => re.test(i.name)) || null; }
  /** Сила бота против врагов рядом: больше 1 - бой по силам. Как прикидывает игрок: оружие, броня, здоровье, щит, лук, еда. */
  odds(foes) {
    const b = this.bot;
    const w = b.inventory.items().reduce((m, i) => Math.max(m, WEAPON_SCORE[i.name] || 0), 1);
    const shield = (b.inventory.slots[45] && b.inventory.slots[45].name === 'shield') || !!this.has(/^shield$/);
    const bow = !!this.has(/^(bow|crossbow)$/) && !!this.has(/arrow$/);
    const me = (w / 4) * (1 + this.armorPts() / 10) * (b.health / 20) * (shield ? 1.4 : 1) * (bow ? 1.2 : 1) * (b.food > 6 ? 1 : 0.7);
    let them = 0;
    for (const e of foes) { const n = this.name(e); them += (DANGER[n] || 2) / 3 * (RANGED.test(n) && !shield && !bow ? 1.5 : 1); }
    return them ? me / them : 9;
  }

  weaponKind(item) {
    if (!item) return 'hand';
    const n = item.name;
    if (n.endsWith('_sword')) return 'sword';
    if (n.endsWith('_axe')) return 'axe';
    if (n.endsWith('_spear')) return 'spear';
    return COOLDOWN[n] ? n : 'hand';
  }

  async equipWeapon() {
    const b = this.bot;
    const best = b.inventory.items().filter((i) => WEAPON_SCORE[i.name]).sort((x, y) => WEAPON_SCORE[y.name] - WEAPON_SCORE[x.name])[0];
    if (best && (!b.heldItem || b.heldItem.name !== best.name)) await b.equip(best, 'hand');
  }

  async step() {
    const b = this.bot, tb = this.tb;
    if (!b || !b.entity || this.mode === 'off' || tb.eating || tb.busyLook) return;
    const me = b.entity.position;
    // огненный шар гаста летит рядом - отбить ударом (как игроки), иначе взорвёт мост под ногами
    const fb = Object.values(b.entities).find((e) => /^(fireball)$/.test(this.name(e)) && e.position.distanceTo(me) < 4.5);
    if (fb && Date.now() - (this.fbAt || 0) > 400) { this.fbAt = Date.now(); try { await b.lookAt(fb.position, true); b.attack(fb); tb.log('отбит удар: огненный шар'); } catch {} }

    // крипер: пока не шипит - бьём и отскакиваем (как игроки), зашипел или варден - отбегаем
    const swelling = (e) => this.name(e) === 'creeper' && (e.metadata[16] === 1 || e.metadata[18] === true);
    const heard = tb.heardPrime && Date.now() - tb.heardPrime.at < 1500 ? tb.heardPrime.pos : null;   // шипение слышно (hearing.js)
    const scary = Object.values(b.entities).find((e) => FLEE.has(this.name(e)) && e.position.distanceTo(me) < 6
      && (this.name(e) === 'warden' || swelling(e) || b.health <= 6 || (heard && this.name(e) === 'creeper' && e.position.distanceTo(heard) < 2)))
      || (heard ? { position: heard, name: 'creeper' } : null);
    if (scary) {
      // куда: веер лучей по земле прочь от всех врагов рядом, мимо стен, обрывов и лавы (steer.js); раз в секунду,
      // а не каждый тик. Уйти некуда - по-старому, прочь по прямой.
      if (!this.fleeing || Date.now() - (this.fleeAt || 0) > 1000) {
        this.fleeAt = Date.now();
        const foes = Object.values(b.entities).filter((e) => e !== b.entity && e.position && e.position.distanceTo(me) < 10 && (FLEE.has(this.name(e)) || this.isHostile(e)));
        const s = tb.steerAway ? tb.steerAway(foes.length ? foes : [scary], 10) : null;
        const away = s ? new Vec3(s.x + 0.5, s.y, s.z + 0.5) : me.minus(scary.position).normalize().scaled(10).plus(me);
        if (!this.fleeing) { this.fleeing = true; tb.log('отбегаю от ' + this.name(scary) + (s ? ` к ${s.x} ${s.z}` : '')); }
        b.setControlState('sprint', true);
        b.pathfinder.setGoal(new goals.GoalNear(away.x, away.y, away.z, s ? 1 : 2), false);
      }
      return;
    }
    if (this.fleeing) { this.fleeing = false; b.setControlState('sprint', false); this.resume(); }

    const t = this.pick();
    // Бой по силам? (23.11: зашёл на сервер без брони, полез на скелета с мечом и за 10 с умер от стрел.) Враги в 16 бл.;
    // не тянем - уйти из-под обстрела за укрытие или к хозяину, а не стоять под стрелами до 6 здоровья
    let outmatched = false;
    if (t) {
      // фантомы в небе - не повод бросать дело (23.11: шла спать, а от каждого налёта фантома «ухожу из-под удара» и не дошла;
      // от фантомов спасает как раз сон)
      const foes = Object.values(b.entities).filter((e) => e !== b.entity && e.position && e.position.distanceTo(me) < 16 && this.isHostile(e) && !NEUTRAL.has(this.name(e)) && !(this.name(e) === 'phantom' && e.position.y - me.y > 2));
      const o = this.odds(foes.length ? foes : [t]);
      const ranged = foes.some((e) => RANGED.test(this.name(e)));
      const shieldOn = b.inventory.slots[45] && b.inventory.slots[45].name === 'shield';
      outmatched = o < 0.8 || b.health <= (ranged && !shieldOn ? 10 : 6);
      if (outmatched && !this.retreatSaid) { this.retreatSaid = Date.now(); tb.log(`бой не по силам (${o.toFixed(2)}: здоровье ${Math.round(b.health)}, броня ${this.armorPts()}, врагов ${foes.length}${ranged ? ', стрелки' : ''}) - ухожу из-под удара`); }
      if (!outmatched) this.retreatSaid = 0;
      // мало здоровья - зелье лечения, если есть
      if (b.health <= 8 && Date.now() - (this.potAt || 0) > 4000) this.drinkHeal().catch(() => {});
    }
    // бой не по силам или режим «убегать»: к хозяину или за укрытие
    if (t && (this.mode === 'flee' || outmatched)) {
      this.cover(t);
      if (!this.fighting) { this.fighting = true; tb.log(b.health <= 6 ? 'мало здоровья, отступаю' : 'убегаю от ' + this.name(t)); }
      return;
    }
    if (!t) {
      if (this.fighting) { this.fighting = false; this.target = null; tb.log('бой окончен'); this.resume(); }
      return;
    }
    if (!this.fighting) { this.fighting = true; tb.log('защищаюсь: ' + this.name(t)); await this.equipWeapon().catch(() => {}); }
    this.target = t;
    const d = t.position.distanceTo(me);
    const tn = this.name(t);
    // далеко, есть лук и стрелы - стрелять (как игроки: лук против стрелков и между ударами)
    if (d > 7 && d < 28 && !this.shooting && this.has(/^(bow|crossbow)$/) && this.has(/arrow$/) && (!tb.seesEntity || tb.seesEntity(t)) && (RANGED.test(tn) || d > 10)) { this.shoot(t).catch(() => {}); return; }
    if (this.shooting) return;
    if (d > 2.8) {
      if (tb.mode !== 'task') b.pathfinder.setGoal(new goals.GoalFollow(t, 1.5), true);   // в задании путь не перехватываем
      // к стрелку - зигзагом (стрейф влево-вправо: труднее попасть) и со щитом, если он во второй руке
      if (RANGED.test(tn)) {
        const side = Math.floor(Date.now() / 600) % 2 ? 'left' : 'right';
        b.setControlState('left', side === 'left'); b.setControlState('right', side === 'right'); this.strafing = true;
        const off = b.inventory.slots[45];
        if (off && off.name === 'shield' && !this.blockingNow && d > 4) { try { b.activateItem(true); this.blockingNow = true; } catch {} }
      }
      return;
    }
    if (this.strafing) { this.strafing = false; b.setControlState('left', false); b.setControlState('right', false); }
    if (this.blockingNow) { try { b.deactivateItem(); } catch {} this.blockingNow = false; }   // щит опустить перед ударом
    // вплотную - путь не нужен: он поворачивает голову по ходу шага и мешает прицелу
    if (tb.mode !== 'task' && b.pathfinder.goal && b.pathfinder.goal.entity === t) b.pathfinder.setGoal(null);
    // поворот и удар - в combatTick, синхронно с тиками клиента
  }

  /**
   * Каждый тик, до отправки движения: плавный поворот к цели (не больше ~35° за тик, как рука человека) и удар,
   * только когда прицел уже был на цели в прошлом тике (сервер видит поворот раньше удара) и оружие готово.
   */
  combatTick() {
    const b = this.bot, t = this.target;
    if (!b || !b.entity || !this.fighting || !t || !t.isValid || this.tb.eating) { this.aimed = false; return; }
    const eye = b.entity.position.offset(0, b.entity.height * 0.9, 0);
    const aim = t.position.offset(0, t.height * 0.6, 0);
    const d = aim.minus(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z));
    let dy = yaw - b.entity.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const dp = pitch - b.entity.pitch;
    const maxYaw = 0.45 + Math.random() * 0.2, maxPitch = 0.3;
    const sy = Math.max(-maxYaw, Math.min(maxYaw, dy)), sp = Math.max(-maxPitch, Math.min(maxPitch, dp));
    // лёгкое дрожание прицела, как у руки
    b.look(b.entity.yaw + sy + (Math.random() - 0.5) * 0.02, b.entity.pitch + sp + (Math.random() - 0.5) * 0.015, true);
    const wasAimed = this.aimed;
    this.aimed = Math.abs(dy - sy) < 0.15 && Math.abs(dp - sp) < 0.15;
    const dist = t.position.distanceTo(b.entity.position);
    const kind = this.weaponKind(b.heldItem);
    if (!wasAimed || dist > 3.0 || this.tick - this.lastHit < COOLDOWN[kind] + Math.floor(Math.random() * 3)) return;
    b.attack(t);   // use_entity, затем взмах (порядок 1.9+ по признаку версии в mineflayer)
    this.lastHit = this.tick;
    // после удара шаг назад: моб чаще промахивается (так дерутся игроки)
    b.setControlState('back', true);
    setTimeout(() => { try { b.setControlState('back', false); } catch {} }, this.name(t) === 'creeper' ? 450 : 250);
  }

  /** Уйти из-под удара: к хозяину, иначе за укрытие - место прочь от врагов, куда их взгляд упирается в блок. */
  cover(t) {
    const b = this.bot, tb = this.tb;
    if (this.strafing) { this.strafing = false; b.setControlState('left', false); b.setControlState('right', false); }
    if (this.blockingNow) { try { b.deactivateItem(); } catch {} this.blockingNow = false; }
    if (Date.now() - (this.fleeAt || 0) < 1000) return;
    this.fleeAt = Date.now();
    const own = this.owner();
    if (own && own.position.distanceTo(b.entity.position) < 40) { b.pathfinder.setGoal(new goals.GoalFollow(own, 1), true); return; }
    const me = b.entity.position, foes = Object.values(b.entities).filter((e) => e !== b.entity && e.position && e.position.distanceTo(me) < 16 && this.isHostile(e));
    let best = null, bs = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI, r = 6 + (i % 3) * 3, x = Math.floor(me.x + Math.cos(a) * r), z = Math.floor(me.z + Math.sin(a) * r);
      let y = null;
      for (let yy = Math.floor(me.y) + 2; yy >= Math.floor(me.y) - 3; yy--) {
        const f = b.blockAt(new Vec3(x, yy - 1, z)), c = b.blockAt(new Vec3(x, yy, z)), h = b.blockAt(new Vec3(x, yy + 1, z));
        if (f && c && h && f.boundingBox === 'block' && c.boundingBox === 'empty' && h.boundingBox === 'empty' && !/lava|water|fire/.test(c.name + f.name)) { y = yy; break; }
      }
      if (y === null) continue;
      const spot = new Vec3(x + 0.5, y + 1.5, z + 0.5);
      let sc = Math.min(20, ...foes.map((e) => e.position.distanceTo(spot)));
      for (const e of foes) { try { const eye = e.position.offset(0, (e.height || 1.8) * 0.85, 0), dir = spot.minus(eye), L = dir.norm(); if (b.world.raycast(eye, dir.scaled(1 / L), L)) sc += 8; } catch {} }
      if (sc > bs) { bs = sc; best = new Vec3(x + 0.5, y, z + 0.5); }
    }
    if (best) b.pathfinder.setGoal(new goals.GoalNear(best.x, best.y, best.z, 1), false);
    else if (tb.steerAway) { const s2 = tb.steerAway(foes.length ? foes : [t], 12); if (s2) b.pathfinder.setGoal(new goals.GoalNear(s2.x + 0.5, s2.y, s2.z + 0.5, 1), false); }
  }

  /** Выстрел из лука: натянуть ~1 с, целиться с упреждением (движение цели, падение стрелы). */
  async shoot(t) {
    const b = this.bot;
    const bow = this.has(/^(bow|crossbow)$/); if (!bow) return;
    this.shooting = true;
    try {
      if (!b.heldItem || b.heldItem.name !== bow.name) await b.equip(bow, 'hand');
      b.pathfinder.setGoal(null);
      b.activateItem();
      for (let i = 0; i < 20 && t.isValid; i++) {
        const d = t.position.distanceTo(b.entity.position), tt = d / 3, drop = 0.025 * tt * tt;
        await b.lookAt(t.position.offset((t.velocity ? t.velocity.x * tt : 0), (t.height || 1.8) * 0.6 + drop, (t.velocity ? t.velocity.z * tt : 0)), true);
        await new Promise((r) => setTimeout(r, 55));
      }
      b.deactivateItem();
      this.tb.log('выстрел из лука в ' + this.name(t));
    } catch {} finally { this.shooting = false; await this.equipWeapon().catch(() => {}); }
  }

  /** Зелье лечения (питьё или взрывное под ноги) или регенерации, если есть. */
  async drinkHeal() {
    const b = this.bot;
    const it = b.inventory.items().find((i) => /potion/.test(i.name) && /healing|regeneration|heal/.test(JSON.stringify(i.components || i.nbt || '')));
    if (!it) return;
    this.potAt = Date.now();
    this.tb.eating = true;
    try {
      await b.equip(it, 'hand');
      if (/splash|lingering/.test(it.name)) { await b.look(b.entity.yaw, -Math.PI / 2, true); b.activateItem(); }
      else { b.activateItem(); await new Promise((r) => setTimeout(r, 1700)); b.deactivateItem(); }
      this.tb.log('зелье: ' + it.name);
    } catch {} finally { this.tb.eating = false; await this.equipWeapon().catch(() => {}); }
  }

  // после боя вернуться к тому, что делали: идти за хозяином
  resume() {
    const b0 = this.bot;
    if (this.strafing) { this.strafing = false; try { b0.setControlState('left', false); b0.setControlState('right', false); } catch {} }
    if (this.blockingNow) { try { b0.deactivateItem(); } catch {} this.blockingNow = false; }
    const tb = this.tb, b = this.bot;
    if (tb.mode === 'follow') {
      const own = this.owner();
      if (own) b.pathfinder.setGoal(new goals.GoalFollow(own, 2.8), true);
    } else if (tb.mode === 'idle') {
      b.pathfinder.setGoal(null);
    }
  }

  // броня и тотем, как AutoArmor/AutoTotem
  async gear() {
    const b = this.bot;
    if (!b || !b.entity || this.fighting) return;
    for (const [part, dest] of Object.entries(SLOTS)) {
      const slot = b.getEquipmentDestSlot(dest);
      const cur = b.inventory.slots[slot];
      const rank = (i) => (i ? ARMOR_TIER.indexOf(i.name.split('_')[0]) : -1);
      const best = b.inventory.items().filter((i) => i.name.endsWith('_' + part) && ARMOR_TIER.includes(i.name.split('_')[0]))
        .sort((x, y) => rank(y) - rank(x))[0];
      if (best && rank(best) > rank(cur)) { await b.equip(best, dest); this.tb.log('надел ' + best.name); }
    }
    const off = b.inventory.slots[45];
    const totem = b.inventory.items().find((i) => i.name === 'totem_of_undying');
    if (totem && (!off || off.name !== 'totem_of_undying')) { await b.equip(totem, 'off-hand'); this.tb.log('тотем во второй руке'); }
    else if (!totem && (!off || off.name !== 'shield')) { const sh = b.inventory.items().find((i) => i.name === 'shield'); if (sh) { await b.equip(sh, 'off-hand'); this.tb.log('щит во второй руке'); } }
  }
}

module.exports = { Guard };
