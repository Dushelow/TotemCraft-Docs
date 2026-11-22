// Мелкие умения по образцу Meteor и Baritone (22.11, владелец: «делай всё, главное по-умному»):
//  - присед у края (Meteor SafeWalk): стоит без дела у обрыва в 4+ бл., над лавой или пустотой - присела, чтобы толчок
//    моба или игрока не скинул вниз (физика игры с приседом не даёт сойти с края); пошла - встала;
//  - уворот от стрел и огненных шаров (Meteor ArrowDodge): снаряд летит в неё - шаг вбок, куда можно встать;
//  - быстрый доступ (Meteor AutoReplenish): между делами нужное (оружие, кирка, топор, еда, факелы) - в нижний ряд,
//    только в пустые ячейки, ничего не перекладывает зря;
//  - починка опытом (Meteor AutoMend): рядом шары опыта, а у неё повреждённая вещь с «Починкой» - взять её в руку,
//    пока собирает опыт; после - вернуть прежнее;
//  - разведение (Meteor AutoBreed), костная мука и какао (Baritone FarmProcess) - только по просьбе, не сами по себе:
//    разводит, только если в загоне меньше предела (по умолчанию 12) и есть корм; мука - на неспелое рядом;
//    какао - собрать спелое и посадить на свободные бока стволов джунглей, сколько бобов просили.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// корм для разведения (ваниль)
const FOOD = {
  cow: ['wheat'], mooshroom: ['wheat'], sheep: ['wheat'], goat: ['wheat'], pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod'],
  rabbit: ['carrot', 'golden_carrot', 'dandelion'], horse: ['golden_carrot', 'golden_apple'], donkey: ['golden_carrot', 'golden_apple'],
  llama: ['hay_block'], fox: ['sweet_berries', 'glow_berries'], turtle: ['seagrass'], panda: ['bamboo'], frog: ['slime_ball'],
  bee: ['dandelion', 'poppy', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium'], camel: ['cactus'], armadillo: ['spider_eye'],
  strider: ['warped_fungus'], hoglin: ['crimson_fungus'], sniffer: ['torchflower_seeds'], cat: ['cod', 'salmon'],
};
const ANIMAL_RU = { 'корова': 'cow', 'коровы': 'cow', 'коров': 'cow', 'овца': 'sheep', 'овцы': 'sheep', 'овец': 'sheep', 'свинья': 'pig', 'свиньи': 'pig', 'свиней': 'pig', 'курица': 'chicken', 'курицы': 'chicken', 'куры': 'chicken', 'кур': 'chicken', 'кролик': 'rabbit', 'кролики': 'rabbit', 'кроликов': 'rabbit', 'лошадь': 'horse', 'лошади': 'horse', 'лошадей': 'horse', 'коза': 'goat', 'козы': 'goat', 'коз': 'goat', 'пчела': 'bee', 'пчёлы': 'bee', 'пчелы': 'bee' };
const PROJ = /^(arrow|spectral_arrow|small_fireball|fireball|trident|wither_skull|shulker_bullet|breeze_wind_charge|wind_charge|snowball)$/;
const isBaby = (e) => { try { return (e.metadata || []).some((m, i) => i === 16 && m === true); } catch { return false; } };

class Chores {
  // ---------- 1. присед у края
  edgeTick() {
    const b = this.bot, e = b.entity;
    if (!e) return;
    const moving = b.pathfinder.isMoving() || b.vehicle || e.isInWater || this.busyLook || this.eating || (this.guard && this.guard.fighting) || this.seat;
    const set = (on) => { if (!on && !this._edgeSneak) return; this._edgeSneak = on; try { if (b.getControlState('sneak') !== on) b.setControlState('sneak', on); } catch {} };
    if (moving || !e.onGround) { set(false); return; }
    const p = e.position.floored();
    let risky = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      // край близко (до 0,5 бл. от края клетки)
      const fx = e.position.x - p.x, fz = e.position.z - p.z;
      if ((dx > 0 && fx < 0.5) || (dx < 0 && fx > 0.5) || (dz > 0 && fz < 0.5) || (dz < 0 && fz > 0.5)) continue;
      const side = b.blockAt(p.offset(dx, 0, dz));
      if (!side || side.boundingBox !== 'empty') continue;
      let drop = 0;
      for (let y = -1; y >= -6; y--) { const k = b.blockAt(p.offset(dx, y, dz)); if (!k) { drop = 6; break; } if (/lava|fire/.test(k.name)) { drop = 9; break; } if (k.boundingBox === 'block' || /water/.test(k.name)) break; drop++; }
      if (drop >= 4) { risky = true; break; }
    }
    set(risky);
  }

  // ---------- 3. уворот от снарядов (каждый тик физики, дёшево: только снаряды в 24 бл.)
  dodgeTick() {
    const b = this.bot, e = b.entity, now = Date.now();
    if (!e || b.vehicle || this.seat || now - (this._dodgeAt || 0) < 700) return;
    const me = e.position.offset(0, 0.9, 0);
    for (const s of Object.values(b.entities)) {
      if (!s.position || !PROJ.test(s.name || '') || !s.velocity) continue;
      const v = s.velocity, sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 0.3) continue;
      const rx = me.x - s.position.x, ry = me.y - s.position.y, rz = me.z - s.position.z;
      const d = Math.hypot(rx, ry, rz);
      if (d > 24 || d < 0.8) continue;
      // время сближения и промах (на сколько пролетит мимо), до 1 с вперёд
      const t = (rx * v.x + ry * v.y + rz * v.z) / (sp * sp);
      if (t < 0 || t > 20) continue;
      const mx = rx - v.x * t, my = ry - v.y * t, mz = rz - v.z * t;
      if (Math.hypot(mx, my, mz) > 1.1) continue;
      // вбок от линии полёта: в ту сторону, где можно встать (не в обрыв, не в лаву)
      const hx = -v.z / Math.hypot(v.x, v.z || 1e-6), hz = v.x / Math.hypot(v.x, v.z || 1e-6);
      for (const sgn of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
        const x = Math.floor(e.position.x + hx * sgn * 1.2), z = Math.floor(e.position.z + hz * sgn * 1.2), y = Math.floor(e.position.y);
        if (this.standOk && !this.standOk(x, y, z)) continue;
        this._dodgeAt = now;
        // шаг вбок клавишей (влево или вправо от взгляда), как стрейф игрока: своя скорость тела античит видит как Speed
        const rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw), side = (hx * sgn * rx + hz * sgn * rz) > 0 ? 'right' : 'left';
        b.setControlState(side, true); setTimeout(() => { try { b.setControlState(side, false); } catch {} }, 450);
        if (!this._dodgeSaid || now - this._dodgeSaid > 30000) { this._dodgeSaid = now; this.log(`уворачиваюсь от ${s.name}`); }
        return;
      }
    }
  }

  // ---------- 2. быстрый доступ и 4. починка опытом (раз в секунду, только без дела)
  async kitTick() {
    const b = this.bot, now = Date.now();
    if (!b || !b.entity || this.mode === 'task' || this.busyLook || this.eating || (this.guard && this.guard.fighting) || b.currentWindow) return;
    // починка: шары опыта в 6 бл. и повреждённая вещь с «Починкой»
    const orbs = Object.values(b.entities).some((x) => x.name === 'experience_orb' && x.position.distanceTo(b.entity.position) < 6);
    const mend = (i) => i && i.maxDurability && i.durabilityUsed > 0 && (i.enchants || []).some((en) => /mending/.test(en.name));
    if (orbs) {
      const held = b.heldItem;
      if (!mend(held)) {
        const it = b.inventory.items().find(mend);
        if (it) { this._mendBack = held ? held.name : ''; this._mendAt = now; try { await b.equip(it, 'hand'); this.log(`чиню опытом: ${it.name}`); } catch {} return; }
      }
      return;
    }
    if (this._mendBack !== undefined && now - (this._mendAt || 0) > 3000) {
      const back = this._mendBack; this._mendBack = undefined;
      if (back) { const it = b.inventory.items().find((i) => i.name === back); if (it) try { await b.equip(it, 'hand'); } catch {} }
      return;
    }
    // быстрый доступ: раз в минуту, только в пустые ячейки нижнего ряда
    if (now - (this._kitAt || 0) < 60000) return;
    this._kitAt = now;
    const S = b.inventory.slots, hot = [36, 37, 38, 39, 40, 41, 42, 43, 44];
    const inHot = (re) => hot.some((i) => S[i] && re.test(S[i].name));
    const WANT = [/_sword$/, /_pickaxe$/, /_axe$/, /^(cooked_|bread$|baked_potato$|golden_carrot$|apple$|carrot$)/, /^torch$/, /_shovel$/];
    for (const re of WANT) {
      if (inHot(re)) continue;
      const free = hot.find((i) => !S[i]);
      if (free === undefined) return;
      const src = b.inventory.items().find((i) => re.test(i.name) && !hot.includes(i.slot));
      if (!src) continue;
      try { await b.moveSlotItem(src.slot, free); } catch {}
      return;   // одно перемещение за раз
    }
  }

  // ---------- 7. разведение
  async breed(a, tok) {
    const b = this.bot;
    let kind = String(a.animal || a.what || '').toLowerCase().replace(/^minecraft:/, '');
    kind = ANIMAL_RU[kind] || kind;
    const me = b.entity.position;
    const all = Object.values(b.entities).filter((e) => e.position && FOOD[e.name] && e.position.distanceTo(me) < 24);
    if (!kind) {   // какое стадо рядом самое большое и есть корм
      const by = {}; for (const e of all) by[e.name] = (by[e.name] || 0) + 1;
      kind = Object.keys(by).sort((x, y) => by[y] - by[x]).find((k) => FOOD[k].some((f) => b.inventory.items().some((i) => i.name === f))) || '';
      if (!kind) throw new Error('рядом нет животных, для которых у меня есть корм');
    }
    if (!FOOD[kind]) throw new Error(`не знаю, чем кормить ${kind}`);
    const herd = all.filter((e) => e.name === kind);
    const adults = herd.filter((e) => !isBaby(e));
    const limit = Math.max(2, Math.min(40, +a.max || 12));
    if (herd.length >= limit) return `${kind}: в стаде уже ${herd.length} (предел ${limit}) - разводить не нужно`;
    const food = b.inventory.items().find((i) => FOOD[kind].includes(i.name));
    if (!food) throw new Error(`нет корма для ${kind}: нужен ${FOOD[kind].join(' или ')}`);
    const fed = (this._fed = this._fed || new Map());
    const ready = adults.filter((e) => !(fed.get(e.id) > Date.now() - 300000));   // кормленные недавно - 5 мин отдыхают
    let pairs = Math.min(Math.floor(ready.length / 2), limit - herd.length, +a.count || 4);
    if (pairs < 1) return `${kind}: взрослых без кормёжки меньше двух - пока нечего`;
    let n = 0;
    for (const e of ready.sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))) {
      if (n >= pairs * 2) break;
      this.check(tok);
      const it = b.inventory.items().find((i) => FOOD[kind].includes(i.name));
      if (!it) break;
      try { await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok, 15000); } catch (err) { if (this.isCancel(err)) throw err; continue; }
      try { await b.equip(it, 'hand'); await b.lookAt(e.position.offset(0, (e.height || 1) * 0.7, 0), true); await b.activateEntity(e); fed.set(e.id, Date.now()); n++; await sleep(300); } catch {}
    }
    return n >= 2 ? `покормила ${n} ${kind} - будет ${Math.floor(n / 2)} малыш(а)` : 'покормить пару не вышло';
  }

  // ---------- 8. костная мука на неспелое
  async bonemeal(a, tok) {
    const b = this.bot;
    const MAX = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3, sweet_berry_bush: 3, cocoa: 2, torchflower_crop: 1, pitcher_crop: 4 };
    const want = Math.max(1, Math.min(64, +a.count || 16));
    const has = () => b.inventory.items().find((i) => i.name === 'bone_meal');
    if (!has()) throw new Error('нет костной муки (её делают из костей: !craft(bone_meal))');
    let used = 0;
    for (let k = 0; k < want; k++) {
      this.check(tok);
      const me = b.entity.position;
      const p = b.findBlocks({ point: me, maxDistance: 12, count: 60, matching: (bl) => (MAX[bl.name] !== undefined && (bl.getProperties().age ?? 0) < MAX[bl.name]) || /_sapling$/.test(bl.name) && !!a.saplings })
        .filter((v) => !(a.crop && !b.blockAt(v).name.startsWith(a.crop))).sort((x, y) => x.distanceTo(me) - y.distanceTo(me))[0];
      if (!p) break;
      const bm = has(); if (!bm) break;
      try {
        await this.goto(new goals.GoalNear(p.x, p.y, p.z, 3), tok, 15000);
        await b.equip(bm, 'hand');
        await b.activateBlock(b.blockAt(p));
        used++; await sleep(250);
      } catch (err) { if (this.isCancel(err)) throw err; break; }
    }
    return used ? `костная мука: ${used} раз на неспелое рядом` : 'неспелого рядом нет';
  }

  // ---------- 9. какао: спелое собрать, посадить столько, сколько просили
  async cocoa(a, tok) {
    const b = this.bot;
    let got = 0, planted = 0;
    const want = Math.max(0, Math.min(32, a.count === undefined ? 0 : +a.count));
    // спелое (age 2) - собрать
    for (let k = 0; k < 40; k++) {
      this.check(tok);
      const p = b.findBlock({ maxDistance: 16, matching: (bl) => bl.name === 'cocoa' && bl.getProperties().age === 2 });
      if (!p) break;
      try { await this.goto(new goals.GoalNear(p.position.x, p.position.y, p.position.z, 3), tok, 15000); await b.dig(b.blockAt(p.position)); got++; } catch (err) { if (this.isCancel(err)) throw err; break; }
    }
    // посадить: только если просили (сколько) - на свободные бока стволов джунглей
    for (let k = 0; k < want; k++) {
      this.check(tok);
      const beans = b.inventory.items().find((i) => i.name === 'cocoa_beans');
      if (!beans) break;
      const me = b.entity.position;
      const logs = b.findBlocks({ point: me, maxDistance: 16, count: 40, matching: (bl) => /^(jungle_log|stripped_jungle_log|jungle_wood)$/.test(bl.name) });
      let spot = null;
      for (const v of logs.sort((x, y) => x.distanceTo(me) - y.distanceTo(me))) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const s = b.blockAt(v.offset(dx, 0, dz)); if (s && s.name === 'air') { spot = { log: v, face: new Vec3(dx, 0, dz) }; break; } }
        if (spot) break;
      }
      if (!spot) break;
      try {
        await this.goto(new goals.GoalNear(spot.log.x + spot.face.x, spot.log.y, spot.log.z + spot.face.z, 2), tok, 15000);
        await b.equip(beans, 'hand');
        await b.placeBlock(b.blockAt(spot.log), spot.face);
        planted++;
      } catch (err) { if (this.isCancel(err)) throw err; break; }
    }
    if (!got && !planted) throw new Error(want ? 'посадить какао некуда (нужен ствол джунглей с открытым боком) или нет бобов' : 'спелого какао рядом нет');
    return `какао: собрала ${got}${planted ? `, посадила ${planted}` : ''}`;
  }
}

module.exports = { Chores, FOOD };
