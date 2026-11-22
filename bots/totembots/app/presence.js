// Присутствие компаньона (22.11, второй проход по докладу о Серане, Fallout 4, Иниго, Элизабет, Элли). Всё - тело,
// без нейросети. В Minecraft нет анимаций для NPC, поэтому «видимость» жизни делается тем, что клиент игрока и так
// показывает: предмет в руке (книга у кафедры, удочка у воды, пшеница у овец - овцы сами идут следом, подзорная
// труба на высоте), открывающаяся крышка своего сундука, позы GSit (сидеть, лежать), присед, взгляд, частицы еды.
//
//  - Симпатия (Fallout 4, скрытые счётчики Сераны): к каждому игроку число от -100 до 100 по делам - подарил,
//    ударил оружием, насмехался, помог. Влияет на ответные жесты; мозгу - одним словом в [встреча] и [жест].
//  - Тихий шаг (Элли): хозяин крадётся (присед дольше секунды) - бот тоже крадётся следом.
//  - Личное пространство (жалоба на Серану в дверях): хозяин вплотную идёт на бота - шаг в сторону.
//  - Помощь вовремя (Элизабет бросает аптечки): у хозяина мало здоровья, а у бота есть еда - бросить ему.
//  - Комментарии к месту и виду (Иниго, Люсьен): Незер, Энд, пещера, океан, пустыня, снег; новая броня хозяина.
//  - Свои сундуки дома: без дел заглянуть (крышка открывается - видно со стороны; заодно бот узнаёт, что там).
//  - Отдых дома (Followers Can Relax): ночью без дел в своём доме - иногда присесть (/sit, на сервере работает только он), встать - присед.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// предмет в руку к занятию (что видно со стороны)
const PROP = [
  [/книг/, /^(writable_book|written_book|book|enchanted_book|filled_map|map)$/],
  [/костр|печ/, 'food'],
  [/варочн/, /^(glass_bottle|potion|splash_potion)$/],
  [/верстак|наковальн/, /_pickaxe$|_axe$|_shovel$|_hoe$|^shears$/],
  [/рыбач/, /^fishing_rod$/],
];
const PET_FOOD = { sheep: /^wheat$/, cow: /^wheat$/, goat: /^wheat$/, mooshroom: /^wheat$/, pig: /^(carrot|potato|beetroot)$/, chicken: /_seeds$/, horse: /^(golden_carrot|apple|sugar|hay_block)$/, donkey: /^(golden_carrot|apple|sugar|hay_block)$/, llama: /^(hay_block|wheat)$/, wolf: /^bone$/, cat: /^(cod|salmon)$/, rabbit: /^(carrot|dandelion)$/, fox: /^sweet_berries$/, bee: /dandelion|poppy|tulip|orchid|allium|daisy|cornflower|bluet/, turtle: /^seagrass$/, frog: /^slime_ball$/, axolotl: /bucket_of_tropical_fish/, camel: /^cactus$/, armadillo: /^spider_eye$/ };
const PLACE_BARK = {
  nether: ['жарко тут... держись подальше от лавы', 'Незер. смотри под ноги'],
  end: ['Энд... тут эндермены, не смотри им в глаза', 'тихо тут как-то'],
  cave: ['темно. под ногами осторожней', 'пещера... слышишь?'],
  ocean: ['вода кругом', 'море!'],
  desert: ['пустыня, жара', 'песок кругом'],
  snow: ['холодно...', 'снег!'],
  armor: ['о, новая броня?', 'красиво смотрится'],
  owner_hurt: ['держи, поешь', 'на, подлечись'],
};
const TIER = ['leather', 'golden', 'chainmail', 'copper', 'iron', 'diamond', 'netherite'];

