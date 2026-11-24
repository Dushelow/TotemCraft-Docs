// Транспорт (лодка, лошадь), выбросить всё, дуэль.
// Вынесено из bot.js (21.11.2026, разбивка большого файла): методы подмешиваются в TotemBot, this - тело бота.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { BUILT } = require('./skills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';
const RIDE_RE = /boat|raft|^(horse|donkey|mule|camel|pig|strider|llama|skeleton_horse|zombie_horse|minecart|happy_ghast)$/;

class Vehicles {
  // --- транспорт: лодка, лошадь и прочее, на чём ездят (раньше команды не было: «не умею садиться в лодку», 15.11)

  /** Сесть: в лодку или на животное рядом; who - к этому игроку (в его лодку, свободное место). */
  async mount(a, tok) {
    const b = this.bot, RIDE = RIDE_RE;
    // сидит на ступеньке или полублоке (GSit: невидимое сиденье) - встать, а не «уже сижу» (22.11: «поставь лодку» -
    // так и сидел на фонарном столбе)
    if (b.vehicle && !RIDE.test(b.vehicle.name || '')) { await this.standUp(); for (let w = 0; w < 15 && b.vehicle; w++) await sleep(100); }
    if (b.vehicle) return 'уже сижу в ' + (b.vehicle.name || 'чём-то');
    const me = b.entity.position;
    // мозг пишет в «who» и ник, и название лодки (22.11: mount(pale_oak_boat) - сел в чужую лодку в стороне)
    let kind = String(a.what || '').toLowerCase();
    if (a.who && !this.player(a.who) && /boat|raft|horse|donkey|mule|camel|pig|strider|llama|лодк|лошад/i.test(a.who)) { kind = kind || String(a.who).toLowerCase(); a = { ...a, who: '' }; }
    let target = null;
    // без ника - сначала лодка хозяина рядом (в которой он сидит или у которой стоит), а не ближайшая к боту
    const owner = !a.who && (this.opts.masters || [this.followName]).map((n) => n && this.player(n)).find((e) => e && e.position.distanceTo(me) < 24);
    const who = a.who ? this.player(a.who) : owner && (owner.vehicle || Object.values(b.entities).some((e) => RIDE.test(e.name || '') && e.position.distanceTo(owner.position) < 3)) ? owner : null;
    if (who) {
      target = who.vehicle || Object.values(b.entities).filter((e) => RIDE.test(e.name || '') && e.position.distanceTo(who.position) < 4)
        .sort((x, y) => x.position.distanceTo(who.position) - y.position.distanceTo(who.position))[0];
      if (!target) throw new Error(`${a.who} ни на чём не сидит, и рядом с ним нет лодки`);
    } else {
      target = Object.values(b.entities).filter((e) => RIDE.test(e.name || '') && (!kind || (e.name || '').includes(kind)) && e.position.distanceTo(me) < 24)
        .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
      if (!target && (!kind || /boat|raft/.test(kind))) target = await this.placeBoat(tok);
      if (!target) throw new Error(`рядом нет ${kind || 'лодки или животного'}, на что сесть`);
    }
    const seats = /boat|raft/.test(target.name || '') ? (/chest/.test(target.name) ? 1 : 2) : 1;
    if ((target.passengers || []).length >= seats) throw new Error(`в ${target.name} нет места`);
    for (let i = 0; i < 3 && !b.vehicle; i++) {
      this.check(tok);
      // подойти на 2 бл. к месту лодки и остановиться (за лодкой «следом» тело упиралось в неё и толкало - 22.11)
      if (target.position.distanceTo(b.entity.position) > 2.6) {
        try { await this.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2), tok, 20000); } catch (e) { if (isCancel(e)) throw e; }
      }
      try { b.pathfinder.setGoal(null); b.clearControlStates(); } catch {}
      await sleep(150);
      const d = target.position.distanceTo(b.entity.position.offset(0, 1.6, 0));
      this.busyLook = true;
      let heard = '';
      try { await b.lookAt(target.position.offset(0, (target.height || 0.5) / 2, 0), true); heard = await this.interactEntity(target, () => !!b.vehicle); } finally { this.busyLook = false; }
      if (!b.vehicle) this.log(`в ${target.name} не сел (попытка ${i + 1}, до неё ${d.toFixed(1)} бл.; сервер прислал: ${heard || 'ничего'})`);
    }
    if (!b.vehicle) throw new Error(`не сел в ${target.name}${/horse|donkey|mule|camel/.test(target.name) ? ' (лошадь должна быть приручена и под седлом)' : ''}`);
    if (this.mode !== 'task') this.mode = 'ride';
    const driver = !(target.passengers || []).some((x) => x !== b.entity);
    return `сел в ${target.name}${driver ? ' (я за рулём: !drive(x, z))' : ' пассажиром'}`;
  }

  /**
   * Правый клик по существу (лодка, житель) как у клиента игры: присед отпущен, взгляд на середину тела, в тике физики
   * сначала «клик в точку» (interact_at), затем «клик» (interact) - mineflayer шлёт только второе и вне тика, и сервер
   * 26.3 молча не сажал в лодку и не открывал торговлю (22.11: по 3 попытки в 2 бл. - ничего). Возвращает, что
   * сервер прислал в ответ (для журнала), ждёт до 2 с, пока done() не станет true.
   */
  async interactEntity(target, done) {
    const b = this.bot, seen = [];
    const spy = (data, meta) => { if (/passengers|open_window|open_screen|trade_list|mount|entity_link|system_chat|action_bar/.test(meta.name) && seen.length < 8) seen.push(meta.name); };
    b._client.on('packet', spy);
    try {
      if (b.getControlState('sneak')) { b.setControlState('sneak', false); await sleep(150); }
      await new Promise((res) => { this._interactQ = { target, res }; setTimeout(res, 1500); });
      for (let w = 0; w < 20 && !(done && done()); w++) await sleep(100);
    } finally { b._client.removeListener('packet', spy); this._interactQ = null; }
    return seen.join(', ');
  }
  /** Из тика физики (bot.js): отправить клик по существу, если ждёт. */
  interactTick() {
    const q = this._interactQ, b = this.bot;
    if (!q || !b.entity) return;
    this._interactQ = null;
    const t = q.target, hit = { x: 0, y: (t.height || 0.5) / 2, z: 0 };
    try {
      // 26.x: один пакет (рука, точка касания), удар - отдельный пакет; 1.21.11: «клик в точку» и «клик» (стенд 23.11:
      // на 26.1 жители не открывали торговлю - уходил старый формат)
      if (b.registry.version['>=']('26.1')) b._client.write('use_entity', { target: t.id, hand: 'main_hand', location: hit, sneaking: false });
      else {
        b._client.write('use_entity', { target: t.id, mouse: 2, sneaking: false, hand: 0, x: hit.x, y: hit.y, z: hit.z });
        b._client.write('use_entity', { target: t.id, mouse: 0, sneaking: false, hand: 0 });
      }
      b.swingArm('right');
    } catch (e) { this.log('клик по существу: ' + e.message); }
    q.res();
  }

  /**
   * Забрать лодку (выбить: несколько ударов, лодка выпадает предметом, кто в ней - выходит). Только по слову хозяина:
   * обычно в лодки сажают животных и мобов нарочно - перевезти или сохранить, это чужое (22.11, владелец). С игроком в
   * лодке - никогда. Какую: ближайшую к хозяину (он показывает, стоя рядом) или к точке x z.
   */
  async takeBoat(a, tok) {
    const b = this.bot;
    const near = a.x !== undefined ? new Vec3(+a.x, b.entity.position.y, +a.z) : (this.player(a.who) || b.entity).position;
    const boat = Object.values(b.entities).filter((e) => /boat|raft/.test(e.name || '') && e.position.distanceTo(near) < 8)
      .sort((x, y) => x.position.distanceTo(near) - y.position.distanceTo(near))[0];
    if (!boat) throw new Error('рядом нет лодки');
    if ((boat.passengers || []).some((p) => p.type === 'player')) throw new Error('в лодке игрок - не трогаю');
    const who = (boat.passengers || []).map((p) => p.name).join(', ');
    if (boat.position.distanceTo(b.entity.position) > 2.8) { try { await this.goto(new goals.GoalNear(boat.position.x, boat.position.y, boat.position.z, 2), tok, 20000); } catch (e) { if (isCancel(e)) throw e; } }
    for (let i = 0; i < 10 && b.entities[boat.id]; i++) {
      this.check(tok);
      try { await b.lookAt(boat.position.offset(0, 0.3, 0), true); b.attack(boat); } catch {}
      await sleep(300);
    }
    if (b.entities[boat.id]) throw new Error('лодку выбить не вышло');
    await sleep(400);
    try { const it = Object.values(b.entities).find((e) => e.name === 'item' && e.position.distanceTo(boat.position) < 4); if (it) await this.goto(new goals.GoalNear(it.position.x, it.position.y, it.position.z, 0.5), tok, 8000); } catch {}
    return `лодка забрана${who ? ' (в ней были: ' + who + ' - вышли)' : ''}`;
  }

  /** Поставить свою лодку на воду или лёд рядом (как игрок: лодка в руке, правый клик по блоку). */
  async placeBoat(tok) {
    const b = this.bot;
    const it = b.inventory.items().find((i) => /_boat$|_raft$/.test(i.name) && !/chest/.test(i.name)) || b.inventory.items().find((i) => /_boat$|_raft$/.test(i.name));
    if (!it) return null;
    const me = b.entity.position;
    // Лодка шире блока (1,375): у самого берега она задевает берег, и сервер её не ставит (стенд 23.11: целился в воду
    // вплотную к берегу - лодки нет). Место - где вокруг на 1 бл. тоже вода или лёд и сверху пусто; ближе 1,5 бл. - нет.
    const flat = (k) => k && /^(water|ice|packed_ice|blue_ice|frosted_ice)$/.test(k.name);
    const free = (k) => { const up = b.blockAt(k.position.offset(0, 1, 0)); return up && up.boundingBox === 'empty' && !/water/.test(up.name); };
    const roomy = (k) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const n = b.blockAt(k.position.offset(dx, 0, dz)); if (!flat(n) || !free(n)) return false; } return true; };
    const eye = me.offset(0, 1.62, 0);
    const cand = b.findBlocks({ matching: (bl) => flat(bl), maxDistance: 5, count: 80 }).map((p) => b.blockAt(p))
      .filter((k) => free(k) && k.position.offset(0.5, 0.9, 0.5).distanceTo(eye) < 4.3)
      .sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me));
    // куда плыть потом известно - ближе к той стороне (вода за спиной бывает другим водоёмом)
    const T = this._boatToward;
    if (T) cand.sort((p, q) => Math.hypot(p.position.x - T.x, p.position.z - T.z) - Math.hypot(q.position.x - T.x, q.position.z - T.z));
    const spot = cand.find((k) => roomy(k) && k.position.offset(0.5, 0, 0.5).distanceTo(me) > 1.5) || cand.find((k) => k.position.offset(0.5, 0, 0.5).distanceTo(me) > 1.5) || cand[0];
    if (!spot) throw new Error('лодку ставить некуда: рядом нет воды или льда');
    this.check(tok);
    await b.equip(it, 'hand');
    this.busyLook = true;
    // Как клиент: взгляд на воду и «использовать предмет» - сервер сам ищет лучом точку на воде или льду и ставит лодку.
    // (mineflayer placeEntity ждёт существо «boat», а с 1.21.2 лодки - «oak_boat», «birch_boat»...: лодка вставала,
    // а бот считал, что не вышло - «Failed to place entity», стенд 23.11)
    const before = new Set(Object.keys(b.entities));
    const isNew = (x) => !before.has(String(x.id)) && /boat|raft/.test(x.name || '') && x.position.distanceTo(spot.position) < 4;
    this.log(`ставлю лодку на ${spot.name} ${spot.position.x} ${spot.position.y} ${spot.position.z} (я у ${Math.floor(me.x)} ${Math.floor(me.y)} ${Math.floor(me.z)}, мест ${cand.length})`);
    try {
      await b.lookAt(spot.position.offset(0.5, 0.9, 0.5), true);
      await sleep(100);
      b.activateItem();
    } finally { this.busyLook = false; }
    let e = null;
    for (let i = 0; i < 20 && !e; i++) { await sleep(100); e = Object.values(b.entities).find(isNew) || null; }
    if (!e) throw new Error('лодка не встала (сервер её не поставил)');
    if (e) this.log(`поставил лодку на ${spot.position.x} ${spot.position.y} ${spot.position.z}`);
    return e || null;
  }

  async dismount() {
    const b = this.bot;
    if (!b.vehicle) return 'я ни на чём не сижу';
    const was = b.vehicle;
    // как игрок: «присесть» во вводе (rideTick шлёт shift), пока сервер не высадит. mineflayer.dismount шлёт прыжок -
    // на 1.21.2+ это не высаживает (стенд 23.11: «не смог слезть», потом бот считал, что всё ещё в лодке, и тонул подо льдом)
    this._wantOff = true;
    if (!this._rideTimer) { try { b._client.write('player_input', { inputs: { forward: false, backward: false, left: false, right: false, jump: false, shift: true, sprint: false } }); } catch {} }
    try { if (was && /boat|raft/.test(was.name || '')) this.autoMark('моя лодка', was.position, { kind: 'моя лодка', one: true, ttl: 3 * 86400000 }); } catch {}
    for (let w = 0; w < 20 && b.vehicle; w++) await sleep(100);
    this._wantOff = false;
    try { b._client.write('player_input', { inputs: { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false } }); } catch {}
    if (this.mode === 'ride') this.mode = 'idle';
    return b.vehicle ? 'не смог слезть' : 'слез';
  }

  /** Вести лодку или лошадь к точке (x, z). Лошадь идёт по взгляду; лодку поворачивают «влево/вправо». */
  /**
   * Езда (22.11: сел в лодку - и стоит): пока бот на чём-то сидит, физика mineflayer выключена совсем - нет ни сигнала
   * «конец такта» (без него сервер 1.21.2+ не применяет ввод), ни движения лодки. А лодку в Minecraft двигает сам
   * водитель у себя и шлёт серверу её место (vehicle_move). Здесь это сделано как в клиенте (Boat.controlBoat и
   * floatBoat): вперёд +0,04 за такт, поворот ±1° за такт, трение воды 0,9 (лёд 0,98, синий лёд 0,989), стоп у берега.
   * Пассажир шлёт только «конец такта» и ввод.
   */
  vehiclesAttach(bot) {
    bot.on('mount', () => this.rideStart());
    bot.on('dismount', () => this.rideStop());
    // mineflayer снимает бота с лодки, только если лодка исчезла или пришло «-1»; а сервер при высадке (шифт, перенос,
    // смерть лодки рядом) шлёт «у лодки пассажиров: [без тебя]» - и bot.vehicle оставался навсегда (стенд 23.11: после
    // переноса бот «сидел в лодке» под водой, спасение от удушья молчало). Снять самим
    bot._client.on('set_passengers', ({ entityId, passengers }) => {
      try {
        const v = bot.vehicle;
        if (v && v.id === entityId && bot.entity && !passengers.includes(bot.entity.id)) {
          const i = (v.passengers || []).indexOf(bot.entity); if (i >= 0) v.passengers.splice(i, 1);
          bot.entity.vehicle = null; bot.vehicle = null; bot.emit('dismount', v);
        }
      } catch {}
    });
  }
  rideStart() {
    this.rideStop();
    const b = this.bot;
    this._ride = { yawDeg: null, dRot: 0, vx: 0, vz: 0 };
    this._rideTimer = setInterval(() => { try { this.rideTick(); } catch (e) { this.log('езда: ' + e.message); } }, 50);
    this.log('еду: ' + ((b.vehicle && b.vehicle.name) || 'что-то'));
  }
  rideStop() { if (this._rideTimer) clearInterval(this._rideTimer); this._rideTimer = null; this._ride = null; }
  rideTick() {
    const b = this.bot, v = b && b.vehicle, R = this._ride;
    if (!b || !v || !R) { this.rideStop(); return; }
    const c = (k) => !!b.getControlState(k);
    const ps = v.passengers || [];
    const driver = /boat|raft/.test(v.name || '') && (!ps.length || ps[0] === b.entity);
    // верхом (лошадь, осёл, мул, верблюд, свинья, страйдер): правит первый седок - движение считает клиент (mechanics.js)
    const rider = !driver && /horse|donkey|mule|camel|^pig$|strider|llama/.test(v.name || '') && ps[0] === b.entity;
    // shift - слезть (с 1.21.2 сервер высаживает по «присесть» во вводе, а не по прыжку, как шлёт mineflayer.dismount)
    try { b._client.write('player_input', { inputs: { forward: c('forward'), backward: c('back'), left: c('left'), right: c('right'), jump: false, shift: !!this._wantOff || c('sneak'), sprint: false } }); } catch {}   // присед = встать с сиденья GSit (standUp)
    if (driver) {
      if (R.yawDeg === null) R.yawDeg = 180 - (v.yaw || 0) * 180 / Math.PI;   // mineflayer: yaw = рад(180 - градусы игры)
      if (c('left')) R.dRot -= 1;
      if (c('right')) R.dRot += 1;
      let f = 0;
      if (c('right') !== c('left') && !c('forward') && !c('back')) f += 0.005;
      R.yawDeg += R.dRot;
      if (c('forward')) f += 0.04;
      if (c('back')) f -= 0.005;
      const ry = R.yawDeg * Math.PI / 180;
      R.vx += Math.sin(-ry) * f; R.vz += Math.cos(ry) * f;
      const p = v.position, V = p.constructor;
      const under = b.blockAt(new V(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)));
      const inv = under && /blue_ice/.test(under.name) ? 0.989 : under && /ice/.test(under.name) ? 0.98 : under && /water/.test(under.name) ? 0.9 : 0.5;
      // столкновение как у лодки в игре: коробка 1,375 x 0,5625 и сидящие над ней (до 2,4 бл. вверх) - в блок не
      // въезжать (22.11: упёрлись в борт корабля, лодка продолжала «плыть» в стену, обоих задавило в блоках)
      const hits = (x, z) => { const h = 0.6875; for (let yy = Math.floor(p.y); yy <= Math.floor(p.y + 2.4); yy++) for (const ox of [-h, 0, h]) for (const oz of [-h, 0, h]) { const k = b.blockAt(new V(Math.floor(x + ox), yy, Math.floor(z + oz))); if (k && k.boundingBox === 'block' && !/water/.test(k.name)) return true; } return false; };
      const nx = p.x + R.vx, nz = p.z + R.vz;
      if (!hits(nx, nz)) { p.x = nx; p.z = nz; R.blockedAt = 0; }
      else if (Math.abs(R.vx) > 0.02 && !hits(nx, p.z)) { p.x = nx; R.vz = 0; R.blockedAt = R.blockedAt || Date.now(); }   // скользить вдоль стены
      else if (Math.abs(R.vz) > 0.02 && !hits(p.x, nz)) { p.z = nz; R.vx = 0; R.blockedAt = R.blockedAt || Date.now(); }
      else { R.vx = 0; R.vz = 0; R.blockedAt = R.blockedAt || Date.now(); }
      R.vx *= inv; R.vz *= inv; R.dRot *= inv;
      v.yaw = (180 - R.yawDeg) * Math.PI / 180;
      b._client.write('vehicle_move', { x: p.x, y: p.y, z: p.z, yaw: R.yawDeg, pitch: 0, onGround: false });
      try { b._client.write('steer_boat', { leftPaddle: c('forward') || c('right'), rightPaddle: c('forward') || c('left') }); } catch {}
    }
    // взгляд седока - серверу (пока сидит, физика mineflayer молчит и поворот не уходил): вагонетка толкается «вперёд»
    // туда, куда смотрит игрок (стенд 23.11: смотрел вдоль рельсов, а сервер считал по старому взгляду - стояла)
    if (!driver && !rider) {
      const ny = 180 - b.entity.yaw * 180 / Math.PI, np = -b.entity.pitch * 180 / Math.PI;
      if (R.lookYaw === undefined || Math.abs(ny - R.lookYaw) > 0.5 || Math.abs(np - R.lookPitch) > 0.5) { R.lookYaw = ny; R.lookPitch = np; try { b._client.write('look', { yaw: ny, pitch: np, onGround: false, flags: { onGround: false, hasHorizontalCollision: false } }); } catch {} }
    }
    if (rider && this.horseTick) { try { this.horseTick(v, c); } catch (e) { if (!this._horseErr) { this._horseErr = 1; this.log('верхом: ' + e.message); } } }
    try { b._client.write('tick_end', {}); } catch {}
  }

  /** Впереди по курсу лодки (до 6 бл.): первая твёрдая клетка на уровне борта - { d, k }. */
  boatAhead(yaw) {
    const b = this.bot, v = b.vehicle ? b.vehicle.position : b.entity.position, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let t = 1; t <= 6; t += 0.5) for (const dy of [0, 1]) { const k = b.blockAt(new Vec3(Math.floor(v.x + fx * t), Math.floor(v.y) + dy, Math.floor(v.z + fz * t))); if (k && k.boundingBox === 'block') return { d: t, k }; }
    return null;
  }
  /** Чем назвать преграду: постройка (корабль, причал) или берег. */
  obstacleName(k) {
    if (!k) return 'берег или стену';
    if (/_planks$|_log$|_wood$|_stairs$|_slab$|_fence|_wall$|wool|_door$|trapdoor|glass|bricks?$|terracotta|concrete|barrel|chest/.test(k.name)) {
      // много дерева и досок рядом над водой - корабль
      const b = this.bot, wood = b.findBlocks({ point: k.position, matching: (bl) => /_planks$|_log$|_stairs$|_slab$/.test(bl.name), maxDistance: 8, count: 60 }).length;
      return wood >= 40 ? 'корабль' : 'постройку';
    }
    return 'берег';
  }

  async drive(a, tok) {
    const b = this.bot;
    if (!b.vehicle) throw new Error('я ни на чём не сижу - сначала !boardBoat');
    if (!RIDE_RE.test(b.vehicle.name || '')) throw new Error('сижу не в лодке и не на лошади (на сиденье) - сначала !boardBoat');
    // рулит тот, кто сел первым (так в игре): пассажир править не может (22.11: Loki сел к хозяину и «плыл» на месте)
    const ps = b.vehicle.passengers || [];
    if (ps.length && ps[0] !== b.entity) { const d = ps[0]; throw new Error(`рулит ${d.username || d.name || 'другой'}: я пассажир, править не могу - пусть рулит он, или он пересядет, и я сяду первым`); }
    const x = +a.x, z = +a.z;
    if (!isFinite(x) || !isFinite(z)) throw new Error('куда? нужны x и z');
    const boat = /boat|raft/.test(b.vehicle.name || '');
    // по прямой - суша (остров, мыс, берег реки с поворотом): путь по воде, плыть по точкам поворота
    if (boat && !a._leg && this.waterRoute) {
      const vp = b.vehicle.position, L = Math.hypot(x - vp.x, z - vp.z);
      let land = false;
      for (let t = 2; t < L - 3 && !land; t += 2) { const k = b.blockAt(new Vec3(Math.floor(vp.x + (x - vp.x) * t / L), Math.floor(vp.y), Math.floor(vp.z + (z - vp.z) * t / L)), false); if (k && !/water|ice|air/.test(k.name)) land = true; }
      if (land) {
        const route = this.waterRoute(vp, { x, z });
        if (route && route.length > 1) {
          this.log(`по прямой суша - плыву в обход: ${route.length} точек`);
          for (const pt of route.slice(0, -1)) { const r0 = await this.drive({ x: pt.x, z: pt.z, _leg: true, seconds: 60 }, tok); if (/упёрлась/.test(r0)) return r0; }
        } else if (!route) this.log('по воде к цели не доплыть - плыву напрямик, сколько выйдет');
      }
    }
    const until = Date.now() + Math.min(600, +a.seconds || 180) * 1000;
    let flip = 1, lastErr = null, errAt = Date.now();
    this.busyLook = true;
    try {
      while (Date.now() < until) {
        this.check(tok);
        if (!b.vehicle) throw new Error('меня выкинуло из ' + (boat ? 'лодки' : 'седла'));
        const v = b.vehicle.position, d = Math.hypot(x - v.x, z - v.z);
        if (d < 3) break;
        // упёрлись (берег, борт) и стоим 1,5 с - дальше не жать: выйти, сказать, где
        if (this._ride && this._ride.blockedAt && Date.now() - this._ride.blockedAt > 1500) { const left = Math.round(d); b.clearControlStates(); const ob = this.boatAhead(b.vehicle.yaw || 0); if (left < 12) return `приплыла: упёрлась в ${this.obstacleName(ob && ob.k)} у цели (${left} бл.)`; return `упёрлась в ${this.obstacleName(ob && ob.k)} в ${left} бл. от цели - дальше по воде не проплыть`; }
        const want = Math.atan2(-(x - v.x), -(z - v.z));
        await b.look(want, 0, true);
        let err = want - (b.vehicle.yaw || 0); while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
        // курс лодки считаем сами (rideTick): ошибка за 2 с выросла - поворачиваем в другую сторону (страховка знака)
        // курс лодки считаем сами (rideTick), знак поворота известен - без «переворотов», от них лодка петляла и тормозила
        if (!boat && Date.now() - errAt > 2000) { if (lastErr !== null && Math.abs(err) > Math.abs(lastErr) + 0.2) flip = -flip; lastErr = err; errAt = Date.now(); }
        const turn = boat && Math.abs(err) > 0.25 ? Math.sign(err) * flip : 0;
        // у цели - отпустить «вперёд» заранее: лодка катится по инерции ~3-4 бл. (22.11: плыл, пока не упрётся в борт);
        // упёрлись у цели - приплыли
        if (boat && d < 10 && this._ride && this._ride.blockedAt) break;
        const ahead = boat ? this.boatAhead(b.vehicle.yaw || 0) : null;
        if (boat && ahead && ahead.d <= 4 && d < 12) { b.clearControlStates(); await sleep(600); return `приплыла к цели: у борта - ${this.obstacleName(ahead.k)} (${Math.round(d)} бл. до точки)`; }
        const go = (!boat || Math.abs(err) < 1.6) && !(boat && d < 4) && !(ahead && ahead.d <= 3 && Math.abs(err) < 0.5);   // преграда в 3 бл. по курсу - не таранить, накатом
        b.setControlState('forward', go);
        b.setControlState('left', turn > 0);
        b.setControlState('right', turn < 0);
        // лодку и лошадь ведёт rideTick по клавишам и взгляду (mechanics.js horseTick); прочее - по-старому
        if (!boat && !/horse|donkey|mule|camel|^pig$|strider|llama/.test(b.vehicle.name || '')) { try { b.moveVehicle(turn, go ? 1 : 0); } catch {} }
        await sleep(100);
      }
    } finally { b.clearControlStates(); try { b.moveVehicle(0, 0); } catch {} this.busyLook = false; }
    const v = b.vehicle ? b.vehicle.position : b.entity.position;
    return `доплыл/доехал до ${Math.floor(v.x)} ${Math.floor(v.z)}`;
  }

  /** Выбросить всё (и броню, и вторую руку), кроме keep: «выкинь всё, я тебя переодену». */
  async discardAll(a) {
    const b = this.bot;
    const keep = String(a.keep || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const kept = (n) => keep.some((k) => n.includes(k));
    for (const slot of ['head', 'torso', 'legs', 'feet', 'off-hand']) { try { await b.unequip(slot); await sleep(150); } catch {} }
    let n = 0;
    for (const it of b.inventory.items()) {
      if (kept(it.name)) continue;
      try { await b.tossStack(it); n += it.count; await sleep(120); } catch {}
    }
    this.handsAt = Date.now() + 120000;
    return n ? `выбросил всё (${n} шт.)${keep.length ? ', оставил ' + keep.join(', ') : ''}` : 'выбрасывать нечего';
  }

  /**
   * Дуэль с игроком: только по приказу хозяина (проверяет мозг), честным боем guard, не дольше 60 с;
   * своё здоровье 6 и меньше - сдаюсь. На !stop - сразу конец.
   */
  async duel(a, tok) {
    const b = this.bot, t = this.player(a.who);
    if (!t) throw new Error(`не вижу ${a.who} рядом`);
    if (!this.guard) throw new Error('бой выключен');
    const was = this.guard.mode; if (was === 'off') this.guard.mode = 'defend';
    this.guard.prey = t.id;
    const until = Date.now() + 60000;
    let why = 'время вышло';
    try {
      while (Date.now() < until) {
        this.check(tok);
        if (!t.isValid) { why = 'соперник выбыл'; break; }
        if (b.health <= 6) { why = 'у меня мало здоровья - сдаюсь'; break; }
        if (t.position.distanceTo(b.entity.position) > 2.5) { try { await this.goto(new goals.GoalFollow(t, 2), tok, 4000); } catch (e) { if (isCancel(e)) throw e; } }
        await sleep(250);
      }
    } finally { this.guard.prey = null; this.guard.mode = was; try { b.pathfinder.setGoal(null); } catch {} }
    return `дуэль с ${a.who} окончена: ${why}`;
  }

}

module.exports = { Vehicles };
