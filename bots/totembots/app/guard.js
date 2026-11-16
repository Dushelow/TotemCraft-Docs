// Защита бота и хозяина от мобов. Идеи взяты из модулей Meteor (KillAura, AutoArmor, AutoTotem, AutoEat),
// код свой: удар только при полном откате оружия, только враждебные мобы, нейтральных, именованных и игроков не трогаем,
// от крипера отходим, при малом здоровье уходим к хозяину. Блоки не ломаем.
const { goals } = require('mineflayer-pathfinder');

// Нейтральные: бьём, только если сами напали на бота (злые пиглины и т.п. сюда попадают через hurtBy)
const NEUTRAL = new Set(['zombified_piglin', 'piglin', 'enderman', 'wolf', 'iron_golem', 'snow_golem', 'llama', 'trader_llama',
  'polar_bear', 'bee', 'panda', 'dolphin', 'goat', 'spider', 'cave_spider']);
const FLEE = new Set(['creeper', 'warden']);
// откат удара в тиках (20 тиков = 1 с) по типу оружия
const COOLDOWN = { sword: 13, axe: 20, trident: 19, mace: 34, spear: 20, hand: 5 };
const WEAPON_SCORE = { netherite_sword: 8, diamond_sword: 7, netherite_axe: 7.5, diamond_axe: 7, iron_sword: 6, iron_axe: 6.5,
  stone_sword: 5, stone_axe: 6, golden_sword: 4, wooden_sword: 4, copper_sword: 5.5, copper_axe: 6.2, trident: 6, mace: 5 };
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
    const near = Object.values(b.entities).filter((e) => e !== b.entity && e.type !== 'player' && e.position.distanceTo(b.entity.position) < 6);
    for (const e of near) this.hurtBy.set(e.id, Date.now());
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
      if (e.customName && !angry) continue;
      // защищаем: себя (до 8 блоков) и хозяина (моб в 6 блоках от него)
      const nearOwner = own && e.position.distanceTo(own.position) < 6;
      if (d > 8 && !nearOwner) continue;
      const score = d - (angry ? 4 : 0) - (nearOwner ? 2 : 0);
      if (score < bestD) { best = e; bestD = score; }
    }
    return best;
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

    // крипер: пока не шипит - бьём и отскакиваем (как игроки), зашипел или варден - отбегаем
    const swelling = (e) => this.name(e) === 'creeper' && (e.metadata[16] === 1 || e.metadata[18] === true);
    const scary = Object.values(b.entities).find((e) => FLEE.has(this.name(e)) && e.position.distanceTo(me) < 6
      && (this.name(e) === 'warden' || swelling(e) || b.health <= 6));
    if (scary) {
      const away = me.minus(scary.position).normalize().scaled(10).plus(me);
      if (!this.fleeing) { this.fleeing = true; tb.log('отбегаю от ' + this.name(scary)); }
      b.setControlState('sprint', true);
      b.pathfinder.setGoal(new goals.GoalNear(away.x, away.y, away.z, 2), false);
      return;
    }
    if (this.fleeing) { this.fleeing = false; b.setControlState('sprint', false); this.resume(); }

    const t = this.pick();
    // мало здоровья или режим «убегать»: к хозяину, есть
    if (t && (this.mode === 'flee' || b.health <= 6)) {
      const own = this.owner();
      if (own) b.pathfinder.setGoal(new goals.GoalFollow(own, 1), true);
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
    if (d > 2.8) {
      if (tb.mode !== 'task') b.pathfinder.setGoal(new goals.GoalFollow(t, 1.5), true);   // в задании путь не перехватываем
      return;
    }
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

  // после боя вернуться к тому, что делали: идти за хозяином
  resume() {
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
  }
}

module.exports = { Guard };