class Presence {
  // ---------- симпатия
  affinity(name) { const A = (this.memory && this.memory.data.affinity) || {}; return (A[String(name).toLowerCase()] || {}).v || 0; }
  affinityAdd(name, dv, why) {
    if (!name || !this.memory) return;
    const A = (this.memory.data.affinity = this.memory.data.affinity || {}), k = String(name).toLowerCase();
    const e = (A[k] = A[k] || { v: 0, at: 0, last: '' });
    e.v = Math.max(-100, Math.min(100, e.v + dv)); e.at = Date.now(); e.last = why;
    const ks = Object.keys(A); if (ks.length > 200) for (const x of ks.sort((a, c) => A[a].at - A[c].at).slice(0, ks.length - 200)) delete A[x];
    if (Date.now() - (this.affSavedAt || 0) > 30000) { this.affSavedAt = Date.now(); this.memory.save(); }
  }
  affinityWord(name) { const v = this.affinity(name); return v >= 40 ? 'тёплое' : v >= 10 ? 'доброе' : v <= -30 ? 'плохое' : v <= -10 ? 'настороженное' : 'нейтральное'; }

  /** Раз в секунду из companionTick. */
  presenceTick(owner, now) {
    const b = this.bot, P = (this.pres = this.pres || { place: '', armor: '', helpAt: 0 });
    this.stealthTick(owner);
    this.spaceTick(owner, now);
    this.helpTick(owner, now, P);
    this.placeTick(owner, now, P);
    this.formationTick(owner, now);
    this.comfortTick(owner, now);
    this.ownerEventsTick(owner, now, P);
    this.socialTick(owner, now, P);
    if (this.pose && (this.mode !== 'idle' || owner || (this.threat && this.threat().level !== 'спокойно') || now > this.pose.until)) this.poseEnd();
    void b;
  }

