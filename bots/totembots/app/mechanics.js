// Механики передвижения и ремёсел, которых не было (23.11, владелец: «элитры, вагонетки, лошадь, лодка с поворотами,
// варка зелий - надо»). Всё - как у настоящего клиента: клавиши, взгляд и пакеты в такт, своя скорость тела только там,
// где её и в игре считает клиент (лошадь и лодка - их двигает сам игрок у себя и шлёт серверу место).
//   !fly(x, z)       - элитры: надеть, разбег-прыжок, раскрыть в падении, ракетами набрать высоту, лететь, сесть у цели;
//   !rail([x, z])    - вагонетка: сесть в ближайшую, ехать (вперёд по рельсам - ускорители двигает сервер), выйти у цели
//                      или когда встала;
//   лошадь           - если сидишь в седле, !drive(x, z) ведёт её (шаг 1 бл., прыжок через 2, своя скорость лошади);
//   лодка            - !drive(x, z) по воде в обход островов и мысов: путь по клеткам воды, лодка по точкам;
//   !brew(зелье, n)  - варочная стойка: вода в бутылки, адский нарост (грубое зелье), ингредиент, огненный порошок.
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Варка - все зелья игры. Цепочка ингредиентов от бутылки воды: адский нарост (грубое), основной ингредиент, порча
// (приготовленный паучий глаз), усиление (редстоун - дольше, светопыль - сильнее), вид (порох - взрывное, драконье
// дыхание - оседающее). Каждый шаг ~20 с, топливо - огненный порошок.
const BASE = {
  healing: 'glistering_melon_slice', strength: 'blaze_powder', swiftness: 'sugar', fire_resistance: 'magma_cream', regeneration: 'ghast_tear',
  night_vision: 'golden_carrot', water_breathing: 'pufferfish', slow_falling: 'phantom_membrane', leaping: 'rabbit_foot', poison: 'spider_eye',
  turtle_master: 'turtle_helmet', wind_charged: 'breeze_rod', weaving: 'cobweb', oozing: 'slime_block', infested: 'stone',
};
// порча: из какого зелья (приготовленным паучьим глазом)
const CORRUPT = { invisibility: 'night_vision', slowness: 'swiftness', harming: 'healing', weakness: null };
const RU = {
  'лечение': 'healing', 'исцеление': 'healing', 'сила': 'strength', 'скорость': 'swiftness', 'огнестойкость': 'fire_resistance', 'регенерация': 'regeneration',
  'ночное зрение': 'night_vision', 'подводное дыхание': 'water_breathing', 'медленное падение': 'slow_falling', 'прыгучесть': 'leaping', 'прыжок': 'leaping',
  'яд': 'poison', 'отравление': 'poison', 'черепашья мощь': 'turtle_master', 'черепаха': 'turtle_master', 'невидимость': 'invisibility', 'замедление': 'slowness',
  'урон': 'harming', 'вред': 'harming', 'слабость': 'weakness', 'ветер': 'wind_charged', 'плетение': 'weaving', 'слизь': 'oozing', 'заражение': 'infested',
};
/** «взрывное сильное лечение», «long swiftness», «splash_healing» -> { eff, long, strong, kind } */
function parsePotion(t) {
  t = String(t || '').toLowerCase().replace(/_/g, ' ');
  const long = /долг|длит|long|продл/.test(t), strong = /сильн|strong|\bii\b/.test(t);   // «мощь» - это черепашья мощь, не усиление
  const kind = /взрыв|splash|бросок/.test(t) ? 'splash' : /оседа|lingering|облак/.test(t) ? 'lingering' : '';
  let eff = Object.keys(BASE).concat(Object.keys(CORRUPT)).find((k) => t.includes(k.replace(/_/g, ' ')));
  if (!eff) { const r = Object.keys(RU).sort((a, b) => b.length - a.length).find((k) => t.includes(k)); eff = r && RU[r]; }
  return eff ? { eff, long, strong, kind } : null;
}
/** Ингредиенты по порядку от бутылки воды. */
function brewChain(p) {
  const out = [];
  if (p.eff === 'weakness') out.push('fermented_spider_eye');
  else {
    out.push('nether_wart');
    if (CORRUPT[p.eff]) out.push(BASE[CORRUPT[p.eff]], 'fermented_spider_eye');
    else out.push(BASE[p.eff]);
  }
  if (p.long) out.push('redstone'); else if (p.strong) out.push('glowstone_dust');
  if (p.kind === 'splash' || p.kind === 'lingering') out.push('gunpowder');
  if (p.kind === 'lingering') out.push('dragon_breath');
  return out;
}
const WHERE = { nether_wart: 'крепость Незера', blaze_powder: 'из огненного стержня (блейзы, крепость Незера)', glistering_melon_slice: 'кусок арбуза + 8 золотых самородков',
  magma_cream: 'кубы магмы или слизь + огненный порошок', ghast_tear: 'гасты в Незере', golden_carrot: 'морковь + 8 золотых самородков', pufferfish: 'рыбалка',
  phantom_membrane: 'фантомы', rabbit_foot: 'кролики', spider_eye: 'пауки', fermented_spider_eye: 'паучий глаз + сахар + коричневый гриб', turtle_helmet: 'щитки черепашат',
  redstone: 'шахта', glowstone_dust: 'светокамень в Незере', gunpowder: 'криперы', dragon_breath: 'дракон в Энде (в бутылку)', breeze_rod: 'вихри в испытаниях',
  cobweb: 'шахты', slime_block: '9 слизи', stone: 'шахта', sugar: 'тростник' };

