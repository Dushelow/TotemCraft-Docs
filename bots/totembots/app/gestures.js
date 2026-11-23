// Язык тела без чата (22.11, по исследованию владельца: как игроки Minecraft «говорят» движениями). Тело само узнаёт
// жесты и их связки у игроков рядом и отвечает своими - без нейросети; мозгу уходит только смысл («кивнул: да»,
// «показал на сундук», «зовёт за собой»), и только то, о чём есть что решать.
//
// Что видно у игрока (ванильный клиент): присед, прыжок, взмах рукой, поворот головы (кивок, мотание, кружение),
// что в руке, броня, выброшенный рядом предмет, подошёл или ушёл, сел (GSit: ступеньки и нижние полублоки,
// подушки 26.3). Смысл зависит от обстановки: двойной присед - привет, после боя - «без обид», над убитым - насмешка.
//
// Сидение (сервер TotemCraft): на сервере работает только /sit (GSit сажает на блок под ногами), встать - присесть;
// поэтому бот встаёт на нижнюю ступеньку или полублок и пишет /sit; подушка (26.3) - щелчок по ней (ванилла).
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIN = 3000;   // окно «фразы»: связка движений за 3 с
const WEAPON = /_sword$|_axe$|^bow$|^crossbow$|^trident$|^mace$|_spear$/;
const SEAT = /_stairs$|_slab$/;

