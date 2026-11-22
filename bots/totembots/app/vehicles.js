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
    const b = this.bot, me = b.entity.position, RIDE = RIDE_RE;
    if (b.vehicle) return 'уже сижу';
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
      b._client.write('use_entity', { target: t.id, mouse: 2, sneaking: false, hand: 0, x: hit.x, y: hit.y, z: hit.z });
      b._client.write('use_entity', { target: t.id, mouse: 0, sneaking: false, hand: 0 });
      b.swingArm('right');
    } catch (e) { this.log('клик по существу: ' + e.message); }
    q.res();
  }

  /** Поставить свою лодку на воду или лёд рядом (как игрок: лодка в руке, правый клик по блоку). */
  async placeBoat(tok) {
    const b = this.bot;
    const it = b.inventory.items().find((i) => /_boat$|_raft$/.test(i.name) && !/chest/.test(i.name)) || b.inventory.items().find((i) => /_boat$|_raft$/.test(i.name));
    if (!it) return null;
    const me = b.entity.position;
    const spot = b.findBlocks({ matching: (bl) => /^(water|ice|packed_ice|blue_ice)$/.test(bl.name), maxDistance: 4, count: 30 }).map((p) => b.blockAt(p))
      .filter((k) => { const up = b.blockAt(k.position.offset(0, 1, 0)); return up && up.boundingBox === 'empty' && !/water/.test(up.name); })
      .sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me))[0];
    if (!spot) throw new Error('лодку ставить некуда: рядом нет воды или льда');
    this.check(tok);
    await b.equip(it, 'hand');
    this.busyLook = true;
    try { await b.lookAt(spot.position.offset(0.5, 1, 0.5), true); await b.placeEntity(spot, new Vec3(0, 1, 0)); } finally { this.busyLook = false; }
    await sleep(400);
    const e = Object.values(b.entities).filter((x) => /boat|raft/.test(x.name || '') && x.position.distanceTo(spot.position) < 3).sort((x, y) => x.position.distanceTo(spot.position) - y.position.distanceTo(spot.position))[0];
    if (e) this.log(`поставил лодку на ${spot.position.x} ${spot.position.y} ${spot.position.z}`);
    return e || null;
  }

  async dismount() {
    const b = this.bot;
    if (!b.vehicle) return 'я ни на чём не сижу';
    const was = b.vehicle;
    try { b.dismount(); } catch {}
    try { if (was && /boat|raft/.test(was.name || '')) this.autoMark('моя лодка', was.position, { kind: 'моя лодка', one: true, ttl: 3 * 86400000 }); } catch {}
    for (let w = 0; w < 20 && b.vehicle; w++) await sleep(100);
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
    const b = this.bot, v = b.vehicle, R = this._ride;
    if (!v || !R) { this.rideStop(); return; }
    const c = (k) => !!b.getControlState(k);
    const ps = v.passengers || [];
    const driver = /boat|raft/.test(v.name || '') && (!ps.length || ps[0] === b.entity);
    try { b._client.write('player_input', { inputs: { forward: c('forward'), backward: c('back'), left: c('left'), right: c('right'), jump: false, shift: false, sprint: false } }); } catch {}
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
    try { b._client.write('tick_end', {}); } catch {}
  }

  async drive(a, tok) {
    const b = this.bot;
    if (!b.vehicle) throw new Error('я ни на чём не сижу - сначала !mount');
    // рулит тот, кто сел первым (так в игре): пассажир править не может (22.11: Loki сел к хозяину и «плыл» на месте)
    const ps = b.vehicle.passengers || [];
    if (ps.length && ps[0] !== b.entity) { const d = ps[0]; throw new Error(`рулит ${d.username || d.name || 'другой'}: я пассажир, править не могу - пусть рулит он, или он пересядет, и я сяду первым`); }
    const x = +a.x, z = +a.z;
    if (!isFinite(x) || !isFinite(z)) throw new Error('куда? нужны x и z');
    const boat = /boat|raft/.test(b.vehicle.name || '');
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
        if (this._ride && this._ride.blockedAt && Date.now() - this._ride.blockedAt > 1500) { const left = Math.round(d); b.clearControlStates(); return `упёрлась в берег или стену в ${left} бл. от цели - дальше по воде не проплыть`; }
        const want = Math.atan2(-(x - v.x), -(z - v.z));
        await b.look(want, 0, true);
        let err = want - (b.vehicle.yaw || 0); while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
        // курс лодки считаем сами (rideTick): ошибка за 2 с выросла - поворачиваем в другую сторону (страховка знака)
        // курс лодки считаем сами (rideTick), знак поворота известен - без «переворотов», от них лодка петляла и тормозила
        if (!boat && Date.now() - errAt > 2000) { if (lastErr !== null && Math.abs(err) > Math.abs(lastErr) + 0.2) flip = -flip; lastErr = err; errAt = Date.now(); }
        const turn = boat && Math.abs(err) > 0.25 ? Math.sign(err) * flip : 0;
        const go = !boat || Math.abs(err) < 1.6;   // вперёд и на повороте, как игрок, - без остановок
        b.setControlState('forward', go);
        b.setControlState('left', turn > 0);
        b.setControlState('right', turn < 0);
        if (!boat) { try { b.moveVehicle(turn, go ? 1 : 0); } catch {} }   // лодку ведёт rideTick по клавишам
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