class Mechanics {
  // ---------------- лошадь (и свинья, страйдер, верблюд - ездовые, которыми правит седок)
  /** Такт езды верхом: как LivingEntity.travel для ездового, по клавишам; место - серверу vehicle_move. */
  horseTick(v, c) {
    const b = this.bot, R = this._ride;
    const p = v.position, V = p.constructor;
    // скорость лошади - её свойство (атрибут), если сервер прислал; иначе средняя
    let speed = 0.225;
    try { const a = v.attributes && (v.attributes['minecraft:movement_speed'] || v.attributes['movement_speed'] || v.attributes['generic.movement_speed']); if (a && a.value) speed = a.value; } catch {}
    if (/camel/.test(v.name)) speed = Math.min(speed, 0.09); if (/pig/.test(v.name)) speed = 0.1; if (/strider/.test(v.name)) speed = 0.175;
    const yaw = b.entity.yaw;   // лошадь идёт туда, куда смотрит седок
    const fwd = c('forward') ? 1 : c('back') ? -0.25 : 0;
    R.hvx = R.hvx || 0; R.hvz = R.hvz || 0; R.hvy = R.hvy || 0;
    const ground = (x, y, z) => { const k = b.blockAt(new V(Math.floor(x), Math.floor(y), Math.floor(z))); return k && k.boundingBox === 'block'; };
    const onGround = ground(p.x, p.y - 0.05, p.z);
    const slip = onGround ? 0.546 : 0.91;
    if (fwd) { const acc = onGround ? speed * fwd : speed * fwd * 0.1; R.hvx += -Math.sin(yaw) * acc; R.hvz += -Math.cos(yaw) * acc; }
    // прыжок: впереди стена в 2 блока, а наверху свободно - прыгнуть (сила прыжка лошади ~0,7)
    const ax = p.x + Math.sign(R.hvx) * 0.9, az = p.z + Math.sign(R.hvz) * 0.9;
    const wall1 = ground(ax, p.y + 0.2, az), wall2 = ground(ax, p.y + 1.2, az), wall3 = ground(ax, p.y + 2.2, az);
    if (onGround && wall1 && wall2 && !wall3 && fwd > 0) R.hvy = 0.7;
    let nx = p.x + R.hvx, nz = p.z + R.hvz, ny = p.y + R.hvy;
    // шаг на блок (лошадь шагает на 1 блок без прыжка)
    if (ground(nx, p.y + 0.2, nz)) { if (!ground(nx, p.y + 1.2, nz) && onGround) ny = Math.floor(p.y) + 1; else { nx = p.x; nz = p.z; R.hvx = 0; R.hvz = 0; R.blockedAt = R.blockedAt || Date.now(); } } else R.blockedAt = 0;
    // гравитация и земля
    if (!ground(nx, ny - 0.05, nz)) { R.hvy = (R.hvy - 0.08) * 0.98; } else { if (R.hvy < 0) R.hvy = 0; ny = Math.max(ny, Math.floor(ny - 0.05) + 1); if (ny - Math.floor(ny) > 0.001 && ground(nx, ny - 1, nz)) ny = Math.floor(ny); }
    p.x = nx; p.y = ny; p.z = nz;
    R.hvx *= slip; R.hvz *= slip;
    v.yaw = yaw;
    const yawDeg = 180 - yaw * 180 / Math.PI;
    b._client.write('vehicle_move', { x: p.x, y: p.y, z: p.z, yaw: yawDeg, pitch: 0, onGround: ground(p.x, p.y - 0.05, p.z) });
  }