class Gestures {
  /** Подключить (из bot.js при входе): события игроков + выборка положения раз в 2 тика. */
  gesturesAttach(bot) {
    this.gx = new Map();   // ник -> { s: [{t,x,y,z,yaw,pitch}], crouch: [t], swing: [t], said: {вид: t}, held, armor, near }
    const get = (e) => {
      if (!e || e.type !== 'player' || !e.username || e === bot.entity) return null;
      let g = this.gx.get(e.username);
      if (!g) this.gx.set(e.username, g = { s: [], crouch: [], swing: [], said: {}, held: null, armor: null });
      return g;
    };
    bot.on('entityCrouch', (e) => { const g = get(e); if (g) { g.crouch.push(Date.now()); if (g.crouch.length > 10) g.crouch.shift(); } });
    bot.on('entitySwingArm', (e) => { const g = get(e); if (g) { g.swing.push(Date.now()); if (g.swing.length > 10) g.swing.shift(); } });
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const p = Object.values(bot.players).map((x) => x.entity).filter((x) => x && x !== bot.entity && x.position.distanceTo(bot.entity.position) < 4.5)
        .sort((a, c) => a.position.distanceTo(bot.entity.position) - c.position.distanceTo(bot.entity.position))[0];
      if (p) { const g = get(p); if (g) { g.hitAt = Date.now(); g.hitEmpty = !p.heldItem; } this.pvpAt = Date.now(); if (p.heldItem && this.affinityAdd) this.affinityAdd(p.username, -5, 'ударил оружием'); if (p.heldItem && this.moodShift) this.moodShift('open', -0.3, 'ударили'); }
    });
    bot.on('entityDead', (e) => { if (e && e.position) this.deadAt = { t: Date.now(), pos: e.position.clone(), player: e.type === 'player' }; });
    // копает или строит - взмахи и кивки не жесты (ломание виден по трещинам, стройка - новый блок рядом с ним)
    bot.on('blockBreakProgressObserved', (bl, st, e) => { const g = get(e); if (g) g.digAt = Date.now(); });
    bot.on('blockUpdate', (o, n) => {
      if (!n || n.boundingBox !== 'block' || (o && o.boundingBox === 'block')) return;
      for (const pl of Object.values(bot.players)) { const p = pl.entity; if (p && p !== bot.entity && p.position.distanceTo(n.position) < 5.5) { const g = get(p); if (g) g.buildAt = Date.now(); } }
    });
    bot.on('itemDrop', (e) => {
      // предмет появился рядом с игроком, который смотрит на бота, - вероятно, подарок
      setTimeout(() => {
        if (!e || !e.position || !bot.entity) return;
        for (const pl of Object.values(bot.players)) {
          const p = pl.entity;
          if (!p || p === bot.entity || p.position.distanceTo(e.position) > 2.5 || p.position.distanceTo(bot.entity.position) > 8) continue;
          const g = get(p); if (g && this.facing(p, bot.entity.position) > 0.8) { g.dropN = g.dropAt && Date.now() - g.dropAt < 3000 ? (g.dropN || 1) + 1 : 1; g.dropAt = Date.now(); }
        }
      }, 300);
    });
    let n = 0;
    bot.on('physicsTick', () => {
      if (++n % 2 || !bot.entity) return;
      try { this.gestureSample(bot); } catch (e) { if (this.fault) this.fault('жесты', e); }
    });
  }

  /** Насколько игрок p смотрит на точку to: 1 - прямо, 0 - вбок, -1 - спиной. */
  facing(p, to) {
    const dx = to.x - p.position.x, dz = to.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    return (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / l;
  }

  gestureSample(bot) {
    const now = Date.now(), me = bot.entity.position;
    for (const pl of Object.values(bot.players)) {
      const p = pl.entity;
      if (!p || p === bot.entity || p.position.distanceTo(me) > 16) continue;
      const g = this.gx.get(pl.username) || (this.gx.set(pl.username, { s: [], crouch: [], swing: [], said: {}, held: null, armor: null }), this.gx.get(pl.username));
      g.s.push({ t: now, x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch, ground: p.onGround !== false });
      while (g.s.length && now - g.s[0].t > 4000) g.s.shift();
      const held = p.heldItem ? p.heldItem.name : '';
      if (g.held !== null && held !== g.held) { g.heldPrev = g.held; g.heldAt = now; }
      g.held = held;
      const armor = (p.equipment || []).slice(2, 6).filter(Boolean).length;
      if (g.armor !== null && armor < g.armor) g.armorOffAt = now;
      if (g.armor !== null && armor > g.armor) g.armorOnAt = now;
      g.armor = armor;
      g.sitting = !!p.vehicle;
      if (g.sitting && !g.satAt) g.satAt = now; else if (!g.sitting) g.satAt = 0;
      const k = this.readGesture(pl.username, g, p, now) || this.readFollowMe(pl.username, g, p, now);
      if (k) this.onGesture(pl.username, k, p, now);
    }
  }

  /**
   * Узнать «фразу» по следу за 3 с. Возвращает { kind, text, at? } или null. Одно и то же - не чаще раза в 4 с.
   * Те же движения бывают и обычной игрой (22.11, владелец: «не всё жест, это породит ошибки»), поэтому жест
   * засчитывается только в «спокойной» обстановке: игрок стоит (не идёт, не бежит), на земле, не на краю блока, не
   * копает и не строит, не в бою, бот его видит, и он обращён к боту. Иначе - не жест, бот только посмотрит.
   *   присед - строит мостом у края, спускается по лестнице, ставит блок на сундук, прячет ник; двойной - только стоя
   *   кивок - копает, ставит блоки, смотрит под ноги; - только без взмахов рукой и лицом к боту
   *   мотание - целится в бою, оглядывается; - только без врагов рядом и лицом к боту в начале и в конце
   *   прыжки - бег с прыжками, столб из блоков; - только на месте и на одной высоте
   *   взмах - копает, бьёт моба; - только если ничего не ломается и перед ним нет моба
   *   бросил предмет - чистит инвентарь, умер; - только 1-3 штуки, вплотную, лицом к боту
   */
  readGesture(name, g, p, now) {
    const b = this.bot, me = b.entity.position, d = p.position.distanceTo(me), look = this.facing(p, me);
    const once = (kind, text, extra = {}) => { if (now - (g.said[kind] || 0) < 4000) return null; g.said[kind] = now; return { kind, text, ...extra }; };
    const recent = (arr, ms = WIN) => arr.filter((t) => now - t < ms).length;
    const s = g.s.filter((x) => now - x.t < 1600), w = g.s.filter((x) => now - x.t < WIN);
    if (d > 12 || w.length < 4) return g.sitting && g.satAt && now - g.satAt > 1500 && now - g.satAt < 3000 && d < 16 ? once('сел', 'сел отдохнуть') : null;
    // обстановка
    const moved = Math.hypot(w[w.length - 1].x - w[0].x, w[w.length - 1].z - w[0].z);
    const still = moved < 0.8;
    const busyHands = (g.digAt && now - g.digAt < 4000) || (g.buildAt && now - g.buildAt < 4000);
    const foes = Object.values(b.entities).some((e) => e.position && e !== b.entity && e.type !== 'player' && e.type !== 'object' && this.guard && this.guard.isHostile(e) && e.position.distanceTo(p.position) < 10);
    const fight = foes || (this.pvpAt && now - this.pvpAt < 5000 && !(g.hitAt && now - g.hitAt < 5000));
    const seen = this.seesEntity ? this.seesEntity(p) : true;
    const edge = (() => { try { let air = 0; for (const [ox, oz] of [[0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]) { const k = b.blockAt(p.position.offset(ox, -0.5, oz)); if (!k || k.boundingBox === 'empty') air++; } return air > 0; } catch { return false; } })();
    const climbing = (() => { try { const k = b.blockAt(p.position); return k && /ladder|vine|scaffolding|water|lava/.test(k.name); } catch { return false; } })();
    if (g.sitting && g.satAt && now - g.satAt > 1200 && now - g.satAt < 4000) return once('сел', 'сел отдохнуть');
    const calm = still && seen && !busyHands && !fight && !climbing && !p.vehicle && !p.elytraFlying;
    // спор после стычки и насмешка - смысл по обстановке
    const crouches = recent(g.crouch, 2500);
    const deadPl = this.deadAt && this.deadAt.player && now - this.deadAt.t < 20000 && this.deadAt.pos.distanceTo(p.position) < 3;
    if (crouches >= 3 && deadPl && still) return once('насмешка', 'приседает над убитым игроком (насмешка)');
    if (!calm) return null;
    if (crouches >= 2 && !edge && look > 0.5) {
      if (this.pvpAt && now - this.pvpAt < 30000 && g.hitAt && now - g.hitAt < 30000) return once('без обид', 'приседает после стычки: «без обид, хорошая игра»');
      return once('привет', 'приседает тебе: «привет, я свой»');
    }
    const noSwing = recent(g.swing, 1600) === 0;
    // кивок / мотание: 2+ смены направления, размах, лицом к боту, без взмахов рукой
    const swings = (key, amp) => {
      let dir = 0, flips = 0, lo = Infinity, hi = -Infinity;
      for (let i = 1; i < s.length; i++) {
        let dv = s[i][key] - s[i - 1][key];
        if (key === 'yaw') { while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; }
        if (Math.abs(dv) < 0.04) continue;
        const nd = Math.sign(dv); if (dir && nd !== dir) flips++; dir = nd;
        lo = Math.min(lo, s[i][key]); hi = Math.max(hi, s[i][key]);
      }
      return flips >= 3 && hi - lo > amp && hi - lo < 1.3;
    };
    // всё время смотрит в сторону бота (осматривается - взгляд уходит в сторону и не возвращается)
    const faceAll = s.length > 4 && s.every((x) => this.facing({ position: p.position, yaw: x.yaw }, me) > 0.55);
    const yawSpan = (() => { let lo = Infinity, hi = -Infinity; for (const x of s) { let dv = x.yaw - s[0].yaw; while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; lo = Math.min(lo, dv); hi = Math.max(hi, dv); } return hi - lo; })();
    const pitchSpan = s.length ? Math.max(...s.map((x) => x.pitch)) - Math.min(...s.map((x) => x.pitch)) : 0;
    if (s.length > 4 && look > 0.75 && faceAll && noSwing && yawSpan < 0.35 && swings('pitch', 0.45)) return once('да', 'кивнул: «да»');
    let tot = 0; for (let i = 1; i < s.length; i++) { let dv = s[i].yaw - s[i - 1].yaw; while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; tot += dv; }
    if (Math.abs(tot) > 5.5 && d < 10) return once('кружится', 'кружится на месте (радуется или дурачится)');
    const faceStart = s.length ? this.facing({ position: p.position, yaw: s[0].yaw }, me) : 0;
    if (s.length > 4 && look > 0.6 && faceStart > 0.6 && faceAll && noSwing && pitchSpan < 0.35 && swings('yaw', 0.5)) return once('нет', 'мотает головой: «нет»');
    // прыжки на месте и на одной высоте (не бег, не столб из блоков)
    let jumps = 0; for (let i = 1; i < w.length; i++) if (w[i].y - w[i - 1].y > 0.25 && w[i - 1].ground) jumps++;
    const gy = w.filter((x) => x.ground).map((x) => x.y);
    if (jumps >= 2 && gy.length >= 2 && Math.max(...gy) - Math.min(...gy) < 0.3 && look > 0.3) return once('радость', 'прыгает на месте (радуется)');
    if (g.hitAt && now - g.hitAt < 1500 && g.hitEmpty) return once('тычок', 'ткнул тебя рукой: «эй, обрати внимание»');
    if (g.dropAt && now - g.dropAt < 2000 && (g.dropN || 1) <= 3 && d < 5 && look > 0.7) return once('подарок', 'бросил тебе предмет (подарок?)');
    if (g.armorOffAt && now - g.armorOffAt < 2000 && look > 0.7 && !(g.armorOnAt && now - g.armorOnAt < 5000)) return once('мир', 'снял броню: мирные намерения');
    // предмет в руке: держит 1,5+ с, а не листает хотбар
    if (g.heldAt && now - g.heldAt > 1500 && now - g.heldAt < 3000 && look > 0.8) {
      if (WEAPON.test(g.held || '') && d < 8) return once('оружие', `держит ${g.held} и смотрит на тебя`);
      if (WEAPON.test(g.heldPrev || '') && !g.held) return once('убрал оружие', 'убрал оружие: «я не нападу»');
      if (/flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose/.test(g.held || '')) return once('цветок', 'держит цветок и смотрит на тебя');
    }
    // взмах: блок не ломается, перед ним нет моба; один-три взмаха
    const sw = recent(g.swing, 1200);
    if (sw >= 1 && sw <= 3) {
      try {
        const eye = p.position.offset(0, 1.62, 0), dir = new Vec3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
        const mob = Object.values(b.entities).some((e) => e !== p && e !== b.entity && e.position && e.position.distanceTo(eye) < 4.5 && this.facing(p, e.position) > 0.9);
        if (!mob) {
          const hit = b.world.raycast(eye, dir, 8);
          // показал: незадолго до этого смотрел на бота (позвал взглядом), блок дальше вытянутой руки - не копает
          const lookedAtMe = w.some((x) => this.facing({ position: p.position, yaw: x.yaw }, me) > 0.85);
          if (hit && hit.position && hit.position.distanceTo(eye) > 4.6 && look < 0.7 && lookedAtMe) return once('указал', `показал на ${hit.name} ${hit.position.x} ${hit.position.y} ${hit.position.z}`, { at: hit.position });
          if (look > 0.85 && d < 8 && (!hit || hit.position.distanceTo(eye) > 4.6)) return once('эй', 'машет тебе рукой: «эй»');
        }
      } catch {}
    }
    return null;
  }

  /** «За мной» - не по одному следу, а по двум шагам: отошёл от бота на 3+ бл., потом встал и ждёт лицом к боту (0,8+ с). */
  readFollowMe(name, g, p, now) {
    const me = this.bot.entity.position, d = p.position.distanceTo(me);
    const w = g.s.filter((x) => now - x.t < 4000);
    if (w.length < 10 || d < 4 || d > 24 || this.mode === 'follow' || this.mode === 'task' || this._errandBusy) return null;
    // ждёт дольше секунды неподвижно, а до этого был рядом с ботом (до 4 бл.) - позвал, а не просто ушёл по делам
    if (!w.some((x) => Math.hypot(x.x - me.x, x.z - me.z) < 4.5)) return null;
    const last = w.filter((x) => now - x.t < 1200), first = w[0];
    const stoodStill = last.length >= 5 && Math.hypot(last[last.length - 1].x - last[0].x, last[last.length - 1].z - last[0].z) < 0.3;
    const walkedAway = d - Math.hypot(first.x - me.x, first.z - me.z) > 3;
    const waits = last.every((x) => this.facing({ position: p.position, yaw: x.yaw }, me) > 0.8);
    if (stoodStill && walkedAway && waits && now - (g.said['за мной'] || 0) > 8000) { g.said['за мной'] = now; return { kind: 'за мной', text: 'отошёл, остановился и ждёт, глядя на тебя: «иди за мной»' }; }
    return null;
  }

  /** Ответ тела сразу + смысл мозгу (только то, о чём есть что решать). */
  onGesture(name, k, p, now) {
    const master = this.isMasterName ? this.isMasterName(name) : name === this.followName;
    this.log(`жест: ${name} ${k.text}`);
    // симпатия по делам (presence.js): подарок, мир, привет - теплее; насмешка, оружие на бота - холоднее
    const AFF = { 'подарок': 4, 'мир': 2, 'убрал оружие': 1, 'цветок': 2, 'привет': 1, 'без обид': 2, 'насмешка': -4, 'оружие': master ? 0 : -2 };
    if (AFF[k.kind] && this.affinityAdd) this.affinityAdd(name, AFF[k.kind], k.kind);
    // настроение (mood.js): тепло - открытее, игра - игривее, обида - закрытее
    if (this.moodShift) {
      if (/^(привет|подарок|мир|цветок|без обид|убрал оружие)$/.test(k.kind)) this.moodShift('open', 0.15, k.kind);
      if (/^(радость|кружится)$/.test(k.kind)) this.moodShift('play', 0.15, k.kind);
      if (/^(насмешка|оружие)$/.test(k.kind) && !master) { this.moodShift('open', -0.25, k.kind); this.moodShift('play', -0.1); }
    }
    const cold = this.affinity && this.affinity(name) <= -20;
    // кому отвечать жестом: хозяину и знакомым по-доброму (симпатия 10+); незнакомым - только взгляд (и кивок на
    // привет), чтобы не заводить случайных людей и не «болтать» с теми, кто просто играет рядом
    const friend = master || (this.affinity && this.affinity(name) >= 10);
    const R = (this.gReplies = this.gReplies || []);
    while (R.length && now - R[0] > 60000) R.shift();
    const canReply = R.length < 4 && now - (this.gReplyAt || 0) > 5000;   // не чаще раза в 5 с и 4 в минуту (без «зеркала» с другим ботом)
    this.lastGesture = { name, ...k, t: now };
    if (this.attend) this.attend(name, 2500);
    const reply = {
      'привет': 'привет', 'без обид': 'привет', 'радость': 'радость', 'кружится': 'кружится', 'да': null, 'нет': null,
      'тычок': 'кивок', 'эй': 'кивок', 'подарок': 'спасибо', 'мир': 'привет', 'убрал оружие': 'кивок', 'цветок': 'привет',
      'указал': 'кивок', 'за мной': 'кивок', 'сел': null, 'оружие': null, 'насмешка': null,
    }[k.kind];
    // с тем, кто обижал, - холодно: на привет мотает головой и отворачивается, на радость не отвечает
    let answer = cold ? ({ 'привет': 'нет', 'радость': null, 'кружится': null, 'спасибо': 'кивок' }[reply] ?? reply) : reply;
    if (!friend && answer) answer = k.kind === 'привет' ? 'кивок' : null;
    if (friend && answer === 'привет' && this.playful && this.playful() && Math.random() < 0.4) answer = 'радость';
    if (answer && canReply && this.mode !== 'task' && !(this.guard && this.guard.fighting)) { R.push(now); this.gReplyAt = now; this.gesture(answer).catch(() => {}); }
    if (k.kind === 'указал' && k.at) this.lookTarget = k.at.offset(0.5, 0.5, 0.5);
    // ждёт ответа «где нельзя» (zones.js): удар по блоку, прыжки или присед, глядя туда - это и есть ответ
    if (master && this._zoneAsk && /^(указал|радость|привет|да)$/.test(k.kind) && this.zoneAnswer) {
      const res = this.zoneAnswer(name, { at: k.kind === 'указал' ? k.at : null });
      if (res) { try { this.say(res, 'local'); } catch {} this.emit('gesture', { name, kind: 'указал', text: 'показал, где запретная зона: ' + res, master, aff: '' }); return; }
    }
    // подарок: подобрать, только если от своего и рядом с вещью нет никого ближе бота (не забрать чужое)
    if (k.kind === 'подарок' && friend && this.mode !== 'task') setTimeout(() => {
      const b = this.bot, me = b.entity.position;
      const it = Object.values(b.entities).filter((e) => e.name === 'item' && e.position.distanceTo(me) < 4).sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
      if (!it) return;
      const closer = Object.values(b.players).some((pl) => pl.entity && pl.entity !== b.entity && pl.username !== name && pl.entity.position.distanceTo(it.position) < it.position.distanceTo(me));
      if (!closer) this.goto(new goals.GoalNear(it.position.x, it.position.y, it.position.z, 0.5), this.token, 6000).catch(() => {});
    }, 600);
    // хозяин позвал жестом - идти следом сразу (без нейросети)
    if (master && k.kind === 'за мной' && this.mode !== 'follow' && this.mode !== 'task' && !this._errandBusy) { try { this.follow(name); } catch {} }
    // хозяин сел - сесть рядом, если есть куда
    if (master && k.kind === 'сел' && this.mode === 'follow') this.sitNear(p.position).catch(() => {});
    // мозгу - смысловые (решать есть что); приветы и радость - нет, тело ответило само
    if (/^(да|нет|указал|подарок|оружие|насмешка|тычок|за мной)$/.test(k.kind) && (friend || /^(оружие|насмешка|подарок|тычок)$/.test(k.kind))) this.emit('gesture', { name, kind: k.kind, text: k.text, master, aff: this.affinityWord ? this.affinityWord(name) : '' });
  }

  /**
   * Показать жест (тело, без нейросети). Виды: привет (двойной присед), кивок, нет, радость (прыжки), кружится,
   * спасибо (присед и взгляд), поклон, грусть (взгляд вниз), эй (взмах), указать (на lookTarget).
   */
  async gesture(kind) {
    const b = this.bot;
    if (!b || !b.entity || this.gesturing) return;
    // на ходу поворот головы = поворот всего тела: «вперёд» становится «назад», и бот шёл задом (22.11). На ходу -
    // только жесты без поворота: кивок, прыжок; остальные - когда стоит
    if (b.pathfinder.isMoving()) {
      if (/^(нет|кружится|указать|поклон|грусть)$/.test(kind)) return;
      if (/^(привет|спасибо)$/.test(kind)) kind = 'кивок';
    }
    this.gesturing = true; this.busyLook = true;
    const yaw0 = b.entity.yaw, pitch0 = b.entity.pitch;
    const look = (y, p) => b.look(y, p, true).catch(() => {});
    try {
      switch (kind) {
        case 'привет': case 'спасибо':
          for (let i = 0; i < 2; i++) { b.setControlState('sneak', true); await sleep(180); b.setControlState('sneak', false); await sleep(180); }
          break;
        case 'кивок': case 'да':
          for (let i = 0; i < 2; i++) { await look(yaw0, 0.6); await sleep(160); await look(yaw0, -0.15); await sleep(160); }
          break;
        case 'нет':
          for (let i = 0; i < 2; i++) { await look(yaw0 + 0.5, pitch0); await sleep(150); await look(yaw0 - 0.5, pitch0); await sleep(150); }
          break;
        case 'радость':
          if (!this.safeToJump()) { for (let i = 0; i < 2; i++) { b.setControlState('sneak', true); await sleep(150); b.setControlState('sneak', false); await sleep(150); } break; }
          for (let i = 0; i < 2; i++) { b.setControlState('jump', true); await sleep(120); b.setControlState('jump', false); await sleep(420); }
          break;
        case 'кружится':
          for (let i = 1; i <= 8; i++) { await look(yaw0 + i * Math.PI / 4, pitch0); await sleep(70); }
          break;
        case 'поклон':
          b.setControlState('sneak', true); await look(yaw0, 0.9); await sleep(700); b.setControlState('sneak', false);
          break;
        case 'грусть':
          await look(yaw0, 1.0); await sleep(1500);
          break;
        case 'эй':
          await look(yaw0, -0.4); await sleep(250); await look(yaw0, 0.3); await sleep(200);
          break;
        default: return;
      }
      await look(yaw0, pitch0);
    } finally { this.gesturing = false; this.busyLook = false; try { b.setControlState('sneak', false); b.setControlState('jump', false); } catch {} }
  }

  /** Прыгать на месте безопасно: под ногами не пашня и не грядки, рядом нет края в 2+ бл. и лавы. */
  safeToJump() {
    const b = this.bot, p = b.entity.position.floored();
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const u = b.blockAt(p.offset(dx, -1, dz)), f = b.blockAt(p.offset(dx, 0, dz));
      if ((u && /farmland|lava/.test(u.name)) || (f && /lava|_crop|wheat|carrots|potatoes|beetroots|turtle_egg|sniffer_egg|frogspawn/.test(f.name))) return false;
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) { const u2 = b.blockAt(p.offset(dx, -2, dz)); if (u && u2 && u.boundingBox === 'empty' && u2.boundingBox === 'empty') return false; }
    }
    return true;
  }

  /**
   * Сесть рядом с точкой (хозяином): подушка (26.3), нижняя ступенька или полублок до 6 бл. (встать на него и /sit).
   * Встаёт, когда хозяин пошёл (companion.js) - присед.
   */
  async sitNear(pos) {
    const b = this.bot;
    if (b.vehicle || this.seat) return false;
    const cushion = Object.values(b.entities).find((e) => /cushion/.test(e.name || '') && e.position.distanceTo(pos) < 6 && !Object.values(b.entities).some((x) => x.vehicle === e));
    let target = null;
    if (!cushion) {
      const pts = b.findBlocks({ point: pos, matching: (bl) => SEAT.test(bl.name) || /cushion/.test(bl.name), maxDistance: 6, count: 20 });
      for (const v of pts) {
        const bl = b.blockAt(v), pr = bl.getProperties ? bl.getProperties() : {};
        if (/_slab$/.test(bl.name) && pr.type !== 'bottom') continue;
        if (/_stairs$/.test(bl.name) && pr.half !== 'bottom') continue;
        const up = b.blockAt(v.offset(0, 1, 0)), up2 = b.blockAt(v.offset(0, 2, 0));
        if (!up || up.boundingBox !== 'empty' || (up2 && up2.boundingBox !== 'empty')) continue;
        // занято или вплотную к кому-то: не на место хозяина и не впритык (22.11: села прямо в хозяина)
        if (Object.values(b.players).some((p) => p.entity && p.entity !== b.entity && Math.hypot(p.entity.position.x - v.x - 0.5, p.entity.position.z - v.z - 0.5) < 1.4 && Math.abs(p.entity.position.y - v.y) < 2.5)) continue;
        if (Object.values(b.entities).some((e) => e !== b.entity && e.type !== 'player' && e.position && Math.hypot(e.position.x - v.x - 0.5, e.position.z - v.z - 0.5) < 0.7 && Math.abs(e.position.y - v.y) < 1.5 && !/item/.test(e.name || ''))) continue;   // место GSit занято сиденьем
        target = bl; break;
      }
    }
    // ни ступеньки, ни полублока (у костра на траве, на брёвнах) - сесть прямо на землю рядом, /sit работает на
    // любом блоке (22.11: у костра первый раз села быстро на ступеньку, потом стояла - сидеть было «не на чем»)
    let ground = null;
    if (!cushion && !target) {
      const me = b.entity.position;
      const cand = [];
      for (let a = 0; a < 12; a++) for (const r of [1.6, 2.3]) {
        const v = pos.offset(Math.cos(a * Math.PI / 6) * r, 0, Math.sin(a * Math.PI / 6) * r).floored();
        for (const dy of [0, -1, 1]) {
          const fl = b.blockAt(v.offset(0, dy - 1, 0)), at = b.blockAt(v.offset(0, dy, 0)), up = b.blockAt(v.offset(0, dy + 1, 0));
          if (!fl || fl.boundingBox !== 'block' || /campfire|magma|fire|lava|water|leaves|_glass|glass|farmland|hopper|chest|barrel/.test(fl.name) || !at || at.boundingBox !== 'empty' || /fire|water|lava|rail|pressure_plate|tripwire/.test(at.name) || !up || up.boundingBox !== 'empty') continue;
          const c = v.offset(0, dy, 0);
          if (Object.values(b.players).some((p) => p.entity && p.entity !== b.entity && Math.hypot(p.entity.position.x - c.x - 0.5, p.entity.position.z - c.z - 0.5) < 1.4 && Math.abs(p.entity.position.y - c.y) < 2)) continue;
          cand.push({ v: c, d: c.offset(0.5, 0, 0.5).distanceTo(me) }); break;
        }
      }
      cand.sort((x, y) => x.d - y.d);
      if (cand.length) ground = cand[0].v;
    }
    if (!cushion && !target && !ground) return false;
    if (ground) {
      try { await this.goto(new goals.GoalNear(ground.x, ground.y, ground.z, 0.6), this.token, 12000); } catch { return false; }
      try { await b.lookAt(pos.offset(0, 1.2, 0), true); } catch {}
      b.chat('/sit');
      await sleep(800);
      if (!b.vehicle) return false;
      this.seat = { since: Date.now(), at: ground };
      this.task = 'сижу рядом';
      this.log('села рядом на землю');
      return true;
    }
    const where = cushion ? cushion.position : target.position;
    try { await this.goto(cushion ? new goals.GoalNear(where.x, where.y, where.z, 2) : new goals.GoalNear(where.x, where.y + 1, where.z, 0.8), this.token, 15000); } catch { return false; }
    if (!cushion) {
      b.chat('/sit');   // GSit: сесть на блок под ногами (на сервере работает только /sit)
      await sleep(800);
      if (!b.vehicle) return false;
      this.seat = { since: Date.now(), at: where };
      this.task = 'сижу рядом';
      this.log(`села рядом на ${target.name}`);
      return true;
    }
    // пустая рука (GSit: empty-hand-only)
    try { const empty = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !b.inventory.slots[36 + i]); if (empty !== undefined) b.setQuickBarSlot(empty); } catch {}
    try { if (cushion) await b.activateEntity(cushion); else await b.activateBlock(target); } catch { return false; }
    await sleep(500);
    if (!b.vehicle) return false;
    this.seat = { since: Date.now(), at: where };
    this.task = 'сижу рядом';
    this.log('села рядом' + (cushion ? ' на подушку' : ` на ${target.name}`));
    return true;
  }

  /** Встать (GSit: присесть). */
  async standUp() {
    const b = this.bot;
    if (!this.seat && !b.vehicle) return;
    this.seat = null;
    if (this.task === 'сижу рядом') this.task = '';
    // держать присед, пока сервер не снимет с сиденья (до 2 с): 300 мс иногда не хватало, и бот оставался сидеть
    try { b.setControlState('sneak', true); await sleep(300); for (let i = 0; i < 17 && b.vehicle; i++) await sleep(100); b.setControlState('sneak', false); } catch {}
    if (b.vehicle && !/boat|raft|horse|donkey|mule|camel|pig|strider|llama|minecart/.test(b.vehicle.name || '')) this.log('встать не вышло: сервер не снял с сиденья');
  }
}

module.exports = { Gestures };