  /**
   * Строй (как спутники в RPG и Элли): идти не впереди хозяина и не на линии его взгляда, а сзади-сбоку. Если бот
   * оказался впереди него по ходу (мешает смотреть, лезет под стрелы) - отойти за плечо.
   */
  formationTick(owner, now) {
    const b = this.bot;
    if (!owner || this.mode !== 'follow' || this.sandbox || this.seat || now - (this.formAt || 0) < 700) return;
    const v = owner.velocity || { x: 0, z: 0 }, sp = Math.hypot(v.x, v.z);
    if (sp < 0.08) { if (this.post) { this.post = null; try { b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); } catch {} } return; }   // хозяин стоит - обычное следование и занятия
    this.formAt = now;
    const post = this.pickPost(owner, v, sp);
    if (!post) { if (this.post) { this.post = null; try { b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); } catch {} } return; }   // поста нет (тесно) - просто следом
    // гистерезис: менять пост, только если новый заметно лучше или старый стал плох (иначе бот мечется)
    if (this.post && this.post.ok && post.score < this.post.score + 1.5 && now - this.post.at < 4000) {
      const P = this.post; P.x += post.dx; P.z += post.dz;   // пост едет вместе с хозяином
    } else this.post = { ...post, at: now, ok: true };
    const P = this.post;
    try { b.pathfinder.setGoal(new goals.GoalNear(P.x, P.y, P.z, 1)); } catch {}
  }

  /**
   * Пост для следования (как у напарников в Uncharted 4 и The Last of Us): веер мест вокруг хозяина, каждое проходит
   * три проверки прохода - от хозяина до места, от места до точки впереди по ходу, от неё обратно к хозяину (так
   * пост не за стеной и не за обрывом). Очки: сзади-сбоку лучше, чем впереди; ближе к нынешнему месту бота лучше
   * (меньше бегать); на удобной дистанции. Возвращает { x, y, z, score, dx, dz } или null.
   */
  pickPost(owner, v, sp) {
    const b = this.bot, o = owner.position, me = b.entity.position;
    const fx = v.x / sp, fz = v.z / sp, R = Math.max(2, this.followDist ? this.followDist() : 3);
    const ahead = { x: o.x + fx * 4, z: o.z + fz * 4 };
    const clear = (x0, z0, x1, z1, y) => {   // прямой проход по клеткам: везде можно стоять (на 1 бл. вверх-вниз)
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.7);
      let yy = y;
      for (let i = 1; i <= n; i++) {
        const x = Math.floor(x0 + (x1 - x0) * i / n), z = Math.floor(z0 + (z1 - z0) * i / n);
        let okk = false;
        for (const dy of [0, 1, -1]) if (this.standOk && this.standOk(x, yy + dy, z)) { yy += dy; okk = true; break; }
        if (!okk) return null;
      }
      return yy;
    };
    let best = null;
    for (let i = 0; i < 12; i++) {
      const ang = Math.PI * (0.55 + i / 11 * 0.9);   // от «сбоку» через «сзади» к другому боку (без переднего сектора)
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = fx * ca - fz * sa, dz = fz * ca + fx * sa;
      const px = o.x + dx * R, pz = o.z + dz * R, y0 = Math.floor(o.y + 0.01);
      const y1 = clear(o.x, o.z, px, pz, y0); if (y1 === null) continue;
      if (clear(px, pz, ahead.x, ahead.z, y1) === null) continue;
      if (clear(ahead.x, ahead.z, o.x, o.z, y1) === null) continue;
      if (this.harmlessSpot && !this.harmlessSpot(Math.floor(px), y1, Math.floor(pz))) continue;
      const behind = -(dx * fx + dz * fz);   // 1 - прямо сзади, 0 - сбоку
      const score = behind * 2 + (1 - Math.min(1, Math.hypot(px - me.x, pz - me.z) / 8)) * 2;
      if (!best || score > best.score) best = { x: Math.floor(px) + 0.5, y: y1, z: Math.floor(pz) + 0.5, score, dx: fx * sp * 14, dz: fz * sp * 14 };
    }
    return best;
  }

  /**
   * Общение по своей воле (Серана сама заводит разговор, лагерь в BG3, перки симпатии в Fallout 4) - редко и к месту:
   *  - хозяин рядом стоит 40+ с, тихо, 25+ мин не говорили по её почину - повод поговорить (мозгу, он и решит, о чём);
   *  - вечер дома рядом с хозяином - раз за ночь вспомнить день;
   *  - симпатия к хозяину 40+ - раз в сутки маленький подарок (цветок), если есть;
   *  - хозяин стоит 5+ мин без движения - «ты тут?» (раз за такую паузу).
   */
  socialTick(owner, now, P) {
    const b = this.bot, C = this.comp;
    if (!owner || !C || this.mode !== 'follow' || (this.threat && this.threat().level !== 'спокойно') || owner.position.distanceTo(b.entity.position) > 10) return;
    const still = now - (C.stillSince || now);
    if (still > 5 * 60000 && !P.afkSaid) { P.afkSaid = true; try { this.say('ты тут?', 'local'); } catch {} return; }
    if (still < 5000) P.afkSaid = false;
    if (still > 40000 && still < 5 * 60000 && now - (P.talkAt || 0) > 25 * 60000 && now - (C.barkAt || 0) > 120000) {
      P.talkAt = now;
      this.event(`повод поговорить: ${owner.username} рядом, вы давно молчите. Можно самой заговорить коротко и по-живому: спросить, как дела, вспомнить недавнее, рассказать, что видела, предложить дело. Не обязательно - если нечего сказать, промолчи`, true);
      return;
    }
    const t = b.time && b.time.timeOfDay, h = require('./life').home(this);
    const atHome = h && h.dim === this.dimName() && Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) < 16;
    const day = Math.floor((b.time && b.time.age || 0) / 24000);
    if (atHome && t > 12500 && t < 14000 && P.eveningDay !== day && still > 10000) {
      P.eveningDay = day;
      this.event('вечер дома с хозяином: можно коротко вспомнить день (что было, что получилось) и сказать, что завтра. Одной-двумя фразами', true);
      return;
    }
    if (this.affinity(owner.username) >= 40 && now - (P.giftAt || 0) > 24 * 3600000 && still > 8000) {
      const f = b.inventory.items().find((i) => /^(poppy|dandelion|cornflower|allium|azure_bluet|oxeye_daisy|lily_of_the_valley|.*_tulip|blue_orchid|sunflower|peony|rose_bush|lilac)$/.test(i.name));
      if (f && !this.busyLook) {
        P.giftAt = now;
        (async () => { this.busyLook = true; try { await b.lookAt(owner.position.offset(0, 1.2, 0), true); await b.toss(f.type, null, 1); this.log('подарила хозяину ' + f.name); try { this.say('это тебе', 'local'); } catch {} } catch {} finally { this.busyLook = false; } })();
      }
    }
  }

  /**
   * Удобная дистанция: в доме, пещере, тесном проходе и при опасности - ближе (-1); на открытом месте днём и когда
   * хозяин бежит - дальше (+1); много людей вокруг - чуть ближе. Меняется - путь следом перестраивается сразу.
   */
  comfortShift() {
    const b = this.bot, owner = this.followName ? this.player(this.followName) : null;
    if (!b || !b.entity) return 0;
    let k = 0;
    try {
      const head = b.blockAt(b.entity.position.offset(0, 2, 0)), sky = b.blockAt(b.entity.position.offset(0, 1, 0));
      const roofed = (head && head.boundingBox === 'block') || (sky && (sky.skyLight || 0) < 8);
      if (roofed) k -= 1;
      if (this.threat && this.threat().level !== 'спокойно') k -= 1;
      const v = owner && owner.velocity ? Math.hypot(owner.velocity.x, owner.velocity.z) : 0;
      if (!roofed && v > 0.2) k += 1;
      const crowd = Object.values(b.players).filter((p) => p.entity && p.entity !== b.entity && p.entity.position.distanceTo(b.entity.position) < 8).length;
      if (crowd >= 3) k -= 0.5;
    } catch {}
    return Math.max(-1.5, Math.min(1.5, k));
  }
  comfortTick(owner, now) {
    const b = this.bot;
    if (!owner || this.mode !== 'follow' || this.sandbox || this.seat || now - (this.comfAt || 0) < 2000) return;
    const k = this.comfortShift();
    if (this.comfK === undefined || Math.abs(k - this.comfK) >= 0.5) {
      this.comfK = k; this.comfAt = now;
      const g = b.pathfinder.goal;
      if (g && g.constructor && g.constructor.name === 'GoalFollow') try { b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); } catch {}
    }
  }

  /**
   * Что делает хозяин - и бот рядом по-живому, без нейросети:
   *  - лёг спать ночью - тоже идёт спать (ночь пропускается быстрее, если спят все);
   *  - открыл сундук - бот не подглядывает: отводит взгляд по сторонам;
   *  - рыбачит (поплавок рядом) - присесть рядом (/sit) и смотреть на поплавок;
   *  - погиб - сказать «ой!», встать у места его смерти и ждать его там (вещи не брать).
   */
  ownerEventsTick(owner, now, P) {
    const b = this.bot;
    if (!this.ownerHooked && b) {
      this.ownerHooked = true;
      b.on('entitySleep', (e) => { try { if (e && e.username && e.username === this.followName && this.mode === 'follow' && this.goSleep && !b.isSleeping) { this.log('хозяин лёг спать - иду спать тоже'); this.goSleep(this.token).catch(() => {}); } } catch {} });
      b.on('chestLidMove', (bl, open) => { try { const o = this.followName && this.player(this.followName); if (o && open && bl.position.distanceTo(o.position) < 4) { this.attendUntil = 0; this.lookTarget = b.entity.position.offset(Math.random() * 10 - 5, 1.6, Math.random() * 10 - 5); this.privacyUntil = Date.now() + 4000; } } catch {} });
      b.on('entityDead', (e) => { try { if (e && e.username && e.username === this.followName) { this.ownerDied = { at: Date.now(), pos: e.position.clone() }; this.say('ой!', 'local'); } } catch {} });
    }
    // хозяин погиб: подойти к месту и ждать его там (5 мин), пока не вернётся
    if (this.ownerDied && now - this.ownerDied.at < 300000 && this.mode === 'follow' && !owner && !this.ownerDied.went) {
      this.ownerDied.went = true;
      this.log('хозяин погиб - иду к месту, буду ждать там');
      this.goto(new goals.GoalNear(this.ownerDied.pos.x, this.ownerDied.pos.y, this.ownerDied.pos.z, 2), this.token, 60000).catch(() => {});
    }
    if (owner && this.ownerDied && this.ownerDied.went && owner.position.distanceTo(this.ownerDied.pos) < 10) { this.ownerDied = null; try { this.say('я тут, вещи твои рядом', 'local'); } catch {} }
    // рыбачит: поплавок у хозяина
    if (owner && this.mode === 'follow' && !this.seat && now - (P.fishSitAt || 0) > 120000) {
      const bob = Object.values(b.entities).find((e) => /fishing_bobber/.test(e.name || '') && e.position.distanceTo(owner.position) < 25);
      if (bob && now - (this.comp && this.comp.stillSince || now) > 8000 && this.sitNear) { P.fishSitAt = now; this.lookTarget = bob.position; this.sitNear(owner.position).catch(() => {}); }
    }
  }

  /** Хозяин крадётся (присед дольше секунды, не жест) - красться следом. */
  stealthTick(owner) {
    const b = this.bot;
    const want = !!(owner && this.mode === 'follow' && owner.crouching && !this.seat && !this.gesturing
      && (this.owCrouchAt || (this.owCrouchAt = Date.now())) && Date.now() - this.owCrouchAt > 1200);
    if (!(owner && owner.crouching)) this.owCrouchAt = 0;
    if (want !== !!this.sneaking) { this.sneaking = want; try { b.setControlState('sneak', want); } catch {} if (want) this.log('хозяин крадётся - крадусь следом'); }
  }

  /** Хозяин вплотную идёт прямо на бота - шаг в сторону (не стоять в проходе). */
  spaceTick(owner, now) {
    const b = this.bot;
    if (!owner || this.mode !== 'follow' || this.seat || b.pathfinder.isMoving() || now - (this.stepAsideAt || 0) < 3000) return;
    const d = owner.position.distanceTo(b.entity.position);
    if (d > 1.6 || !this.facing) return;
    const v = owner.velocity || { x: 0, z: 0 }, sp = Math.hypot(v.x, v.z);
    if (sp < 0.05 || this.facing(owner, b.entity.position) < 0.7) return;
    this.stepAsideAt = now;
    // вбок от его пути: перпендикуляр к направлению взгляда
    const fx = -Math.sin(owner.yaw), fz = -Math.cos(owner.yaw), me = b.entity.position;
    for (const s of [1, -1]) {
      const x = Math.floor(me.x + -fz * s * 2), z = Math.floor(me.z + fx * s * 2);
      for (const dy of [0, 1, -1]) if (this.standOk && this.standOk(x, Math.floor(me.y) + dy, z)) { try { b.pathfinder.setGoal(new goals.GoalBlock(x, Math.floor(me.y) + dy, z)); } catch {} setTimeout(() => { try { if (this.mode === 'follow' && owner.isValid !== false) b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); } catch {} }, 1500); return; }
    }
  }

  /** У хозяина мало здоровья, у бота есть еда - бросить ему (раз в 90 с). */
  helpTick(owner, now, P) {
    const b = this.bot;
    if (!owner || now - P.helpAt < 90000 || owner.position.distanceTo(b.entity.position) > 6 || (this.guard && this.guard.fighting)) return;
    const idx = ((b.registry.entitiesByName.player || {}).metadataKeys || []).indexOf('health');
    const hp = idx >= 0 && owner.metadata ? owner.metadata[idx] : null;
    if (typeof hp !== 'number' || hp > 7 || hp <= 0) return;
    const foods = b.registry.foodsByName || {};
    const food = b.inventory.items().filter((i) => foods[i.name] && !/rotten|spider_eye|poison|pufferfish|chorus/.test(i.name))
      .sort((x, y) => (foods[y.name].foodPoints + foods[y.name].saturation) - (foods[x.name].foodPoints + foods[x.name].saturation))[0];
    if (!food || this.busyLook) return;
    P.helpAt = now;
    if (this.moodShift) this.moodShift('play', -0.25, 'хозяин ранен');
    (async () => {
      this.busyLook = true;
      try { await b.lookAt(owner.position.offset(0, 1.2, 0), true); await b.toss(food.type, null, Math.min(food.count, 3)); this.log(`у хозяина ${Math.round(hp)}/20 - бросила ему ${food.name}`); try { this.say(pick(PLACE_BARK.owner_hurt), 'local'); } catch {} }
      catch {} finally { this.busyLook = false; }
    })();
  }

  /** Комментарий к новому месту или новой броне хозяина (тема - раз в 30 мин, общий счётчик реплик - в companion.js). */
  placeTick(owner, now, P) {
    const b = this.bot, C = this.comp;
    if (!owner || !C || owner.position.distanceTo(b.entity.position) > 16 || now - C.barkAt < 240000) return;
    const dim = String(b.game.dimension || '');
    let place = /nether/.test(dim) ? 'nether' : /end/.test(dim) ? 'end' : '';
    if (!place) {
      const sky = b.blockAt(b.entity.position.offset(0, 1, 0));
      if (sky && (sky.skyLight || 0) === 0 && b.entity.position.y < 50) place = 'cave';
      else {
        try { const bl = b.blockAt(b.entity.position); const n = (bl && bl.biome && bl.biome.name) || ''; place = /ocean/.test(n) ? 'ocean' : /desert|badlands/.test(n) ? 'desert' : /snow|frozen|ice/.test(n) ? 'snow' : ''; } catch {}
      }
    }
    const say = (topic) => {
      if (now - (C.topic[topic] || 0) < 30 * 60000) return false;
      C.topic[topic] = now; C.barkAt = now;
      try { this.say(pick(PLACE_BARK[topic]), 'local'); this.log(`сама сказала (${topic})`); } catch {}
      return true;
    };
    if (place && place !== P.place) { P.place = place; if (say(place)) return; }
    if (!place) P.place = '';
    // броня хозяина: лучше прежней
    const arm = (owner.equipment || []).slice(2, 6).filter(Boolean).map((i) => i.name).sort().join(',');
    const tier = (s) => Math.max(-1, ...s.split(',').map((n) => TIER.findIndex((t) => n.startsWith(t + '_'))));
    if (P.armor && arm && arm !== P.armor && tier(arm) > tier(P.armor)) say('armor');
    if (arm) P.armor = arm;
  }

  // ---------- предмет в руке к занятию
  async propOn(sb) {
    const b = this.bot;
    if (sb.propped) return; sb.propped = true;
    let re = null;
    if (sb.ent && PET_FOOD[sb.ent.name]) {
      const pen = this.skills && this.skills.builtNear && (() => { try { return this.skills.builtNear(sb.ent.position.floored(), 8); } catch { return true; } })();
      if (pen) return;   // животное в загоне или у чужой постройки - не выманивать
      re = PET_FOOD[sb.ent.name];
    }
    else { const p = PROP.find(([w]) => w.test(sb.what)); if (p) re = p[1]; }
    if (!re) return;
    const foods = b.registry.foodsByName || {};
    const item = b.inventory.items().find((i) => re === 'food' ? !!foods[i.name] : re.test(i.name));
    if (!item) return;
    sb.prevHeld = b.heldItem ? b.heldItem.name : null;
    try { await b.equip(item, 'hand'); sb.prop = item.name; } catch { return; }
    const crowd = sb.water && Object.values(b.entities).some((e) => e !== b.entity && e.position && e.name !== 'item' && e.type !== 'object' && (e.position.distanceTo(sb.water) < 8 || e.position.distanceTo(b.entity.position) < 3));
    if (sb.prop === 'fishing_rod' && sb.water && !crowd) { try { await b.lookAt(sb.water.offset(0.5, 0.5, 0.5), true); b.activateItem(); sb.cast = Date.now(); } catch {} }
  }
  async propOff(sb) {
    const b = this.bot;
    if (!sb || !sb.prop) return;
    if (sb.cast) { try { b.activateItem(); } catch {} }   // смотать удочку
    try { const prev = sb.prevHeld && b.inventory.items().find((i) => i.name === sb.prevHeld); if (prev) await b.equip(prev, 'hand'); } catch {}
  }

  /** Добавочные точки возможностей: вода (порыбачить, если есть удочка), свой сундук (заглянуть), отдых дома. */
  moreOpportunities(center, r, recent, withOwner) {
    const b = this.bot, out = [];
    const has = (re) => b.inventory.items().some((i) => re.test(i.name));
    if (has(/^fishing_rod$/)) {
      try {
        const w = b.findBlock({ point: center, matching: (bl) => bl.name === 'water', maxDistance: r, useExtraInfo: (bl) => { const up = b.blockAt(bl.position.offset(0, 1, 0)); return up && up.name === 'air'; } });
        if (w && !recent(w.position)) { const spot = this.standNear(w.position.offset(0, 1, 0)); if (spot && !/water/.test((b.blockAt(spot) || {}).name || '')) out.push({ w: 1.5, what: 'рыбачу', hand: false, look: w.position.offset(0.5, 0.5, 0.5), spot, key: w.position, water: w.position }); }
      } catch {}
    }
    if (!withOwner && this.ownChest) {
      try {
        const c = b.findBlocks({ point: center, matching: (bl) => /^(chest|barrel)$/.test(bl.name), maxDistance: r, count: 10 }).find((v) => this.ownChest(v) && !recent(v));
        if (c) { const spot = this.standNear(c); if (spot) out.push({ w: 1, what: 'заглядываю в свой сундук', hand: false, look: c.offset(0.5, 0.5, 0.5), spot, key: c, chest: c }); }
      } catch {}
    }
    // осмотреться (как человек на новом месте): отойти на пару шагов и посмотреть по очереди на интересное вокруг -
    // таблички, двери, верстаки, жителей, животных, даль; без предметов в руке (22.11: «ходила, осматривалась, как будто понимает»)
    if (this.interestPoints) {
      const pts = this.interestPoints(center, 12);
      if (pts.length >= 3) {
        const looks = [];
        for (let i = 0; i < 5 && pts.length; i++) { let t = Math.random() * pts.reduce((s, q) => s + q.w, 0), j = 0; for (; j < pts.length - 1; j++) { t -= pts[j].w; if (t <= 0) break; } looks.push(pts.splice(j, 1)[0]); }
        let spot = null;
        for (let k = 0; k < 12 && !spot; k++) {
          const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 3, x = Math.floor(center.x + Math.cos(a) * d), z = Math.floor(center.z + Math.sin(a) * d);
          for (const dy of [0, 1, -1]) { const y = Math.floor(center.y) + dy; if (this.standOk && this.standOk(x, y, z) && (!this.harmlessSpot || this.harmlessSpot(x, y, z))) { spot = new Vec3(x + 0.5, y, z + 0.5); break; } }
        }
        const named = looks.filter((q) => q.what !== 'вдаль').slice(0, 2).map((q) => String(q.what).replace(/_/g, ' '));
        if (spot && !recent(spot.floored())) out.push({ w: 2.5, what: 'осматриваюсь' + (named.length ? ': ' + named.join(', ') : ''), hand: false, look: looks[0].at, looks: looks.map((q) => q.at), spot, key: spot.floored() });
      }
    }
    // ночью дома без хозяина - иногда присесть (/sit)
    const h = require('./life').home(this), t = b.time && b.time.timeOfDay;
    if (!withOwner && h && h.dim === this.dimName() && Math.hypot(h.x - center.x, h.z - center.z) < 12 && t > 13000 && t < 23000) out.push({ w: 0.6, what: 'присела отдохнуть', hand: false, look: null, spot: b.entity.position.clone(), key: b.entity.position.floored(), lay: true });
    return out;
  }

  /** На месте занятия: особые действия (сундук, поза). */
  async opportunityAct(sb) {
    const b = this.bot;
    if (sb.acted) return; sb.acted = true;
    if (sb.chest) {
      const bl = b.blockAt(sb.chest);
      if (!bl || (this.chestVisible && !this.chestVisible(bl))) return;
      try { await b.lookAt(sb.chest.offset(0.5, 0.5, 0.5), true); const c = await b.openContainer(bl); if (this.noteChest) this.noteChest(sb.chest.x, sb.chest.y, sb.chest.z, c.containerItems()); await sleep(1500 + Math.random() * 1500); c.close(); } catch {}
    }
    if (sb.lay) { try { b.chat('/sit'); this.pose = { kind: 'sit', until: Date.now() + 30000 + Math.random() * 30000 }; } catch {} }
  }
  poseEnd() { const b = this.bot; this.pose = null; try { b.setControlState('sneak', true); setTimeout(() => { try { b.setControlState('sneak', false); } catch {} }, 300); } catch {} }
}

module.exports = { Presence, PET_FOOD };