  // ---------------- лодка в обход островов
  /** Путь по воде (поверхность), обход в ширину по клеткам до 96 бл.: точки поворота. null - по воде не доплыть. */
  waterRoute(from, to) {
    const b = this.bot, V = from.constructor, y = Math.floor(from.y);
    const water = (x, z) => { const k = b.blockAt(new V(x, y, z), false), u = b.blockAt(new V(x, y + 1, z), false); return k && /water|ice/.test(k.name) && u && u.boundingBox === 'empty'; };
    // лодке нужна ширина: клетка и соседи - вода (кроме самой цели у берега)
    // лодка шире блока (1,375): путь - где вода со всех 8 сторон, иначе цепляет берег на углах (стенд: «упёрлась в берег» у острова)
    const wide = (x, z) => water(x, z) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].every(([dx, dz]) => water(x + dx, z + dz));
    const sx = Math.floor(from.x), sz = Math.floor(from.z), tx = Math.floor(to.x), tz = Math.floor(to.z);
    const key = (x, z) => x + ',' + z, prev = new Map([[key(sx, sz), null]]), q = [[sx, sz]];
    let end = null;
    while (q.length && prev.size < 30000) {
      const [x, z] = q.shift();
      if (Math.hypot(x - tx, z - tz) < 3) { end = [x, z]; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, nz = z + dz, k = key(nx, nz);
        if (prev.has(k) || Math.abs(nx - sx) > 96 || Math.abs(nz - sz) > 96) continue;
        if (!(wide(nx, nz) || Math.hypot(nx - tx, nz - tz) < 3 && water(nx, nz))) continue;
        if (dx && dz && !(water(x + dx, z) && water(x, z + dz))) continue;
        prev.set(k, [x, z]); q.push([nx, nz]);
      }
    }
    if (!end) return null;
    const pts = []; for (let c = end; c; c = prev.get(key(c[0], c[1]))) pts.unshift(c);
    // оставить точки поворота (направление меняется) и каждую 12-ю
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], n = pts[i + 1];
      if (!n || (c[0] - a[0]) !== (n[0] - c[0]) || (c[1] - a[1]) !== (n[1] - c[1]) || i % 12 === 0) out.push({ x: c[0] + 0.5, z: c[1] + 0.5 });
    }
    return out;
  }

  // ---------------- элитры
  /** Раскрыть элитры: как клиент - player_command START_FALL_FLYING. mineflayer шлёт «start_elytra_flying», которого
   *  в протоколе 1.21.11 нет (там «start_fall_flying») - сервер не мог разобрать пакет и выкидывал бота (стенд 23.11). */
  elytraStart() {
    const b = this.bot;
    b._client.write('entity_action', { entityId: b.entity.id, actionId: b.supportFeature('entityActionUsesStringMapper') ? 'start_fall_flying' : 8, jumpBoost: 0 });
  }
  async fly(a, tok) {
    const b = this.bot, tx = +a.x, tz = +a.z;
    // Стенд 23.11: сервер 26.3 через ViaVersion не разбирает команду «раскрыть элитры» от клиента 1.21.11 и выкидывает
    // бота (Failed to decode player_command); прыжок в воздухе тоже не раскрывает. Пока бот на 1.21.11 - не летать
    // (включается настройкой elytra: true, когда перейдём на родной протокол 26.3)
    if (!this.opts.elytra) throw new Error('на этом сервере элитры у меня пока не работают: версия сервера 26.3 не понимает команду раскрытия от моей 1.21.11 (выкидывает с сервера). Иду пешком или на лодке');
    if (!isFinite(tx) || !isFinite(tz)) throw new Error('куда лететь? нужны x и z');
    if (b.entity.isInWater) throw new Error('из воды не взлететь');
    const inv = b.inventory.items();
    const ely = (b.inventory.slots[6] && b.inventory.slots[6].name === 'elytra') ? b.inventory.slots[6] : inv.find((i) => i.name === 'elytra');
    if (!ely) throw new Error('элитр нет');
    const dmg = (ely.durabilityUsed !== undefined ? ely.durabilityUsed : 0), maxD = 432;
    if (maxD - dmg < 20) throw new Error(`элитры почти сломаны (${maxD - dmg} прочности) - починить или заменить`);
    const rockets = () => b.inventory.items().filter((i) => i.name === 'firework_rocket').reduce((s, i) => s + i.count, 0);
    const far = Math.hypot(tx - b.entity.position.x, tz - b.entity.position.z);
    if (!rockets() && far > 60) throw new Error('ракет нет - далеко не улететь (нужны фейерверки)');
    if (!(b.inventory.slots[6] && b.inventory.slots[6].name === 'elytra')) await b.equip(ely, 'torso');   // нагрудник - на место элитр, вернём после
    const nether = /nether/.test(b.game.dimension), cruiseMin = nether ? 0 : 30;
    const groundY = (x, z, y0) => { for (let y = Math.min(y0, nether ? 120 : 319); y > (nether ? 0 : -60); y--) { const k = b.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)), false); if (k && k.boundingBox === 'block') return y + 1; if (k === null) return null; } return null; };
    const boost = async () => {
      const r = b.inventory.items().find((i) => i.name === 'firework_rocket'); if (!r) return false;
      const held = b.heldItem; await b.equip(r, 'hand'); b.activateItem(); this._rocketAt = Date.now();
      if (held && held.name !== 'firework_rocket') { const h2 = b.inventory.items().find((i) => i.name === held.name); if (h2) b.equip(h2, 'hand').catch(() => {}); }
      return true;
    };
    this.busyLook = true; this.flying = true;
    const t0 = Date.now(), until = t0 + Math.max(60000, far / 15 * 1000 * 2);
    try {
      // взлёт: прыжок, в падении - раскрыть (как клиент: второй «прыжок» в воздухе), сразу ракета вверх
      if (b.entity.onGround) { b.setControlState('jump', true); await sleep(150); b.setControlState('jump', false); }
      for (let i = 0; i < 20 && !(b.entity.velocity.y < -0.05); i++) await sleep(50);
      this.elytraStart();
      for (let i = 0; i < 10 && !b.entity.elytraFlying; i++) await sleep(50);
      if (!b.entity.elytraFlying) throw new Error('элитры не раскрылись (сервер не принял)');
      await b.look(Math.atan2(-(tx - b.entity.position.x), -(tz - b.entity.position.z)), 0.7, true);   // круто вверх
      await boost();
      while (Date.now() < until) {
        this.check(tok);
        const p = b.entity.position, d = Math.hypot(tx - p.x, tz - p.z);
        if (!b.entity.elytraFlying) { if (b.entity.onGround || b.entity.isInWater) break; this.elytraStart(); await sleep(100); }
        const yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
        const gy = groundY(p.x, p.z, Math.floor(p.y)) ?? (p.y - 40), alt = p.y - gy;
        // впереди препятствие (луч по скорости на 14 бл.) - вверх
        const vel = b.entity.velocity, sp = Math.hypot(vel.x, vel.y, vel.z);
        let obstacle = false;
        try { if (sp > 0.1) { const hit = b.world.raycast(p.offset(0, 0.5, 0), vel.scaled(1 / sp), 14); obstacle = !!hit; } } catch {}
        let pitch;
        if (d < 24 + alt * 0.8) pitch = alt > 4 ? -0.45 : alt > 1.5 ? -0.15 : 0.05;   // посадка: вниз, у земли - выровняться
        else if (obstacle || alt < cruiseMin) pitch = 0.5;                               // вверх
        else pitch = alt > cruiseMin + 30 ? -0.12 : -0.03;                               // крейсер: чуть вниз, держать скорость
        await b.look(yaw, pitch, true);
        if (d > 24 + alt && (obstacle || alt < cruiseMin || sp < 0.9) && Date.now() - (this._rocketAt || 0) > 1600) await boost();
        await sleep(50);
      }
      // сели
      for (let i = 0; i < 60 && !(b.entity.onGround || b.entity.isInWater); i++) await sleep(100);
    } finally {
      this.busyLook = false; this.flying = false;
      // нагрудник обратно, если был
      const chest = b.inventory.items().find((i) => /_chestplate$/.test(i.name));
      if (chest && b.entity.onGround) await b.equip(chest, 'torso').catch(() => {});
    }
    const p = b.entity.position;
    return `долетел${Math.hypot(tx - p.x, tz - p.z) > 12 ? ' не до конца' : ''}: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, ${Math.round((Date.now() - t0) / 1000)} с, ракет осталось ${rockets()}`;
  }

  // ---------------- вагонетка
  async rail(a, tok) {
    const b = this.bot;
    if (!b.vehicle || !/minecart/.test(b.vehicle.name || '')) {
      const cart = Object.values(b.entities).filter((e) => /^minecart$/.test(e.name || '') && e.position.distanceTo(b.entity.position) < 16).sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
      if (!cart) throw new Error('вагонетки рядом нет');
      await this.mount({ what: 'minecart' }, tok);
      for (let i = 0; i < 20 && !b.vehicle; i++) await sleep(100);
      if (!b.vehicle) throw new Error('в вагонетку не сел');
    }
    const tx = a.x !== undefined ? +a.x : null, tz = a.z !== undefined ? +a.z : null;
    // толкнуть: смотреть вдоль рельсов (по ближайшему рельсу впереди) и «вперёд» - так игрок трогает вагонетку
    const p0 = b.vehicle.position;
    let dir = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = b.blockAt(new Vec3(Math.floor(p0.x) + dx, Math.floor(p0.y), Math.floor(p0.z) + dz)); if (k && /rail/.test(k.name)) { if (!dir || (tx !== null && Math.hypot(tx - (p0.x + dx), tz - (p0.z + dz)) < Math.hypot(tx - (p0.x + dir[0]), tz - (p0.z + dir[1])))) dir = [dx, dz]; } }
    if (dir) await b.look(Math.atan2(-dir[0], -dir[1]), 0, true);
    b.setControlState('forward', true);
    const t0 = Date.now(); let still = Date.now(), last = p0.clone(), why = 'встала';
    try {
      while (Date.now() - t0 < 600000) {
        this.check(tok);
        await sleep(250);
        if (!b.vehicle) { why = 'вылетел'; break; }
        const p = b.vehicle.position;
        if (tx !== null && Math.hypot(tx - p.x, tz - p.z) < 4) { why = 'доехал'; break; }
        if (p.distanceTo(last) > 0.3) { still = Date.now(); last = p.clone(); if (Date.now() - t0 > 2000) b.setControlState('forward', false); }
        else if (Date.now() - still > 3000) break;
      }
    } finally { b.setControlState('forward', false); }
    if (b.vehicle) await this.dismount().catch(() => {});
    const p = b.entity.position;
    return `вагонетка: ${why}, теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;
  }

  // ---------------- кузнечный стол: алмазное -> незеритовое (шаблон + вещь + незеритовый слиток)
  async smith(a, tok) {
    const b = this.bot, want = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const inv = () => b.inventory.items();
    const base = inv().find((i) => /^diamond_(sword|axe|pickaxe|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(i.name) && (!want || i.name.includes(want.replace(/^netherite_/, ''))));
    const lack = [];
    if (!base) lack.push('алмазная вещь для улучшения');
    if (!inv().some((i) => i.name === 'netherite_upgrade_smithing_template')) lack.push('шаблон улучшения (бастионы в Незере)');
    if (!inv().some((i) => i.name === 'netherite_ingot')) lack.push('незеритовый слиток (4 обломка древних обломков + 4 золота)');
    if (lack.length) throw new Error('для незерита не хватает: ' + lack.join('; '));
    const { goals } = require('mineflayer-pathfinder');
    const st = b.findBlock({ matching: (bl) => bl.name === 'smithing_table', maxDistance: 16 });
    if (!st) throw new Error('кузнечного стола рядом нет (скрафтить: 4 доски + 2 железа)');
    if (st.position.distanceTo(b.entity.position) > 3.5) await this.goto(new goals.GoalNear(st.position.x, st.position.y, st.position.z, 2), tok, 30000);
    const win = await b.openBlock(b.blockAt(st.position));
    const at = (name) => win.slots.findIndex((s2, i) => i >= 4 && s2 && s2.name === name);
    const one = async (name, dest) => { const i = at(name); if (i < 0) throw new Error('нет ' + name); await b.clickWindow(i, 0, 0); await b.clickWindow(dest, 1, 0); await b.clickWindow(i, 0, 0); };
    try {
      await one('netherite_upgrade_smithing_template', 0); await one(base.name, 1); await one('netherite_ingot', 2);
      for (let k = 0; k < 20 && !win.slots[3]; k++) await sleep(150);
      if (!win.slots[3]) throw new Error('стол не дал результат');
      // забрать результат в свободную ячейку (шифт-клик mineflayer не делает)
      const free = win.slots.findIndex((s2, i) => i >= win.inventoryStart && !s2);
      await b.moveSlotItem(3, free >= 0 ? free : win.inventoryStart);
      await sleep(400);
      if (!b.inventory.items().some((i) => /^netherite_/.test(i.name) && i.name === base.name.replace('diamond', 'netherite')) && !win.slots.some((s2, i) => i >= win.inventoryStart && s2 && s2.name === base.name.replace('diamond', 'netherite'))) throw new Error('результат не забрался');
    } finally { try { win.close(); } catch {} }
    return `улучшил ${base.name} -> ${base.name.replace('diamond', 'netherite')}`;
  }

  // ---------------- варка зелий
  async brew(a, tok) {
    const b = this.bot, n = Math.max(1, Math.min(3, +a.count || 3));
    const want = parsePotion(a.potion || a.what);
    if (!want) throw new Error(`не знаю зелья «${a.potion || a.what}»; умею: ${Object.keys(RU).join(', ')} - обычные, долгие, сильные, взрывные, оседающие`);
    if (want.long && want.strong) throw new Error('зелье бывает либо долгим (редстоун), либо сильным (светопыль), не всё сразу');
    const chain = brewChain(want);
    const have = () => this.invCounts();
    const lack = [];
    for (const it of chain) if ((have()[it] || 0) < 1) lack.push(`${it}${WHERE[it] ? ' (' + WHERE[it] + ')' : ''}`);
    if ((have().blaze_powder || 0) < (chain.includes('blaze_powder') ? 2 : 1)) lack.push('огненный порошок для топлива (blaze_powder)');
    if ((have().glass_bottle || 0) + b.inventory.items().filter((x) => x.name === 'potion' && /water/.test(require('./guard').potionName(x))).length < n) lack.push(`бутылки (${n} шт., glass_bottle - 3 стекла)`);
    if (lack.length) throw new Error('не хватает: ' + [...new Set(lack)].join('; '));
    const { goals } = require('mineflayer-pathfinder');
    let st = b.findBlock({ matching: (bl) => bl.name === 'brewing_stand', maxDistance: 16 });
    if (!st) {
      if (!have().brewing_stand) throw new Error('варочной стойки нет рядом и с собой (скрафтить: огненный стержень + 3 булыжника)');
      await this.run([{ act: 'place', block: 'brewing_stand' }], 'стойка', 'master');
      st = b.findBlock({ matching: (bl) => bl.name === 'brewing_stand', maxDistance: 6 });
      if (!st) throw new Error('стойку поставить не вышло');
    }
    // бутылки с водой
    const water = () => b.inventory.items().filter((x) => x.name === 'potion' && /water/.test(require('./guard').potionName(x))).length;
    for (let i = 0; i < 6 && water() < n; i++) {
      const w = b.findBlock({ matching: (bl) => bl.name === 'water', maxDistance: 16 });
      if (!w) throw new Error('воды рядом нет - набрать в бутылки негде');
      if (w.position.distanceTo(b.entity.position) > 4) await this.goto(new goals.GoalNear(w.position.x, w.position.y, w.position.z, 3), tok, 30000);
      const bt = b.inventory.items().find((x) => x.name === 'glass_bottle'); if (!bt) break;
      await b.equip(bt, 'hand'); await b.lookAt(w.position.offset(0.5, 0.8, 0.5), true); b.activateItem(); await sleep(400);
    }
    if (st.position.distanceTo(b.entity.position) > 3.5) await this.goto(new goals.GoalNear(st.position.x, st.position.y, st.position.z, 2), tok, 30000);
    const win = await b.openBlock(b.blockAt(st.position));   // openContainer стойку не знает (нет в его списке окон)
    const slotOf = (pred) => win.slots.findIndex((s2, i) => i >= 5 && s2 && pred(s2));
    const putOne = async (name, dest) => { const i = slotOf((x) => x.name === name); if (i < 0) throw new Error('нет ' + name); await b.clickWindow(i, 0, 0); await b.clickWindow(dest, 1, 0); await b.clickWindow(i, 0, 0); };
    const waitBrew = async () => { for (let k2 = 0; k2 < 70; k2++) { await sleep(500); this.check(tok); if (!win.slots[3]) return; } throw new Error('варка не закончилась за 35 с'); };
    const done = [];
    try {
      if (!win.slots[4]) await putOne('blaze_powder', 4);
      for (let k2 = 0; k2 < n; k2++) if (!win.slots[k2]) { const i = slotOf((x) => x.name === 'potion' && /water/.test(require('./guard').potionName(x))); if (i >= 0) await b.moveSlotItem(i, k2); }
      for (const ing of chain) {
        if (!win.slots[4] || (win.slots[4] && win.slots[4].count < 1)) await putOne('blaze_powder', 4).catch(() => {});
        await putOne(ing, 3); await waitBrew(); done.push(ing);
      }
      for (let k2 = 0; k2 < 3; k2++) if (win.slots[k2]) { const free = win.slots.findIndex((s2, i) => i >= win.inventoryStart && !s2); if (free >= 0) await b.moveSlotItem(k2, free); }
    } finally { try { win.close(); } catch {} }
    const name = `${want.kind === 'splash' ? 'взрывное ' : want.kind === 'lingering' ? 'оседающее ' : ''}${want.long ? 'долгое ' : want.strong ? 'сильное ' : ''}${want.eff}`;
    return `сварил ${n} зелья «${name}» (${done.join(' -> ')})`;
  }

}

module.exports = { Mechanics, parsePotion, brewChain };
