// Тело бота: mineflayer + pathfinder. Ходит компаньоном, берёт и кладёт вещи в сундуки, отдаёт вещи игрокам,
// проходит порталы. Блоки не ломает и не ставит (на живом сервере это был бы гриф).
// Заходит клиентом 26.1 (с 23.11; ViaVersion переводит 26.1 -> 26.3, разница малая). Прежняя 1.21.11 - настройка version у бота.
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Skills, NATURAL, BUILT } = require('./skills');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('events');
const { Guard } = require('./guard');

const VERSION = process.env.TB_VERSION || '26.1';   // основная с 23.11 (стенд: все проверки, кроме элитр); стабильная прежняя - version: '1.21.11' у бота
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

class Cancelled extends Error {}

// Пакет custom_click_action (этап настройки, id 0x08) вручную: в minecraft-data у него нет длины перед NBT,
// а сервер (ServerboundCustomClickActionPacket) читает NBT с префиксом длины - пакет от библиотеки сервер не разбирает.
const nbt = require('prismarine-nbt');
function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function clickActionPacket(id, value) {
  const named = nbt.writeUncompressed({ type: 'compound', name: '', value }, 'big');
  const anon = Buffer.concat([named.subarray(0, 1), named.subarray(3)]);   // сетевой NBT без имени корня
  const idBuf = Buffer.from(id, 'utf8');
  return Buffer.concat([varint(0x08), varint(idBuf.length), idBuf, varint(anon.length), anon]);   // проверено на стенде: без флага optional
}

class TotemBot extends EventEmitter {
  /** opts: { name, password, host, port } */
  constructor(opts) {
    super();
    this.opts = opts;
    this.bot = null;
    this.status = 'off';      // off | connecting | online
    this.mode = 'idle';       // idle | follow | task
    this.followName = '';
    this.task = '';
    this.token = 0;           // смена номера отменяет текущее задание
    this.lostReported = false;
    this.lookTarget = null;
  }

  log(text) {
    this.emit('log', text); if (this.diaryFrom) try { this.diaryFrom(String(text)); } catch {}
    // отладка движения (movetrace.js): застрял, умер, нет пути - снимок того момента отдельным файлом (не чаще раза в 10 с)
    if (this.trace && /^застрял:|^умер на|No path|не дошёл|не доплыл|воздух кончается/.test(String(text)) && Date.now() - (this._snapAt || 0) > 10000) { this._snapAt = Date.now(); this.trace.snapshot(String(text).slice(0, 200)); }
  }
  event(text, important = false) { this.emit('event', { text, important }); }

  start() {
    if (this.bot) return;
    this.manual = false;
    clearTimeout(this.reconnectTimer);
    const { name, host, port } = this.opts;
    this.status = 'connecting';
    this.log(`захожу на ${host}:${port} как ${name}`);
    const bot = this.bot = mineflayer.createBot({ host, port, username: name, version: this.opts.version || process.env.TB_VERSION || VERSION, auth: 'offline', hideErrors: true });   // версия протокола: настройка бота, иначе стабильная
    // Номер состояния окна: mineflayer берёт его из любого пакета слота. Сервер 26.3 через ViaVersion после каждого клика
    // в верстаке присылает синхронизацию слота инвентаря игрока (окно 0) со своим номером - клики в окне верстака уходили
    // с чужим номером, и сервер их откатывал (стенд 23.11: крафт поршня, полки, компаса не проходил). Пока открыто
    // другое окно - пакеты окна 0 не трогают его номер
    {
      const lastState = new Map();
      const fix = (pk) => {
        if (pk.windowId !== undefined && pk.windowId !== 0) { lastState.set(pk.windowId, pk.stateId); return; }
        const cw = bot.currentWindow;
        if (cw && cw.id !== 0 && lastState.has(cw.id)) pk.stateId = lastState.get(cw.id);
      };
      bot._client.prependListener('set_slot', fix);
      bot._client.prependListener('window_items', fix);
    }
    bot.loadPlugin(pathfinder);
    bot._client.on('show_dialog', (d) => this.onDialog(d));
    // Уши: аддон TotemVoiceAddon присылает речь игроков рядом по каналу totem:ears ([1]+ник, [2]+PCM 48 кГц, [3]).
    // Канал надо объявить серверу (minecraft:register), иначе Bukkit не пришлёт.
    bot.once('login', () => { try { bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('totem:ears') }); } catch {} });
    let heard = null;
    bot._client.on('custom_payload', (p) => {
      if (p.channel !== 'totem:ears' || !p.data || !p.data.length) return;
      const t = p.data[0];
      if (t === 1) heard = { from: p.data.subarray(1).toString('utf8'), parts: [] };
      else if (t === 2 && heard) heard.parts.push(Buffer.from(p.data.subarray(1)));
      else if (t === 3 && heard) { const h = heard; heard = null; this.emit('speech', { from: h.from, pcm: Buffer.concat(h.parts) }); }
    });
    // Отбрасывание: с 1.21.9 скорость в пакете уже в блоках за тик (minecraft-data так и раскладывает: -0.4, 0.36),
    // а mineflayer делит её ещё на 8000 по старому формату - бот не отлетал, Vulcan отмечал Velocity (стенд 15.11).
    // Обработчик ставим после входа: модули mineflayer подключаются позже createBot, и их обработчик иначе сработал бы последним.
    bot.once('login', () => bot._client.on('entity_velocity', (p) => {
      if (bot.entity && p.entityId === bot.entity.id && p.velocity && Math.abs(p.velocity.x) < 20) {
        bot.entity.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      }
    }));
    // Смена слота в руке на тот же самый - Vulcan Bad Packets C (кик с одного раза, стенд 15.11: при посадке урожая
    // mineflayer заново выбирал слот семян). Настоящий клиент такого не шлёт - отбрасываем повтор.
    {
      const raw = bot._client.write.bind(bot._client);
      let slot = -1;
      bot._client.on('held_item_slot', (p) => { slot = p.slot ?? p.slotId ?? slot; });
      const trail = [];   // для отладки: последние пакеты (TB_PACKETLOG=1 печатает их при кике)
      bot.on('kicked', () => { if (process.env.TB_PACKETLOG) console.log('последние пакеты:\n' + trail.join('\n')); });
      bot._client.write = (name, params) => {
        if (process.env.TB_PACKETLOG && !/^(position|position_look|look|flying|tick_end|keep_alive|pong)$/.test(name)) { trail.push(Date.now() % 100000 + ' ' + name + ' ' + JSON.stringify(params).slice(0, 140)); if (trail.length > 25) trail.shift(); }
        if (name === 'held_item_slot') {
          if (params.slotId === slot) return;
          slot = params.slotId;
        }
        return raw(name, params);
      };
    }

    bot.once('spawn', () => {
      this.status = 'online'; this.onlineAt = Date.now();
      // Сервер 26.3 тихо откатывает игрока, если тело касается стенки вплотную (физика mineflayer подводит его на
      // волосок ближе, чем считает сервер): у ступенек - десятки откатов, «на земле» сбрасывается, прыжок срывается -
      // бот «застревает на ровном месте» (стенд-копия мира 15.11: 76 откатов на одну ступеньку). Тело чуть шире -
      // останавливается за волосок до блока, как настоящий клиент.
      bot.physics.playerHalfWidth = 0.3005;
      const mv = new Movements(bot);
      // Ходит как Baritone: по дороге копает природное и подставляет под себя землю/булыжник (без этого 99 застреваний
      // за 15.11: ямы, закрытые проходы, ступенька в два блока). Ломать и ставить - только вдали от чужих построек:
      // карта (чанк застроен) + 3 блока вокруг (кэш на 30 с, pathfinder спрашивает одну клетку много раз).
      mv.canDig = true;
      for (const bl of Object.values(bot.registry.blocksByName)) if (!NATURAL.test(bl.name) || /_log$|_stem$/.test(bl.name)) mv.blocksCantBreak.add(bl.id);
      // лианы, лестницы, светящийся лишайник - по ним лазают и их растят нарочно: не ломать по дороге (22.11: ломал «наши лианы»)
      for (const n of ['vine', 'ladder', 'glow_lichen', 'cave_vines', 'cave_vines_plant', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'scaffolding', 'sugar_cane', 'bamboo', 'sweet_berry_bush', 'kelp', 'kelp_plant']) { const r = bot.registry.blocksByName[n]; if (r) mv.blocksCantBreak.add(r.id); }
      const nearBuilt = (pos) => {
        const k = pos.x + ',' + pos.y + ',' + pos.z, c = (this._builtCache = this._builtCache || new Map()), hit = c.get(k);
        if (hit && Date.now() - hit.at < 30000) return hit.v;
        if (c.size > 20000) c.clear();
        const v = this.skills.builtChunk(pos) || !!this.skills.builtNear(pos, 3);
        c.set(k, { v, at: Date.now() });
        return v;
      };
      mv.exclusionAreasBreak = [(block) => (block.position && !this.skills.mine(block.position) && nearBuilt(block.position) ? 100 : 0)];
      mv.exclusionAreasPlace = [(block) => (block.position && nearBuilt(block.position) ? 100 : 0)];
      mv.scafoldingBlocks = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'coarse_dirt', 'blackstone']
        .map((n) => bot.registry.itemsByName[n]).filter(Boolean).map((i) => i.id);
      mv.allow1by1towers = true;      // выбраться из ямы столбиком, как игрок
      mv.digCost = 2;                 // копать - дороже обхода: ломает, только когда обойти нельзя
      mv.placeCost = 2;
      mv.allowParkour = false;   // прыжки с разбега у pathfinder срываются (бот стоит перед ямой без клавиш, стенд 15.11)
      mv.allowSprinting = true;
      mv.canOpenDoors = true;
      // по образцу Baritone (maxFallHeightNoWater, blocksToAvoid, mobAvoidance, exclusionAreas)
      mv.maxDropDown = 3;
      for (const n of ['fire', 'soul_fire', 'lava', 'magma_block', 'campfire', 'soul_campfire', 'sweet_berry_bush',
        'wither_rose', 'powder_snow', 'cactus', 'pointed_dripstone']) {
        const bl = bot.registry.blocksByName[n];
        if (bl) mv.blocksToAvoid.add(bl.id);
      }
      mv.entitiesToAvoid = new Set(['creeper']);
      mv.exclusionAreasStep = [(block) => this.forbiddenCost(block)];
      // Ходьба по настоящей форме блоков (nav.js): ступеньки, плиты, кровати, ковры, люки, двери, заборы, углы по
      // диагонали - геометрией, как в игре. Заменила заплатки 15-21.11 (ковёр выше ног, диагонали, house-moves).
      bot._tb = this;   // для nav.js: сбои навигации - в здоровье тела
      if (this.partOn('nav')) require('./nav').install(mv, bot);
      // кэш проходимости (passcache.js): путь и через выгруженные чанки, которые бот видел раньше
      if (this.partOn('passcache') && this.passCacheShared && !bot._passAttached) { bot._passAttached = true; this.passCacheShared.attach(this); }
      mv.passCache = this.partOn('passcache') ? this.passCacheShared || null : null;
      mv.passDim = () => String(bot.game && bot.game.dimension || 'overworld').replace(/^minecraft:/, '');
      // Как человек: по дорогам и натоптанным местам, а не по газонам у чужих домов. Дорога - выложенное (не природное)
      // под открытым небом, или клетка, где часто ходят. Рядом с постройками остальное дороже в 1,6 раза; в диком
      // месте разницы нет. Множитель только >= 1: оценка пути модуля не завышается.
      mv.navStepCost = (x, y, z, under) => {
        if (!under || !this.travel || !this.travel.trails) return 1;
        // у края лавы (Незер, пещеры) - вдвое дороже: один толчок гаста или моба - и в лаву
        let lava = false;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const ay of [-1, 0]) { const k = bot.blockAt(new Vec3(x + ax, y + ay, z + az), false); if (k && k.name === 'lava') lava = true; }
        if (lava) return 2;
        // враги рядом с клеткой (по чувствам, senses.js): обойти, если обход дешевле; в узком проходе - пройти, а
        // мешающего на пути ударит guard.js (22.11: «магма-куб или зомби на пути - обойти или ударить, что выгоднее»)
        let foe = 1;
        for (const t of (this.tracks || new Map()).values()) {
          if (t.kind !== 'enemy' || t.d > 24) continue;
          // где сейчас и где будет через секунду (как сети занятости у автопилота: не что это, а куда движется)
          const ahead = t.vx !== undefined ? Math.hypot(t.pos.x + t.vx - x - 0.5, t.pos.z + t.vz - z - 0.5) : Infinity;
          const dd = Math.min(Math.hypot(t.pos.x - x - 0.5, t.pos.z - z - 0.5), ahead);
          if (dd < 2 && Math.abs(t.pos.y - y) < 3) foe = Math.max(foe, t.name === 'creeper' ? 6 : 2.5); else if (dd < 4 && Math.abs(t.pos.y - y) < 3) foe = Math.max(foe, t.name === 'creeper' ? 3 : 1.4);
        }
        // стрелки (скелет, блейз, ведьма, разбойник) бьют издалека: их клетки в 10 бл. дороже (как mobAvoidanceRadius у Baritone),
        // а не только вплотную - 22.11 погибала от блейзов у замка, проходя мимо
        for (const t of (this.tracks || new Map()).values()) {
          if (t.kind !== 'enemy' || t.d > 32 || !/^(skeleton|stray|bogged|blaze|witch|pillager|ghast|breeze|evoker)$/.test(t.name)) continue;
          const dd = Math.hypot(t.pos.x - x - 0.5, t.pos.z - z - 0.5);
          if (dd < 10 && Math.abs(t.pos.y - y) < 10) foe = Math.max(foe, t.name === 'blaze' || t.name === 'ghast' ? 3 : 2);
        }
        if (foe > 1) return foe;
        // по дороге, которую тело распознало (features.js), - дешевле любой земли рядом: держаться дороги
        try { if (this.onKnownRoad && this.onKnownRoad(x, z)) return 0.8; } catch {}
        const d = require('./travel').dkey(bot.game.dimension);
        if (this.travel.trails.heat(d, x, y, z) >= 2) return 1;
        // В поселении - по дорожкам, а не по газонам у домов (23.11, владелец: по карте видно - коричневое тропа, вокруг
        // зелень и участки). Тропа бывает любой: протоптанная земля, гравий, булыжник, плитка, светлые блоки на площади.
        // Газон - трава, мох, подзол, цветы и трава у ног: в 2,5 раза дороже; прочее природное - чуть дороже
        // Незер: дороги метро (лёд, синий лёд) - дешевле, голый незеррак - дороже: держаться дорог
        if (/nether/.test(bot.game.dimension || '')) return /ice$/.test(under) ? 0.6 : /^(netherrack|soul_sand|soul_soil|basalt|blackstone|magma_block|crimson_nylium|warped_nylium)$/.test(under) ? 1.4 : 1;
        if (/^(dirt_path|gravel|coarse_dirt|packed_mud|mud|suspicious_gravel)$/.test(under)) return 1;
        // листва (кусты, живые изгороди), сено, тыквы, верх заборов и стен, сундуки, бочки, кровати, ульи - не дорога: в
        // поселении в 4 раза дороже, в лесу листва - вдвое (23.11: шёл за хозяином по заборам, листьям и стогам вместо тропы)
        if (/leaves|hay_block|_fence$|_wall$|chest|barrel|_bed$|beehive|bee_nest|melon|pumpkin|composter|_table$|anvil|cauldron|lectern|bookshelf|target|_head$|_skull$/.test(under)) {
          return (nearBuilt(new Vec3(x, y - 1, z)) || (this.skills && this.skills.builtChunk(new Vec3(x, y, z)))) ? 4 : (/leaves/.test(under) ? 2 : 1.5);
        }
        if (!NATURAL.test(under) && !/leaves|farmland|moss_block|moss_carpet/.test(under)) return 1;   // выложенное: дорожка, плитка, пол
        if (!nearBuilt(new Vec3(x, y - 1, z)) && !(this.skills && this.skills.builtChunk(new Vec3(x, y, z)))) return 1;
        const feet = bot.blockAt(new Vec3(x, y, z), false), fn = feet ? feet.name : '';
        const lawn = /^(grass_block|moss_block|moss_carpet|podzol|mycelium|rooted_dirt)$/.test(under) || /flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily|rose|peony|lilac|short_grass|tall_grass|fern|sapling|pink_petals|leaf_litter|wildflowers|bush/.test(fn) || (fn === 'snow' && /grass_block|dirt|podzol/.test(under));
        return lawn ? 2.5 : 1.3;   // Vec3: builtNear берёт pos.offset (22.11 простой объект ронял поиск пути)
      };
      this.movements = mv;
      bot.pathfinder.setMovements(mv);
      bot.pathfinder.thinkTimeout = 15000;   // путь в обход (без паркура) ищется дольше 5 с по умолчанию
      this.guard = new Guard(this);
      this.guard.mode = this.opts.combat || 'defend';
      this.guard.attach();
      require('./life').start(this);   // нужды и распорядок дня - само тело (life.js)
      this.retry = 0;
      this.log('на сервере');
      this.event('вход на сервер');
      this.loops();
    });
    bot.on('spawn', () => {
      setTimeout(() => { const e = this.errand && this.errand(); if (e && e.state === 'run' && !this._errandBusy) { this.log('продолжаю поручение'); this.errandLoop().catch(() => {}); } }, 12000);
      if (this.dim && this.dim !== bot.game.dimension) {
        this.event(`ты в другом измерении: ${this.dimName()}`);
        // прошёл портал (а не умер): стоял в портале перед этим - запомнить пару «вход -> выход»
        const was = this.inPortal, fromDim = this.dim;
        if (was && Date.now() - was.at < 15000 && this.travel) {
          setTimeout(() => {
            try {
              const p = bot.entity.position;
              const exit = bot.findBlock({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 4 });
              if (exit) { this.travel.addLink(fromDim, was.pos, bot.game.dimension, exit.position); this.log(`запомнил портал: ${was.pos.x} ${was.pos.z} -> ${Math.floor(p.x)} ${Math.floor(p.z)} (${this.dimName()})`); }
            } catch {}
          }, 1500);
        }
      }
      if (this.dim && this.dim !== bot.game.dimension) this.arrivedAt = Date.now();
      this.dim = bot.game.dimension; this.inPortal = null;
    });
    // след хозяина - где он прошёл (23.11, владелец: «че он не мог научиться у меня»): если к нему нет пути, пройти
    // его же дорогой шаг в шаг - через скрытую дверь, течение, лаз
    bot.on('entityMoved', (e) => {
      try {
        if (!e || e.type !== 'player' || !(this.opts.masters || []).includes(e.username)) return;
        const T = (this._trail = this._trail || []), last = T[T.length - 1], p = e.position;
        if (last && last.p.distanceTo(p) < 0.5) return;
        T.push({ p: p.clone(), at: Date.now(), who: e.username }); if (T.length > 300) T.shift();
      } catch {}
    });
    bot.on('path_update', (r) => {
      this.lastPath = { status: r.status, path: r.path, at: Date.now() };
      // иду за хозяином, а до него прохода нет (он за скрытой дверью, в закрытой комнате): путь «частичный» уводит в
      // обход куда попало - 23.11 убежал вниз в пещеры и заблудился. Не уходить: стоять, ждать, пробовать механизм
      try {
        if (this._mechBusy || this._trailBusy || this.mode !== 'follow' || !/^(partial|noPath)$/.test(r.status) || !this._followEnt) return;
        const own = this._followEnt.position, me = bot.entity.position, end = r.path.length ? r.path[r.path.length - 1] : me;
        if (!own || me.distanceTo(own) > 24 || end.distanceTo(own) <= 4) return;
        if (r.path.length && end.distanceTo(own) < me.distanceTo(own) - 2) return;   // частичный, но ведёт ближе - пусть идёт
        bot.pathfinder.setGoal(null);
        // сначала механизм у входа (плита в воде, кнопка) - с подходом по дну и нырком; после него снова за хозяином
        // (23.11 у друга: «за мной» через секретный вход - шёл следом руками и всплывал, плиту не нажал)
        if (!this._mechBusy && Date.now() - (this._followMechAt || 0) > 15000) {
          this._followMechAt = Date.now(); this._mechBusy = true;
          this.useMechanism(own, this.token).then((m) => { if (m) { this.log(m + ' - за хозяином'); try { bot.pathfinder.setGoal(new goals.GoalFollow(this._followEnt, this.followDist()), true); } catch {} } }).catch(() => {}).finally(() => { this._mechBusy = false; });
          return;
        }
        if (!this._trailBusy && this.walkTrail) { this._trailBusy = true; this.walkTrail(this.followName).then((m) => { if (m) this.log(m); }).catch(() => {}).finally(() => { this._trailBusy = false; }); return; }
        if (!this._waitWallSaid || Date.now() - this._waitWallSaid > 60000) { this._waitWallSaid = Date.now(); this.log(`к ${this.followName} прохода не вижу - жду здесь, не ухожу`); }
        if (!this._mechBusy) { this._mechBusy = true; this.useMechanism(own, this.token).then((m) => { if (m) this.log(m + ' - бегом к хозяину'); }).catch(() => {}).finally(() => { this._mechBusy = false; }); }
        clearTimeout(this._followRetry);
        this._followRetry = setTimeout(() => { try { if (this.mode === 'follow' && this._followEnt && this._followEnt.isValid !== false) bot.pathfinder.setGoal(new goals.GoalFollow(this._followEnt, this.followDist()), true); } catch {} }, 3000);
      } catch {}
    });
    bot.on('messagestr', (msg, pos, json, sender) => {
      if (pos === 'system' || pos === 'game_info') { this.lastSystem = (this.lastSystem || []).concat(String(msg).slice(0, 160)).slice(-10); }
      // сообщение сервера о своей смерти («Loki drowned», «Loki was slain by Zombie») - причина для зоны (zones.js)
      try { const t = String(msg || ''); if (t.startsWith(this.opts.name + ' ') && !/joined|left|has made|получил|был кикнут/.test(t)) this.deathMsg = { text: t, at: Date.now() }; } catch {}
      this.onMessage(msg, pos, json, sender);
    });
    // чат разбирается в onMessage (каналы по оформлению Essentials); события mineflayer chat/whisper не используем:
    // его шаблоны принимали личку «[ник -> я] текст» ещё и за общий чат
    bot.on('death', () => {
      const p = bot.entity.position;
      this.deathPoint = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim: bot.game.dimension, at: Date.now() };
      this.resumeFollow = this.followName || this.resumeFollow;
      this.log(`умер на ${this.deathPoint.x} ${this.deathPoint.y} ${this.deathPoint.z}`);
      this.ev('смерть', {});
      // опасное место: путь будет его обходить сутки (память опасности, как у мобов и NPC)
      if (this.memory) { const dd = this.memory.data.danger = (this.memory.data.danger || []).filter((x) => Date.now() - x.at < 86400000); dd.push({ ...this.deathPoint, dim: this.dimName() }); if (dd.length > 50) dd.shift(); this.memory.save(); }
      { const pt = this.deathPoint; setTimeout(() => { try { this.zoneDeath(pt, this.deathMsg && Date.now() - this.deathMsg.at < 4000 ? this.deathMsg.text : ''); } catch (e) { this.log('зона смерти: ' + e.message); } }, 1500); }   // причина приходит сообщением сервера
      if (this.memory) this.memory.journal(this.opts.name, `умер на ${this.deathPoint.x} ${this.deathPoint.y} ${this.deathPoint.z} (${this.dimName()})`);
      this.cancel();
      // после возрождения (spawn) - забрать вещи, как waypoint смерти в Baritone
      bot.once('spawn', () => setTimeout(() => this.afterDeath().catch(() => {}), 2500));
    });
    // кто из игроков ударил: замах рукой в последние 0,6 с в 5 блоках (удар без атакующего в событии)
    // жесты игроков: удар по блоку и присед (чтобы показывать, а не диктовать координаты)
    this.gestures = new Map();   // ник -> { poke: {name,x,y,z,at}, crouch: [время...] }
    const g = (n) => { if (!this.gestures.has(n)) this.gestures.set(n, { poke: null, crouch: [] }); return this.gestures.get(n); };
    bot.on('blockBreakProgressObserved', (block, stage, entity) => {
      if (entity && entity.type === 'player' && entity.username) g(entity.username).poke = { name: block.name, x: block.position.x, y: block.position.y, z: block.position.z, at: Date.now() };
    });
    bot.on('entityCrouch', (e) => { if (e.type === 'player' && e.username) { const c = g(e.username).crouch; c.push(Date.now()); if (c.length > 6) c.shift(); } });
    // кто спит (события mineflayer по позе игрока)
    this.sleepers = new Set();
    bot.on('entitySleep', (e) => { if (e !== bot.entity) this.sleepers.add(e.id); });
    bot.on('entityWake', (e) => this.sleepers.delete(e.id));
    const swings = new Map();
    bot.on('entitySwingArm', (e) => { if (e.type === 'player') swings.set(e.username, Date.now()); });
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const who = [...swings].find(([n, t]) => Date.now() - t < 600 && bot.players[n] && bot.players[n].entity
        && bot.players[n].entity.position.distanceTo(bot.entity.position) < 5);
      if (who && Date.now() - (this.hitReported || 0) > 10000) { this.hitReported = Date.now(); this.event(`игрок ${who[0]} ударил тебя`, true); }
    });
    bot.on('kicked', (r) => { this.kickReason = this.reason(r); this.log('кикнули: ' + this.kickReason); });
    if (this.partOn('hearing')) this.listen(bot);   // слух (hearing.js)
    if (this.partOn('balance')) this.balanceAttach(bot);
    if (this.partOn('gestures')) this.gesturesAttach(bot);
    this.vehiclesAttach(bot);
    this.closeBehindAttach(bot);   // двери, калитки, люки - закрывать за собой (chores.js)   // езда: конец такта и движение лодки, пока физика mineflayer выключена (vehicles.js)
    if (this.partOn('companion')) this.musicAttach(bot);   // музыка рядом - пританцовывать (mood.js)   // язык тела: узнать жесты игроков и ответить (gestures.js)   // равновесие после толчка (steer.js)
    // поток лавы рядом (сломали блок, гаст взорвал, натекло сверху) - отойти от него сразу, не ждать, пока зальёт
    // хозяин открыл скрытый проход (поршни в стене): кнопка, рычаг, плита сменили состояние, а он рядом - запомнить,
    // где и что; когда путь за ним не строится - сделать то же самое (23.11, владелец: «если хозяин зашёл через скрытую
    // дверь - чтоб он тоже прошёл»)
    bot.on('blockUpdate', (o, n) => {
      try {
        if (!n || !/(_button|^lever|_pressure_plate)$/.test(n.name) || !o || o.name !== n.name) return;
        const po = o.getProperties ? o.getProperties() : {}, pn = n.getProperties ? n.getProperties() : {};
        if (JSON.stringify(po) === JSON.stringify(pn)) return;
        const m = this.opts.masters || [];
        const who = Object.values(bot.players).find((p) => p.entity && m.includes(p.username) && p.entity.position.distanceTo(n.position) < 3.5);
        if (!who) return;
        const k = n.position.toString();
        this._ownerMech = (this._ownerMech || []).filter((x) => Date.now() - x.at < 30 * 60000 && x.k !== k).concat({ k, p: n.position.clone(), name: n.name, at: Date.now() }).slice(-12);
        // показывает дорогу - нажатие в маршрут, на своём месте по порядку (плита: только когда встал, не когда сошёл)
        const T = this._teach;
        const pressed = /_pressure_plate$/.test(n.name) ? (pn.powered === true || pn.powered === 'true' || +pn.power > 0) : true;
        if (T && T.who === who.username && pressed && !(T.pts.length && T.pts[T.pts.length - 1].press && T.pts[T.pts.length - 1].press.k === k)) {
          const wp = who.position.floored();
          T.pts.push({ x: wp.x, y: wp.y, z: wp.z, dim: this.dimName ? this.dimName() : '', press: { x: n.position.x, y: n.position.y, z: n.position.z, k } });
          this.log(`запись дороги: ${who.username} нажал ${n.name} у ${n.position.x} ${n.position.y} ${n.position.z}`);
        }
      } catch {}
    });
    bot.on('blockUpdate', (o, n) => {
      try {
        if (!n || n.name !== 'lava' || !bot.entity || this.paused) return;
        const me = bot.entity.position, d = n.position.offset(0.5, 0, 0.5).distanceTo(me);
        if (d > 3 || Date.now() - (this.lavaFleeAt || 0) < 1500) return;
        this.lavaFleeAt = Date.now();
        const away = me.minus(n.position.offset(0.5, 0, 0.5)); away.y = 0;
        const k = 4 / (Math.hypot(away.x, away.z) || 1), to = me.offset(away.x * k, 0, away.z * k);
        this.log(`рядом течёт лава (${n.position.x} ${n.position.y} ${n.position.z}) - отхожу`);
        bot.pathfinder.setGoal(new goals.GoalNearXZ(to.x, to.z, 1));
      } catch {}
    });
    bot.on('error', (e) => this.log('ошибка: ' + e.message));
    bot.on('end', (r) => {
      this.log('отключён: ' + (r || ''));
      this.status = 'off';
      this.bot = null;
      clearInterval(this.timer);
      this.emit('end');
      const banned = /ban|бан|заблокир/i.test(this.kickReason || '');
      if (!this.manual && !banned) {
        this.retry = Math.min(120, (this.retry || 10) * 1.5);
        this.log(`переподключусь через ${Math.round(this.retry)} с`);
        this.reconnectTimer = setTimeout(() => { this.kickReason = ''; this.start(); }, this.retry * 1000);
      }
    });
  }

  stop() {
    this.manual = true;
    clearTimeout(this.reconnectTimer);
    this.cancel();
    if (this.bot) this.bot.quit();
  }

  // Причина кика приходит текстом, JSON-компонентом или NBT: собираем из неё только видимый текст
  reason(r) {
    const out = [];
    const walk = (v, key) => {
      if (typeof v === 'string') {
        if (key === 'text' || key === '' || key === 'value' || key === undefined) {
          try { if (/^[{[]/.test(v)) { walk(JSON.parse(v)); return; } } catch {}
          if (!/^(compound|string|list|byte|int)$/.test(v)) out.push(v);
        }
        return;
      }
      if (Array.isArray(v)) { v.forEach((x) => walk(x)); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!/^(type|color|bold|italic|underlined|strikethrough|obfuscated|translate)$/.test(k)) walk(x, k); }
    };
    try { walk(r); } catch {}
    const t = out.join('').replace(/§./g, '').replace(/\s+/g, ' ').trim();
    return (t || (typeof r === 'string' ? r : JSON.stringify(r))).slice(0, 300);
  }

  dimName() {
    const d = String(this.bot && this.bot.game.dimension || '');
    return /nether/.test(d) ? 'Незер' : /end/.test(d) ? 'Энд' : 'обычный мир';
  }

  // --- AuthMe и чат
  // AuthMe 6 спрашивает пароль окном ещё до входа в мир (этап настройки соединения). Заполняем все поля окна паролем
  // и жмём кнопку с «submit». Окна не от AuthMe не трогаем.
  onDialog(d) {
    const raw = JSON.stringify(d);
    if (!/authme:/i.test(raw)) { this.log('окно сервера, не от AuthMe: пропускаю'); return; }
    const ids = [...raw.matchAll(/"id":\{"type":"string","value":"(authme:[^"]+)"/g)].map((m) => m[1]);
    const submit = ids.find((i) => /submit/i.test(i));
    if (!submit) { this.log('окно AuthMe без кнопки входа: ' + ids.join(', ')); return; }
    const keys = [...raw.matchAll(/"key":\{"type":"string","value":"([^"]+)"/g)].map((m) => m[1]);
    const value = {};
    for (const k of keys) value[k] = { type: 'string', value: this.opts.password };
    this.bot._client.writeRaw(clickActionPacket(submit, value));
    this.log('ввёл пароль в окне AuthMe (' + submit + ')');
  }

  onMessage(msg, pos, json, sender) {
    if (pos === 'game_info') return;
    const text = String(msg).trim();
    if (!text) return;
    const pw = this.opts.password;
    const now = Date.now();
    // запасной вход AuthMe командой - только по сообщению сервера и только пока бот не вошёл
    // (раньше срабатывало и на «/l» в словах игроков)
    if (pos === 'system' && !this.authed) {
      if (/\/reg(ister)?\b/i.test(text) && now - (this.regAt || 0) > 10000) { this.regAt = now; this.bot.chat(`/register ${pw} ${pw}`); this.log('регистрируюсь в AuthMe'); return; }
      if (/\/l(ogin)?\b/i.test(text) && !/\/reg/i.test(text) && now - (this.loginAt || 0) > 10000) { this.loginAt = now; this.bot.chat(`/login ${pw}`); this.log('вхожу в AuthMe'); return; }
    }
    if (/successful login|успешн.*вход|вы вошли|logged-in/i.test(text)) this.authed = true;
    if (pos === 'chat') {
      // сообщение игрока: автор - по UUID отправителя. Канал - по оформлению Essentials (unsigned):
      // «[Рядом] <ник> текст» - ближний, «<ник> текст» - общий. Текст - без приставки «!» ближнего чата.
      const p = sender && Object.values(this.bot.players).find((x) => x.uuid === sender);
      const shown = json && json.unsigned ? String(json.unsigned.toString()) : '';
      const local = /^\s*\[Рядом\]/i.test(shown);
      let body = text;
      const m = /^.*?<[^>]+>\s?(.*)$/.exec(shown);
      if (m && m[1]) body = m[1];
      else if (local) body = text.replace(/^!\s*/, '');
      this.emit('chat', `${local ? '[рядом]' : '[общий]'} ${p ? p.username : '?'}: ${body}`);
      if (p) this.playerChat(p.username, body, false, local ? 'local' : 'global');
      return;
    }
    // не сообщение игрока по протоколу: личка Essentials, клановый чат SimpleClans, системное. В журнал - с каналом,
    // чтобы было видно, откуда пришло (21.11: не понять было, общий это чат или личка)
    const parsed = this.parseChat(text);
    const clan = /^\s*\[(Клан|Clan|Союз|Ally)\]/i.test(text);
    const local = /^\s*\[Рядом\]/i.test(text);
    const ch = !parsed ? 'сервер' : parsed.whisper ? 'личка' : clan ? 'клан' : local ? 'рядом' : 'общий';
    this.emit('chat', `[${ch}] ${clan ? text.replace(/^\s*\[[^\]]+\]\s*/, '') : parsed ? parsed.from + ': ' + parsed.text : text}`);
    if (parsed) this.playerChat(parsed.from, parsed.text, parsed.whisper, parsed.whisper ? 'whisper' : local ? 'local' : 'global');
  }

  playerChat(from, text, whisper, channel = whisper ? 'whisper' : 'global') {
    if (!from || from === this.opts.name || !text) return;
    const key = from + '|' + text;
    const now = Date.now();
    if (this.lastChat && this.lastChat.key === key && now - this.lastChat.at < 2000) return;   // одно сообщение двумя путями
    this.lastChat = { key, at: now };
    if ((this.opts.masters || []).includes(from)) this.ownerAskAt = now;   // хозяин что-то сказал - не садиться отдыхать, пока не ясно, что он хочет
    this.emit('player-chat', { from, text: String(text).trim(), whisper: channel === 'whisper', channel });
  }

  // Формат чата на сервере свой (префиксы, кланы, ближний чат, личка Essentials), поэтому автора ищем по нику из списка игроков
  // в «шапке» сообщения до первого «:» или «>». Личка Essentials: «[Ник -> я] текст».
  parseChat(text) {
    const names = Object.keys(this.bot.players || {}).sort((a, b) => b.length - a.length);
    const pm = /^\[?\s*([A-Za-z0-9_]{3,16})\s*(?:->|→)\s*(?:я|me|[A-Za-z0-9_]{3,16})\s*\]?\s*:?\s*(.+)$/i.exec(text);
    if (pm && names.includes(pm[1])) return { from: pm[1], text: pm[2].trim(), whisper: true };
    const sep = text.search(/[:>»]/);
    if (sep < 0) return null;
    const head = text.slice(0, sep);
    const from = names.find((n) => new RegExp(`(^|[^A-Za-z0-9_])${n}([^A-Za-z0-9_]|$)`).test(head));
    if (!from) return null;
    return { from, text: text.slice(sep + 1).trim(), whisper: false };
  }

  /** Сказать в канал: личка - /msg ник, ближний - «!текст» (TotemEssentialsAddon), общий - обычный чат. */
  /** Куда показывает игрок: блок под его взглядом (до 8 бл.), последний удар по блоку, присед за 10 с. Текстом для мозга. */
  pointing(name) {
    const b = this.bot, e = this.player(name);
    if (!b || !e) return '';
    const out = [];
    try {
      const eye = e.position.offset(0, 1.62, 0);
      const dir = new Vec3(-Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), -Math.cos(e.yaw) * Math.cos(e.pitch));
      const hit = b.world.raycast(eye, dir, 8);
      if (hit && hit.name !== 'air') out.push(`смотрит на ${hit.name} ${hit.position.x} ${hit.position.y} ${hit.position.z}`);
    } catch {}
    const gs = this.gestures && this.gestures.get(name);
    if (gs && gs.poke && Date.now() - gs.poke.at < 60000) out.push(`ударил рукой по ${gs.poke.name} ${gs.poke.x} ${gs.poke.y} ${gs.poke.z} (${Math.round((Date.now() - gs.poke.at) / 1000)} с назад)`);
    if (gs) { const n = gs.crouch.filter((t) => Date.now() - t < 10000).length; if (n) out.push(`приседал ${n} раз за 10 с`); }
    return out.join('; ');
  }

  say(text, channel = 'global', to = '') {
    if (!this.bot || this.status !== 'online') return;
    let t = String(text).replace(/^[/!]+/, '').slice(0, 240);   // своя реплика не должна стать командой
    if (!t) return;
    // тихий режим (lifeview.js): только личка; общий и ближний чат - молча (в журнал)
    if (this.opts.quiet && !(channel === 'whisper' && to)) { this.log('(тихо, не сказано) ' + t); if (this.thought) this.thought(t, false); return; }
    if (this.thought) this.thought(t, true);
    if (channel === 'whisper' && to) t = `/msg ${to} ${t}`;
    else if (channel === 'local') t = '!' + t;
    else if (channel === 'global') t = '/g ' + t;
    else if (channel === 'clan') t = '/. ' + t;   // клановый чат (SimpleClans на сервере: «/. текст»)
    this.bot.chat(t);
  }

  // --- состояние для Qwen
  player(name) {
    const p = this.bot && this.bot.players[name];
    return p && p.entity ? p.entity : null;
  }

  state() {
    const b = this.bot;
    if (!b || this.status !== 'online' || !b.entity) return { status: this.status };
    const p = b.entity.position;
    const items = {};
    for (const it of b.inventory.items()) items[it.name] = (items[it.name] || 0) + it.count;
    const near = Object.values(b.players).filter((pl) => pl.entity && pl.username !== b.username)
      .map((pl) => ({ name: pl.username, dist: Math.round(pl.entity.position.distanceTo(p)) }))
      .filter((x) => x.dist <= 48).sort((x, y) => x.dist - y.dist);
    return {
      status: this.status, dim: this.dimName(), pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)],
      health: Math.round(b.health), food: b.food, items, near, mode: this.mode, follow: this.followName, task: this.task,
      parts: this.healthState ? this.healthState() : [],   // сбои частей тела (раньше затирали здоровье)
      life: this.lifeView ? this.lifeView() : null,
      errand: (() => { const e = this.errand && this.errand(); return e && e.state !== 'done' && e.state !== 'cancel' ? { state: e.state, cur: e.cur, text: e.text, steps: e.steps.map((s) => ({ title: s.title, st: s.st, note: s.note || '' })) } : null; })(),
    };
  }

  // --- фоновое поведение: взгляд как у человека, еда, слежение за тем, за кем идём
  loops() {
    const b = this.bot;
    // Сервер 1.21.2+ применяет шаги игрока только после пакета «конец тика клиента», mineflayer его не шлёт:
    // без него сервер считает, что бот стоит на месте (проверено на стенде 26.3, 15.11.2026).
    // Порядок пакетов как у настоящего клиента: «конец тика» прошлого тика → действия этого тика (удар) → движение.
    // physicsTick у mineflayer вызывается до отправки движения, поэтому tick_end здесь закрывает прошлый тик, а удар
    // (guard.combatTick) уходит синхронно внутри этого тика. Без tick_end сервер 1.21.2+ не применяет шаги; удар вне
    // тика (из async-кода) Vulcan отмечал как Kill Aura / Aim (стенд 15.11, 36 отметок; после правки - ноль).
    this.trace = new (require('./movetrace').MoveTrace)(this, require('path').join(process.env.TOTEMBOTS_LOCAL || require('path').join(__dirname, '..', 'local'), 'logs'));
    b.on('physicsTick', () => {
      try { if (this._interactQ) this.interactTick(); } catch {}   // клик по существу - в тике, как клиент (vehicles.js)
      try { b._client.write('tick_end', {}); } catch {}
      this.lookTick();
      if (this.guard) this.guard.combatTick();
      // своё плавание (swim.js); не взялось (суша впереди, нет пути) - старая логика воды и выхода на берег
      // Вода - только swim.js (22.11: прыгал без конца - кроме него клавишами в воде управляли старое плавание water.js и
      // толчок на берег, и каждый тянул своё). Порядок: воздух -> путь -> держаться на воде. Толчок на берег - только
      // когда swim.js сам ведёт к берегу (shoreNode)
      { const sw = require('./swim'); sw.swimPhysics(this);
        this._waterBy = sw.airTick(this) ? 'воздух' : sw.swimTick(this) ? (this.shoreNode ? 'к берегу' : 'плыву') : sw.floatTick(this) ? 'на плаву' : '';
        if (this._waterBy === 'к берегу') this.waterExitTick();
        // «прыжок в очереди» mineflayer: модуль пути жмёт прыжок в воде каждый такт, а флаг очереди в воде сам не
        // сбрасывается - тело всплывало и подпрыгивало, хотя клавиша отпущена (стенд 26.3, 22.11: не нырял за хозяином)
        if (this._waterBy && !b.getControlState('jump')) b.jumpQueued = false; }
      try { this.dodgeTick(); } catch {}   // уворот от стрел и огненных шаров (chores.js)
      try { this.trace.tick(); } catch {}   // журнал движения - в конце такта: клавиши такие, какие ушли на сервер
    });
    this.timer = setInterval(() => this.slowTick().catch(() => {}), 1000);
  }

  lookTick() {
    const b = this.bot;
    if (!b || !b.entity || b.pathfinder.isMoving() || this.busyLook || this.mode === 'task' || (this.guard && this.guard.fighting)) return;
    const t = this.lookTarget;
    if (!t) return;
    // эндермену в глаза не смотреть - разозлится (Энд, ночь): цель взгляда у его головы - не поворачиваться
    if (Object.values(b.entities).some((e) => e.name === 'enderman' && e.position && t.distanceTo(e.position.offset(0, 2.6, 0)) < 1.6)) return;
    const eye = b.entity.position.offset(0, b.entity.height * 0.9, 0);
    const d = t.minus(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z));
    let dy = yaw - b.entity.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const dp = pitch - b.entity.pitch;
    if (Math.abs(dy) < 0.02 && Math.abs(dp) < 0.02) return;
    // плавный поворот: доля пути за тик, не мгновенно
    const k = 0.18;
    b.look(b.entity.yaw + dy * k, b.entity.pitch + dp * k, true);
  }

  async slowTick() {
    const b = this.bot;
    if (!b || !b.entity) return;
    // каждая часть - через tick(): выключатель, изоляция сбоя (не молчит - считается и видна), бюджет времени
    this.tick('perception', () => this.senseTick());
    this.tick('features', () => this.featuresTick());   // дороги и разметка вокруг (features.js)
    this.tick('teach', () => this.teachTick());   // «покажу дорогу» - запись пути хозяина (navgraph.js)
    this.tick('atlas', () => this.atlasTick());
    this.tick('senses', () => this.sensesTick());
    this.tick('marks', () => this.marksTick());
    if (this.worldMap) this.tick('atlas', () => this.worldMap.seenTick(this));   // места на карту - только увиденные
    this.tick('torches', () => this.torchTick());
    this.tick('hands', () => this.handsTick());
    this.tick('reflexes', () => this.reflexTick());
    this.tick('zones', () => this.zonesTick());
    this.tick('edge', () => this.edgeTick());
    this.tick('closeBehind', () => this.closeBehindTick());   // присед у обрыва (chores.js)
    this.tick('kit', () => this.kitTick());     // быстрый доступ, починка опытом   // запретные и опасные зоны (zones.js)
    this.tick('water', () => this.shoreTick());
    this.tick('companion', () => this.companionTick());
    this.tick('lifeview', () => this.lifeTick());   // песочница, жесты, реплики (companion.js)
    // взгляд: на того, за кем идём, иногда по сторонам
    const owner = this.followName ? this.player(this.followName) : null;
    const nearest = Object.values(b.players).filter((p) => p.entity && p.username !== b.username)
      .map((p) => p.entity).sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
    const focus = owner || (nearest && nearest.position.distanceTo(b.entity.position) < 8 ? nearest : null);
    if (this.partOn('companion') && this.gazePick) {   // взгляд по вниманию: кто заговорил, звук, куда смотрит хозяин
      if (Math.random() < 0.5 || (this.attendUntil || 0) > Date.now()) { const g = this.gazePick(); if (g) this.lookTarget = g; }
    } else if (Math.random() < 0.15 || !focus) {
      if (Math.random() < 0.3) this.lookTarget = b.entity.position.offset(rnd(-8, 8), rnd(0, 3), rnd(-8, 8));
    } else {
      this.lookTarget = focus.position.offset(0, focus.height * 0.9, 0);
    }
    await this.eatTick();
    this.airTick();
    this.stuckTick();
    this.sleepTick().catch(() => {});
    // в воде без дела - всплывать (держать прыжок), как игрок; иначе бот тонет
    if (!this.busyLook && !this._waterBy) {   // busyLook - бот сам ведёт движение; в воде клавиши у swim.js
      const here = b.blockAt(b.entity.position.offset(0, 1, 0));
      const inWater = here && /water|kelp|seagrass|bubble_column/.test(here.name);
      if (inWater && !b.pathfinder.isMoving() && !this._trailBusy) { b.setControlState('jump', true); this.swimming = true; }
      else if (this.swimming) { b.setControlState('jump', false); this.swimming = false; }
    }
    this.notice().catch(() => {});
    if (this.travel && this.travel.trails) {
      const { dkey } = require('./travel');
      const d = dkey(b.game.dimension), at = b.blockAt(b.entity.position);
      this.trailState = this.trailState || {};
      if (b.entity.onGround && at && !/water|lava|nether_portal/.test(at.name)) this.travel.trails.step(d, b.entity.position, this.trailState);
      else if (at && /nether_portal/.test(at.name)) this.travel.trails.forget(this.trailState);
      if (b.entity.onGround && at && !/water|lava|nether_portal/.test(at.name)) this.travel.trails.tread(d, b.entity.position);
      // где ходят игроки: их пути - тоже тропы (дальние маршруты по хабу и метро, которые бот сам не проходил),
      // а клетки - «натоптанные» (проходы между домами, дорожки из любых блоков находятся сами)
      this.peerTrail = this.peerTrail || new Map();
      for (const pl of Object.values(b.players)) {
        const e = pl.entity;
        if (!e || pl.username === b.username || e.position.distanceTo(b.entity.position) > 64) continue;
        const under = b.blockAt(e.position.offset(0, -0.2, 0)), feet = b.blockAt(e.position);
        if (!under || under.boundingBox !== 'block' && !(under.shapes && under.shapes.length) || (feet && /water|lava|nether_portal/.test(feet.name))) continue;
        if (!this.peerTrail.has(pl.username)) this.peerTrail.set(pl.username, {});
        this.travel.trails.step(d, e.position, this.peerTrail.get(pl.username));
        this.travel.trails.tread(d, e.position);
      }
      if ((this._trSave = (this._trSave || 0) + 1) % 30 === 0) { this.travel.trails.save(d); this.travel.trails.saveHeat(d); }
    }
    // в портале после перехода не стоять - затянет обратно (16.11: «сколько раз говорил!!!»); только если не заходим нарочно
    {
      const at = b.blockAt(b.entity.position);
      if (at && at.name === 'nether_portal' && !this.portalTask && !b.pathfinder.isMoving() && !(this.mode === 'follow' && this.followName && !this.player(this.followName)) && Date.now() - (this.arrivedAt || 0) > 1500 && Date.now() - (this.portalStepAt || 0) > 4000) {
        this.portalStepAt = Date.now();
        const p0 = b.entity.position.floored();
        const out = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => p0.offset(dx, 0, dz))
          .find((v) => { const f = b.blockAt(v), h = b.blockAt(v.offset(0, 1, 0)), u = b.blockAt(v.offset(0, -1, 0)); return f && h && u && f.boundingBox === 'empty' && f.name !== 'nether_portal' && h.boundingBox === 'empty' && u.boundingBox === 'block' && !/lava/.test(f.name); });
        if (out) { this.log('стою в портале - отхожу, чтобы не затянуло'); const was = b.pathfinder.goal; b.pathfinder.setGoal(new goals.GoalBlock(out.x, out.y, out.z)); if (was && this.mode === 'follow') setTimeout(() => { try { if (this.mode === 'follow' && this.followName) this.follow(this.followName); } catch {} }, 1500); }
      }
    }
    // инвентарь полон - сказать мозгу один раз (16.11: не брал шерсть, и никто не понимал почему)
    {
      const full = b.inventory.emptySlotCount() === 0;
      if (full && !this.fullSaid) { this.fullSaid = true; this.event('инвентарь полон: подобрать ничего не можешь - выложи лишнее в сундук (!putInChest) или выброси (!discard)', true); }
      else if (!full) this.fullSaid = false;
    }
    // компаньон: потерял из виду - сказать один раз
    // Хозяин нырнул или ушёл за угол - сервер перестаёт присылать игрока, и бот терял его («пропал из виду», 22.11:
    // хозяин на дно - бот за ним не поплыл). Как человек: идти туда, где видел последний раз (и под воду), минуту;
    // появился снова - опять следом (новый объект игрока - новая цель).
    if (this.mode === 'follow') {
      if (owner) {
        this.lastSeen = { name: this.followName, pos: owner.position.clone(), at: Date.now(), dim: b.game.dimension };
        if (this.lostReported || this._followEnt !== owner) { this.lostReported = false; this._seekLast = false; this._followEnt = owner; b.pathfinder.setGoal(new goals.GoalFollow(owner, this.followDist()), true); }
      } else {
        const L = this.lastSeen;
        // исчез у портала - ушёл в портал: за ним, в тот же портал (24.11: «я в портал зашёл, ты не видел?» - бот бежал
        // туда, где видел его последний раз, и терялся)
        if (L && L.name === this.followName && L.dim === b.game.dimension && Date.now() - L.at < 8000 && !this._portalChase) {
          const portal = b.findBlocks({ point: L.pos, matching: (bl) => bl.name === 'nether_portal' || bl.name === 'end_portal', maxDistance: 3, count: 1 })[0];
          if (portal) {
            this._portalChase = true; this.log(`${this.followName} ушёл в портал - иду следом`);
            this.run([{ act: 'portal', x: portal.x, y: portal.y, z: portal.z }, { act: 'follow', who: this.followName }], 'за хозяином в портал', 'master').catch(() => {}).finally(() => { this._portalChase = false; });
            return;
          }
        }
        // последнее место из другого мира - не годится (после портала бежал туда «куда глаза глядят», 24.11): ждать у портала
        if (L && L.name === this.followName && L.dim !== b.game.dimension) { if (!this.lostReported) { this.lostReported = true; this._seekLast = false; try { b.pathfinder.setGoal(null); } catch {} this.event(`${this.followName} не видно в этом мире - жду его здесь, у портала`, true); } return; }
        if (L && L.name === this.followName && Date.now() - L.at < 60000) {
          if (!this._seekLast) { this._seekLast = true; this.log(`${this.followName} не видно - иду, где видно было последний раз: ${Math.floor(L.pos.x)} ${Math.floor(L.pos.y)} ${Math.floor(L.pos.z)}`); b.pathfinder.setGoal(new goals.GoalNear(L.pos.x, L.pos.y, L.pos.z, 1.5)); }
        } else if (!this.lostReported) { this.lostReported = true; this._seekLast = false; this.event(`${this.followName} пропал из виду (далеко или в другом измерении)`, true); }
      }
    }
  }

  // Еда по образцу Meteor AutoEat: чёрный список (вредное и хорус - телепортирует), лучшее по сытости и насыщению.
  // Голод < 14 - есть; здоровье неполное и голод < 18 вне боя - доесть для лечения.
  // Золотое яблоко (AutoGap): opts.gapple = 'emergency' (по умолчанию: бой и здоровье <= 8) или 'never'.
  async eatTick() {
    const b = this.bot;
    if (this.eating || !b.registry.foodsByName) return;
    const BAD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew',
      'chicken', 'golden_apple', 'enchanted_golden_apple']);
    const fighting = this.guard && this.guard.fighting;
    let pick = null;
    if ((this.opts.gapple || 'emergency') === 'emergency' && fighting && b.health <= 8) {
      pick = b.inventory.items().find((i) => i.name === (b.health <= 4 ? 'enchanted_golden_apple' : 'golden_apple'))
        || b.inventory.items().find((i) => /golden_apple$/.test(i.name));
    }
    const hungry = b.food < 14 || (b.health < 20 && b.food < 18 && !fighting);
    if (!pick && hungry && b.food < 20) {
      const score = (i) => { const f = b.registry.foodsByName[i.name]; return f ? f.foodPoints + f.saturation : -1; };
      pick = b.inventory.items().filter((i) => b.registry.foodsByName[i.name] && !BAD.has(i.name)).sort((x, y) => score(y) - score(x))[0];
      // совсем голодно и нормальной еды нет - гнилая плоть лучше голодной смерти
      if (!pick && b.food <= 6) pick = b.inventory.items().find((i) => i.name === 'rotten_flesh');
    }
    if (!pick) return;
    this.eating = true;
    try { await this.eatNow(pick); this.log('съел ' + pick.name); } catch (e) { this.log('не смог поесть: ' + e.message); } finally { this.eating = false; }
  }

  // Сторож застревания (Baritone: movementTimeoutTicks): путь идёт, а бот 5 с почти на месте -
  // прыжок и шаг назад, путь заново; три раза подряд - сообщить мозгу.
  stuckTick() {
    const b = this.bot;
    if (!b.pathfinder.isMoving() || this._waterBy === 'воздух') { this.stuck = null; return; }
    const p = b.entity.position;
    if (!this.stuck || p.distanceTo(this.stuck.at) > 1) { this.stuck = { at: p.clone(), since: Date.now(), tries: this.stuck ? this.stuck.tries : 0 }; return; }
    // путь есть, а ни одна клавиша не нажата: модуль пути решил, что «не пройти» (тело у самого забора, фонаря, угла),
    // и стоит минутами (23.11: у заборов с фонарями, «пройти было изи»). Как игрок: шаг к следующей точке пути руками,
    // и путь заново - без прыжков и шагов назад
    const keys = ['forward', 'back', 'left', 'right', 'jump'].some((k) => b.getControlState(k));
    const nxt = ((this.lastPath || {}).path || []).find((n) => Math.hypot(n.x + 0.5 - p.x, n.z + 0.5 - p.z) > 0.6);
    if (!keys && nxt && Date.now() - this.stuck.since > 1500 && Date.now() - (this._nudgeAt || 0) > 2500 && !b.vehicle && !this.busyLook) {
      this._nudgeAt = Date.now();
      this.log(`путь есть, а стою - шаг к ${Math.floor(nxt.x)} ${Math.floor(nxt.z)} сам`);
      this.busyLook = true;
      b.lookAt(new Vec3(nxt.x + 0.5, p.y + 1.6, nxt.z + 0.5), true).then(() => {
        b.setControlState('forward', true);
        setTimeout(() => { try { b.setControlState('forward', false); } catch {} this.busyLook = false; try { if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 600);   // путь заново той же цели (setGoal оборвал бы дело: «goal changed»)
      }).catch(() => { this.busyLook = false; });
      return;
    }
    if (Date.now() - this.stuck.since < 5000) return;
    this.stuck.tries++;
    this.stuck.since = Date.now();
    // запись для разбора: цель, сколько до неё, следующие шаги пути, блоки вокруг
    {
      const g = b.pathfinder.goal, lp = this.lastPath || {};
      const gp = g && (g.entity ? g.entity.position : (g.x !== undefined ? new Vec3(g.x, g.y !== undefined ? g.y : p.y, g.z) : null));
      const fl = p.floored(), around = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) around.push(`${dx},${dz}:${(b.blockAt(fl.offset(dx, 0, dz)) || {}).name}/${(b.blockAt(fl.offset(dx, 1, dz)) || {}).name}`);
      this.log(`застрял: я ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}, цель ${g ? g.constructor.name : 'нет'}${gp ? ' до неё ' + gp.distanceTo(p).toFixed(1) : ''}, путь ${lp.status || '?'} ${(lp.path || []).slice(0, 3).map((n) => `${Math.floor(n.x)},${Math.floor(n.y)},${Math.floor(n.z)}`).join(' ')}, под ногами ${(b.blockAt(fl.offset(0, -1, 0)) || {}).name}, вокруг ${around.join(' ')}, земля ${b.entity.onGround}`);
    }
    this.log('застрял, пробую выбраться (' + this.stuck.tries + ')');
    if (this.stuck.tries >= 2) this.dumpArea('застрял');
    this.ev('застрял', { tries: this.stuck.tries, goal: b.pathfinder.goal ? b.pathfinder.goal.constructor.name : '' });
    // водоросли и трава в воде держат тело («застрял в водорослях», 15.11): срезать их вокруг - ломаются мгновенно, природное
    {
      const fl = p.floored(), weeds = [];
      for (let dy = 0; dy <= 1; dy++) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = b.blockAt(fl.offset(dx, dy, dz));
        // лиан тут нет: их сажают игроки (23.11, владелец: «лианы зачем-то ломал» - срезал их здесь, застряв у борта)
        if (k && /^(kelp|kelp_plant|seagrass|tall_seagrass|short_grass|tall_grass|fern|large_fern)$/.test(k.name)) weeds.push(k);
      }
      if (weeds.length) {
        this.log('срезаю водоросли и траву вокруг: ' + weeds.length);
        (async () => { for (const k of weeds.slice(0, 6)) { try { await b.dig(k, true); } catch {} } try { if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} })();
        return;
      }
    }
    // в воде - как игрок: вперёд с прыжком (выплыть на уступ); на суше - прыжок и шаг назад
    const feetW = b.blockAt(b.entity.position);
    const swim = feetW && /water/.test(feetW.name);
    // над головой блок - прыгать бесполезно (удар о потолок Vulcan видит как Jump C): только шаг назад
    const head = b.blockAt(b.entity.position.offset(0, 2.2, 0));
    if (!swim && head && head.boundingBox === 'block') { b.setControlState('back', true); setTimeout(() => { try { b.setControlState('back', false); if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 400); return; }
    // застрял, а цель рядом за стеной (скрытая дверь, хозяин прошёл через поршни): кнопка, рычаг, плита (23.11)
    {
      const g = b.pathfinder.goal, gp = g && (g.entity ? g.entity.position : (g.x !== undefined ? { x: g.x, y: g.y, z: g.z } : null));
      if (gp && this.stuck.tries <= 2 && !this._mechBusy) {
        this._mechBusy = true;
        this.useMechanism(gp, this.token).then((m) => { if (m) { this.log(m + ' - пробую пройти'); try { b.pathfinder.setGoal(g, true); } catch {} } }).catch(() => {}).finally(() => { this._mechBusy = false; });
      }
    }
    // у забора, стены, калитки - не прыжок назад (23.11: «прыгает нонстопом, ходит задом» - так выбирался каждые 5 с),
    // а шаг вбок вдоль забора, по очереди влево и вправо
    {
      const fl = p.floored();
      const fence = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => { const k = b.blockAt(fl.offset(dx, 0, dz)); return k && /_fence|_wall$|_gate$|iron_bars|_pane$/.test(k.name); });
      if (!swim && fence) {
        const side = (this._sideFlip = !this._sideFlip) ? 'left' : 'right';
        b.setControlState(side, true);
        setTimeout(() => { try { b.setControlState(side, false); if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 350);
        return;
      }
    }
    const dir = swim ? 'forward' : 'back';
    // в воде у уступа - лицом к следующей точке пути, потом рывок вперёд с прыжком (23.11: у секретной двери плыл в
    // течении, жал «вперёд» не туда и 30 с не мог выйти на блок выше)
    if (swim) {
      // иду за хозяином и застрял в воде - его следом, под водой (23.11: всплывал в течении и не входил в проём)
      if (this.mode === 'follow' && this.followName && !this._trailBusy) {
        this._trailBusy = true; try { b.pathfinder.setGoal(null); } catch {}
        this.walkTrail(this.followName).then((m) => { if (m) this.log(m); }).catch(() => {}).finally(() => { this._trailBusy = false; });
        return;
      }
      const nx = ((this.lastPath || {}).path || []).find((n) => Math.hypot(n.x + 0.5 - p.x, n.z + 0.5 - p.z) > 0.6);
      if (nx) {
        // точка пути не выше ног - не прыгать (прыжок в воде = всплыть, течение сносит): вперёд, ниже - с приседом
        const lower = nx.y <= p.y - 1.2;   // ямка у уступа: точка на том же уровне - тоже прыгать (23.11: 215 69 у входа)
        try { b.lookAt(new Vec3(nx.x + 0.5, nx.y + 0.5, nx.z + 0.5), true); } catch {}
        b.setControlState('sprint', true); b.setControlState('forward', true); b.setControlState('sneak', lower); b.setControlState('jump', !lower && nx.y > p.y - 0.6);
        setTimeout(() => { try { for (const k of ['sprint', 'forward', 'sneak', 'jump']) b.setControlState(k, false); if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 1200);
        return;
      }
    }
    b.setControlState('jump', true);
    b.setControlState(dir, true);
    setTimeout(() => { try { b.setControlState('jump', false); b.setControlState(dir, false); /* новый путь к той же цели (setGoal оборвал бы текущий переход: «goal was changed») */ if (b.pathfinder.goal) b.pathfinder.setMovements(b.pathfinder.movements); } catch {} }, 400);
    if (this.stuck.tries === 3 && Date.now() - (this.stuckSaidAt || 0) > 180000) { this.stuckSaidAt = Date.now(); this.event('тело застряло и не может пройти дальше (тело пробует выбраться само; писать об этом в чат не нужно)', true); }
  }

  // Сон: на сервере ночь пропускается, когда спят все не-AFK. Кто-то лёг, ночь, кровать в 16 блоках - ложимся.
  // Утром mineflayer будит сам; кровать запоминаем (Baritone doBedWaypoints).
  async sleepTick() {
    const b = this.bot;
    if (this.opts.sleep === false || b.isSleeping || this.mode === 'task' || this.sleepTry > Date.now()) return;
    const t = b.time && b.time.timeOfDay;
    const night = t !== undefined && t >= 12542 && t <= 23460;
    if (!night && !b.thunderState) return;
    const someoneSleeps = [...(this.sleepers || [])].some((id) => b.entities[id] && b.entities[id].type === 'player');
    if (!someoneSleeps) return;
    if (this.guard && this.guard.fighting) return;
    const bed = b.findBlock({ matching: (bl) => /_bed$/.test(bl.name), maxDistance: 16 });
    if (!bed) { this.sleepTry = Date.now() + 60000; return; }
    this.sleepTry = Date.now() + 30000;
    try {
      await this.toBed(bed, this.token, 20000);
      await b.sleep(bed);
      this.log('лёг спать');
      if (this.memory) this.memory.place({ name: `кровать у ${bed.position.x} ${bed.position.z}`, x: bed.position.x, y: bed.position.y, z: bed.position.z, dim: this.dimName(), note: 'спал тут' }, this.opts.name);
      b.once('wake', () => { this.log('проснулся'); if (this.followName && this.player(this.followName)) this.follow(this.followName); });
    } catch (e) { this.log('не смог лечь: ' + e.message); }
  }

  // Запретные места: в памяти место с пометкой «нельзя», «чужая», «не заходить» - путь обходит 16 блоков вокруг
  forbiddenCost(block) {
    if (!block || !block.position) return 0;
    // портал - только когда заходим нарочно (!enterPortal, дальний путь): иначе путь за хозяином шёл сквозь портал, и её
    // перекидывало туда-обратно (22.11)
    // сквозь портал пройти можно (перенос - только если стоять в нём ~4 с), но лучше обойти: цена, а не запрет
    if (block.name === 'nether_portal' && !this.portalTask) return 6;
    // опасный пол (магма, костёр) - pathfinder смотрит только блоки на уровне тела
    // с запасом в блок: на углу бот срезает диагональ и цепляет край
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const floor = this.bot.blockAt(block.position.offset(dx, -1, dz), false);
      if (floor && /^(magma_block|campfire|soul_campfire)$/.test(floor.name)) return dx || dz ? 20 : 100;
    }
    const m = this.memory;
    if (!m) return 0;
    const dim = this.dimName();
    // зоны (zones.js): запрет - клетка закрыта, опасно (смерть, блейзы) - дорого
    void dim;
    return this.zoneCost(block.position.x + 0.5, block.position.z + 0.5);
  }

  // Сам замечает и запоминает: порталы рядом, новых игроков. Раз в 10 с, дёшево.
  async notice() {
    const b = this.bot, m = this.memory;
    if (!m || !b || !b.entity) return;
    const t = Date.now();
    if (t - (this.noticedAt || 0) < 10000) return;
    this.noticedAt = t;
    const me = b.entity.position, dim = this.dimName();
    const portal = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 24 });
    if (portal) {
      const p = portal.position;
      const known = Object.values(m.data.places).some((x) => x.dim === dim && Math.hypot(x.x - p.x, x.y - p.y, x.z - p.z) < 12);
      if (!known) {
        try { if (this.linkAdd && this._lastPortalFrom && this._lastPortalFrom.dim !== dim) this.linkAdd({ a: this._lastPortalFrom.name, b: `портал ${dim === 'Незер' ? 'в Незере' : 'в обычном мире'} ${p.x} ${p.z}`, how: 'через портал', dim }); } catch {}
        const r = m.place({ name: `портал ${dim === 'Незер' ? 'в Незере' : 'в обычном мире'} ${p.x} ${p.z}`, x: p.x, y: p.y, z: p.z, dim, note: 'нашёл сам' }, this.opts.name);
        this.log(r);
        this.event(`найден портал в Незер: ${p.x} ${p.y} ${p.z} (${dim}), записан в память`, false);
        this._lastPortalFrom = { name: `портал ${dim === 'Незер' ? 'в Незере' : 'в обычном мире'} ${p.x} ${p.z}`, dim };   // связь «портал - портал» при следующем
      }
    }
    this.met = this.met || new Set();
    for (const pl of Object.values(b.players)) {
      if (!pl.entity || pl.username === b.username || this.met.has(pl.username)) continue;
      if (pl.entity.position.distanceTo(me) > 16) continue;
      this.met.add(pl.username);
      const where = m.nearestPlace(me, dim);
      m.journal(this.opts.name, `встретил ${pl.username}${where ? ' у места «' + where.name + '»' : ''}`);
    }
  }

  // Чутьё раз в секунду, дёшево: стоит ли в портале (для пар порталов), где видел игроков (радар Xaero, но с памятью),
  // и заметные перемены (ночь, утро, дождь, знакомый снова рядом) - мозгу как «момент», он сам решит, реагировать ли.
  senseTick() {
    const b = this.bot, me = b.entity.position, now = Date.now(), dim = this.dimName();
    try {
      const at = b.blockAt(me);
      if (at && at.name === 'nether_portal') this.inPortal = { pos: { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) }, at: now };
    } catch {}
    this.seen = this.seen || {};
    this.closeAt = this.closeAt || {};
    for (const pl of Object.values(b.players)) {
      if (!pl.entity || pl.username === b.username) continue;
      const p = pl.entity.position;
      this.seen[pl.username] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim, at: now };
      if (p.distanceTo(me) <= 16) {
        const last = this.closeAt[pl.username];
        if (last && now - last > 10 * 60000) this.emit('moment', { kind: 'встреча:' + pl.username, who: pl.username, text: `${pl.username} снова рядом (не виделись ${Math.round((now - last) / 60000)} мин)` });
        if (!last) this.closeAt[pl.username] = now - 1;   // первая встреча за сеанс - без «снова»
        this.closeAt[pl.username] = now;
      }
    }
    const t = b.time && b.time.timeOfDay;
    if (t !== undefined) {
      const night = t >= 13000 && t < 23000;
      if (this.wasNight !== undefined && night !== this.wasNight) this.emit('moment', night ? { kind: 'ночь', text: 'стемнело, наступает ночь' } : { kind: 'утро', text: 'рассвело' });
      this.wasNight = night;
    }
    const rain = !!this.precip();
    if (this.wasRain !== undefined && rain && !this.wasRain) this.emit('moment', { kind: 'дождь', text: (this.precip() === 'снег' ? 'пошёл снег' : 'пошёл дождь') + (b.thunderState > 0.3 ? ', гроза' : '') });
    this.wasRain = rain;
  }

  /** Как игрок: в основной руке - оружие или инструмент, а не тотем и не случайный блок; тотем - во второй руке. */
  async handsTick() {
    const b = this.bot;
    if (this.mode === 'task' || this.busyLook || this.eating || (this.guard && this.guard.fighting)) return;
    if (Date.now() - (this.handsAt || 0) < 15000) return;
    this.handsAt = Date.now();
    const items = b.inventory.items();
    const off = b.inventory.slots[45];
    const totem = items.find((i) => i.name === 'totem_of_undying');
    if (totem && (!off || off.name !== 'totem_of_undying')) { await b.equip(totem, 'off-hand'); return; }
    const held = b.heldItem;
    const W = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe'];
    const best = W.map((n) => items.find((i) => i.name === n)).find(Boolean);
    const odd = held && !W.includes(held.name) && !/pickaxe|shovel|_axe|hoe|fishing_rod|shield|bow|crossbow|trident|mace|spear/.test(held.name);
    if (best && (!held || odd)) { await b.equip(best, 'hand'); return; }
    if (!best && odd) { try { await b.unequip('hand'); } catch {} }
  }

  /** Надеть или взять в руку: броня - на тело, щит и тотем - во вторую руку, остальное - в основную. */
  async equipItem(a) {
    const b = this.bot, q = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const it = b.inventory.items().find((i) => i.name === q) || b.inventory.items().find((i) => i.name.includes(q));
    if (!it) throw new Error(`нет в инвентаре: ${q}`);
    const dest = /_helmet$|turtle_helmet/.test(it.name) ? 'head' : /_chestplate$|^elytra$/.test(it.name) ? 'torso' : /_leggings$/.test(it.name) ? 'legs' : /_boots$/.test(it.name) ? 'feet' : /^(shield|totem_of_undying)$/.test(it.name) ? 'off-hand' : 'hand';
    await b.equip(it, dest);
    this.handsAt = Date.now() + 120000;   // сам выбрал, что держать - порядок в руках пока не трогает
    return `надел/взял ${it.name}`;
  }

  /**
   * Съесть предмет, как игрок: взять в руку, держать «использовать» ~1,8 с, отпустить. bot.consume() на 26.3 через
   * ViaVersion часто не дожидается ответа сервера (Promise timed out при 8 здоровья, 15.11). Успех - предмета стало
   * меньше или еда выросла. Две попытки.
   */
  async eatNow(it) {
    const b = this.bot;
    const count = () => b.inventory.items().filter((i) => i.name === it.name).reduce((s, i) => s + i.count, 0);
    for (let t = 0; t < 2; t++) {
      const before = count(), food = b.food;
      await b.equip(it, 'hand');
      // во время еды не бежать (в игре на бегу не едят - античит ловил «Bad Packets», 25.11): бег выключить на время еды
      this._eating = Date.now(); try { b.setControlState('sprint', false); } catch {}
      await sleep(100);
      b.activateItem(false);
      const long = it.name === 'dried_kelp' ? 1000 : 1700;
      for (let w = 0; w < (long + 1500) / 100; w++) { await sleep(100); if (count() < before || b.food > food) break; }
      try { b.deactivateItem(); } catch {}
      if (count() < before || b.food > food) return;
      await sleep(300);
    }
    throw new Error(`не съелось ${it.name}`);
  }

  /** Поесть: названное или лучшее из того, что есть. */
  async eatItem(a) {
    const b = this.bot;
    const foods = b.registry.foodsByName || {};
    const q = String(a.item || '').toLowerCase().replace(/^minecraft:/, '');
    const BAD = /rotten_flesh|spider_eye|poisonous_potato|pufferfish|chorus_fruit|suspicious_stew|raw_chicken|chicken$/;
    const it = q ? b.inventory.items().find((i) => i.name === q)
      : b.inventory.items().filter((i) => foods[i.name] && !BAD.test(i.name)).sort((x, y) => (foods[y.name].foodPoints || 0) - (foods[x.name].foodPoints || 0))[0];
    if (!it) throw new Error(q ? `нет в инвентаре: ${q}` : 'нечего есть');
    if (!foods[it.name]) throw new Error(`${it.name} не едят${it.name === 'kelp' ? ' (сырую ламинарию нельзя: сначала пожарить в печи -> dried_kelp)' : ''}`);
    if (b.food >= 20 && !/golden_apple/.test(it.name)) return 'не голоден';
    this.eating = true;
    try { await this.eatNow(it); } finally { this.eating = false; }
    return `съел ${it.name}`;
  }

  /** Команда сервера как у обычного игрока. Входа/пароля не касается (AuthMe - сам). */
  async serverCommand(a) {
    let t = String(a.text || '').trim();
    if (!t) throw new Error('пустая команда');
    if (!t.startsWith('/')) t = '/' + t;
    if (/^\/(login|l|register|reg|changepassword|cp|unregister|email|logout)\b/i.test(t)) throw new Error('эту команду не пишу');
    const before = this.lastSystem || [];
    this.lastSystem = [];
    this.bot.chat(t.slice(0, 250));
    await sleep(1500);
    const reply = (this.lastSystem || []).slice(-3).join(' | ');
    this.lastSystem = before.concat(this.lastSystem).slice(-10);
    return `${t}${reply ? ': сервер ответил: ' + reply.slice(0, 200) : ''}`;
  }

  /** Напасть на моба (не игрока): честный бой guard. */
  async attackMob(a, tok) {
    const b = this.bot, kind = String(a.mob || '').toLowerCase().replace(/^minecraft:/, '');
    const me = b.entity.position;
    const t = Object.values(b.entities).filter((e) => e.type !== 'player' && e.isValid && e !== b.entity && (!kind || (e.name || '') === kind || (e.name || '').includes(kind)) && e.position.distanceTo(me) < 32)
      .filter((e) => kind || !this.guard || this.guard.isHostile(e))   // без названия - только враждебных (не корову и не жителя)
      .sort((x, y) => x.position.distanceTo(me) - y.position.distanceTo(me))[0];
    if (!t) throw new Error(`рядом нет ${kind || 'врагов'}`);
    if (!this.guard) throw new Error('бой выключен');
    const was = this.guard.mode; if (was === 'off') this.guard.mode = 'defend';
    this.guard.prey = t.id;
    const until = Date.now() + 40000;
    try {
      while (t.isValid && Date.now() < until) {
        this.check(tok);
        if (t.position.distanceTo(b.entity.position) > 2.5) { try { await this.goto(new goals.GoalFollow(t, 2), tok, 4000); } catch (e) { if (e instanceof Cancelled) throw e; } }
        await sleep(250);
      }
    } finally { this.guard.prey = null; this.guard.mode = was; try { b.pathfinder.setGoal(null); } catch {} }
    await this.pickup({ radius: 6 }, tok).catch(() => {});
    return t.isValid ? `не добил ${t.name}` : `убил ${t.name}`;
  }

  /** Подойти к кровати вплотную (сервер пускает лечь только в ~2 блоках: «the bed is too far» с GoalNear 2 по диагонали и через этаж). */
  async toBed(bed, tok, ms) {
    const b = this.bot;
    // вплотную к кровати (соседняя клетка): «видеть» её мало - сквозь стену и с другого этажа сервер не даёт лечь (21.11)
    try { await this.goto(new goals.GoalGetToBlock(bed.position.x, bed.position.y, bed.position.z), tok, ms); }
    catch (e) { if (e instanceof Cancelled) throw e; await this.goto(new goals.GoalLookAtBlock(bed.position, b.world, { reach: 2 }), tok, ms); }
  }

  /** Лечь спать в кровать рядом (ночью или в грозу). */
  async goSleep(tok) {
    const b = this.bot;
    const bed = b.findBlock({ matching: (bl) => /_bed$/.test(bl.name), maxDistance: 32 });
    if (!bed) throw new Error('рядом нет кровати');
    const t = b.time && b.time.timeOfDay;
    if (t !== undefined && !(t >= 12542 && t <= 23460) && !b.thunderState) throw new Error('сейчас день - спать можно только ночью или в грозу');
    await this.toBed(bed, tok, 60000);
    await b.sleep(bed);
    try { this.autoMark('моя кровать', bed.position, { kind: 'моя кровать', one: true }); } catch {}
    return 'лёг спать';
  }

  /**
   * Рефлексы (как modes в Mindcraft), без нейросети: огонь/лава - выйти на безопасное; игрок вплотную - отойти;
   * темно и есть факелы - поставить; вещи рядом - подобрать. Только когда бот не занят заданием (кроме огня).
   */
  async reflexTick() {
    const b = this.bot, e = b.entity, now = Date.now();
    if (!e || this.busyLook) return;
    const p = e.position, feet = b.blockAt(p), under = b.blockAt(p.offset(0, -0.5, 0));
    const burning = (e.metadata && (e.metadata[0] & 0x01)) || (feet && /fire|lava/.test(feet.name)) || (under && /magma_block|campfire/.test(under.name));
    if (burning && now - (this.fireAt || 0) > 3000) {
      this.fireAt = now;
      const water = b.findBlock({ matching: (bl) => bl.name === 'water', maxDistance: 8 });
      let safe = water ? water.position : null;
      if (!safe) {
        for (let r = 2; r <= 6 && !safe; r++) for (let a = 0; a < 8 && !safe; a++) {
          const v = p.offset(Math.round(Math.cos(a * Math.PI / 4) * r), 0, Math.round(Math.sin(a * Math.PI / 4) * r)).floored();
          const f = b.blockAt(v), u = b.blockAt(v.offset(0, -1, 0)), h = b.blockAt(v.offset(0, 1, 0));
          if (f && h && u && f.boundingBox === 'empty' && h.boundingBox === 'empty' && u.boundingBox === 'block' && !/fire|lava/.test(f.name) && !/magma|lava|campfire/.test(u.name)) safe = v;
        }
      }
      if (safe) { this.log('горю - ухожу ' + (water ? 'в воду' : 'из огня')); try { b.pathfinder.setGoal(new goals.GoalNear(safe.x, safe.y, safe.z, 0)); } catch {} }
      return;
    }
    if (this.mode === 'task') return;
    // игрок вплотную (стоит в нас) - шаг в сторону, как живой
    if (this.mode === 'idle' && now - (this.elbowAt || 0) > 4000) {
      const close = Object.values(b.players).find((pl) => pl.entity && pl.username !== b.username && pl.entity.position.distanceTo(p) < 0.9);
      if (close) { this.elbowAt = now; try { b.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalNear(close.entity.position.x, close.entity.position.y, close.entity.position.z, 2))); setTimeout(() => { try { if (this.mode === 'idle') b.pathfinder.setGoal(null); } catch {} }, 1500); } catch {} return; }
    }
    // темно (свет блоков <= 2, неба нет) и есть факелы - поставить под ноги рядом, не у чужих построек
    if (now - (this.torchAt || 0) > 15000 && feet && (feet.light || 0) <= 2 && (feet.skyLight || 0) <= 2 && b.inventory.items().some((i) => i.name === 'torch')) {
      this.torchAt = now;
      if (!this.skills.builtNear(p.floored(), 6)) this.skills.place({ block: 'torch' }, this.token).then(() => this.log('поставил факел - темно')).catch(() => {});
      return;
    }
    // вещи на земле рядом - подобрать (стоит без дела)
    if (this.mode === 'idle' && now - (this.lootAt || 0) > 10000) {
      const drop = Object.values(b.entities).find((x) => x.name === 'item' && x.position && x.position.distanceTo(p) < 5);
      if (drop) { this.lootAt = now; this.pickup({ radius: 5 }, this.token).catch(() => {}); }
    }
  }

  /** Где последний раз видел игроков (по запросу мозга). */
  seenText() {
    const now = Date.now();
    const list = Object.entries(this.seen || {}).filter(([n]) => n !== this.opts.name).sort((a, c) => c[1].at - a[1].at).slice(0, 15)
      .map(([n, s]) => `${n}: ${s.x} ${s.y} ${s.z} (${s.dim}), ${now - s.at < 5000 ? 'сейчас' : Math.round((now - s.at) / 60000) + ' мин назад'}`);
    return list.join('; ') || 'пока никого не видел';
  }

  // Дальний путь: план (пешком или через Незер) и исполнение по шагам. Цель - место из памяти или координаты.
  async travelTo(a, tok) {
    this.travelling = true;   // в дороге - не отвлекаться на мобов (guard.js)
    try { return await this.travelToInner(a, tok); } finally { this.travelling = false; }
  }

  async travelToInner(a, tok) {
    const b = this.bot;
    if (!this.travel) throw new Error('нет модуля путей');
    let dest;
    if (a.place) {
      const pl = this.memory && this.memory.findPlace(a.place);
      if (!pl) throw new Error(`не знаю места «${a.place}»`);
      dest = { x: pl.x, y: pl.y, z: pl.z, dim: pl.dim, name: pl.name };
    } else {
      if (a.x === undefined || a.z === undefined) throw new Error('куда? нужны x и z или место');
      dest = { x: +a.x, y: a.y !== undefined ? +a.y : null, z: +a.z, dim: a.dim || this.dimName(), who: a.who };
    }
    let plan = this.travel.plan(b.entity.position, b.game.dimension, dest);
    // портал не знает (или цель очень далеко, а идти только пешком) - найти портал самой: спросить в чате и
    // поискать в поселениях, где они обычно стоят; потом план заново
    const far = Math.hypot(dest.x - b.entity.position.x, dest.z - b.entity.position.z);
    if (plan.error && /портал/.test(plan.error) || (!plan.error && /^пешком/.test(plan.text) && far > 1500 && /overworld/.test(b.game.dimension))) {
      if (await this.findPortal(tok)) plan = this.travel.plan(b.entity.position, b.game.dimension, dest);
    }
    if (plan.error) throw new Error(plan.error);
    this.log('путь: ' + plan.text);
    this.event('путь: ' + plan.text, false);
    const legTime = (d) => Math.max(120000, d / 3 * 1500);   // ~3 бл./с с запасом
    for (const s of plan.steps) {
      this.check(tok);
      const d = Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z);
      if (s.do === 'portal') await this.portal(s, tok);
      else if (s.do === 'find_portal') {
        // Незер: метро сервера расходится от незерхаба (0 0) ветками по осям (23.11, владелец: «красная ветка до
        // -8125»). Знаю хаб и цель далеко почти по оси - через хаб и вдоль ветки, а не напрямик по незерраку
        // известная подписанная дорога (ветка метро, тракт), что ведёт к цели, - к её началу и вдоль неё (features.js)
        let byRoad = false;
        try {
          const rt = this.roadToward && this.roadToward(this.dimName(), b.entity.position, s);
          if (rt) {
            const st = rt.road.start, along = Math.max(0, (s.x - st.x) * rt.ux + (s.z - st.z) * rt.uz);
            this.log(`к цели по дороге${rt.road.label ? ' «ветка ' + rt.road.label + '»' : ''} из ${rt.road.mat[0]}: от ${st.x} ${st.z}, ${Math.round(along)} бл.`);
            if (Math.hypot(st.x - b.entity.position.x, st.z - b.entity.position.z) > 4) await this.walkTo({ x: st.x, y: rt.road.y, z: st.z }, tok, legTime(Math.hypot(st.x - b.entity.position.x, st.z - b.entity.position.z)));
            await this.walkTo({ x: Math.round(st.x + rt.ux * along), y: rt.road.y, z: Math.round(st.z + rt.uz * along) }, tok, legTime(along));
            byRoad = true;
          }
        } catch (e) { if (e instanceof Cancelled) throw e; this.log('по дороге не вышло: ' + String(e.message).slice(0, 80)); }
        if (!byRoad) try {
          const hub = /nether/.test(b.game.dimension) && this.memory && (this.memory.findPlace('незерхаб') || this.memory.findPlace('хаб'));
          if (hub && hub.dim === this.dimName() && Math.hypot(s.x - hub.x, s.z - hub.z) > 150) {
            const ax = Math.abs(s.x - hub.x) < Math.abs(s.z - hub.z) * 0.35, az = Math.abs(s.z - hub.z) < Math.abs(s.x - hub.x) * 0.35;
            if (ax || az) {
              this.log(`Незер: к цели по ветке метро от незерхаба (${ax ? 'вдоль Z' : 'вдоль X'})`);
              if (Math.hypot(hub.x - b.entity.position.x, hub.z - b.entity.position.z) > 8) await this.walkTo({ x: hub.x, y: hub.y, z: hub.z }, tok, legTime(Math.hypot(hub.x - b.entity.position.x, hub.z - b.entity.position.z)));
              const w = ax ? { x: hub.x, z: s.z } : { x: s.x, z: hub.z };
              await this.walkTo({ x: w.x, y: hub.y, z: w.z }, tok, legTime(Math.hypot(w.x - hub.x, w.z - hub.z)));
            }
          }
        } catch (e) { if (e instanceof Cancelled) throw e; this.log('по ветке не вышло: ' + String(e.message).slice(0, 80)); }
        await this.goto(new goals.GoalNearXZ(s.x, s.z, 6), tok, legTime(Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z)));
        let pb = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 40 });
        // у расчётной точки портала нет - ближайший виденный в этом мире (кэш), до 400 бл. от неё
        if (!pb && this.passCacheShared) {
          const q = this.passCacheShared.nearest(String(b.game.dimension).replace(/^minecraft:/, ''), /^nether_portal$/, { x: s.x, y: b.entity.position.y, z: s.z }, 1, 400)[0];
          if (q) { this.log(`у ${s.x} ${s.z} портала нет - иду к ближайшему виденному ${q.x} ${q.z}`); await this.walkTo({ x: q.x, y: q.y, z: q.z }, tok, legTime(Math.hypot(q.x - s.x, q.z - s.z))); pb = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 16 }); }
        }
        // порталы к базам часто не точно на /8: в стороне, в ответвлении ветки. Прежде чем строить свой -
        // спросить того, к кому иду, и обойти окрестности (чанки грузятся - кэш видит порталы до ~150 бл.)
        if (!pb) pb = await this.searchExit(s, dest, tok);
        if (!pb && await this.portalHere(tok, `у ${s.x} ${s.z} в Незере не нашла портал к цели - строю свой`)) pb = b.findBlock({ matching: b.registry.blocksByName.nether_portal.id, maxDistance: 24 });
        if (!pb) throw new Error(`у ${s.x} ${s.z} (${this.dimName()}) портала нет, рядом не видела, а построить не из чего (нужно 10 обсидиана и огниво)`);
        await this.portal(pb.position, tok);
      } else await this.walkTo(s, tok, legTime(d));
    }
    const p = b.entity.position;
    return `дошёл${dest.name ? ' до «' + dest.name + '»' : ''} (${plan.text}), теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, ${this.dimName()}`;
  }

  /**
   * Выход у цели не на расчётной точке: (1) спросить того, к кому иду, где его портал в Незере (ответ с координатами);
   * (2) обойти окрестности кольцом (4 точки в 120 бл.), после каждой - ближайший портал в кэше мира в 400 бл.
   * Возвращает блок портала рядом или null. Свой портал строится только после этого (portalHere).
   */
  async searchExit(s, dest, tok) {
    const b = this.bot, dim = String(b.game.dimension).replace(/^minecraft:/, ''), id = b.registry.blocksByName.nether_portal.id;
    const near = () => b.findBlock({ matching: id, maxDistance: 48 });
    const go = async (q) => { try { await this.walkTo({ x: q.x, y: q.y, z: q.z }, tok, 180000); } catch (e) { if (this.isCancel(e)) throw e; } return near(); };
    const cached = (at) => (this.passCacheShared ? this.passCacheShared.nearest(dim, /^nether_portal$/, { x: at.x, y: b.entity.position.y, z: at.z }, 1, 400)[0] : null);
    if (dest.who && b.players[dest.who]) {
      this.say('Я в Незере рядом с вами. Где ваш портал в Незере? Напишите координаты (x z).', 'whisper', dest.who);
      const reply = await this.waitReply(dest.who, 90000);
      const p = reply && require('./chatpoints').parse('метка ' + reply);
      if (p) { this.log(`${dest.who} подсказал портал: ${p.x} ${p.z}`); const pb = await go({ x: p.x, y: p.y, z: p.z }); if (pb) return pb; }
    }
    for (const [ax, az] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      this.check(tok);
      const q = cached(s);
      if (q) { const pb = await go(q); if (pb) return pb; }
      this.log(`ищу выход к цели: обхожу ${ax ? (ax > 0 ? 'восток' : 'запад') : (az > 0 ? 'юг' : 'север')} от ${s.x} ${s.z}`);
      const pb = await go({ x: s.x + ax * 120, z: s.z + az * 120 });
      if (pb) return pb;
    }
    const q = cached(s);
    return q ? go(q) : null;
  }

  /**
   * Найти портал в Незер самой (до 6 мин): спросить в общем чате (ответ с координатами - метка «портал», brain.js),
   * и пока ждёт - идти к ближайшему поселению (на спавне и в городах порталы обычно есть) и смотреть по сторонам.
   * true - портал теперь известен.
   */
  async findPortal(tok) {
    const b = this.bot, known = () => this.travel.portals(require('./travel').dkey(b.game.dimension)).length > 0;
    this.travel.near = b.entity.position;
    if (known()) return true;
    if (Date.now() - (this._portalAskAt || 0) > 600000) {
      this._portalAskAt = Date.now();
      this.portalHintUntil = Date.now() + 360000;
      this.say('Подскажите, где ближайший портал в Незер? Напишите координаты, пожалуйста.', 'global');
    }
    const until = Date.now() + 360000;
    let towns = [];
    try { towns = this.worldMap ? this.worldMap.settlements(this, 2000).filter((s) => s.n >= 5 && !s.inside) : []; } catch {}
    for (const t of towns.slice(0, 3)) {
      if (Date.now() > until || known()) break;
      this.log(`ищу портал: иду в поселение у ${t.x} ${t.z}`);
      try { await this.walkTo({ x: t.x, z: t.z }, tok, 240000); } catch (e) { if (this.isCancel(e)) throw e; }
      this.travel.near = b.entity.position;
    }
    while (!known() && Date.now() < until) { await sleep(5000); this.check(tok); this.travel.near = b.entity.position; }
    return known();
  }

  /**
   * Дойти до точки: далеко (40+ бл.) и есть знакомая тропа - по ней, отрезками от точки к точке (как по веткам метро,
   * чанки по пути загружены); тропы нет - напрямик, как раньше.
   */
  async walkTo(s, tok, ms = 300000) {
    const b = this.bot, me = b.entity.position;
    const goal = s.y === null || s.y === undefined ? new goals.GoalNearXZ(s.x, s.z, 2) : new goals.GoalNear(s.x, s.y, s.z, 2);
    if (this.travel && this.travel.trails && Math.hypot(s.x - me.x, s.z - me.z) > 40) {
      const { dkey } = require('./travel');
      const d = dkey(b.game.dimension);
      const r = this.travel.trails.route(d, me, { x: s.x, y: s.y ?? me.y, z: s.z });
      if (r && r.len < Math.hypot(s.x - me.x, s.z - me.z) * 2.5) {
        this.log(`иду по знакомой тропе: ${r.points.length} точек, ${Math.round(r.len)} бл.`);
        const until = Date.now() + ms;
        // точки через одну-две (по ~12 бл.), последнюю - обязательно
        const pts = r.points.filter((_, i) => i % 2 === 0 || i === r.points.length - 1);
        for (const p of pts) {
          this.check(tok);
          if (Math.hypot(p.x - b.entity.position.x, p.z - b.entity.position.z) < 3) continue;
          try { await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, Math.max(20000, until - Date.now())); }
          catch (e) { if (e instanceof Cancelled) throw e; this.log('с тропы сбился: ' + e.message.slice(0, 80) + ' - дальше разведкой'); break; }
        }
      }
    }
    // до цели граф не доходит - по графу к краю знаний, ближайшему к цели (navgraph.js), оттуда дальше
    if (Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z) > 64 && this.frontierRoute) {
      try {
        const { dkey } = require('./travel');
        const fr = this.frontierRoute(dkey(b.game.dimension), b.entity.position, s);
        if (fr) { this.log(`к краю знаний по карте связей: ${fr.points.length} точек, оттуда до цели ${Math.round(fr.left)} бл.`); await this.walkPoints(fr.points, tok, ms); }
      } catch (e) { if (e instanceof Cancelled) throw e; this.log('по карте связей не вышло: ' + String(e.message).slice(0, 80)); }
    }
    // до 160 бл. (в прорисовке) - сначала обычная ходьба: модуль сам находит путь по загруженному; не вышло или
    // дальше - разведка: тело прокладывает путь отрезками (scout.js), пройденное станет тропой
    const far = Math.hypot(s.x - b.entity.position.x, s.z - b.entity.position.z);
    if (far > 48) {
      let done = false;
      if (far <= 160) { try { await this.goto(goal, tok, Math.min(ms, 90000)); done = true; } catch (e) { if (e instanceof Cancelled) throw e; this.log('напрямую не дойти: ' + String(e.message).slice(0, 80) + ' - разведка'); } }
      if (done) return;
      await require('./scout').explore(this, s.x, s.z, tok, ms);
    }
    await this.goto(goal, tok, ms);
  }

  // --- действия
  cancel() {
    this.token++;
    this.mode = this.paused ? 'paused' : 'idle';
    this.task = '';
    this.followName = '';
    if (this.bot) { try { this.bot.pathfinder.setGoal(null); this.bot.clearControlStates(); } catch {} }
  }

  /** Полная пауза (кнопка в панели): бросить дело, стоять, ничего не начинать самой. Рефлексы (еда, отбиться,
   *  не утонуть) работают - иначе бот умрёт, пока стоит. Снять паузу - вернуться к следованию, если шла за кем-то. */
  setPaused(on) {
    if (on && !this.paused) {
      this.pausedFollow = this.followName || '';
      this.cancel();
      this.paused = true; this.mode = 'paused'; this.task = 'пауза';
      this.log('пауза: дела брошены, стою; отбиваюсь и ем, если надо');
    } else if (!on && this.paused) {
      this.paused = false;
      if (this.mode === 'paused') { this.mode = 'idle'; this.task = ''; }
      const f = this.pausedFollow; this.pausedFollow = '';
      if (f && this.player(f)) { this.log('пауза снята - снова иду за ' + f); try { this.follow(f); } catch {} }
      else this.log('пауза снята');
    }
  }

  check(tok) { if (tok !== this.token) throw new Cancelled('отменено'); }
  isCancel(e) { return e instanceof Cancelled; }
  get skills() { return this._skills || (this._skills = new Skills(this)); }

  /**
   * Механизм рядом: кнопка, рычаг, нажимная плита (в т.ч. под водой), у которых рядом дверь, люк, поршень, калитка.
   * Ближайший к цели, ещё не тронутый в этот раз. Возвращает, что сделано, или ''.
   */
  /** После кнопки или плиты - бегом 6 с: скрытый проход закрывается через пару секунд (23.11, владелец: «нажал, быстро
   *  поднялся и выбежал», а бот стоял и думал). */
  async walkTrail(who) {
    const b = this.bot, T = (this._trail || []).filter((t) => t.who === who && Date.now() - t.at < 10 * 60000);
    if (T.length < 3) return '';
    this._hOpened = new Map();
    const me = b.entity.position;
    let i = -1, best = 6;   // ближайшая точка следа рядом (до 6 бл.), с неё и идти
    T.forEach((t, k) => { const d = t.p.distanceTo(me); if (d < best) { best = d; i = k; } });
    if (i < 0) return '';
    this.log(`к ${who} пути нет - иду его следом (${T.length - i} точек)`);
    const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
    try {
      for (let k = i; k < T.length; k++) {
        const t = T[k].p, until = Date.now() + 2500;
        while (Date.now() < until) {
          const p = b.entity.position;
          if (Math.hypot(t.x - p.x, t.z - p.z) < 0.6 && Math.abs(t.y - p.y) < 1.2) break;
          for (const q of [t.floored(), t.floored().offset(0, 1, 0), t.floored().offset(0, -1, 0), p.floored().offset(0, -1, 0)]) {
            const h = b.blockAt(q);
            if (h && /_trapdoor$|_door$/.test(h.name) && !/^iron_/.test(h.name) && h.getProperties && !(h.getProperties().open === true || h.getProperties().open === 'true') && !(this._hOpened = this._hOpened || new Map()).has(q.toString())) {
              this._hOpened.set(q.toString(), Date.now());
              try { await b.lookAt(q.offset(0.5, 0.5, 0.5), true); await b.activateBlock(h); await new Promise((r) => setTimeout(r, 200)); } catch {}
            }
          }
          await b.lookAt(t.offset(0, 1.5, 0), true);
          const wet = /water/.test((b.blockAt(p) || {}).name || '');
          // в воде - вперёд под водой, не всплывать (23.11: всплывал и не проходил в проём секретной двери); прыжок -
          // только к точке выше вплотную (выход на уступ), присед - если точка ниже (нырнуть)
          const up = t.y - p.y, near = Math.hypot(t.x - p.x, t.z - p.z) < 1.5;
          ctl('forward', true); ctl('sprint', true);
          ctl('jump', wet ? (up > 0.6 && near) : up > 0.4);
          ctl('sneak', wet && up < -0.3);
          await new Promise((r) => setTimeout(r, 50));
        }
        if (this.mode !== 'follow') break;
        const own = this.player(who); if (own && own.position.distanceTo(b.entity.position) < 3) break;
      }
    } finally { ctl('forward', false); ctl('sprint', false); ctl('jump', false); ctl('sneak', false); }
    try { const e = this.player(who); if (this.mode === 'follow' && e) b.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true); } catch {}
    return `прошёл следом за ${who}`;
  }

  /**
   * Лезть по лестнице, как игрок (23.11: «подойди к лестнице и поднимись наружу» - стоял у лестницы, goto в середину
   * столба не строится). Найти столб лестницы рядом (до 6 бл.), встать в него, держать прыжок (вверх) или ничего
   * (вниз), закрытые деревянные люки на пути открывать, наверху - шаг на пол рядом.
   */
  async climbLadder(a, tok) {
    const b = this.bot, up = !/^(down|вниз)$/i.test(String(a.dir || ''));
    // «лезь ко мне»: хозяин рядом выше - лезть до его высоты и сойти вбок, а не до верха мачты (23.11)
    if (up && a.stopY === undefined) { const own = (this.opts.masters || []).map((n) => this.player(n)).find((e) => e && e.position.distanceTo(b.entity.position) < 32 && e.position.y > b.entity.position.y + 1.5); if (own) a = { ...a, stopY: Math.floor(own.position.y + 0.01) }; }
    // место для тела: пусто или то, сквозь что проходят (лестница над кнопкой - 23.11 копия лаза владельца)
    const roomy = (k) => k && (k.boundingBox === 'empty' || /ladder|vine|_button$|torch|_sign$|carpet|pressure_plate|^lever$|scaffolding/.test(k.name));
    const CL = /^(ladder|vine|scaffolding)$/;
    const me = b.entity.position.floored();
    // до 24 бл.: лестница бывает за дверью, в соседней комнате (23.11: «лестницы рядом не вижу», а она в 10 бл.)
    const col = b.findBlocks({ matching: (bl) => CL.test(bl.name), maxDistance: 24, count: 400 })
      .filter((p) => up ? Math.abs(p.y - me.y) <= 2 && p.y >= me.y - 1 && CL.test((b.blockAt(p.offset(0, 1, 0)) || {}).name || '') && CL.test((b.blockAt(p.offset(0, 2, 0)) || {}).name || '') : p.y < me.y && p.y >= me.y - 3)
      // есть цель - лестница, чей столб ближе к ней (23.11: полез по ближайшей - в автофермы, а в город вела другая)
      .sort((u, v) => a.toward ? (Math.hypot(u.x - a.toward.x, u.z - a.toward.z) + u.distanceTo(me) * 0.5) - (Math.hypot(v.x - a.toward.x, v.z - a.toward.z) + v.distanceTo(me) * 0.5) : u.distanceTo(me) - v.distanceTo(me))[0];
    if (!col) return 'лестницы рядом не вижу (24 бл.)';
    const x = col.x, z = col.z;
    // встать в столб: снизу - в клетку лестницы на уровне ног, сверху - над ней
    // лестница рядом (до 4 бл.) - сразу напрямую бегом, без поиска пути: проход за плитой открыт на секунду (23.11:
    // постоял на плите полсекунды, пошёл искать путь - дверь закрылась перед носом)
    if (Math.hypot(b.entity.position.x - x - 0.5, b.entity.position.z - z - 0.5) <= 4.2 && Math.abs(b.entity.position.y - col.y) <= 1.5) {
      const ctl0 = (k, v) => { try { b.setControlState(k, v); } catch {} };
      const t1 = Date.now();
      try {
        while (Date.now() - t1 < 2500 && Math.hypot(b.entity.position.x - x - 0.5, b.entity.position.z - z - 0.5) > 0.35) {
          this.check(tok);
          await b.lookAt(new Vec3(x + 0.5, b.entity.position.y + 1.6, z + 0.5), true);
          ctl0('forward', true); ctl0('sprint', true);   // без прыжков: у двери задевал косяк и скакал (23.11)
          await sleep(50);
        }
      } finally { ctl0('forward', false); ctl0('sprint', false); ctl0('jump', false); }
    }
    // цель - сам столб лестницы на любой высоте рядом (низ лестницы бывает над полом: стоять «внутри» на её высоте нельзя -
    // путь не строился, 23.11 стенд в копии мира)
    if (Math.hypot(b.entity.position.x - x - 0.5, b.entity.position.z - z - 0.5) > 0.6) {
      const colGoal = { isEnd: (n) => n.x === x && n.z === z && Math.abs(n.y - col.y) <= 2, heuristic: (n) => Math.abs(n.x - x) + Math.abs(n.z - z) + Math.abs(n.y - col.y) * 0.5, hasChanged: () => false, isValid: () => true };
      try { await this.goto(colGoal, tok, 30000); } catch (e) { if (this.isCancel(e)) throw e; }
    }
    if (Math.hypot(b.entity.position.x - x - 0.5, b.entity.position.z - z - 0.5) > 1.5) { this.dumpArea('до лестницы не дошёл'); return `до лестницы у ${x} ${col.y} ${z} не дошёл`; }
    const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
    const hatchOpen = async (yy) => {
      const h = b.blockAt(new Vec3(x, yy, z));
      if (h && /_trapdoor$/.test(h.name) && !/^iron_/.test(h.name) && !(h.getProperties().open === true || h.getProperties().open === 'true')) {
        ctl('jump', false); await b.lookAt(new Vec3(x + 0.5, yy + 0.5, z + 0.5), true); await b.activateBlock(h); await sleep(250);
        return true;
      }
      return false;
    };
    const t0 = Date.now(); let lastY = b.entity.position.y, still = Date.now(), opened = 0;
    this._sideTried = false; this._hatchFlips = 0;
    this.busyLook = true;
    try {
      while (Date.now() - t0 < 60000) {
        this.check(tok);
        const p = b.entity.position;
        // держаться в столбе
        // держаться в столбе без дёрганья: поправка, только если ушёл от середины дальше 0,35, до 0,15; голову - не
        // каждый такт (23.11: «дёргался как читер» - взгляд и «вперёд» переключались 20 раз в секунду)
        const dc = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
        if (dc > 0.2 && !this._ladFix) this._ladFix = true;   // 0,2: сдвинутому на 0,2 створка открытого люка бьёт по голове (застревал на 66)
        if (this._ladFix && dc < 0.08) { this._ladFix = false; ctl('forward', false); }
        if (this._ladFix) { if (Date.now() - (this._ladLook || 0) > 300) { this._ladLook = Date.now(); await b.lookAt(new Vec3(x + 0.5, p.y + 1.6, z + 0.5), true); } ctl('forward', true); }
        else if (up && b.entity.isInWater) {
          // вверх из воды - прижаться к стене, на которой лестница или лианы (как игрок: из воды так выталкивает на лианы, по
          // лестнице лезут быстрее; 23.11 стенд корабля - висел в воде под лианами, держась посередине)
          let W = null;
          const fy0 = Math.floor(p.y + 0.01);
          for (const yy of [fy0, fy0 + 1, fy0 + 2, fy0 - 1]) {
            const k = b.blockAt(new Vec3(x, yy, z)); if (!k || !CL.test(k.name)) continue;
            const pr = k.getProperties ? k.getProperties() : {};
            if (k.name === 'ladder') W = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[pr.facing];
            else { const d = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]].find(([n]) => pr[n] === true || pr[n] === 'true'); if (d) W = [d[1], d[2]]; }
            if (W) break;
          }
          if (W) {
            if (Date.now() - (this._ladLook || 0) > 400) { this._ladLook = Date.now(); await b.lookAt(new Vec3(x + 0.5 + W[0] * 2, p.y + 1.6, z + 0.5 + W[1] * 2), true); }
            ctl('forward', true);
          }
        }
        const fy = Math.floor(p.y + 0.01);
        if (up) {
          ctl('jump', !(a.stopY !== undefined && fy >= Math.floor(a.stopY)));   // на высоте цели - не выше; люки над головой не открывать заранее: открытый встаёт стенкой и закрывает выход вбок (23.11)
          const here = b.blockAt(new Vec3(x, fy, z)), above = b.blockAt(new Vec3(x, fy + 1, z));
          const climbable = (k) => k && (CL.test(k.name) || /_trapdoor$/.test(k.name));
          // наверху: лестницы под ногами и выше нет - шаг на соседний пол
          if (!climbable(here) && !climbable(above) && b.entity.onGround) {
            for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const f = b.blockAt(new Vec3(x + ax, fy - 1, z + az)), s1 = b.blockAt(new Vec3(x + ax, fy, z + az)), s2 = b.blockAt(new Vec3(x + ax, fy + 1, z + az));
              if (f && f.boundingBox === 'block' && roomy(s1) && roomy(s2)) {
                ctl('jump', false); await b.lookAt(new Vec3(x + ax + 0.5, fy + 1.6, z + az + 0.5), true); ctl('forward', true); await sleep(500); ctl('forward', false);
                break;
              }
            }
            return (await this.afterClimb(tok)) + `поднялся по лестнице до ${Math.floor(b.entity.position.y)}${opened ? `, открыл люков: ${opened}` : ''}`;
          }
          // наверху, но не на полу - шаг на соседнюю клетку повыше (из лаза на пол)
          if (!climbable(here) && !climbable(above)) {
            for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const f = b.blockAt(new Vec3(x + ax, fy, z + az)), s1 = b.blockAt(new Vec3(x + ax, fy + 1, z + az));
              if (f && f.boundingBox === 'block' && roomy(s1)) { await b.lookAt(new Vec3(x + ax + 0.5, fy + 1.6, z + az + 0.5), true); ctl('forward', true); break; }
            }
          }
        } else {
          ctl('jump', false);
          if (await hatchOpen(fy - 1) || await hatchOpen(fy)) opened++;
          if (b.entity.onGround && !CL.test((b.blockAt(new Vec3(x, fy - 1, z)) || {}).name || '') && Date.now() - t0 > 1500 && Math.abs(p.y - lastY) < 0.05) return `спустился по лестнице до ${fy}${opened ? `, открыл люков: ${opened}` : ''}`;
        }
        if (Math.abs(p.y - lastY) > 0.2) { lastY = p.y; still = Date.now(); }
        // на высоте цели (хозяин на палубе, а лестница - на мачту выше) - не лезть дальше, сойти вбок (23.11: лез до верха мачты)
        else if (up && (Date.now() - still > 700 || (a.stopY !== undefined && fy >= Math.floor(a.stopY))) && !this._sideTried) {   // наверху не ждать: 0,7 с без подъёма - выход вбок
          // вверх не лезется (люк, потолок) - выход сбоку, как игрок: с последней ступеньки прыгнуть на блок рядом
          // (23.11: поднялся до 68 и дёргался под люком, а выход был сбоку)
          this._sideTried = true;
          // приём игрока (23.11, владелец): верхняя ступенька срублена - идти вперёд в стену с лестницей, встать на верх
          // лестницы, затем прыжком вперёд на блок выше. Сторона стены - обратная направлению лестницы
          {
            let top = null;
            for (let yy = fy + 1; yy >= fy - 3; yy--) { const k = b.blockAt(new Vec3(x, yy, z)); if (k && k.name === 'ladder') { top = k; break; } }
            const F = top && { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[top.getProperties().facing];
            // куда прыгаем - должен быть пол и место для тела, иначе это шаг в пустоту (лестница без стен, обрыв)
            const landOk = F && [fy + 1, fy + 2].some((ly) => { const fl = b.blockAt(new Vec3(x + F[0], ly - 1, z + F[1])), s1 = b.blockAt(new Vec3(x + F[0], ly, z + F[1])), s2 = b.blockAt(new Vec3(x + F[0], ly + 1, z + F[1])); return fl && fl.boundingBox === 'block' && roomy(s1) && roomy(s2); });
            if (F && landOk) {
              const [wx, wz] = F;
              this.log(`наверх не лезется - встаю на лестницу и прыгаю вперёд (${wx},${wz})`);
              await b.lookAt(new Vec3(x + 0.5 + wx * 2, fy + 2.5, z + 0.5 + wz * 2), true);
              ctl('forward', true); ctl('jump', true);
              const t1 = Date.now(), y0 = b.entity.position.y;
              while (Date.now() - t1 < 3000) { await sleep(50); const q = b.entity.position; if (b.entity.onGround && (Math.floor(q.x) !== x || Math.floor(q.z) !== z) && q.y > y0 + 0.5) break; }
              ctl('forward', false); ctl('jump', false);
              const q = b.entity.position;
              if (Math.floor(q.x) !== x || Math.floor(q.z) !== z) return (await this.afterClimb(tok)) + `поднялся по лестнице и вышел на ${Math.floor(q.x)} ${Math.floor(q.y)} ${Math.floor(q.z)}${opened ? `, открыл люков: ${opened}` : ''}`;
            }
          }
          for (const dy of [0, 1, -1]) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const fl = b.blockAt(new Vec3(x + ax, fy + dy, z + az)), s1 = b.blockAt(new Vec3(x + ax, fy + dy + 1, z + az)), s2 = b.blockAt(new Vec3(x + ax, fy + dy + 2, z + az));
            if (!fl || fl.boundingBox !== 'block' || CL.test(fl.name) || !(roomy(s1) || (s1 && /_trapdoor$/.test(s1.name))) || !roomy(s2)) continue;
            this.log(`наверх не лезется - выхожу сбоку на ${x + ax} ${fy + dy + 1} ${z + az}`);
            await b.lookAt(new Vec3(x + ax + 0.5, fy + dy + 2.2, z + az + 0.5), true);
            ctl('jump', true); ctl('forward', true);
            const t1 = Date.now();
            while (Date.now() - t1 < 2000) { await sleep(50); const q = b.entity.position; if (b.entity.onGround && Math.floor(q.x) === x + ax && Math.floor(q.z) === z + az) break; }
            ctl('forward', false); ctl('jump', false);
            const q = b.entity.position;
            if (Math.floor(q.x) === x + ax && Math.floor(q.z) === z + az) return (await this.afterClimb(tok)) + `поднялся по лестнице и вышел сбоку на ${Math.floor(q.x)} ${Math.floor(q.y)} ${Math.floor(q.z)}${opened ? `, открыл люков: ${opened}` : ''}`;
          }
          // вбок некуда - тогда люк над головой: открыть и лезть дальше; открыт, а всё равно не лезется (повёрнут не так,
          // стоит ребром поперёк) - переключить, до 2 раз (23.11 стенд: люк над лестницей в разном положении)
          if (await hatchOpen(fy + 2) || await hatchOpen(fy + 1)) { opened++; this._sideTried = false; }
          else if ((this._hatchFlips = (this._hatchFlips || 0) + 1) <= 2) {
            for (const yy of [fy + 2, fy + 1]) { const h = b.blockAt(new Vec3(x, yy, z)); if (h && /_trapdoor$/.test(h.name) && !/^iron_/.test(h.name) && !(h.getProperties().open === true || h.getProperties().open === 'true')) { ctl('jump', false); await b.lookAt(new Vec3(x + 0.5, yy + 0.5, z + 0.5), true); await b.activateBlock(h); await sleep(250); this._sideTried = false; this.log(`люк над головой мешает - переключил (${h.getProperties().open ? 'закрыл' : 'открыл'})`); break; } }
          }
          still = Date.now();
        }
        else if (Date.now() - still > 4000) { this.dumpArea('застрял на лестнице'); return `застрял на лестнице на ${fy} (дальше не лезется: ${(b.blockAt(new Vec3(x, fy + (up ? 2 : -1), z)) || {}).name})`; }
        await sleep(50);
      }
      return 'лез по лестнице минуту и не долез';
    } finally { ctl('forward', false); ctl('jump', false); this.busyLook = false; }
  }

  /** Выйти наружу, под открытое небо (23.11: «вылезти в город» - вылез из лаза в комнату и решил, что на улице). */
  /** В воду: ближайшая открытая вода под небом (до 40 бл.), дойти и поплавать a.seconds (3 с). Путь пишется - назад им же. */
  async goSwim(a, tok) {
    const b = this.bot, me = b.entity.position.floored();
    const sky = (x, y, z) => { for (let yy = y + 1; yy < y + 30; yy++) { const k = b.blockAt(new Vec3(x, yy, z)); if (!k) return true; if (k.boundingBox === 'block') return false; } return true; };
    const cand = b.findBlocks({ matching: (bl) => bl.name === 'water', maxDistance: 40, count: 600 })
      .filter((q) => { const up = b.blockAt(q.offset(0, 1, 0)); return up && up.name === 'air' && sky(q.x, q.y, q.z); })
      .sort((u, v) => u.distanceTo(me) - v.distanceTo(me));
    // край к воде рядом (палуба, причал) - просто спрыгнуть, как игрок (23.11: «с корабля мог просто спрыгнуть»)
    try { const S = this.sceneNow(true); const w = S && S.waterEdges[0]; if (w) cand.unshift(new Vec3(w.ex, w.wy, w.ez)); } catch {}
    if (!cand.length) return 'открытой воды рядом не вижу (40 бл.)';
    const trail = [b.entity.position.clone()];
    const rec = () => { try { const q = b.entity.position, l = trail[trail.length - 1]; if (q.distanceTo(l) >= 0.7) trail.push(q.clone()); } catch {} };
    b.on('physicsTick', rec);
    try {
      let ok = null;
      for (const q of cand.filter((q, i) => i < 40 && i % 3 === 0).slice(0, 8)) {
        try { await this.goto(new goals.GoalNear(q.x, q.y, q.z, 1), tok, 30000); } catch (e) { if (this.isCancel(e)) throw e; }
        if (b.entity.isInWater) { ok = q; break; }
      }
      if (!ok) return 'до открытой воды не дошёл';
      const secs = Math.min(60, +a.seconds || 3), t0 = Date.now();
      while (Date.now() - t0 < secs * 1000) { this.check(tok); b.setControlState('jump', true); await sleep(200); }   // держаться на плаву
      b.setControlState('jump', false);
      const p = b.entity.position;
      return `в воде: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, поплавал ${secs} с`;
    } finally { b.removeListener('physicsTick', rec); b.setControlState('jump', false); if (trail.length > 3) this._lastExit = { pts: trail, at: Date.now() }; }
  }

  async goOutside(a, tok) {
    const b = this.bot;
    // свой путь наружу - шаг в шаг: обратно к хозяину по нему же (через секретную стену, лаз; 23.11: вернуться пошёл в
    // пещеру, где прохода нет)
    const trail = [b.entity.position.clone()];
    const rec = () => { try { const q = b.entity.position, l = trail[trail.length - 1]; if (q.distanceTo(l) >= 0.7) trail.push(q.clone()); } catch {} };
    b.on('physicsTick', rec);
    this._inSkill = true;   // свои шаги навыка: без «механизм до начала пути» в каждом goto
    try { return await this.goOutsideInner(a, tok); } finally { this._inSkill = false; b.removeListener('physicsTick', rec); if (trail.length > 3) this._lastExit = { pts: trail, at: Date.now() }; }
  }

  async goOutsideInner(a, tok) {
    const r = await this.goOutsideCore(a, tok);
    if (/^вышел наружу/.test(r)) {
      // у самого выхода (вода, проход) не стоять: шаг на сухое место под небом в 4-10 бл. (23.11 игра: стоял на воде у входа)
      const b = this.bot, me = b.entity.position.floored();
      const wet = (v) => /water/.test((b.blockAt(v) || {}).name || '');
      if (wet(me) || wet(me.offset(0, -1, 0))) {
        let best = null;
        for (let r2 = 4; r2 <= 10 && !best; r2++) for (let dx = -r2; dx <= r2 && !best; dx++) for (let dz = -r2; dz <= r2 && !best; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r2) continue;
          for (let dy = 3; dy >= -3; dy--) { const v = me.offset(dx, dy, dz), fl = b.blockAt(v.offset(0, -1, 0)), a1 = b.blockAt(v), a2 = b.blockAt(v.offset(0, 1, 0)); if (fl && fl.boundingBox === 'block' && !wet(fl.position) && a1 && a1.boundingBox === 'empty' && !wet(v) && a2 && a2.boundingBox === 'empty') { best = v; break; } }
        }
        if (best) { try { await this.goto(new goals.GoalNear(best.x, best.y, best.z, 1), tok, 20000); } catch (e) { if (this.isCancel(e)) throw e; } }
      }
    }
    return r;
  }

  async goOutsideCore(a, tok) {
    const b = this.bot;
    const sky = (x, y, z) => { for (let yy = y + 2; yy < y + 40; yy++) { const k = b.blockAt(new Vec3(x, yy, z)); if (!k) return true; if (k.boundingBox === 'block' || /water|lava/.test(k.name)) return false; } return true; };
    const p0 = b.entity.position.floored();
    if (sky(p0.x, p0.y, p0.z)) return 'я и так под открытым небом';
    // ближайший выход: клетки под небом, куда можно встать, в 48 бл.; порядок - по расстоянию, до 6 попыток
    // поверхность по столбам вокруг (как карта высот): сверху вниз до первого твёрдого - над ним небо. Под землёй
    // «ближайшие твёрдые блоки» - вся толща камня, до поверхности поиск не доставал (23.11: «пробовал 0»)
    const cand = [];
    for (let r = 2; r <= 48; r += 2) for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = p0.x + dx, z = p0.z + dz;
      for (let y = Math.min(p0.y + 70, 318); y > p0.y - 6; y--) {
        const k = b.blockAt(new Vec3(x, y, z)); if (!k) break;
        if (k.boundingBox === 'block' || /water|lava/.test(k.name)) {
          const s1 = b.blockAt(new Vec3(x, y + 1, z)), s2 = b.blockAt(new Vec3(x, y + 2, z));
          if (k.boundingBox === 'block' && s1 && s2 && s1.boundingBox === 'empty' && s2.boundingBox === 'empty' && !/lava|fire|magma|cactus/.test(k.name)) cand.push(new Vec3(x, y + 1, z));
          break;
        }
      }
      if (cand.length >= 400) break;
    }
    // выходы, которые видно (проём под небо рядом) - первыми
    try { const S = this.sceneNow(true); for (const e of (S ? S.exits : []).filter((e) => e.kind === 'проём наружу').reverse()) cand.unshift(new Vec3(e.x, e.y, e.z)); } catch {}
    // ближе по горизонтали и по высоте - раньше
    cand.sort((u, v) => (Math.hypot(u.x - p0.x, u.z - p0.z) + Math.abs(u.y - p0.y) * 0.5) - (Math.hypot(v.x - p0.x, v.z - p0.z) + Math.abs(v.y - p0.y) * 0.5));
    if (!cand.length) return 'наружу не вышел: поверхности рядом не вижу (48 бл.)';
    // по шагам, как игрок (23.11: «пробовал 8» за 2 с - через секретную дверь на кнопке путь не строится): к лучшему
    // выходу насколько пускают; не вышел - лестница вверх рядом, кнопка у прохода, и снова; до 8 раундов
    const done = [];
    let best = cand[0];
    this._outsideIdle = 0;
    for (let round = 0; round < 8; round++) {
      this.check(tok);
      const f0 = b.entity.position.floored();
      if (sky(f0.x, f0.y, f0.z)) return `вышел наружу: ${f0.x} ${f0.y} ${f0.z}${done.length ? ' (' + done.join('; ') + ')' : ''}`;
      // к выходу: и частичный путь годится - ближе к поверхности
      const y0 = b.entity.position.y;
      // идти к месту, только если путь туда строится целиком (частичные пути к разным крышам давали рывки туда-сюда)
      let full = null;
      // путь назад через проход, который сейчас закроется (стена на поршнях), - не годится (23.11 игра: прошёл стену,
      // следующий выход повёл обратно через неё - застрял на лестнице, дёргался)
      const PS = this._passed && Date.now() - this._passed.at < 60000 ? this._passed.keys : null;
      for (const q of cand.slice(0, 6)) {
        try { const r = b.pathfinder.getPathTo(b.pathfinder.movements, new goals.GoalNear(q.x, q.y, q.z, 1), 200); if (r && r.status === 'success' && !(PS && r.path.some((n) => PS.has(n.x + ',' + n.y + ',' + n.z)))) { full = q; break; } } catch {}
      }
      // только что прошёл в проход (стена сзади закрылась) - к ближайшему выходу и по неполному пути: назад всё равно не
      // пустит, а стоять на месте - не выйти (23.11 стенд: прошёл стену и встал)
      if (!full && PS) full = cand.find((q) => q.distanceTo(b.entity.position) > 3) || null;
      if (full) { try { await this.goto(new goals.GoalNear(full.x, full.y, full.z, 1), tok, 45000); } catch (e) { if (this.isCancel(e)) throw e; } }
      let f = b.entity.position.floored();
      if (sky(f.x, f.y, f.z)) return `вышел наружу: ${f.x} ${f.y} ${f.z}${done.length ? ' (' + done.join('; ') + ')' : ''}`;
      let moved = b.entity.position.y > y0 + 1.5;
      // выше по лестнице рядом
      if (!moved) {
        try { const m = await this.climbLadder({ dir: 'up', toward: { x: best.x, z: best.z } }, tok); if (/поднялся/.test(m)) { done.push(m); moved = true; } } catch (e) { if (this.isCancel(e)) throw e; }
      }
      // кнопка, рычаг, плита у прохода
      if (!moved) {
        try {
          const m = await this.useMechanism({ x: best.x, y: best.y, z: best.z }, tok);
          if (m) {
            done.push(m); moved = true;
            { const g = await this.intoOpening(tok); if (g) { done.push(g); continue; } }
            // проход открыт сейчас (кнопка, плита, стена на поршнях): сначала бегом к небу, если путь целый; нет - к лестнице
            // за проходом (23.11: после кнопки полез в шахту вниз, а проход наружу был рядом)
            // лестница вверх в 4 бл. - сразу на неё и бегом (23.11: после кнопки 5 с считал пути, стена закрылась);
            // нет лестницы - коротко: путь к небу через открытый проход
            const ladNear = b.findBlocks({ matching: (bl) => bl.name === 'ladder', maxDistance: 4, count: 10 }).some((q) => q.y >= Math.floor(b.entity.position.y) - 1);
            if (ladNear) { try { const c = await this.climbLadder({ dir: 'up', toward: { x: best.x, z: best.z } }, tok); if (/поднялся/.test(c)) done.push(c); } catch (e) { if (this.isCancel(e)) throw e; } }
            else {
              let out2 = null;
              for (const q of cand.slice(0, 4)) { try { const r = b.pathfinder.getPathTo(b.pathfinder.movements, new goals.GoalNear(q.x, q.y, q.z, 1), 150); if (r && r.status === 'success') { out2 = q; break; } } catch {} }
              if (out2) { try { await this.goto(new goals.GoalNear(out2.x, out2.y, out2.z, 1), tok, 45000); } catch (e) { if (this.isCancel(e)) throw e; } }
            }
          }
        } catch (e) { if (this.isCancel(e)) throw e; }
      }
      // ничего не сдвинулось - следующий выход
      if (!moved) { if (++this._outsideIdle >= 3) break; } else this._outsideIdle = 0;
    }
    const f = b.entity.position.floored();
    if (!sky(f.x, f.y, f.z)) this.dumpArea('наружу не вышел');
    return sky(f.x, f.y, f.z) ? `вышел наружу: ${f.x} ${f.y} ${f.z}` : `наружу не вышел${done.length ? ' (' + done.join('; ') + ')' : ''}: стою на ${f.x} ${f.y} ${f.z}`;
  }

  /** Вылез по лестнице, а над головой крыша - кнопка, рычаг или плита у прохода (секретная дверь), бегом (23.11). */
  async afterClimb(tok) {
    const b = this.bot, f = b.entity.position.floored();
    for (let yy = f.y + 2; yy < f.y + 40; yy++) { const k = b.blockAt(new Vec3(f.x, yy, f.z)); if (!k) return ''; if (k.boundingBox === 'block') break; if (yy === f.y + 39) return ''; }
    try { const m = await this.useMechanism({ x: f.x, y: f.y, z: f.z }, tok); if (!m) return ''; const g = await this.intoOpening(tok); return m + '; ' + (g ? g + '; ' : ''); } catch (e) { if (this.isCancel(e)) throw e; return ''; }
  }

  /**
   * Копия блоков вокруг в файл (logs/area.<время>.json): для стенда - собрать то же место один в один и чинить по нему
   * (23.11: лаз владельца с люками, кнопкой и секретной стеной - гадать по описанию надоело). Не чаще раза в минуту.
   */
  dumpArea(reason) {
    try {
      if (Date.now() - (this._dumpAt || 0) < 60000) return;
      this._dumpAt = Date.now();
      const b = this.bot, f = b.entity.position.floored(), blocks = {};
      for (let dx = -16; dx <= 16; dx++) for (let dy = -12; dy <= 24; dy++) for (let dz = -16; dz <= 16; dz++) {
        const k = b.blockAt(f.offset(dx, dy, dz)); if (!k || k.name === 'air' || k.name === 'cave_air') continue;
        const pr = k.getProperties ? k.getProperties() : {};
        blocks[`${dx},${dy},${dz}`] = Object.keys(pr).length ? [k.name, pr] : k.name;
      }
      const owner = (this.opts.masters || []).map((n) => this.player(n)).find(Boolean);
      const out = { reason: String(reason || ''), at: new Date().toISOString(), version: b.version, origin: [f.x, f.y, f.z], bot: [b.entity.position.x - f.x, b.entity.position.y - f.y, b.entity.position.z - f.z], owner: owner ? [owner.position.x - f.x, owner.position.y - f.y, owner.position.z - f.z] : null, blocks };
      const dir = require('path').join(process.env.TOTEMBOTS_LOCAL || require('path').join(__dirname, '..', 'local'), 'logs');
      require('fs').writeFileSync(require('path').join(dir, `area.${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(out));
      this.log(`копия места для разбора сохранена (${Object.keys(blocks).length} блоков): ${reason}`);
    } catch (e) { this.log('копия места не сохранилась: ' + e.message); }
  }

  /** Твёрдые клетки вокруг (до r бл.) - до нажатия кнопки, чтобы увидеть, что откроется. */
  solidAround(r) {
    const b = this.bot, f = b.entity.position.floored(), out = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -3; dy <= 4; dy++) for (let dz = -r; dz <= r; dz++) { const k = b.blockAt(f.offset(dx, dy, dz)); if (k && k.boundingBox === 'block') out.push(k.position.clone()); }
    return out;
  }

  /** Сразу после кнопки - в открывшийся проход и на 2 бл. дальше, бегом (стена на поршнях закрывается через 1-2 с). */
  async intoOpening(tok) {
    const b = this.bot, O = this._mechOpened;
    if (!O || Date.now() - O.at > 4000 || !O.cells.length) return '';
    const me = b.entity.position;
    const cells = O.cells.slice().sort((u, v) => u.y - v.y || u.distanceTo(me) - v.distanceTo(me));
    const c = cells[0], dir = c.minus(me.floored()), L = Math.hypot(dir.x, dir.z) || 1;
    const far = c.offset(Math.round(dir.x / L * 2), 0, Math.round(dir.z / L * 2));
    this._mechOpened = null;
    this._passed = { at: Date.now(), keys: new Set(O.cells.map((v) => v.x + ',' + v.y + ',' + v.z)) };   // назад через них не планировать - закроются
    // руками, сразу: лицом в проём, вперёд бегом, прыжок (ступенька лестницы под проёмом, вода в проёме) - поиск пути
    // через только что открытый проход с затёкшей водой не строился (23.11 стенд, копия лаза владельца)
    const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
    const t1 = Date.now(); this._closedSaid = false;
    try {
      while (Date.now() - t1 < 3000) {
        this.check(tok);
        const q = b.entity.position;
        if (Math.floor(q.x) === far.x && Math.floor(q.z) === far.z) break;
        { const kc = b.blockAt(c); if (kc && kc.boundingBox === 'block' && !this._closedSaid) { this._closedSaid = true; this.log(`проход закрылся через ${Date.now() - O.at + 150} мс после кнопки; я у ${q.x.toFixed(1)} ${q.y.toFixed(1)} ${q.z.toFixed(1)}`); } }
        const passed = (c.x - q.x) * (dir.x / L) + (c.z - q.z) * (dir.z / L) < -0.6;   // уже за проёмом
        const tgt = passed ? far : c;
        await b.lookAt(new Vec3(tgt.x + 0.5, Math.max(q.y, tgt.y) + 1.4, tgt.z + 0.5), true);
        ctl('forward', true); ctl('sprint', true); ctl('jump', q.y < c.y - 0.2 || b.entity.isInWater);
        await sleep(50);
      }
    } finally { ctl('forward', false); ctl('sprint', false); ctl('jump', false); }
    if (Math.floor(b.entity.position.x) !== far.x || Math.floor(b.entity.position.z) !== far.z) { try { await this.goto(new goals.GoalNear(far.x, far.y, far.z, 1), tok, 8000); } catch (e) { if (this.isCancel(e)) throw e; } }
    const q = b.entity.position;
    return `прошёл в открывшийся проход у ${c.x} ${c.y} ${c.z} (стою ${Math.floor(q.x)} ${Math.floor(q.y)} ${Math.floor(q.z)})`;
  }

  /** Для проверок: назад своим путём наружу как отдельное задание. */
  async walkBackRun() { const tok = ++this.token; this.mode = 'task'; try { return await this.walkBack(this._lastExit.pts, tok); } finally { this.mode = 'idle'; } }

  /** Назад своим следом (обратный порядок), руками: лицом к точке, вперёд, прыжок вверх / по лестнице, вниз - сползти. */
  async walkBack(pts, tok) {
    const b = this.bot, P = pts.slice().reverse();
    const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
    // начать с ближайшей точки следа
    let i0 = 0, bd = Infinity; P.forEach((q, i) => { const d = q.distanceTo(b.entity.position); if (d < bd) { bd = d; i0 = i; } });
    if (bd > 6) { try { await this.goto(new goals.GoalNear(P[i0].x, P[i0].y, P[i0].z, 1), tok, 30000); } catch (e) { if (this.isCancel(e)) throw e; } }
    this.log(`назад своим путём: ${P.length - i0} точек`);
    this._platesDone = new Set();
    try {
      for (let i = i0; i < P.length; i++) {
        const t = P[i];
        // плита на следе: встать на неё как следует (стена открыта, пока стою), потом сразу дальше следом
        { const pc = t.floored(); const pl = b.blockAt(pc); if (pl && /_pressure_plate$/.test(pl.name) && !(this._platesDone || (this._platesDone = new Set())).has(pc.toString())) {
          this._platesDone.add(pc.toString());
          for (const k of ['forward', 'sprint', 'jump', 'sneak']) ctl(k, false);
          try { await this.goto(new goals.GoalBlock(pc.x, pc.y, pc.z), tok, 12000); this.log(`назад: встал на ${pl.name} у ${pc.x} ${pc.y} ${pc.z}`); } catch (e) { if (this.isCancel(e)) throw e; }
          await sleep(250);
          continue;
        } }
        const until = Date.now() + 2500;
        let best = Infinity, bestAt = Date.now();
        while (Date.now() < until) {
          this.check(tok);
          const q = b.entity.position;
          if (Math.hypot(t.x - q.x, t.z - q.z) < 0.5 && Math.abs(t.y - q.y) < 1.1) break;
          // секунду не ближе (течение, вода у стены) - обычной ходьбой с её водными приёмами
          const dd = q.distanceTo(t); if (dd < best - 0.15) { best = dd; bestAt = Date.now(); }
          if (Date.now() - bestAt > 1000) {
            for (const k of ['forward', 'sprint', 'jump', 'sneak']) ctl(k, false);
            try { await this.goto(new goals.GoalNear(t.x, t.y, t.z, 0.6), tok, 8000); } catch (e) { if (this.isCancel(e)) throw e; }
            break;
          }
          const lad = /ladder|vine/.test((b.blockAt(q) || {}).name || '');
          await b.lookAt(new Vec3(t.x, t.y + 1.5, t.z), true);
          const near = Math.hypot(t.x - q.x, t.z - q.z) < 0.35;
          const wet = b.entity.isInWater;
          ctl('forward', !near); ctl('sprint', !lad);   // в воде тоже бегом: против течения у стены иначе стоит ctl('jump', (t.y > q.y + 0.4) || (wet && t.y > q.y - 0.1)); ctl('sneak', false);   // в воде ниже - просто без прыжка (присед своя физика в воде не знает)
          await sleep(50);
        }
        if (process.env.TB_DEBUG_BACK) { const q = b.entity.position; this.log(`назад: точка ${i} ${t.x.toFixed(1)} ${t.y.toFixed(1)} ${t.z.toFixed(1)} - я ${q.x.toFixed(1)} ${q.y.toFixed(1)} ${q.z.toFixed(1)}${b.entity.isInWater ? ' вода' : ''}`); }
      }
    } finally { for (const k of ['forward', 'sprint', 'jump', 'sneak']) ctl(k, false); }
    const q = b.entity.position;
    return `вернулся своим путём до ${Math.floor(q.x)} ${Math.floor(q.y)} ${Math.floor(q.z)}`;
  }

  dashAfterMech() {
    this._mechAt = Date.now();
    const mv = this.bot.pathfinder.movements; if (!mv) return;
    const was = mv.allowSprinting; mv.allowSprinting = true;
    clearTimeout(this._dashT); this._dashT = setTimeout(() => { try { mv.allowSprinting = was; } catch {} }, 6000);
  }

  async useMechanism(goal, tok) {
    const b = this.bot, me = b.entity.position;
    // только что сработал механизм - проход открыт: не бежать к другому, а идти (23.11 стенд: после кнопки ушёл к плите в канале)
    if (Date.now() - (this._mechAt || 0) < 3000) return '';
    if (goal && goal.y !== undefined && goal.y > me.y + 1.5 && b.findBlocks({ matching: (bl) => /^(ladder|vine|scaffolding)$/.test(bl.name), maxDistance: 8, count: 1 }).length) return '';   // наверх ведёт лестница - не ловушка, кнопки не жать (23.11)
    // на лестнице, в лиане или в прыжке - кнопки не жать: сначала встать на пол (23.11: жал кнопку, вися на лестнице, и
    // стена закрывалась раньше, чем он вылез)
    { const fk = b.blockAt(me); if (/ladder|vine|scaffolding/.test((fk || {}).name || '') || (!b.entity.onGround && !b.entity.isInWater)) return ''; }
    const CTRL = /(_button|^lever|_pressure_plate)$/, GATE = /(_door|^piston|^sticky_piston|piston_head|^iron_bars)$/;   // люки и калитки кнопками почти не открывают - кнопки у них не жать (23.11: жал кнопки на корабле)
    const tried = (this._mechTried = this._mechTried && Date.now() - this._mechTried.at < 60000 ? this._mechTried : { at: Date.now(), set: new Set() });
    const gp = goal.x !== undefined ? new Vec3(goal.x, goal.y ?? me.y, goal.z) : me;
    const near = (p) => { for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) { const k = b.blockAt(p.offset(dx, dy, dz)); if (k && GATE.test(k.name)) return true; } return false; };
    if ((this._mechBudget = (this._mechBudget && Date.now() - this._mechBudget.at < 60000 ? this._mechBudget : { at: Date.now(), n: 0 })).n >= 4) return '';   // не больше 4 механизмов в минуту (23.11: жал кнопки по всему городу)
    const cands = b.findBlocks({ matching: (bl) => CTRL.test(bl.name), maxDistance: 10, count: 40 })
      .filter((p) => !tried.set.has(p.toString()) && near(p) && (p.distanceTo(gp) < 12 || p.distanceTo(me) < 10))
      .sort((u, v) => (u.distanceTo(me) + u.distanceTo(gp) * 0.5) - (v.distanceTo(me) + v.distanceTo(gp) * 0.5));
    // сначала - то, что недавно нажимал хозяин (скрытая дверь: механизм может быть далеко от поршней)
    const own = (this._ownerMech || []).filter((x) => !tried.set.has(x.k) && x.p.distanceTo(me) < 32).sort((u, v) => u.p.distanceTo(me) - v.p.distanceTo(me)).map((x) => x.p);
    const p = own[0] || cands[0];
    if (!p) return '';
    this._mechBudget.n++;
    if (process.env.TB_DEBUG_BACK) this.log(`механизм: выбран ${b.blockAt(p).name} у ${p.x} ${p.y} ${p.z}`);
    tried.set.add(p.toString());
    const bl = b.blockAt(p);
    if (/_pressure_plate$/.test(bl.name)) {
      // плита: встать на неё (в воде - доплыть), постоять, пока откроется
      // плита в воде (канал, течение): как игрок - встать по дну рядом с ней на её уровне и идти вперёд шагом, без
      // прыжков (прыжок в воде = всплыть, течение сносит; 23.11 владелец: «медленно иду вперёд или ныряю»)
      const wetPlate = /water/.test((b.blockAt(p.offset(1, 0, 0)) || {}).name + (b.blockAt(p.offset(-1, 0, 0)) || {}).name + (b.blockAt(p.offset(0, 0, 1)) || {}).name + (b.blockAt(p.offset(0, 0, -1)) || {}).name + (b.blockAt(p.offset(0, 1, 0)) || {}).name);
      if (wetPlate) {
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => p.offset(dx, 0, dz)).filter((q) => { const fl = b.blockAt(q.offset(0, -1, 0)), at = b.blockAt(q); return fl && fl.boundingBox === 'block' && at && at.boundingBox === 'empty'; })
          .sort((u, v) => u.distanceTo(me) - v.distanceTo(me));
        if (nb[0]) { try { await this.goto(new goals.GoalBlock(nb[0].x, nb[0].y, nb[0].z), tok, 15000); } catch (e) { if (e instanceof Cancelled) throw e; } }
      } else await this.goto(new goals.GoalBlock(p.x, p.y, p.z), tok, 20000).catch((e) => { if (e instanceof Cancelled) throw e; });
      // не встал (вода над плитой, течение, низкий потолок) - руками: лицом к плите, вперёд, ниже - присесть (опуститься в
      // воде), выше - прыжок (23.11 стенд: плита в канале у секретной стены, бот держался у поверхности)
      if (b.entity.position.floored().x !== p.x || b.entity.position.floored().z !== p.z) {
        const ctl = (k, v) => { try { b.setControlState(k, v); } catch {} };
        try { b.pathfinder.setGoal(null); } catch {}   // модуль пути не должен жать своё (в воде - прыжок, всплыть)
        this._plBest = Infinity; this._plAt = Date.now();
        const t1 = Date.now(); this._trailBusy = true;   // «держать над водой» тела - не мешать опуститься к плите
        try {
          while (Date.now() - t1 < 15000) {
            this.check(tok);
            const q = b.entity.position;
            if (Math.floor(q.x) === p.x && Math.floor(q.z) === p.z && Math.abs(q.y - p.y) < 0.6) break;
            await b.lookAt(new Vec3(p.x + 0.5, p.y + 0.3, p.z + 0.5), true);
            const hd = Math.hypot(p.x + 0.5 - q.x, p.z + 0.5 - q.z), wetQ = b.entity.isInWater;
            // в воде - шагом по дну, без бега и прыжка (всплыл бы); выше плиты - не идти, пока не опустился (голова в потолок)
            const high = q.y > p.y + 0.25;   // под низким потолком над плитой голова не пройдёт, пока не опустился почти до неё
            // течение держит: 0,8 с не ближе - рывок бегом (как «нырнуть» у владельца)
            if (hd < (this._plBest ?? Infinity) - 0.1) { this._plBest = hd; this._plAt = Date.now(); }
            const stall = Date.now() - (this._plAt || Date.now()) > 800;
            // ямка на блок ниже у плиты: прыжок наверх, когда ниже её уровня и рядом
            ctl('forward', hd > 0.25 && !(wetQ && high)); ctl('sprint', hd > 1 && (!wetQ || stall)); ctl('jump', (q.y < p.y - 0.15 && (hd < 1.8 || wetQ)) || (stall && !high && Date.now() % 1000 < 500));   // ниже плиты в воде - выпрыгнуть из ямки (у входа ямка в 3 бл. от плиты, 23.11 игра)
            // над плитой в воде - нырнуть вниз (своя физика бота не опускает: висел на 72,9 при плите на 71, стекающая вода)
            if (high && hd < 2.2) { const e = b.entity; e.velocity.y = Math.min(e.velocity.y, -0.12); }
            await sleep(50);
          }
        } finally { for (const k of ['forward', 'sprint', 'sneak', 'jump']) ctl(k, false); this._trailBusy = false; }
        { const q = b.entity.position; this.log(`к плите ${p.x} ${p.y} ${p.z} руками: я ${q.x.toFixed(1)} ${q.y.toFixed(1)} ${q.z.toFixed(1)}`); }
      }
      const fp = b.entity.position.floored();
      if (fp.x !== p.x || fp.z !== p.z || Math.abs(fp.y - p.y) > 1) return '';   // не дошёл до плиты (течение, стена)
      await sleep(300);   // поршням - полсекунды; дольше стоять нельзя: проход закрывается быстро (23.11)
      this.dashAfterMech();
      return `встал на ${bl.name} у ${p.x} ${p.y} ${p.z}`;
    }
    // дотягиваюсь (до 4 бл. от глаз) - жать с места: шаг к кнопке у лаза уводил обратно в шахту, и бот падал (23.11)
    if (b.entity.position.offset(0, 1.6, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) > 4) await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, 20000).catch((e) => { if (e instanceof Cancelled) throw e; });
    if (b.entity.position.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.5) return '';
    await b.lookAt(p.offset(0.5, 0.5, 0.5), true);
    const snap = this.solidAround(8);
    await b.activateBlock(b.blockAt(p));
    this.dashAfterMech();
    // ждать, пока откроется (до 0,8 с, проверка каждые 0,05): поршни срабатывают через 0,1-0,5 с, а стена открыта ~1,4 с
    let cellsOpen = [];
    for (let w = 0; w < 16 && !cellsOpen.length; w++) { await sleep(50); cellsOpen = snap.filter((v) => { const k = b.blockAt(v); return k && k.boundingBox === 'empty'; }); }
    this._mechOpened = { at: Date.now(), cells: cellsOpen };
    if (this._mechOpened.cells.length) this.log(`открылся проход: ${this._mechOpened.cells.slice(0, 4).map((v) => v.x + ' ' + v.y + ' ' + v.z).join('; ')}`);
    return `нажал ${bl.name} у ${p.x} ${p.y} ${p.z}`;
  }

  async goto(goal, tok, timeoutMs = 120000) {
    const b = this.bot;
    const until = Date.now() + timeoutMs;
    // цель в запретной зоне - не идти вовсе (22.11: шла к жителям в Главный замок и гибла от блейзов)
    if (goal.x !== undefined && goal.z !== undefined && !goal.entity) this.zoneGuard(goal.x, goal.z);
    // бой (отбежать от крипера, отступить к хозяину) перехватывает путь - после него идти дальше, до 6 раз
    // сторож: 20 с без приближения к цели хотя бы на блок - пути отсюда нет, бросить (бот упирался в корпус корабля)
    const gx = goal.x !== undefined ? goal.x : goal.entity ? null : null, gz = goal.z;
    let bestD = Infinity, bestAt = Date.now();
    const far = () => (gx === undefined || gx === null ? 0 : Math.hypot(b.entity.position.x - gx, b.entity.position.z - gz));
    // цель недалеко (до 48 бл.), а путь целиком не строится - сначала механизм у входа рядом (плита, кнопка), потом идти:
    // частичный путь уводил в пещеру, а механизм искался уже там (23.11 стенд: внутрь через секретную стену)
    if (goal.x !== undefined && !this._preMech && !this._inSkill && far() < 48 && b.pathfinder.movements) {
      try {
        const pr = b.pathfinder.getPathTo(b.pathfinder.movements, goal, 600);
        if (process.env.TB_DEBUG_BACK) this.log(`проверка пути до цели: ${pr && pr.status}`);
        if (pr && pr.status !== 'success') {
          this._preMech = true;
          try { const m = await this.useMechanism({ x: goal.x, y: goal.y ?? b.entity.position.y, z: goal.z }, tok); if (m) this.log(m + ' - путь к цели был закрыт'); } finally { this._preMech = false; }
        }
      } catch (e) { if (e instanceof Cancelled) throw e; }
    }
    for (let attempt = 0; ; attempt++) {
      let timer, watch;
      try {
        await Promise.race([
          (() => {
            // радиус поиска - не всё виденное (кэш мира), а 2,5 расстояния до цели + 48, не больше 640: недостижимое
            // - честное «пути нет» быстро, а не «Took too long» через 15 с (22.11)
            const gd = gx === null || gx === undefined ? 64 : Math.hypot(b.entity.position.x - gx, b.entity.position.z - gz);
            b.pathfinder.searchRadius = Math.min(640, Math.max(64, gd * 2.5 + 48));
            return b.pathfinder.goto(goal);
          })(),
          new Promise((_, rej) => { watch = setInterval(() => {
            const d = far(); if (!d) return;
            // Сторож по пути, а не по прямой: в метро и в обход идёшь и в сторону от цели. Прогресс - ближе к цели,
            // или тело идёт по построенному пути (сместилось на 4+ блока за 10 с). Впереди не прогружен мир -
            // ждать чанков, а не бросать (дальние переходы на тысячи блоков).
            const me = b.entity.position;
            const moved = this._lastWatchPos && me.distanceTo(this._lastWatchPos.p) >= 4 && Date.now() - this._lastWatchPos.at <= 10000;
            if (!this._lastWatchPos || Date.now() - this._lastWatchPos.at > 10000) this._lastWatchPos = { p: me.clone(), at: Date.now() };
            const ahead = gx !== null && gx !== undefined ? me.offset((gx - me.x) / (d || 1) * Math.min(d, 24), 0, (gz - me.z) / (d || 1) * Math.min(d, 24)) : null;
            const unloaded = ahead && !b.blockAt(ahead);
            if (d < bestD - 1 || (moved && b.pathfinder.isMoving()) || unloaded) { bestD = Math.min(bestD, d); bestAt = Date.now(); }
            else if (Date.now() - bestAt > 20000) rej(new Error(`отсюда не подойти: 20 с без продвижения, осталось ${Math.round(d)} бл. (путь закрыт - выбери другое)`));
          }, 1000); }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('не дошёл за отведённое время')), Math.max(1000, until - Date.now())); }),
        ]);
        // модуль пути считает «дошёл», если не смог построить ни одного шага (пустой путь) - проверить самим:
        // 21.11 «пришёл к месту «мой дом»» за 0,06 с, стоя за 150 бл., и бот радовался, что дома
        // клетку бота на грядке, плите, кровати модуль пути считает на одну выше (ноги у верха блока) - проверять
        // обе, как он сам (22.11 на поле: «до цели 1 бл., путь пустой», хотя бот уже у цели)
        const fl = b.entity.position.floored();
        if (goal.isEnd && goal.x !== undefined && !goal.entity && !goal.isEnd(fl) && !goal.isEnd(fl.offset(0, 1, 0))) {
          const left = Math.round(Math.hypot((goal.x ?? b.entity.position.x) - b.entity.position.x, (goal.z ?? b.entity.position.z) - b.entity.position.z));
          if (Date.now() - (this._emptyDiagAt || 0) > 30000 && this.movements && this.movements._nav) {
            this._emptyDiagAt = Date.now();
            const f = b.entity.position.floored(), fb = this.movements._navFallback;
            try { this.log(`путь пустой - разбор: ${this.movements._nav.explain(f.x, f.y, f.z)}${fb && Date.now() - fb.at < 5000 ? '; запасная ходьба: ' + fb.why + ' у ' + fb.node : ''}`); } catch (e) { this.log('путь пустой - разбор не вышел: ' + e.message); }
          }
          if (attempt < 1 && left > 2) { this.log(`путь пустой, до цели ${left} бл. - пробую ещё раз`); await sleep(400); continue; }
          // путь не строится, а рядом механизм (железная дверь, поршни, скрытый проход): нажать кнопку, рычаг, встать
          // на плиту (и в воде) - и попробовать снова (23.11, хозяин: «научи проходить скрытые двери»)
          // цель выше или ниже на 3+ бл., а путь не строится - лестница рядом: залезть (спуститься) по ней навыком, как
          // игрок, без подсказки (23.11: стоял у лестницы и ждал, пока скажут «лезь»)
          {
            const gy = goal.y, me2 = b.entity.position;
            const gk = `${goal.x},${gy},${goal.z}`, AC = (this._autoClimbN = this._autoClimbN && Date.now() - this._autoClimbN.at < 120000 ? this._autoClimbN : { at: Date.now(), n: {} });   // на одну цель - не больше 3 раз за 2 мин
            if (gy !== undefined && Math.abs(gy - me2.y) >= 3 && (AC.n[gk] || 0) < 3 && Date.now() - (this._autoClimbAt || 0) > 4000) {
              const lad = b.findBlocks({ matching: (bl) => /^(ladder|vine|scaffolding)$/.test(bl.name), maxDistance: 6, count: 20 }).filter((q) => gy > me2.y ? Math.abs(q.y - me2.y) <= 2 : q.y < me2.y && q.y >= me2.y - 3);
              if (lad.length) {
                AC.n[gk] = (AC.n[gk] || 0) + 1; this._autoClimbAt = Date.now();
                const m = await this.climbLadder({ dir: gy > me2.y ? 'up' : 'down', toward: { x: goal.x ?? me2.x, z: goal.z ?? me2.z }, stopY: gy > me2.y ? gy : undefined }, tok).catch((e) => { if (e instanceof Cancelled) throw e; return ''; });
                this.log('путь не строится, цель ' + (gy > me2.y ? 'выше' : 'ниже') + ' - по лестнице: ' + m);
                if (m && !/не вижу|застрял/.test(m)) { attempt = 0; continue; }
              }
            }
          }
          // только что нажал - поршням нужно время: пробовать путь каждые 0,25 с до 3 с, к другому механизму не бежать
          // (23.11 22:08: нажал кнопку и через 0,6 с побежал к плите снаружи - проход открылся, а он ушёл)
          if (this._mechAt && Date.now() - this._mechAt < 3000) { await sleep(250); attempt = Math.min(attempt, 1); continue; }
          if (attempt < 4 && (this._mechTries = (attempt === 0 ? 0 : this._mechTries || 0)) < 3) {
            const m = await this.useMechanism(goal, tok).catch((e) => { if (e instanceof Cancelled) throw e; return ''; });
            if (m) { this._mechTries++; this.log(m + ' - бегом в проход'); await sleep(250); continue; }
          }
          throw new Error(`не дошёл: путь не строится, до цели ${left} бл.`);
        }
        break;
      } catch (e) {
        this.check(tok);
        // путь оборвался в воде (pathfinder не умеет вылезать на уступ) - вылезти самому и продолжить
        const feet = b.blockAt(b.entity.position);
        if (feet && /water|kelp|seagrass/.test(feet.name) && attempt < 5 && Date.now() < until && !/goal was changed/i.test(e.message)) {
          const g = goal.x !== undefined ? goal : null;
          const ledge = this.ledgeNear(5, g);
          if (ledge) {
            if (await this.climbOut(ledge)) { this.log('вылез из воды, продолжаю путь'); continue; }
            (this.badShore = this.badShore || []).push({ v: ledge.offset(0, -1, 0), at: Date.now() });   // в следующий раз - другой уступ
          }
        }
        // «пути нет» - проход закрыт (плита, кнопка, стена на поршнях): механизм рядом и снова, до 3 раз (23.11 стенд: внутрь
        // через секретную стену с плитой в канале - сдавался сразу)
        // «пути нет», цель выше или ниже на 3+, рядом лестница - лезть к высоте цели (трюм -> палуба по мачте, 24.11)
        if (/no path/i.test(e.message) && goal.y !== undefined && Math.abs(goal.y - b.entity.position.y) >= 3 && Date.now() < until && (this._npClimb = attempt === 0 ? 1 : (this._npClimb || 0) + 1) <= 2) {
          const upw = goal.y > b.entity.position.y;
          if (b.findBlocks({ matching: (bl) => /^(ladder|vine|scaffolding)$/.test(bl.name), maxDistance: 12, count: 1 }).length) {
            const m = await this.climbLadder({ dir: upw ? 'up' : 'down', toward: { x: goal.x, z: goal.z }, stopY: upw ? goal.y : undefined }, tok).catch((er) => { if (er instanceof Cancelled) throw er; return ''; });
            if (/поднялся|спустился/.test(m)) { this.log('пути не было - ' + m + ', снова к цели'); continue; }
          }
        }
        if (/no path/i.test(e.message) && (this._npMech = attempt === 0 ? 1 : (this._npMech || 0) + 1) <= 3 && Date.now() < until && goal.x !== undefined) {
          const m = await this.useMechanism({ x: goal.x, y: goal.y ?? b.entity.position.y, z: goal.z }, tok).catch((er) => { if (er instanceof Cancelled) throw er; return ''; });
          if (m) { this.log(m + ' - снова к цели'); await sleep(200); continue; }
        }
        if (!/goal was changed/i.test(e.message) || attempt >= 5 || Date.now() > until) throw e;
        for (let i = 0; i < (this.travelling ? 8 : 30) && this.guard && (this.guard.fighting || this.guard.fleeing); i++) { await sleep(1000); this.check(tok); }   // в дороге бой короткий
        if (Date.now() - (this._contAt || 0) > 3000) this.log('продолжаю путь');   // без 10 строк в одну миллисекунду
        this._contAt = Date.now();
        await sleep(300);
      } finally { clearTimeout(timer); clearInterval(watch); }
    }
    this.check(tok);
  }

  follow(name) {
    const e = this.player(name);
    this.cancel();
    const L = this.lastSeen;
    if (!e && !(L && L.name === name && Date.now() - L.at < 60000 && (!L.dim || L.dim === this.bot.game.dimension))) return `не вижу ${name} рядом (жду здесь)`;
    this.mode = 'follow';
    this.followName = name;
    this.lostReported = false;
    this._followEnt = e; this._seekLast = !e;
    if (e) this.bot.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true);
    else { this.bot.pathfinder.setGoal(new goals.GoalNear(L.pos.x, L.pos.y, L.pos.z, 1.5)); return `${name} не видно - иду, где был последний раз`; }
    return `иду за ${name}`;
  }

  /** Таблички рядом (8 блоков): текст с обеих сторон. */
  readSigns() {
    const b = this.bot, out = [];
    for (const p of b.findBlocks({ matching: (bl) => /_sign$/.test(bl.name), maxDistance: 8, count: 20 })) {
      const k = b.blockAt(p);
      let t = '';
      try { const st = k.getSignText ? k.getSignText() : []; t = (Array.isArray(st) ? st : [st]).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '); } catch {}
      if (t) out.push(`${p.x} ${p.y} ${p.z}: «${t}»`);
    }
    return out.length ? 'таблички: ' + out.join('; ') : 'рядом нет табличек с текстом';
  }

  /** Как близко идти следом (блоков): настройка бота «Поведение», меняется и словами («ближе», «подальше»). */
  // удобная дистанция (presence.js): теснее в доме, пещере и опасности, свободнее на просторе и когда хозяин бежит; не ближе 1,6
  followDist() { const d = +this.opts.followDist || 3; const k = this.comfortShift ? this.comfortShift() : 0; return Math.max(1.6, d + k + rnd(-0.3, 0.3)); }
  setFollowDist(d) {
    this.opts.followDist = Math.max(1.5, Math.min(12, +d || 3));
    if (this.mode === 'follow' && this.followName) { const e = this.player(this.followName); if (e) this.bot.pathfinder.setGoal(new goals.GoalFollow(e, this.followDist()), true); }
    return this.opts.followDist;
  }

  // Портал: встать прямо перед ним обычной ходьбой (наискосок мешает рама), потом шагнуть внутрь тоже ходьбой
  // pathfinder (его шаги античит принимает). Ручной прыжок - только запасной: с земли, прямо, не больше 3 раз
  // (частые прыжки в раму Vulcan считает Step C, после 15 - бан; стенд 15.11).
  async portal(a, tok) {
    this.portalTask = true;
    try { return await this._portal(a, tok); } finally { this.portalTask = false; this.arrivedAt = Date.now(); }
  }

  async _portal(a, tok) {
    const b = this.bot;
    const from = b.game.dimension;
    const id = b.registry.blocksByName.nether_portal.id;
    if (a.x === undefined || a.y === undefined || a.z === undefined) {
      const near = b.findBlock({ matching: id, maxDistance: 48 });
      if (!near) throw new Error('рядом нет портала');
      a = { x: near.position.x, y: near.position.y, z: near.position.z };
    }
    let target = new Vec3(Math.floor(+a.x), Math.floor(+a.y), Math.floor(+a.z));
    const pb = b.findBlock({ point: target, matching: id, maxDistance: 6 });
    if (pb) {
      target = pb.position;
      for (let i = 0; i < 4; i++) { const below = b.blockAt(target.offset(0, -1, 0)); if (below && below.name === 'nether_portal') target = target.offset(0, -1, 0); else break; }
    }
    const pbl = b.blockAt(target);
    const axis = pbl && pbl.getProperties ? pbl.getProperties().axis : 'x';
    const free = (v) => { const x = b.blockAt(v); return x && x.boundingBox === 'empty' && x.name !== 'nether_portal' && !/lava|fire/.test(x.name); };
    const sides = [];
    for (const s2 of [1, -1]) for (const dy of [-1, 0]) {
      const f = target.offset(axis === 'z' ? s2 : 0, dy, axis === 'z' ? 0 : s2);
      const below = b.blockAt(f.offset(0, -1, 0));
      if (free(f) && free(f.offset(0, 1, 0)) && below && below.boundingBox === 'block') sides.push(f);
    }
    const me0 = b.entity.position;
    sides.sort((p1, p2) => p1.distanceTo(me0) - p2.distanceTo(me0));
    const front = sides[0] || null;
    this.log(`к порталу ${target.x} ${target.y} ${target.z}: встаю перед ним ${front ? front.x + ' ' + front.y + ' ' + front.z : '(места перед ним не вижу)'}`);
    if (front) await this.goto(new goals.GoalBlock(front.x, front.y, front.z), tok, 90000);
    else await this.goto(new goals.GoalNear(target.x, target.y, target.z, 2), tok, 90000);
    const inside = () => { const at = b.blockAt(b.entity.position); return at && at.name === 'nether_portal'; };
    // только что вышел из этого портала (стоит в нём) - сервер не перенесёт снова, пока не выйдешь: шаг наружу и пауза
    if (inside() || Date.now() - (this.arrivedAt || 0) < 5000) {
      if (front) { try { await this.goto(new goals.GoalBlock(front.x, front.y, front.z), tok, 10000); } catch (e) { if (e instanceof Cancelled) throw e; } }
      await sleep(2500);
    }
    try { await this.goto(new goals.GoalBlock(target.x, target.y, target.z), tok, 8000); } catch (e) { if (e instanceof Cancelled) throw e; try { b.pathfinder.setGoal(null); } catch {} }
    this.busyLook = true;
    try {
      for (let i = 0; i < 3 && !inside() && b.game.dimension === from; i++) {
        this.check(tok);
        for (let w = 0; w < 20 && !b.entity.onGround; w++) await sleep(50);
        await b.lookAt(new Vec3(target.x + 0.5, b.entity.position.y + 1.62, target.z + 0.5), true);
        b.setControlState('forward', true);
        if (front && front.y < target.y) { await sleep(100); b.setControlState('jump', true); await sleep(100); b.setControlState('jump', false); }
        await sleep(600);
        b.clearControlStates();
        await sleep(700);
      }
      for (let i = 0; i < 30 && b.game.dimension === from; i++) { await sleep(500); this.check(tok); }
    } finally { b.clearControlStates(); this.busyLook = false; }
    if (b.game.dimension === from) throw new Error('портал не сработал');
    await sleep(2000);
    return `прошёл портал, теперь ${this.dimName()}`;
  }

  // --- навыки: подобрать вещи, вернуть свои после смерти, урожай
  // Вещи на земле рядом (как pickup в Baritone). Свои после смерти, чужие брошенные, дроп с урожая.
  async pickup(a, tok) {
    const b = this.bot;
    const r = Math.min(24, +a.radius || 8);
    const center = a.x !== undefined ? new Vec3(+a.x, +a.y, +a.z) : b.entity.position.clone();
    let got = 0;
    for (let round = 0; round < 40; round++) {
      this.check(tok);
      const items = Object.values(b.entities).filter((e) => e.name === 'item' && e.isValid && e.position.distanceTo(center) <= r)
        .sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position));
      if (!items.length) break;
      const it = items[0];
      try {
        await this.goto(new goals.GoalNear(it.position.x, it.position.y, it.position.z, 0.8), tok, 20000);
      } catch (e) { if (e instanceof Cancelled) throw e; }
      for (let i = 0; i < 10 && it.isValid; i++) await sleep(150);
      if (!it.isValid) got++;
      else { it.isValid = false; }   // недостижимо - пропускаем
    }
    return got ? `подобрал вещи (${got} кучек)` : 'вещей рядом нет';
  }

  // Урожай ломается мгновенно: настоящий клиент шлёт только «начал ломать» (status 0) и взмах. mineflayer.dig()
  // шлёт ещё и «закончил» (status 2) по уже пустому блоку - Vulcan Bad Packets C, кик (стенд 15.11).
  async breakInstant(block) {
    const b = this.bot;
    await b.lookAt(block.position.offset(0.5, 0.3, 0.5));
    this.digSeq = (this.digSeq || 0) + 1;
    b._client.write('block_dig', { status: 0, location: block.position, face: 1, sequence: this.digSeq });
    b.swingArm();
    for (let i = 0; i < 20; i++) {   // ждём, пока сервер сообщит, что блок сломан
      await sleep(50);
      const now = b.blockAt(block.position);
      if (!now || now.name !== block.name) return;
    }
    throw new Error('блок не сломался');
  }

  async recover(tok) {
    const d = this.deathPoint;
    if (!d) return 'места смерти не помню';
    if (d.dim !== this.bot.game.dimension) throw new Error(`вещи остались в другом измерении (${d.x} ${d.y} ${d.z})`);
    await this.goto(new goals.GoalNear(d.x, d.y, d.z, 2), tok, 300000);
    // предметы на земле сервер показывает не сразу после прихода: смотрим ещё пару раз
    let r = '';
    // вещи разлетаются: собирать кругами, пока два раза подряд пусто (23.11: подобрал часть и ушёл, остальное лежало рядом)
    let empty = 0, got = [];
    for (let i = 0; i < 12 && empty < 2; i++) {
      r = await this.pickup({ x: d.x, y: d.y, z: d.z, radius: 14 }, tok);
      if (/нет$/.test(r)) { empty++; await sleep(1500); } else { empty = 0; got.push(r); }
    }
    if (got.length) r = got.join('; ');
    this.deathPoint = null;
    return 'дошёл до места смерти, ' + r;
  }

  async afterDeath() {
    const d = this.deathPoint;
    if (!d || !this.bot) return;
    const follow = this.resumeFollow;
    this.event(`смерть на ${d.x} ${d.y} ${d.z}, возрождение; тело идёт забирать вещи`, true);
    const res = await this.run([{ act: 'recover' }], 'забрать вещи после смерти');
    this.event('после смерти: ' + res, true);
    if (follow && this.player(follow)) this.follow(follow);
    this.resumeFollow = '';
  }

  // Урожай: спелые культуры - сломать, подобрать, посадить обратно («взял - засади обратно»). Ничего, кроме урожая, не ломает.
  async harvest(a, tok) {
    const b = this.bot;
    // по образцу Baritone FarmProcess: что спелое и как сажать
    const CROPS = { wheat: [7, 'wheat_seeds'], carrots: [7, 'carrot'], potatoes: [7, 'potato'], beetroots: [3, 'beetroot_seeds'],
      nether_wart: [3, 'nether_wart'], sugar_cane: ['stack'], bamboo: ['stack'], melon: ['fruit'], pumpkin: ['fruit'] };
    const want0 = a.crop ? String(a.crop).replace(/^minecraft:/, '').toLowerCase() : '';
    const want = { carrot: 'carrots', potato: 'potatoes', beetroot: 'beetroots', wheat_seeds: 'wheat', beetroot_seeds: 'beetroots', 'пшеница': 'wheat', 'морковь': 'carrots', 'картофель': 'potatoes', 'картошка': 'potatoes', 'свёкла': 'beetroots' }[want0] || want0;
    const ids = Object.keys(CROPS).filter((n) => !want || n === want || n.startsWith(want)).map((n) => b.registry.blocksByName[n].id);
    const ready = (bl) => {
      const rule = CROPS[bl.name][0];
      if (rule === 'stack') return b.blockAt(bl.position.offset(0, -1, 0)).name === bl.name;   // нижний стебель не трогаем
      if (rule === 'fruit') {   // плод, а не украшение: рядом стебель, который к нему прикреплён
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const s = b.blockAt(bl.position.offset(dx, 0, dz));
          return s && s.name === `attached_${bl.name}_stem`;
        });
      }
      return (bl.getProperties().age | 0) >= rule;
    };
    const r = Math.min(32, +a.radius || (a.sowOnly ? 32 : 16));
    let done = 0, replanted = 0;
    const limit = a.sowOnly ? 0 : (+a.count || 256);   // sowOnly - только засеять пустые (23.11: просил засеять, а он собирал спелое)
    for (let i = 0; i < limit; i++) {
      this.check(tok);
      const skip = (this._cropSkip = this._cropSkip || new Map());
      const pos = b.findBlocks({ matching: ids, maxDistance: r, count: 200 })
        .map((p) => b.blockAt(p)).filter((bl) => bl && CROPS[bl.name] && ready(bl) && !(Date.now() - (skip.get(bl.position.toString()) || 0) < 10 * 60000))
        .sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
      if (!pos) break;
      const [, seed] = CROPS[pos.name];
      const p = pos.position;
      // не дойти (за забором, на крыше, чужой огород за стеной) - эту грядку пропустить на 10 мин, собирать другие
      // (23.11: «No path to the goal!» на одной грядке валил весь квест, и хозяину в личку уходила английская ошибка)
      try { await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, 30000); }
      catch (e) { if (e instanceof Cancelled) throw e; skip.set(p.toString(), Date.now()); continue; }
      const blk = b.blockAt(p);
      if (!blk || blk.name !== pos.name) continue;
      this.busyLook = true;
      try {
        if (blk.hardness === 0) await this.breakInstant(blk);
        else {   // арбуз, тыква, бамбук: обычное ломание лучшим инструментом (AutoTool)
          const tool = b.inventory.items().filter((x) => /_axe$/.test(x.name)).sort((x, y) => y.type - x.type)[0];
          if (tool) await b.equip(tool, 'hand');
          await b.lookAt(p.offset(0.5, 0.5, 0.5));
          await b.dig(blk, true);
        }
        done++;
        this.log('сорвал ' + pos.name + ' ' + p.x + ' ' + p.y + ' ' + p.z);
        // Как игрок: сорвал - сразу посадил своими семенами, не отводя взгляд (22.11: бот отворачивался, шёл за
        // семенами, возвращался и только потом сажал - лишние повороты головы). Семян нет - подобрать выпавшие.
        await sleep(150);
        const seedName = seed && typeof seed === 'string' && !['stack', 'fruit'].includes(seed) ? seed : null;
        let s = seedName ? b.inventory.items().find((x) => x.name === seedName) : null;
        if (seedName && !s) {
          this.busyLook = false;
          await this.pickup({ x: p.x + 0.5, y: p.y, z: p.z + 0.5, radius: 2.5 }, tok);
          s = b.inventory.items().find((x) => x.name === seedName);
          if (s && b.entity.position.distanceTo(p.offset(0.5, 0, 0.5)) > 4.2) await this.goto(new goals.GoalNear(p.x, p.y, p.z, 2), tok, 15000);
          this.busyLook = true;
        }
        const soil = b.blockAt(p.offset(0, -1, 0));
        if (s && soil && /farmland|soul_sand/.test(soil.name) && b.blockAt(p).name === 'air') {
          if (!b.heldItem || b.heldItem.name !== s.name) await b.equip(s, 'hand');
          await b.placeBlock(soil, new Vec3(0, 1, 0));
          replanted++;
        }
      } catch (e) { if (e instanceof Cancelled) throw e; this.log('урожай: ' + pos.name + ': ' + e.message); } finally { this.busyLook = false; }
    }
    await this.pickup({ radius: 6 }, tok);
    // пустые грядки (залысины) засадить: семенами культуры, которая растёт по соседству (23.11: собирал, а пустое так и
    // оставалось). Семена - из просьбы (crop) или от соседей; нет семян - сказать
    const SEED = { wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds' };
    let filled = 0, noSeed = new Set(); this._mostCrop = null;
    const fl = b.registry.blocksByName.farmland.id;
    // вытоптанная грядка - снова земля (23.11: просил засеять пустое на морковном поле - пустые клетки были землёй, не
    // пашней, и он их не видел). Земля посреди поля (с двух сторон культура) - вскопать мотыгой, потом засеять
    const soilIds = ['dirt', 'coarse_dirt'].map((n) => b.registry.blocksByName[n] && b.registry.blocksByName[n].id).filter((x) => x !== undefined);
    const hoe = () => b.inventory.items().filter((x) => /_hoe$/.test(x.name)).sort((x, y) => y.type - x.type)[0];
    let noHoe = false;
    const cropAt = (p) => { const n = b.blockAt(p); return n && SEED[n.name] ? n.name : null; };
    for (const sp of b.findBlocks({ matching: soilIds, maxDistance: Math.min(r, 12), count: 300 })) {
      this.check(tok);
      const up = b.blockAt(sp.offset(0, 1, 0)); if (!up || up.name !== 'air') continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cropAt(sp.offset(dx, 1, dz))).filter(Boolean);
      if (nb.length < 3 || (want && SEED[want] && !nb.includes(want))) continue;   // окружена грядками с 3 сторон - вытоптанная грядка, не тропинка   // не посреди поля - не трогать (дорожки, газон)
      const h = hoe(); if (!h) { noHoe = true; break; }
      try {
        if (b.entity.position.distanceTo(sp.offset(0.5, 1, 0.5)) > 4.2) await this.goto(new goals.GoalNear(sp.x, sp.y + 1, sp.z, 2), tok, 15000);
        await b.equip(h, 'hand'); await b.lookAt(sp.offset(0.5, 1, 0.5), true); await b.activateBlock(b.blockAt(sp)); await sleep(250);
      } catch (e) { if (e instanceof Cancelled) throw e; }
    }
    let emptySeen = 0;
    for (const sp of b.findBlocks({ matching: fl, maxDistance: r, count: 4000 }).sort((u, v) => u.distanceTo(b.entity.position) - v.distanceTo(b.entity.position))) {
      this.check(tok);
      const up = b.blockAt(sp.offset(0, 1, 0));
      if (!up || !/^(air|cave_air|void_air)$/.test(up.name)) continue;
      emptySeen++;
      let crop = want && SEED[want] ? want : null;
      if (!crop) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) { const n = b.blockAt(sp.offset(dx, 1, dz)); if (n && SEED[n.name]) { crop = n.name; break; } }
      if (!crop) crop = this._mostCrop || (this._mostCrop = (() => { const cnt = {}; for (const n of Object.keys(SEED)) { const id = b.registry.blocksByName[n] && b.registry.blocksByName[n].id; if (id !== undefined) cnt[n] = b.findBlocks({ matching: id, maxDistance: 24, count: 500 }).length; } const top = Object.entries(cnt).sort((u, v) => v[1] - u[1])[0]; return top && top[1] ? top[0] : null; })());
      if (!crop) continue;
      const s = b.inventory.items().find((x) => x.name === SEED[crop]);
      if (!s) { noSeed.add(SEED[crop]); continue; }
      try {
        if (b.entity.position.distanceTo(sp.offset(0.5, 1, 0.5)) > 4.2) await this.goto(new goals.GoalNear(sp.x, sp.y + 1, sp.z, 2), tok, 15000);
        if (!b.heldItem || b.heldItem.name !== s.name) await b.equip(s, 'hand');
        await b.placeBlock(b.blockAt(sp), new Vec3(0, 1, 0)); filled++;
      } catch (e) { if (e instanceof Cancelled) throw e; }
    }
    this.log(`засев: пустых грядок видел ${emptySeen}, засеял ${filled}`);
    if (noHoe) noSeed.add('мотыги (вскопать вытоптанное)');
    const tail = (filled ? `, засадил пустых грядок: ${filled}` : '') + (noSeed.size ? `; нечем засадить пустое: нет ${[...noSeed].join(', ')}` : '');
    if (a.sowOnly) return filled ? `засеял пустых грядок: ${filled}` + (noSeed.size ? `; не хватило: ${[...noSeed].join(', ')}` : '') : (noSeed.size ? `нечем засеять: нет ${[...noSeed].join(', ')}` : 'пустых грядок рядом нет');
    return (done ? `собрал урожай: ${done}, посадил обратно: ${replanted}` : 'спелого урожая рядом нет') + tail;
  }

  /**
   * Голос в Plasmo Voice через аддон TotemVoiceAddon на сервере: речь уходит обычными пакетами игры по каналу
   * totem:voice - [1] начало, [2]+PCM 48 кГц моно 16 бит кусками до 30 КБ, [3] конец. Аддон проигрывает её у бота.
   */
  async sendVoice(pcm, rate) {
    const b = this.bot;
    if (!b || this.status !== 'online') return false;
    // перевод в 48 кГц линейной интерполяцией (Qwen даёт 24 кГц, Piper - 22,05 кГц)
    const inN = Math.floor(pcm.length / 2);
    const outN = Math.floor(inN * 48000 / rate);
    const out = Buffer.alloc(outN * 2);
    for (let i = 0; i < outN; i++) {
      const pos = i * rate / 48000, j = Math.floor(pos), f = pos - j;
      const a = pcm.readInt16LE(Math.min(j, inN - 1) * 2), c = pcm.readInt16LE(Math.min(j + 1, inN - 1) * 2);
      out.writeInt16LE(Math.round(a + (c - a) * f), i * 2);
    }
    const send = (type, data) => b._client.write('custom_payload', { channel: 'totem:voice', data: Buffer.concat([Buffer.from([type]), data || Buffer.alloc(0)]) });
    send(1);
    for (let off = 0; off < out.length; off += 30000) {
      send(2, out.subarray(off, off + 30000));
      await sleep(15);
    }
    send(3);
    return true;
  }

  /** remember: place (без координат - где стою), person, fact. */
  /** Под крышей ли клетка: твёрдое над головой в 6 бл. */
  roofed(x, y, z) { for (let dy = 2; dy <= 7; dy++) { const k = this.bot.blockAt(new Vec3(x, y + dy, z)); if (k && k.boundingBox === 'block') return true; } return false; }

  /**
   * Дом рядом с точкой, если сама точка на улице (23.11: хозяин сказал «дом вот белый», стоя на дороге и глядя на дом, -
   * метка встала на улице). Кровать под крышей, иначе дверь: клетка за ней под крышей; в сторону взгляда хозяина - вперёд.
   */
  houseSpot(p, yaw, all) {
    const b = this.bot, R = 24;
    const fac = (q) => { if (yaw === undefined) return 0; const ang = Math.atan2(-(q.x - p.x), -(q.z - p.z)); let d = Math.abs(ang - yaw) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d < 1.2 ? -8 : 0; };
    const score = (q) => Math.hypot(q.x - p.x, q.z - p.z) + fac(q);
    const stand = (x, y, z) => this.standOk ? this.standOk(x, y, z) : true;
    const cands = [];
    try {
      for (const v of b.findBlocks({ point: p, matching: (bl) => /_bed$/.test(bl.name), maxDistance: R, count: 10 })) {
        if (!this.roofed(v.x, v.y, v.z)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (stand(v.x + dx, v.y, v.z + dz)) { cands.push({ x: v.x + dx, y: v.y, z: v.z + dz, why: 'у кровати' }); break; }
      }
      for (const v of b.findBlocks({ point: p, matching: (bl) => /_door$/.test(bl.name) && !/trapdoor/.test(bl.name), maxDistance: R, count: 20 })) {
        const d = b.blockAt(v); if (!d || String(d.getProperties().half) === 'upper') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const k of [2, 3]) {
          const x = v.x + dx * k, z = v.z + dz * k;
          if (stand(x, v.y, z) && this.roofed(x, v.y, z) && !this.roofed(v.x - dx * 2, v.y, v.z - dz * 2)) { cands.push({ x, y: v.y, z, why: 'за дверью' }); break; }
        }
      }
    } catch {}
    cands.sort((u, w) => score(u) - score(w));
    if (all) return cands;
    return cands[0] || null;
  }

  /**
   * Какой дом - непонятно (рядом ни одного или несколько): спросить хозяина и взять дом, на который он посмотрит
   * (до 90 с; взгляд держится на одном месте 1,5 с). Работает телом, без нейросети - лимит Qwen не мешает.
   */
  askHouse(name, boss, dim, who) {
    const b = this.bot;
    if (this._houseAsk) clearInterval(this._houseAsk.t);
    this.say('Какой дом? Посмотрите на него, я запомню.', 'whisper', boss);
    const st = { until: Date.now() + 90000, key: '', since: 0 };
    st.t = setInterval(() => {
      try {
        const o = this.player(boss);
        if (Date.now() > st.until || !b || !b.entity) { clearInterval(st.t); this._houseAsk = null; if (Date.now() > st.until) this.say('Не понял(а), какой дом. Скажите «это наш дом», стоя внутри него.', 'whisper', boss); return; }
        if (!o) return;
        // пока хозяин показывает - быть рядом и смотреть туда же, куда он (23.11, владелец: «странно, если я объясняю, а он
        // где-то шатается»). Своя жизнь и прогулки на это время замолкают (они ждут затишья после дел)
        this.lastRunAt = Date.now();
        if (this.sandbox && this.sandboxEnd) this.sandboxEnd('хозяин показывает дом');
        const busyQuest = this._errandBusy || this.mode === 'task';
        if (!busyQuest && o.position.distanceTo(b.entity.position) > 4 && !st.walk) { st.walk = true; try { b.pathfinder.setGoal(new goals.GoalFollow(o, 2), true); } catch {} }
        if (st.walk && o.position.distanceTo(b.entity.position) <= 3) { st.walk = false; try { if (this.mode !== 'follow') b.pathfinder.setGoal(null); } catch {} }
        const eye = o.position.offset(0, 1.62, 0), dir = new Vec3(-Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), -Math.cos(o.yaw) * Math.cos(o.pitch));
        const hit = b.world.raycast(eye, dir, 48);
        if (!hit || !hit.position) { st.key = ''; this.lookTarget = o.position.offset(0, 1.6, 0); return; }
        this.lookTarget = hit.position.offset(0.5, 0.5, 0.5);   // смотрит туда же, куда хозяин
        const k = `${Math.floor(hit.position.x / 3)},${Math.floor(hit.position.z / 3)}`;
        if (k !== st.key) { st.key = k; st.since = Date.now(); return; }
        if (Date.now() - st.since < 1500) return;
        const h = this.houseSpot(hit.position);
        if (!h || Math.hypot(h.x - hit.position.x, h.z - hit.position.z) > 12) return;   // смотрит не на дом - ждать
        clearInterval(st.t); this._houseAsk = null;
        const r = this.memory.place({ name, x: h.x, y: h.y, z: h.z, dim }, who);
        this.log(`${r} - дом, на который посмотрел ${boss} (${h.why})`);
        this.say('Запомнил(а), это наш дом.', 'whisper', boss);
      } catch {}
    }, 500);
    this._houseAsk = st;
  }

  /** Центр связного участка культуры: ближайшая к точке (или к боту) грядка, заливка по соседям (зазор до 2 бл. - дорожки, вода). */
  cropCenter(name, near) {
    const b = this.bot, id = b.registry.blocksByName[name] && b.registry.blocksByName[name].id;
    if (id === undefined) return null;
    const ps = b.findBlocks({ matching: id, maxDistance: 24, count: 2000 });
    if (!ps.length) return null;
    const o = near ? new Vec3(+near.x, +near.y, +near.z) : b.entity.position;
    const set = new Map(ps.map((p) => [p.x + ',' + p.z, p]));
    const start = ps.sort((u, v) => u.distanceTo(o) - v.distanceTo(o))[0];
    const seen = new Set([start.x + ',' + start.z]), q = [start], got = [];
    while (q.length) {
      const p = q.pop(); got.push(p);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const k = (p.x + dx) + ',' + (p.z + dz); if (!seen.has(k) && set.has(k)) { seen.add(k); q.push(set.get(k)); } }
    }
    const xs = got.map((p) => p.x), zs = got.map((p) => p.z), ys = got.map((p) => p.y).sort((u, v) => u - v);
    return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), z: Math.round((Math.min(...zs) + Math.max(...zs)) / 2), y: ys[ys.length >> 1], n: got.length, w: Math.max(...xs) - Math.min(...xs) + 1, l: Math.max(...zs) - Math.min(...zs) + 1 };
  }

  /** Все отдельные участки культуры в 24 бл.: [{x,y,z,n,w,l}], ближние первыми. Зазор до 1 бл. (дорожка) - тот же участок. */
  cropFields(name) {
    const b = this.bot, id = b.registry.blocksByName[name] && b.registry.blocksByName[name].id;
    if (id === undefined) return [];
    const ps = b.findBlocks({ matching: id, maxDistance: 24, count: 3000 });
    const set = new Map(ps.map((p) => [p.x + ',' + p.z, p])), seen = new Set(), out = [];
    for (const s0 of ps) {
      const k0 = s0.x + ',' + s0.z; if (seen.has(k0)) continue; seen.add(k0);
      const q = [s0], got = [];
      while (q.length) {
        const p = q.pop(); got.push(p);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const k = (p.x + dx) + ',' + (p.z + dz); if (!seen.has(k) && set.has(k)) { seen.add(k); q.push(set.get(k)); } }
      }
      if (got.length < 3) continue;
      const xs = got.map((p) => p.x), zs = got.map((p) => p.z), ys = got.map((p) => p.y).sort((u, v) => u - v);
      out.push({ x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), z: Math.round((Math.min(...zs) + Math.max(...zs)) / 2), y: ys[ys.length >> 1], n: got.length, w: Math.max(...xs) - Math.min(...xs) + 1, l: Math.max(...zs) - Math.min(...zs) + 1 });
    }
    const me = b.entity.position;
    return out.sort((u, v) => Math.hypot(u.x - me.x, u.z - me.z) - Math.hypot(v.x - me.x, v.z - me.z));
  }

  remember(a, by) {
    const m = this.memory;
    if (!m) return 'памяти нет';
    const who = this.opts.name + (by ? ` (${by})` : '');
    const kind = a.kind || (a.text ? 'fact' : a.note && !a.x ? 'person' : 'place');
    if (kind === 'place') {
      // поле культуры: центр считает тело - связный участок этой культуры рядом (23.11: мозг гадал координаты, морковь и
      // картошку перепутал, ставил метки на краях участков)
      const CROP = [[/морков|carrot/i, 'carrots'], [/картоф|картош|potato/i, 'potatoes'], [/пшени|wheat/i, 'wheat'], [/свекл|свёкл|beet/i, 'beetroots'], [/тыкв|pumpkin/i, 'pumpkin'], [/арбуз|melon/i, 'melon'], [/тростн|cane/i, 'sugar_cane'], [/бородав|wart/i, 'nether_wart']];
      const cr = /пол[еяю]|грядк|огород|ферм|field|farm/i.test(String(a.name || '')) && CROP.find(([re]) => re.test(String(a.name)));
      if (!cr && /пол[еяю]|грядк|огород|ферм|field|farm/i.test(String(a.name || ''))) {
        // общее «запиши, где поля» (23.11: спрашивал, где они, а вокруг росли картошка, морковь, тыквы) - все культуры рядом
        const RU = { carrots: 'морковь', potatoes: 'картофель', wheat: 'пшеница', beetroots: 'свёкла', pumpkin: 'тыквы', melon: 'арбузы', sugar_cane: 'тростник', nether_wart: 'незерский_нарост' };
        const out = [];
        // каждый отдельный участок - своя метка (23.11: вокруг много маленьких огородов, а метка была одна на культуру)
        for (const [, id] of CROP) {
          const fs2 = this.cropFields(id);
          fs2.forEach((c, i) => out.push(this.memory.place({ name: 'поле_' + RU[id] + (fs2.length > 1 ? '_' + (i + 1) : ''), x: c.x, y: c.y, z: c.z, dim: this.dimName(), note: `участок ${c.n} грядок, ${c.w}x${c.l}` }, who)));
          if (fs2.length > 1 && this.memory.data.places) delete this.memory.data.places[('поле_' + RU[id]).toLowerCase()];   // старая общая метка
        }
        return out.length ? out.join('; ') : 'полей рядом не вижу (до 24 бл.)';
      }
      if (cr) {
        const c = this.cropCenter(cr[1], a.x !== undefined ? a : null);
        if (c) { a.x = c.x; a.y = c.y; a.z = c.z; a.note = (a.note ? a.note + '; ' : '') + `участок ${c.n} грядок, ${c.w}x${c.l}`; }
        else return `не вижу рядом поля ${cr[1]} - подойди к нему ближе (до 24 бл.), тогда отмечу центр`;
      }
      // дом и базу называет хозяин (22.11: при входе под водой у корабля мозг сам записал «база» - на дне, и потом
      // плыл туда и тонул)
      if (a.x === undefined && this.runSource !== 'master' && /^(мой |моя |наш |наша )?(дом|база|хата|жильё)/i.test(String(a.name || ''))) return `«${a.name}» не записываю: дом и базу называет хозяин`;
      // точка под водой или в воздухе - ближайшее место, где можно стоять (до 8 бл.), иначе не записывать
      if (a.x === undefined) {
        const f = this.bot.entity.position.floored(), here = this.bot.blockAt(f);
        if (here && /water|lava/.test(here.name) || !(this.standOk && this.standOk(f.x, f.y, f.z))) {
          let best = null;
          for (let r = 1; r <= 8 && !best; r++) for (let dx = -r; dx <= r && !best; dx++) for (let dz = -r; dz <= r && !best; dz++) for (let dy = 4; dy >= -2; dy--) {
            const x = f.x + dx, y = f.y + dy, z = f.z + dz, k = this.bot.blockAt(new Vec3(x, y, z));
            if (this.standOk && this.standOk(x, y, z) && k && !/water/.test(k.name)) { best = { x, y, z }; break; }
          }
          if (!best) return `«${a.name}» не записываю: тут нельзя стоять (вода или воздух), твёрдого места рядом нет`;
          a = { ...a, x: best.x, y: best.y, z: best.z };
        }
      }
      let p = this.bot.entity.position;
      // «вот красная ветка», «это склад» - место там, где хозяин или куда он смотрит рядом (до 10 бл.), а не где бот
      // (23.11: все ветки метро записывались туда, где стоял бот)
      if (a.x === undefined && this.runSource === 'master') {
        const boss = (this.opts.masters || []).map((n) => this.player(n)).find((e) => e && e.position.distanceTo(p) < 24);
        if (boss) {
          let at = boss.position;
          try {
            const eye = boss.position.offset(0, 1.62, 0), dir = new Vec3(-Math.sin(boss.yaw) * Math.cos(boss.pitch), Math.sin(boss.pitch), -Math.cos(boss.yaw) * Math.cos(boss.pitch));
            const hit = this.bot.world.raycast(eye, dir, 10);
            if (hit && hit.position && boss.pitch < -0.2) at = hit.position.offset(0.5, 1, 0.5);   // смотрит вниз, на пол или знак у ног
          } catch {}
          p = at;
        }
      }
      // «это дом», а стоим на улице - метку в сам дом рядом (у кровати или за дверью), в сторону взгляда хозяина
      if (a.x === undefined && /(дом|база|хата|жиль)/i.test(String(a.name || '')) && !this.roofed(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {
        const boss = (this.opts.masters || []).map((n) => this.player(n)).find((e) => e && e.position.distanceTo(p) < 12);
        const all = this.houseSpot(boss ? boss.position : p, boss ? boss.yaw : undefined, true);
        // разные дома - кандидаты дальше 10 бл. друг от друга; ни одного или несколько - переспросить, не угадывать
        const houses = []; for (const c of all) if (!houses.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 10)) houses.push(c);
        const faced = boss && houses.length > 1 && (() => { const ang = (q) => { let d = Math.abs(Math.atan2(-(q.x - boss.position.x), -(q.z - boss.position.z)) - boss.yaw) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; }; const f = houses.filter((q) => ang(q) < 0.5); return f.length === 1 ? f[0] : null; })();
        const h = houses.length === 1 ? houses[0] : faced;
        if (!h && boss) { this.askHouse(a.name, boss.username, a.dim || this.dimName(), who); return `«${a.name}»: ${houses.length ? 'рядом несколько домов' : 'дома рядом не вижу'} - спросил хозяина, какой; запомню, когда посмотрит на него`; }
        if (h) { const r0 = m.place({ name: a.name, x: h.x, y: h.y, z: h.z, dim: a.dim || this.dimName(), note: a.note }, who); return `${r0} - в доме ${h.why} (стояли на улице)`; }
      }
      return m.place({ name: a.name, x: a.x ?? Math.floor(p.x), y: a.y ?? Math.floor(p.y), z: a.z ?? Math.floor(p.z), dim: a.dim || this.dimName(), note: a.note }, who);
    }
    if (kind === 'person') return m.person(a, who);
    if (kind === 'journal' || kind === 'thought') { m.journal(this.opts.name, a.text); return 'записал в дневник'; }
    return m.fact(a, who);
  }

  /** Прогулка: пройти radius блоков в сторону света (по умолчанию - где ещё не был). Не дошёл - не беда. */
  async wander(a, tok) {
    const b = this.bot, me = b.entity.position.clone();
    const DIRS = { 'север': 0, 'северо-восток': 45, 'восток': 90, 'юго-восток': 135, 'юг': 180, 'юго-запад': 225, 'запад': 270, 'северо-запад': 315 };
    const r = Math.max(16, Math.min(96, +a.radius || 48));
    const dir = DIRS[a.dir] !== undefined ? a.dir : (this.worldMap ? this.worldMap.leastExplored(this) : Object.keys(DIRS)[Math.floor(Math.random() * 8)]);
    const ang = (DIRS[dir] + (Math.random() - 0.5) * 50) * Math.PI / 180;
    const x = Math.round(me.x + Math.sin(ang) * r), z = Math.round(me.z - Math.cos(ang) * r);
    let note = '';
    try { await this.goto(new goals.GoalNearXZ(x, z, 3), tok, 90000); } catch (e) { if (e instanceof Cancelled) throw e; note = ' (дальше не прошёл)'; }
    const p = b.entity.position;
    const seen = this.worldMap ? this.worldMap.nearby(this, 48, 3).map((o) => o.text).join('; ') : '';
    return `прогулялся на ${dir}: прошёл ${Math.round(p.distanceTo(me))} бл.${note}, теперь у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` + (seen ? `; рядом: ${seen}` : '');
  }

  /** Выполнить список действий по порядку. Возвращает итог текстом. */
  /**
   * Судья дел (кто главнее): хозяин (3) > мозг по просьбе игрока (2) > мозг сам (1) > жизнь тела (0).
   * Младший не прерывает дело старшего, пока оно идёт (не дольше 5 мин): иначе своё «свободное время» мозга
   * обрывало поручение хозяина, а жизнь тела - решения мозга (16-21.11).
   */
  claim(source) {
    const rank = { master: 3, player: 2, self: 1, life: 0 }[source] ?? 2;
    if (this._errandBusy && rank < 3) { const e = this.errand(); if (e && e.state === 'run') return `выполняю поручение хозяина (шаг ${e.cur + 1} из ${e.steps.length}) - сделаю после`; }
    const cur = this.taskOwner;
    if (cur && this.mode === 'task' && Date.now() - cur.at < 300000 && rank < cur.rank) return `занята делом поважнее (${cur.label}) - сделаю после`;
    this.taskOwner = { rank, at: Date.now() };
    return '';
  }

  /** Единый журнал событий тела (JSON по строке): для разбора игры и сценариев. */
  ev(type, data = {}) {
    try {
      const p = this.bot && this.bot.entity ? this.bot.entity.position : null;
      const line = JSON.stringify({ t: new Date().toISOString(), type, pos: p ? [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)] : null, dim: this.bot && this.bot.game && this.bot.game.dimension, ...data });
      require('fs').appendFileSync(require('path').join(__dirname, '..', 'local', 'logs', `${this.opts.name}.events.jsonl`), line + '\n');
    } catch {}
  }

  /** Сколько каких вещей сейчас (для проверки итога действия). */
  invCounts() { const m = {}; for (const i of (this.bot && this.bot.inventory ? this.bot.inventory.items() : [])) m[i.name] = (m[i.name] || 0) + i.count; return m; }

  async run(actions, label, source = 'player') {
    if (!this.bot || this.status !== 'online') return 'бот не на сервере';
    if (this.paused) return 'на паузе - стою, пока хозяин не нажмёт «Продолжить»';
    const busy = this.claim(source);
    if (busy) { this.ev('отказ_судьи', { source, label }); return busy; }
    if (this.taskOwner) this.taskOwner.label = label || actions.map((a) => a && a.act).join(', ');
    this.runSource = source;   // для умных предметов: рычаг и кнопка - только по просьбе хозяина
    this.lastRunAt = Date.now();   // для жизни тела: мозг занят - не перебивать
    let plain = actions.filter((a) => a && a.act);
    if (!plain.length) return '';
    // «стоп» в цепочке с другими действиями Qwen ставит, чтобы бросить прежнее: прежнее и так отменяется
    if (plain.length > 1) plain = plain.filter((a) => a.act !== 'stop');
    // одиночные мгновенные: идти за кем-то, стоп
    if (plain.length === 1 && plain[0].act === 'follow') return this.follow(plain[0].who);
    // «садись» одним словом - по обстановке (22.11): хозяин в лодке или у лодки (в 3 бл.) - к нему в лодку, иначе - присесть
    if (plain.length === 1 && plain[0].act === 'sitOrMount') {
      const o = this.player(plain[0].who);
      const boat = o && (o.vehicle || Object.values(this.bot.entities).some((e) => /boat|raft/.test(e.name || '') && e.position.distanceTo(o.position) < 3));
      plain[0] = boat ? { act: 'mount', who: plain[0].who } : { act: 'sit' };
    }
    if (plain.length === 1 && plain[0].act === 'stop') { this.cancel(); return 'остановился'; }
    // жест и «встать» - не дело: текущее не прерывают
    if (plain.length && plain.every((a) => a.act === 'zone')) return plain.map((a) => this.zoneAct(a)).join('; ');   // зона - не дело, текущее не прерывает
    if (plain.length === 1 && plain[0].act === 'quiet') { this.opts.quiet = plain[0].on !== false; if (this.onQuiet) this.onQuiet(this.opts.quiet); return this.opts.quiet ? 'тихий режим: в чат не пишу' : 'снова могу говорить в чат'; }
    if (plain.length && plain.every((a) => a.act === 'gesture' || a.act === 'stand')) { for (const a of plain) { if (a.act === 'gesture') await this.gesture(String(a.kind || 'привет').toLowerCase()); else await this.standUp(); } return plain.map((a) => a.act === 'gesture' ? 'жест «' + (a.kind || 'привет') + '» показан' : 'встал(а)').join('; '); }
    // Идёт за кем-то, а дело лёгкое (посмотреть, поесть, надеть, план, подождать...) - после него снова идти следом.
    // Раньше любое такое действие обрывало слежку навсегда: бот отвечал в чат и вставал (16.11).
    const LIGHT = new Set(['combat', 'signs', 'followDist', 'look', 'plan', 'craftable', 'lesson', 'remember', 'forget', 'equip', 'eat', 'cmd', 'wait', 'toss', 'discardAll', 'findSpot', 'craft', 'pickup', 'sleep', 'mount', 'dismount', 'give']);
    const resume = this.mode === 'follow' && plain.every((a) => LIGHT.has(a.act)) ? this.followName : '';
    // то же дело уже идёт (мозг на каждый итог и реплику отвечает той же цепочкой) - не начинать заново
    // (22.11: «собери урожай и поторгуйся» - каждый новый ответ отменял прежний, «задание отменено» снова будило
    // нейросеть, и она стояла, ничего не доделав)
    // то же самое - это то же действие с теми же данными (22.11: !drive к новым координатам считался «уже делаю»)
    const sig = (a) => JSON.stringify(Object.entries(a).filter(([k]) => k !== '_cmd').sort());
    if (this.mode === 'task' && this.runActs && plain.every((a) => this.runActs.slice(this.runAt || 0).includes(sig(a)))) return 'уже делаю: ' + plain.map((a) => a.act).join(', ');
    if (this.mode === 'task') this.replacedTok = this.token;   // прежнее заменено новым: его «отменено» мозгу не нужно
    this.cancel();
    const tok = this.token;
    this.runActs = plain.map((a) => JSON.stringify(Object.entries(a).filter(([k]) => k !== '_cmd').sort())); this.runAt = 0;
    this.mode = 'task';
    this.task = label || plain.map((a) => a.act).join(', ');
    const done = [];
    const b0 = () => this.bot.entity.position;
    let inv0 = this.invCounts();
    try {
      for (let a of plain) {
        this.check(tok);
        if (tok === this.token) this.runAt = plain.indexOf(a);
        let r;
        // идти пешком, сидя: на сиденье (полублок, ступенька) - встать; в лодке за рулём - плыть туда же (!drive),
        // пассажиром - сказать, кто рулит (22.11: в лодке давал «шагать» вместо «плыть»)
        // на сиденье (GSit) - встать перед любым делом, кроме тех, что делаются сидя (23.11: присела отдохнуть, пришло
        // «добудь хлеб» - и просидела, пока программу не выключили: вставала только перед ходьбой)
        const STILL = /^(stand|sit|dismount|drive|mount|gesture|quiet|combat|followDist|signs|where|errand|errandStop|errandGo|eat|equip|cmd|say|remember\w*|forget\w*|forbidArea|allowArea)$/;
        if (this.bot.vehicle && !STILL.test(a.act) && !/boat|raft|horse|donkey|mule|camel|pig|strider|llama|minecart/.test(this.bot.vehicle.name || '')) { await this.standUp(); await sleep(300); }
        if (this.bot.vehicle && /^(goto|come|goto_place|wander|gather|mine|harvest|take|put|use|trades|trade)$/.test(a.act)) {
          const v = this.bot.vehicle, isRide = /boat|raft|horse|donkey|mule|camel|pig|strider|llama/.test(v.name || '');
          if (!isRide) { await this.standUp(); await sleep(300); }
          else if (/boat|raft/.test(v.name || '') && a.act === 'goto' && a.x !== undefined) {
            const ps = v.passengers || [];
            if (ps.length && ps[0] !== this.bot.entity) throw new Error(`я в лодке пассажиром, рулит ${ps[0].username || ps[0].name}`);
            a = { act: 'drive', x: a.x, z: a.z };
            this.log('в лодке за рулём: идти -> плыть');
          } else if (a.act !== 'come') { try { await this.dismount(); } catch {} await sleep(400); }
        }
        switch (a.act) {
          case 'goto': {
            const tgt = new Vec3(+a.x, a.y !== undefined ? +a.y : this.bot.entity.position.y, +a.z);
            try { if (Math.hypot(tgt.x - this.bot.entity.position.x, tgt.z - this.bot.entity.position.z) > 40) await this.walkTo({ x: tgt.x, y: a.y !== undefined ? tgt.y : null, z: tgt.z }, tok, 300000); else await this.goto(a.y !== undefined ? new goals.GoalNear(tgt.x, tgt.y, tgt.z, 1) : new goals.GoalNearXZ(tgt.x, tgt.z, 1), tok, 300000); r = `дошёл до ${a.x} ${a.y ?? ''} ${a.z}`; }
            catch (e) {
              if (e instanceof Cancelled) throw e;
              let left = this.bot.entity.position.distanceTo(tgt);
              if (left > 1.5) {
                // в шаге от цели упёрся (поршни, железная дверь) - как игрок: кнопку рядом и снова (23.11: «почти дошёл» у
                // поршня, кнопку не нажал)
                const m = await this.useMechanism(tgt, tok).catch((er) => { if (er instanceof Cancelled) throw er; return ''; });
                if (m) { this.log(m + ' - снова к цели'); try { await this.goto(new goals.GoalNear(tgt.x, tgt.y, tgt.z, 1), tok, 20000); r = `${m}; дошёл до ${a.x} ${a.y ?? ''} ${a.z}`; break; } catch (er2) { if (er2 instanceof Cancelled) throw er2; left = this.bot.entity.position.distanceTo(tgt); } }
              }
              if (left > 6) throw e;
              r = `дошёл почти до ${a.x} ${a.y ?? ''} ${a.z} (осталось ${left.toFixed(0)} бл.: ближе пути нет)`;
            }
            break;
          }
          case 'come': {
            let e = this.player(a.who);
            const X = this._lastExit && Date.now() - this._lastExit.at < 30 * 60000 ? this._lastExit : null;
            // недавно вышел наружу, а хозяин внизу или не виден - назад тем же путём (шаг в шаг, плиты и лестницы по дороге)
            if (X && (!e || (e.position.y < this.bot.entity.position.y - 4 && e.position.distanceTo(X.pts[0]) < 24))) {
              r = await this.walkBack(X.pts, tok);
              e = this.player(a.who);
              if (!e) break;
            }
            if (!e) throw new Error(`не вижу ${a.who}`);
            await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok, 300000); r = (r ? r + '; ' : '') + `подошёл к ${a.who}`; break;
          }
          case 'take': r = await this.take(a, tok); break;
          case 'put': r = await this.put(a, tok); break;
          case 'undoPut': r = await this.undoPut(a, tok); break;
          case 'errand': r = this.startErrand({ ...a, from: a.from || this.runFrom }); return done.concat(r).join('; ');
          case 'errandStop': r = this.cancelErrand(); break;
          case 'trades': r = await this.lookTrades(a, tok); break;
          case 'portalFix': r = await this.portalFix(a, tok); break;
          case 'portalBuild': r = await this.portalBuild(a, tok); break;
          case 'portalBreak': r = await this.portalBreak({ ...a, master: source === 'master' }, tok); break;
          case 'where': { const pc = this.passCacheShared; if (!pc) { r = 'кэша мира нет'; break; } const list = pc.nearest(String(this.bot.game.dimension).replace(/^minecraft:/, ''), a.what || 'chest', this.bot.entity.position, 5); r = list.length ? `ближайшие ${a.what}: ` + list.map((x) => `${x.name} ${x.x} ${x.y} ${x.z} (${Math.round(x.d)} бл.)`).join('; ') : `не видела ${a.what} поблизости (смотрю только там, где была)`; break; }
          case 'trade': r = await this.doTrade(a, tok); break;
          case 'obtain': r = await this.obtain(a, tok); break;
          case 'errandGo': r = this.resumeErrand(); return done.concat(r).join('; ');
          case 'give': r = await this.give(a, tok); break;
          case 'portal': r = await this.portal(a, tok); break;
          case 'pickup': r = await this.pickup(a, tok); break;
          case 'recover': r = await this.recover(tok); break;
          case 'harvest': r = await this.harvest(a, tok); break;
          case 'getOut': r = this.bot.vehicle ? await this.dismount() : await this.climbLadder({ dir: 'up' }, tok); break;
          case 'climb': r = await this.climbLadder(a, tok); break;
          case 'outside': r = await this.goOutside(a, tok); break;
          case 'swim': r = await this.goSwim(a, tok); break;
          case 'back': r = this._lastExit ? await this.walkBack(this._lastExit.pts, tok) : 'обратного пути не помню'; break;
          case 'remember': r = this.remember(a, label); break;
          case 'forget': r = this.memory ? this.memory.forget(a) : 'памяти нет'; break;
          case 'travel': r = await this.travelTo(a, tok); break;
          case 'goto_place': {
            const pl = this.memory && this.memory.findPlace(a.name);
            if (!pl) throw new Error(`не знаю места «${a.name}»`);
            // к этому месту показана дорога - по ней (через порталы, как вёл хозяин)
            { const rt = this.routeFind && this.routeFind(a.name); const end = rt && rt.pts[rt.pts.length - 1];
              if (end && Math.hypot(end.x - pl.x, end.z - pl.z) < 16 && Math.hypot(pl.x - b0().x, pl.z - b0().z) > 48) { r = await this.routeRun({ name: rt.name }, tok); break; } }
            // в другом измерении или далеко - дальний путь (может, через Незер)
            if (this.travel && (pl.dim !== this.dimName() || Math.hypot(pl.x - b0().x, pl.z - b0().z) > 300)) { r = await this.travelTo({ place: a.name }, tok); break; }
            // дальше 48 бл. - тропами, обычной ходьбой, разведкой (walkTo); рядом - просто подойти
            const noY = /высота неизвестна/.test(pl.note || '');   // метка из чата без высоты - идти по x z
            if (Math.hypot(pl.x - b0().x, pl.z - b0().z) > 48) await this.walkTo({ x: pl.x, y: noY ? null : pl.y, z: pl.z }, tok, 600000);
            else await this.goto(noY ? new goals.GoalNearXZ(pl.x, pl.z, 2) : new goals.GoalNear(pl.x, pl.y, pl.z, 2), tok, 600000);
            r = `пришёл к месту «${pl.name}»`;
            // метка дома на улице (старые метки, 23.11) - пришли, видим дом рядом: перенести метку внутрь
            if (/(дом|база|хата|жиль)/i.test(pl.name) && !this.roofed(pl.x, pl.y, pl.z)) {
              const h = this.houseSpot(new Vec3(pl.x, pl.y, pl.z));
              if (h && Math.hypot(h.x - pl.x, h.z - pl.z) < 16) { this.memory.place({ ...pl, x: h.x, y: h.y, z: h.z }, this.opts.name + ' (поправил: метка была на улице)'); r += `; метка была на улице - перенёс в дом (${h.why}: ${h.x} ${h.y} ${h.z})`; }
            }
            break;
          }
          case 'wait': await sleep(Math.min(60, +a.seconds || 3) * 1000); this.check(tok); r = 'подождал'; break;
          case 'wander': r = await this.wander(a, tok); break;
          case 'stroll': r = await this.stroll(a, tok); break;
          case 'teach': r = this.teachStart({ ...a, who: a.who || this.runFrom || (this.opts.masters || [])[0] }); return done.concat(r).join('; ');
          case 'teachStop': r = this.teachStop(); break;
          case 'route': r = await this.routeRun(a, tok); break;
          case 'survey': r = await this.survey(a, tok); break;
          case 'fly': r = await this.fly(a, tok); break;
          case 'rail': r = await this.rail(a, tok); break;
          case 'brew': r = await this.brew(a, tok); break;
          case 'smith': r = await this.smith(a, tok); break;
          case 'stonecut': r = await this.stonecut(a, tok); break;
          case 'loom': r = await this.loom(a, tok); break;
          case 'trim': r = await this.trim(a, tok); break;
          case 'link': r = this.link(a); break;
          case 'howTo': r = this.howTo(a); break;
          case 'prepare': r = await this.prepare(a, tok); break;
          case 'findEntity': r = this.findEntity(a); break;
          case 'scanBlocks': r = this.scanBlocks(a); break;
          case 'loadout': r = await this.loadout(a, tok); break;
          case 'gather': r = await this.skills.gather(a, tok); break;
          case 'till': r = await this.skills.till(a, tok); break;
          case 'plant': r = await this.skills.plant(a, tok); break;
          case 'farm': r = await this.skills.farm(a, tok); break;
          case 'plan': r = require('./recipes').plan(this.bot, a.item, a.count); break;
          case 'craftable': r = require('./recipes').craftable(this.bot); break;
          case 'findSpot': { const sp = this.skills.freeSpots(5); r = sp.length ? 'места без построек: ' + sp.map((s) => `${s.x} ${s.y} ${s.z} (${Math.round(s.d)} бл. на ${s.dir})`).join('; ') : 'на карте пока нет мест без построек - !wander, чтобы разведать'; break; }
          case 'goFree': { const s = await this.skills.goToFreeSpot(tok); r = `пришёл на свободное место ${s.x} ${s.z}`; break; }
          case 'lesson': r = this.memory ? this.memory.lesson(a.text, this.opts.name) : 'памяти нет'; break;
          case 'equip': r = await this.equipItem(a); break;
          case 'eat': r = await this.eatItem(a); break;
          case 'cmd': r = await this.serverCommand(a); break;
          case 'attack': r = await this.attackMob(a, tok); break;
          case 'sleep': r = await this.goSleep(tok); break;
          case 'hold': this.cancel(); this.mode = 'hold'; return done.concat('стою на месте и жду').join('; ');
          case 'combat': { const m = { defend: 'defend', flee: 'flee', off: 'off', защищать: 'defend', убегать: 'flee', нет: 'off' }[String(a.mode || '').toLowerCase()]; if (!m || !this.guard) throw new Error('режим боя: defend, flee или off'); this.guard.mode = m; this.opts.combat = m; if (this.onCombat) this.onCombat(m); r = 'режим боя: ' + { defend: 'защищаю', flee: 'убегаю к хозяину', off: 'мобов не трогаю' }[m]; break; }
          case 'signs': r = this.readSigns(); break;
          case 'use': r = await require('./objects').use(this, a, tok); break;
          case 'stash': r = await this.stash(a, tok); break;
          case 'followDist': { const cur = +this.opts.followDist || 3; r = 'держусь в ' + this.setFollowDist(a.d === 'closer' ? cur - 1 : a.d === 'farther' ? cur + 2 : a.d) + ' бл.'; if (this.onFollowDist) this.onFollowDist(this.opts.followDist); break; }
          case 'mount': {
            // дальше в списке «плыть к x z» - свою лодку ставить на воду в ту сторону (стенд 23.11: поставил в море за
            // спиной и упёрся в берег)
            const nx = plain.slice(plain.indexOf(a) + 1).find((q) => q && (q.act === 'drive' || q.act === 'goto') && q.x !== undefined);
            this._boatToward = nx ? { x: +nx.x, z: +nx.z } : null;
            try { r = await this.mount(a, tok); } finally { this._boatToward = null; }
            break;
          }
          case 'dismount': r = await this.dismount(); break;
          case 'quiet': this.opts.quiet = a.on !== false; if (this.onQuiet) this.onQuiet(this.opts.quiet); r = this.opts.quiet ? 'тихий режим: в чат не пишу' : 'снова могу говорить в чат'; break;
          case 'sit': { let ok = this.sitNear ? await this.sitNear(b0()) : false; if (!ok && !this.bot.vehicle) { this.bot.chat('/sit'); await new Promise((res) => setTimeout(res, 800)); ok = !!this.bot.vehicle; if (ok) this.seat = { since: Date.now(), at: b0().clone() }; } if (!ok) throw new Error('сесть негде: рядом нет свободной нижней ступеньки, полублока или подушки, /sit не сработал'); r = 'села'; break; }
          case 'drive': r = await this.drive(a, tok); break;
          case 'discardAll': r = await this.discardAll(a); break;
          case 'duel': r = await this.duel(a, tok); break;
          case 'craft': r = await this.skills.craft(a, tok); break;
          case 'place': r = await this.skills.place(a, tok); break;
          case 'break': r = await this.skills.breakAt(a, tok); break;
          case 'mine': r = await this.skills.mineOre(a, tok); break;
          case 'surface': r = await this.skills.surface(a, tok); break;
          case 'fish': r = await this.skills.fish(a, tok); break;
          case 'smelt': r = await this.skills.smelt(a, tok); break;
          case 'hunt': r = await this.skills.hunt(a, tok); break;
          case 'shear': r = await this.skills.shear(a, tok); break;
          case 'breed': r = await this.breed(a, tok); break;
          case 'takeBoat': r = await this.takeBoat(a, tok); break;
          case 'bonemeal': r = await this.bonemeal(a, tok); break;
          case 'cocoa': r = await this.cocoa(a, tok); break;
          case 'toss': r = await this.skills.toss(a, tok); break;
          case 'build': r = await this.skills.build(a, tok); break;
          case 'look': r = 'посмотрел'; break;
          case 'follow': done.push(this.follow(a.who)); return done.join('; ');
          case 'stop': this.cancel(); return done.concat('остановился').join('; ');
          default: r = `не знаю действие ${a.act}`;
        }
        // проверка итога: что реально изменилось в инвентаре (мозг видит правду, а не «вроде положила»)
        if (/^(take|put|toss|stash|discardAll|craft|smelt|gather|mine|harvest|pickup|give|hunt|shear|fish|eat|recover|trade)$/.test(a.act)) {
          const after = this.invCounts(), diff = [];
          for (const k of new Set([...Object.keys(inv0), ...Object.keys(after)])) { const d = (after[k] || 0) - (inv0[k] || 0); if (d) diff.push(`${d > 0 ? '+' : ''}${d} ${k}`); }
          if (diff.length) r += ` [инвентарь: ${diff.slice(0, 6).join(', ')}]`;
          else if (/^(take|put|craft|gather|mine|give|stash|trade)$/.test(a.act)) r += ' [инвентарь не изменился - похоже, на деле не вышло]';
          inv0 = after;
        }
        done.push(r);
        this.log(r);
        this.ev('итог_действия', { act: a.act, ok: true, r: String(r).slice(0, 200), source });
      }
      return done.join('; ') + '; задание выполнено';
    } catch (e) {
      if (e instanceof Cancelled) { this.ev('отмена', { label, source }); if (tok === this.replacedTok) return ''; return done.concat('задание отменено').join('; '); }
      this.ev('итог_действия', { ok: false, err: String(e.message).slice(0, 200), label, source });
      return done.concat('не получилось: ' + e.message).join('; ');
    } finally {
      if (tok === this.token) { this.mode = 'idle'; this.task = ''; this.taskOwner = null; this.runActs = null; try { this.bot.pathfinder.setGoal(null); } catch {} if (resume) this.follow(resume); }
    }
  }
}

// методы из отдельных модулей (разбивка bot.js): транспорт, дом
for (const M of [require('./scene').Scene, require('./vehicles').Vehicles, require('./house').House, require('./perception').Perception, require('./water').Water, require('./containers').Containers, require('./errand').Errands, require('./atlas').Atlas, require('./trade').Trade, require('./hearing').Hearing, require('./senses').Senses, require('./marks').Marks, require('./health').Health, require('./portals').Portals, require('./steer').Steer, require('./obtain').Obtain, require('./companion').Companion, require('./gestures').Gestures, require('./presence').Presence, require('./lifeview').LifeView, require('./placesense').PlaceSense, require('./mood').Mood, require('./zones').Zones, require('./chores').Chores, require('./stroll').Stroll, require('./loadout').Loadout, require('./features').Features, require('./navgraph').NavGraph, require('./survey').Survey, require('./mechanics').Mechanics]) {
  for (const k of Object.getOwnPropertyNames(M.prototype)) if (k !== 'constructor') Object.defineProperty(TotemBot.prototype, k, Object.getOwnPropertyDescriptor(M.prototype, k));
}

module.exports = { TotemBot, clickActionPacket, Cancelled };
