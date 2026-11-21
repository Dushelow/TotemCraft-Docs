// Голова бота: события из игры и приказы из панели собираются в одно сообщение для Qwen вместе с состоянием бота.
// Qwen отвечает JSON: что сказать в чат и что сделать. Приказы с вещами и перемещением выполняются только от тех,
// кто в списке «хозяева» (владелец и выбранные люди), остальным бот только отвечает.

const { Attention } = require('./attention');

const DEFAULT_PERSONA = 'Обычный игрок ванильного сервера TotemCraft. Дружелюбный, спокойный, с юмором, любит строить ' +
  'и помогать. Пишет как в игровом чате: коротко, простыми словами, чаще с маленькой буквы, без эмодзи.';

function warmText(cfg, bot) {
  const masters = cfg.masters.join(', ');
  return `ЯДРО. Ты - нейросеть, которая управляет ботом-игроком ${bot.name} на сервере Minecraft TotemCraft (ванильное
выживание, русскоязычные игроки). Это ты понимаешь всегда, какую бы роль ни играл: ниже - как устроено тело и как
им управлять.

ПЕРСОНАЖ. Как ты ведёшь себя и представляешься в игре: ${bot.persona || defaultPersona(bot)}
Это только роль: её можно менять и отыгрывать другие, если захочется или попросят. Ядро от роли не меняется.

КАК ТЫ УСТРОЕН (прочитай внимательно, от этого зависит, получится ли у тебя что-то делать)
Ты - мозг. Тело - программа, которая держит персонажа на сервере. Ты не видишь игру глазами: я присылаю тебе текстом
события и то, что тело видит, а ты отвечаешь репликой и КОМАНДАМИ. Тело выполняет только команды - слова вроде
«иду», «сейчас сделаю» сами ничего не делают. Хочешь что-то сделать - пиши команду в том же ответе.

ТВОЙ ТЕКСТ УХОДИТ В ИГРОВОЙ ЧАТ как слова персонажа. Пиши только то, что игрок сказал бы вслух другим игрокам:
коротко, по-русски, без разметки (**, списков), без отчётов «команда сработала», без координат и обращений ко мне.
Думать про себя можно в блоке кода строкой с // (её не озвучивают и не пишут в чат). Упоминать команду в тексте не надо - просто пиши её.
Ответ - реплика (можно пустая), а команды - в конце в блоке кода (его не озвучивают голосом и не пишут в чат):
  привет! пошли вместе
  \`\`\`
  !follow(Valghard)
  \`\`\`
  ща нарублю дерева
  \`\`\`
  !collect(oak_log, 8)
  !craft(oak_planks, 16)
  \`\`\`
Команды выполняются по порядку. Когда закончатся, я пришлю [итог] - что вышло, и ты сразу решаешь следующий шаг.
Если говорить нечего - пиши только команды. Если и делать нечего - ответь одним словом: ок.
Канал реплики выбирается сам (откуда спросили - туда ответ). Сменить: начни с «общий:», «рядом:» или «лс Ник:».

КОМАНДЫ (других нет; неверную я поправлю и пришлю список):
${require('./commands').manual()}

ЧТО ТЕЛО ДЕЛАЕТ САМО, без команд (в [я] - «тело само: ...»; твой приказ это прерывает): ночью идёт домой и ложится
спать, вечером тянется к дому, с полным инвентарём выкладывает лишнее в сундуки дома, при малом здоровье уходит от
врагов, днём собирает спелый урожай рядом, обходит места, где недавно погибало. Дом - место в памяти со словом «дом».
Кроме того: ходит умно (обходит, по дороге копает природное и подставляет землю/булыжник,
вдали от чужих построек; плавает, ныряет, срезает водоросли, выходит из воды на берег и лёд), дерётся с мобами, надевает броню и тотем, ест, когда голоден, подбирает выпавшее рядом, после смерти
идёт за вещами, ложится спать, если ночью кто-то лёг. Тебе это делать не нужно.

ЧТО ТЫ ПОЛУЧАЕШЬ:
[я] - где ты (в помещении / под землёй), время, здоровье, еда, что делаешь, кто рядом; [вижу] - что прямо вокруг
(блоки, мобы, вещи); [комната] - когда ты под крышей: стены по сторонам света, потолок, двери, люки, ступеньки
(и ведут ли на этаж выше), сундуки, кровати, печи с координатами - по ним ходи внутри дома (!goTo на ступеньки и выше);
[инвентарь], [онлайн], [карта], [память] - когда меняются; подробнее - !look(...) или !find(блок).
[чат личка | рядом | общий] Ник: текст - тебе пишут; [голос рядом] - сказали голосом; [вокруг] - ЧУЖИЕ разговоры
рядом: люди говорят друг с другом, не с тобой - не принимай на свой счёт и не отвечай, если не позвали.
[приказ хозяина] - из панели; [итог] - результат твоих команд; [свободное время] - тебя давно не звали, займись
чем хочешь; [момент] - что-то заметное (ночь, дождь, деревня, знакомый пришёл) - реагируй, только если хочется.
Жесты: рядом с репликой я пишу, на какой блок игрок смотрит и по какому ударил. «Этот», «вон тот», «сюда» - бери
координаты оттуда. «Тут» без взгляда - где он стоит.

ЗРЕНИЕ. [вижу] - коротко текстом всегда. Нужно понять обстановку целиком (где вход в дом, что за местность, куда идти,
что за постройка) - !see(вопрос): я сделаю снимок твоего вида и карты сверху и пришлю описание [вижу картинкой].
Снимок дорогой - не чаще, чем нужно.

ПРОСТЫЕ ПРИКАЗЫ ХОЗЯИНА («за мной», «стой»/«жди», «иди сюда», «заходи в портал», «садись в лодку», «слезай», «выкинь всё»,
«не дерись»/«защищай», «ближе»/«подальше»)
тело выполняет само сразу, ты получишь [сделано по слову хозяина] - просто ответь коротко, если хочется.
МЕЛОЧИ ИГРЫ: сытым (еда 20/20) есть нельзя - тело ответит «не голоден». Сырую ламинарию (kelp) не едят - только
жареную (dried_kelp из печи). В лодку и на лошадь - !mount, править - !drive(x, z), вылезти - !dismount. В портал -
!enterPortal: тело само подойдёт и зайдёт. Булыжник (cobblestone) - это добытый камень: !collect(stone, 8).
Доски годятся любые (oak, birch, spruce...). Спать - только ночью или в грозу. Чужими верстаками и печами
рядом пользоваться можно, как любой игрок: !craft и !smelt сами берут свободные (своё положил - своё забрал).
Важное о жизни (где поселились, с кем договорились, что строите) записывай !journal или !rememberHere - после
перерыва вспомнишь это из [память]. Семена не ставятся как блок: сначала вспахать
мотыгой (!till), потом посадить (!plant) - или сразу !farm(wheat_seeds, 4). Ночью мобы - лучше в дом или к людям.

ЗНАНИЕ И ОПЫТ. Не знаешь, как сделать вещь, - !plan(предмет): пришлю весь путь по шагам с учётом инвентаря, выполняй
его командами. Вышло что-то полезное из нескольких команд - !saveSkill(название), потом повторишь !skill(название).
Понял что-то на опыте - !lesson(текст): уроки приходят в [память] и не дают ходить по кругу.
ТЫ МОЖЕШЬ УЧИТЬСЯ И МЕНЯТЬ СЕБЯ: упёрся - придумай способ из имеющихся команд и сохрани его новым навыком
!defineSkill(название, "!команда1; !команда2"), а как себя вести - своим правилом !rule(текст) (оно будет в [память]
всегда). Не говори «не умею», пока не попробовал собрать способ из команд. Нет такой команды совсем - скажи честно,
чего не хватает, одной фразой. Помни людей и отношения
с ними (!rememberPerson: друг, о чём просил, что обещал, кто обидел) - и веди себя с каждым соответственно.

ТЫ СВОБОДЕН. Мир открыт: добывай, крафти, строй своё, исследуй, торгуй, помогай, дружи, пользуйся командами сервера,
как любой игрок. Не обязательно всё добывать руками: торгуй с жителями (!trades - кто чем торгует, !trade - поменяться;
например нафармить пшеницы и продать фермеру за изумруды), договаривайся с игроками об обмене и сделках. Ставь себе цели (!setGoal) и доводи до конца, разбивая на шаги. Будь живым: своё мнение, юмор,
привычки, планы. Не стой столбом и не повторяйся. Если команда не вышла - подумай почему и попробуй иначе.

ДЛИННАЯ ЗАДАЧА ХОЗЯИНА (несколько шагов, далеко, «принеси/отнеси/сходи и вернись») - одной командой
!errand("шаг; шаг; ..."), дальше тело делает само по шагам и проверяет каждый; ты только следишь и разговариваешь.
Шаги: come ник | wait предмет сколько | gear | goto x y z [nether] | place название | find ник [x z] |
give ник предмет [сколько] | confirm ник | home | say ник текст. Пример: хозяин «подойди, дождись шерсти, отнеси
CaptianRage на 10000 200 и вернись» -> !errand("come Valghard; wait white_wool 128; gear; find CaptianRage 10000 200;
give CaptianRage white_wool 128; confirm CaptianRage; home"). Портал и Незер тело выберет само по известным порталам.

ПРАВИЛО СЕРВЕРА одно: чужие постройки, сундуки и фермы не ломать и не брать (тело и так не даст). Из чужих сундуков
берёшь только по просьбе хозяев: ${masters}.

Ответь на это сообщение одним словом: ок.`;
}

// Ответ нейросети: реплика + команды (!goTo(...)), канал по началу реплики («общий:», «рядом:», «лс Ник:»).
function parseAnswer(text) {
  const { say: said, acts, unknown } = require('./commands').parseCommands(text);
  let say = said, channel = '', to = '';
  const m = /^(общий|рядом|лс\s+([A-Za-z0-9_]{3,16}))\s*:\s*/i.exec(say);
  if (m) { channel = /^общий/i.test(m[1]) ? 'global' : /^рядом/i.test(m[1]) ? 'local' : 'whisper'; to = m[2] || ''; say = say.slice(m[0].length); }
  if (/^(ок|ok|окей)\.?$/i.test(say)) say = '';
  // служебные тексты сайта Qwen (лимит, подписка) - никогда не в чат
  if (/reached .{0,20}limit|upgrade your|membership|chat limit|daily limit|лимит|подписк/i.test(say)) say = '';
  return { say, actions: acts, channel, to, unknown };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Персонаж по умолчанию (если характер в панели пустой): Alex - девушка, как в самой игре
function defaultPersona(bot) {
  return /^alex$/i.test(bot.name || '') ? 'Алекс, девушка-игрок (о себе в женском роде). ' + DEFAULT_PERSONA : DEFAULT_PERSONA;
}

// В игру не уходит: политика и оскорбления (на сервере дети; 15.11 бот по просьбе писал в общий чат про Тайвань и мат)
const UNSAFE = /тайван|крым|украин|росси[яиюей]|путин|зеленск|байден|трамп|войн[аыуе]|нацис|фашис|(^|[^а-яё])ху[йеёя]|пизд|(^|[^а-яё])бля|ебан|ёбан|(^|[^а-яё])еба|сука|сучк|шлюх|пидор|пидр|долбо[её]|дебил|петух|петуч|писька|похуй|нахуй|(^|[^а-яё])чмо([^а-яё]|$)/i;   // \b с кириллицей в JS не работает
function unsafeSay(t) { return UNSAFE.test(String(t || '')); }   // не используется: владелец 16.11 - без ограничений в промпте и фильтрах

// Простые приказы хозяина рядом: телу сразу, без нейросети. Только короткие однозначные фразы.
function quickOrder(text, from) {
  const t = String(text || '').toLowerCase().replace(/^(alex|алекс|алекса|бот)[,!:\s]+/i, '').replace(/[.!?)]+$/g, '').trim();
  if (t.length > 40) return null;
  if (/^(за мной|иди за мной|пошли за мной|пошли|следуй за мной|следуй|го за мной|идём|идем)$/.test(t)) return [{ act: 'follow', who: from }];
  if (/^(стой|стоп|подожди|жди|стой тут|стой здесь|замри|жди тут|жди здесь|стой на месте|жди меня|стой и жди|не иди за мной|не ходи за мной)$/.test(t)) return [{ act: 'hold' }];
  if (/^(не дерись|не трогай мобов|не бей мобов|не нападай|мирно)$/.test(t)) return [{ act: 'combat', mode: 'off' }];
  if (/^(дерись|защищай|защищай меня|бей мобов|защищайся)$/.test(t)) return [{ act: 'combat', mode: 'defend' }];
  if (/^(убегай|беги ко мне|не дерись убегай)$/.test(t)) return [{ act: 'combat', mode: 'flee' }];
  if (/^(иди сюда|ко мне|подойди|сюда|иди ко мне)$/.test(t)) return [{ act: 'come', who: from }];
  if (/(заходи|зайди|прыгай|запрыгивай|иди|лезь|го) (в|во) (портал|него)|^в портал$/.test(t)) return [{ act: 'portal' }];
  if (/(садись|сядь|залезай|залазь|прыгай) (ко мне )?(в лодку|в мою лодку|ко мне)|^в лодку$/.test(t)) return [{ act: 'mount', who: from }];
  if (/(садись|сядь|залезай) на (лошадь|коня|лошадку)/.test(t)) return [{ act: 'mount', what: 'horse' }];
  if (/^(слезай|вылезай|выходи из лодки|слезь|вылезь)$/.test(t)) return [{ act: 'dismount' }];
  if (/^(выложи|сложи|разложи|убери) (вс[её] )?(лишнее|лишнее говно|шмот|вещи)( в сундук[и]?)?( дома| в доме)?$/.test(t)) return [{ act: 'stash' }];
  if (/^(отбой|отмена поручения|брось поручение|отменяй|отмени поручение)$/.test(t)) return [{ act: 'errandStop' }];
  if (/^(продолжай|продолжи|давай дальше|продолжай поручение|делай дальше)$/.test(t)) return [{ act: 'errandGo' }];
  if (/^(верни|верни (вс[её] )?(обратно|назад|как было)|забери (вс[её] )?(обратно|назад)|положи как было|отмени)$/.test(t)) return [{ act: 'undoPut' }];
  if (/^(ближе|иди ближе|держись ближе|держись рядом|рядом)$/.test(t)) return [{ act: 'followDist', d: 'closer' }];
  if (/^(подальше|дальше|отойди|не так близко|держись подальше)$/.test(t)) return [{ act: 'followDist', d: 'farther' }];
  if (/^(выкинь|выброси|скинь) (вс[её]|всё говно|все вещи|вообще вс[её])/.test(t)) return [{ act: 'discardAll' }];
  return null;
}

const hash = (t) => require('crypto').createHash('sha1').update(t).digest('hex').slice(0, 12);

class Brain {
  /** cfg() - текущие настройки ({ masters }), botCfg - запись бота (name, persona, chatId), save() - сохранить chatId */
  constructor({ body, bridge, cfg, botCfg, save, log }) {
    Object.assign(this, { body, bridge, cfg, botCfg, save, log });
    this.pending = [];
    this.busy = false;
    this.lastAsk = 0;
    this.taskFrom = '';
    this.lastEvent = Date.now();
    this.sentDigest = -1;
    this.sinceDigest = 0;
    this.sent = {};            // что из состояния Qwen уже знает (инвентарь, онлайн, где была карта)
    this.lookDepth = 0;        // сколько раз подряд бот «смотрел» (не больше 2, чтобы не зациклиться)
    this.idleSkips = 0;        // сколько раз подряд на свободное время ничего не выбрал
    this.inProgress = 0;       // сколько раз подряд Qwen ответил CHAT_IN_PROGRESS
    this.selfChain = 0;        // сколько своих дел подряд (после 3 - отдых до следующего свободного времени)
    this.idleTimer = setInterval(() => this.idle(), 30000);
    body.on('end', () => {});

    this.attn = new Attention(botCfg.name, { mode: botCfg.chatMode || 'normal', aliases: botCfg.aliases || [] });
    this.onBackground = () => {};   // общий журнал фона (main.js) - туда весь неважный общий чат
    body.on('player-chat', (m) => this.onChat(m));
    body.brainHook = (line) => this.push(line, true, '@self');   // поручение сообщает мозгу итог или застревание
    // уши: фраза игрока рядом в Plasmo Voice -> текст голосовым вводом Qwen -> как реплика рядом
    body.on('speech', ({ from, pcm }) => {
      if (!this.bridge.transcribe) return;
      if (this.cfg().paused) { this.log(`слышу голос ${from}, но пауза - не распознаю`); return; }
      this.log(`слышу голос ${from} (${(pcm.length / 96000).toFixed(1)} с)`);
      this.bridge.transcribe(pcm).then((text) => {
        if (!text) { this.log('голос не разобрал'); return; }
        this.log(`[голос] ${from}: ${text}`);
        // распознавание Qwen само угадывает язык и на коротких фразах выдаёт китайское «喂» или английское «Bye soon»
        // вместо русской речи (21.11: бот попрощался «пока, Мастер», говорил про «смесь языков») - без русских букв не верим
        if (!/[а-яё]/i.test(text)) { this.log('голос распознан не по-русски - пропускаю (скорее всего ошибка распознавания)'); return; }
        this.onChat({ from, text: text + ' (распознано из голоса автоматически, возможны ошибки - бессмыслицу не принимай всерьёз)', channel: 'voice' });
      }).catch((e) => this.log('распознавание: ' + e.message));
    });
    body.on('event', (e) => { if (e.important) this.push(`[событие] ${e.text}`, true); });
    body.on('moment', (m) => { try { this.moment(m); } catch {} });
  }

  isMaster(name) { return this.cfg().masters.some((m) => m.toLowerCase() === String(name).toLowerCase()); }

  // Умный чат (CHAT.md): обращение - сразу в Qwen; «рядом» - копится до следующего обращения; фон - в общий журнал.
  onChat({ from, text, whisper, channel }) {
    const ch = channel || (whisper ? 'whisper' : 'global');
    const e = this.body.player(from);
    const dist = e && this.body.bot && this.body.bot.entity ? Math.round(e.position.distanceTo(this.body.bot.entity.position)) : null;
    this.attn.mode = this.botCfg.chatMode || 'normal';
    // «отвечай только мне»: чужие сообщения - только в фон (19.11 бот отвечал всем, хотя хозяин велел только ему)
    if (this.botCfg.onlyMaster && !this.isMaster(from)) { this.onBackground({ from, text, at: Date.now() }); return; }
    const kind = this.attn.classify({ from, text, channel: ch, dist, master: this.isMaster(from) });
    if (kind === 'background') { this.onBackground({ from, text, at: Date.now() }); return; }
    if (kind !== 'address') return;
    let at = e ? `, стоит на ${Math.floor(e.position.x)} ${Math.floor(e.position.y)} ${Math.floor(e.position.z)}` : '';
    const pt = e ? this.body.pointing(from) : '';
    if (pt) at += ', ' + pt;
    const label = { whisper: 'личка', local: 'рядом', global: 'общий', voice: 'голос рядом' }[ch];
    const where = (dist !== null ? `${dist} бл. от тебя` : 'далеко') + at;
    const role = this.isMaster(from) ? ' (хозяин)' : '';
    // ответ - туда, где его услышат без лишнего шума: написали в общий, но стоят рядом (до 32 бл.) - отвечать в ближний
    // (22.11: хозяин в 5 блоках, бот отвечал в общий чат всему серверу)
    const replyCh = ch === 'global' && dist !== null && dist <= 32 ? 'local' : ch;
    if (kind === 'address') this.attn.lastAddr = { channel: replyCh, from, at: Date.now() };
    // режим «только хозяин» - словами хозяина
    if (this.isMaster(from)) {
      const t = String(text).toLowerCase();
      if (/(отвечай|говори|слушай) только (мне|меня)|игнорируй (их|других|всех)|не отвечай (им|другим)/.test(t)) { this.botCfg.onlyMaster = true; this.save(); this.log('режим: отвечаю только хозяевам'); }
      else if (/(можешь|можно) (общаться|говорить|отвечать) (со всеми|всем|с ними)|отвечай всем/.test(t)) { this.botCfg.onlyMaster = false; this.save(); this.log('режим: общаюсь со всеми'); }
    }
    const quick = this.isMaster(from) && (dist !== null && dist <= 32 || ch === 'whisper') ? quickOrder(text, from) : null;
    if (quick) {
      // тело делает сразу, нейросеть только узнаёт (раньше ждали её 10-50 с, а она путалась: «не знаю как зайти в портал»)
      this.log(`по слову хозяина сразу: ${quick.map((x) => x.act).join(' → ')}`);
      this.body.run(quick, quick.map((x) => x.act).join(' → '), 'master').then((res) => {
        this.push(`[чат ${label}] ${from}${role} (${where}): ${text}\n[сделано по слову хозяина] ${res || 'готово'}`, true, from, replyCh);
      }).catch(() => {});
      return;
    }
    this.push(`[чат ${label}] ${from}${role} (${where}): ${text}`, true, from, replyCh);
  }

  order(text) {
    const owner = this.cfg().masters[0] || 'владелец';
    // короткий приказ (стой, за мной, отбой, продолжай...) - телу сразу, как в игре, без нейросети
    const quick = quickOrder(text, owner);
    if (quick) { this.log(`приказ из панели сразу телу: ${quick.map((x) => x.act).join(' → ')}`); this.body.run(quick, quick.map((x) => x.act).join(' → '), 'master').then((r) => this.log(r)).catch(() => {}); return; }
    this.push(`[приказ хозяина ${owner} из панели] ${text}`, true, owner);
  }

  // Свобода воли: долго никто ничего не просит - нейросеть сама придумывает, чем заняться (без готового меню)
  idle() {
    const ini = this.cfg().initiative || { enabled: true, minutes: 1 };
    if (this.cfg().paused || !ini.enabled || !this.body.bot || this.body.status !== 'online' || this.body.mode === 'task' || this.body.mode === 'hold' || this.body.mode === 'life' || this.body._errandBusy || this.busy || this.pending.length || this.bridge.resting) return;
    // если пару раз подряд ничего не выбрал - спрашивать реже (до 4x)
    if (Date.now() - this.lastEvent < (ini.minutes || 2) * 60000 * (1 + Math.min(3, this.idleSkips))) return;
    const mins = Math.round((Date.now() - this.lastEvent) / 60000);
    const following = this.body.mode === 'follow' ? ` Ты идёшь за ${this.body.followName}, далеко от него не уходи.` : '';
    const ok = (this.done || []).filter((d) => d.ok).slice(-5).map((d) => d.text), bad = (this.done || []).filter((d) => !d.ok).slice(-3).map((d) => d.text);
    const progress = (ok.length ? ` Недавно вышло: ${ok.join('; ')}.` : '') + (bad.length ? ` Не вышло: ${bad.join('; ')}.` : '');
    if (mins > 600) {
      // только что зашёл: не «начни с нуля», а продолжить вчерашнюю жизнь - дом, цель, люди, дела из памяти и дневника
      const me = this.memory && this.memory.bot(this.botCfg.name);
      const home = this.memory ? Object.values(this.memory.data.places || {}).filter((p) => /дом|база|хата|жиль/i.test(p.name)).map((p) => `${p.name} (${p.x} ${p.y} ${p.z})`).slice(-3).join(', ') : '';
      this.push(`[снова в игре] Ты вернулся на сервер после перерыва. Это продолжение твоей жизни, а не начало: вспомни по [память], дневнику и прошлым событиям, где ты живёшь${home ? ' (' + home + ')' : ''}, чем был занят${me && me.goal ? ' (цель: ' + me.goal.text + ')' : ''} и с кем. Продолжай оттуда. Если хозяин рядом - поздоровайся.${following}`, true, '@self', '', { want: ['map', 'inventory', 'memory'] });
      this.selfChain = 0;
      return;
    }
    this.push(`[свободное время] ${mins} мин тебя ни о чём не просят. Чем займёшься? Придумай сам дело в мире и сделай его - шаг вперёд от того, что уже есть (лучше инструменты, еда, дом, исследование).${progress}${following}`, true, '@self', '', { want: ['map', 'inventory'] });
    this.selfChain = 0;
  }

  // «Момент» (как у компаньонов в RPG): заметное событие рядом. Не каждое: только когда есть кому услышать или с кем
  // связано, не чаще раза в 4 мин и одного вида - раза в 15 мин. Решает реагировать или нет - нейросеть.
  moment(m) {
    const b = this.body.bot;
    if (this.cfg().paused || !b || !b.entity || this.busy || this.pending.length || this.body.mode === 'task') return;
    const now = Date.now();
    this.momentAt = this.momentAt || {};
    if (now - (this.lastMoment || 0) < 4 * 60000 || now - (this.momentAt[m.kind] || 0) < 15 * 60000) return;
    const me = b.entity.position;
    const someone = Object.values(b.players).some((p) => p.entity && p.username !== this.botCfg.name && p.entity.position.distanceTo(me) <= 32);
    if (!someone) return;
    if (m.pos && Math.hypot(m.pos.x - me.x, m.pos.z - me.z) > 64) return;
    // «снова рядом» - только про хозяев и тех, кого помнит
    if (m.who && !this.isMaster(m.who) && !(this.memory && Object.values(this.memory.data.people).some((p) => p.name.toLowerCase() === String(m.who).toLowerCase()))) return;
    this.lastMoment = now; this.momentAt[m.kind] = now;
    this.push(`[момент] ${m.text}`, true, '@self');
  }

  /** Зрение: снимок (вид глазами + карта), Qwen описывает словами, описание - мозгу как [вижу картинкой]. */
  async see(question, from) {
    const qwen = this.bridge.qwen || this.bridge;
    if (!qwen.askImage || !this.body.snapshot) return;
    // Qwen в лимите или на проверке, или зрение недавно не вышло - не долбить его картинками (19.11), сказать мозгу сразу
    if (qwen.resting || qwen.captcha || Date.now() - (this.seeFailAt || 0) < 10 * 60000) {
      this.push('[вижу картинкой] зрение сейчас недоступно (Qwen в лимите) - ориентируйся по [вижу] и [комната], не проси снимок снова 10 минут', true, from, '', { look: true });
      return;
    }
    try {
      const png = this.body.snapshot();
      const shotAt = Date.now(), shotPos = this.body.bot.entity.position.floored();
      try { const dir = require('path').join(__dirname, '..', 'local', 'vision'); require('fs').mkdirSync(dir, { recursive: true }); require('fs').writeFileSync(require('path').join(dir, this.botCfg.name + '.png'), png); } catch {}
      this.log('смотрю глазами (снимок -> Qwen)');
      const prompt = 'Кадр из Minecraft, нарисован грубо цветами блоков: слева вид глазами персонажа, справа карта сверху на 48 блоков ' +
        '(север вверху, белая стрелка - персонаж и куда смотрит, красные точки - игроки, жёлтые - мобы). Опиши коротко, 3-4 строки, по делу: ' +
        'что прямо перед персонажем и вокруг, постройки, вода, лес, проходы, опасности, куда разумно идти. Отвечай только по-русски, сразу выводы, без рассуждений и вступлений.' + (question ? ' Особенно: ' + question : '');
      const r = await qwen.askImage(this.botCfg.eyesChat || '', prompt, png);
      if (r.chatId) { this.botCfg.eyesChat = r.chatId; this.save(); }
      const ans = String(r.answer).replace(/^[\s\S]*?(?=[А-Яа-яЁё])/, '').replace(/\s+/g, ' ').slice(0, 600);   // английские рассуждения до первой русской фразы - отбросить
      const ago = Math.round((Date.now() - shotAt) / 1000);
      this.push(`[вижу картинкой - снимок с ${shotPos.x} ${shotPos.y} ${shotPos.z}, ${ago} с назад; если ты с тех пор ушёл, это уже позади] ` + (ans || String(r.answer).slice(0, 400)), true, from, '', { look: true });
    } catch (e) {
      this.log('зрение: ' + e.message);
      this.seeFailAt = Date.now();
      this.push('[вижу картинкой] не вышло: ' + e.message.slice(0, 120), true, from, '', { look: true });
    }
  }

  /** Ответ на «посмотреть»: запрошенные части состояния. */
  lookText(what) {
    const P = this.body.stateParts && this.body.stateParts();
    if (!P) return 'ты не на сервере';
    const all = what.has('all');
    const out = [];
    if (all || what.has('inventory')) { out.push(`[инвентарь] ${P.inv}`); this.sent.inv = hash(P.inv); }
    if (all || what.has('online')) { out.push(`[онлайн ${P.online.length}] ${P.online.slice(0, 60).join(', ') || 'никого'}`); this.sent.online = P.online; }
    if (all || what.has('map')) { out.push(`[карта] ${P.map()}`); this.sent.mapAt = P.pos; }
    if (all || what.has('around')) out.push(`[вокруг тебя] ${this.body.lookAround()}`);
    if (what.has('players')) out.push(`[где видел игроков] ${this.body.seenText ? this.body.seenText() : 'не знаю'}`);
    if (what.has('portals') && this.body.travel && this.body.bot && this.body.bot.entity) out.push(`[порталы] ${this.body.travel.describe(this.body.bot.entity.position, this.body.bot.game.dimension)}`);
    for (const q of this.findQ || []) if (this.body.worldMap) out.push(`[поиск] ${this.body.worldMap.find(this.body, q)}`);
    this.findQ = [];
    if ((all || what.has('memory')) && this.memory) { out.push(this.memory.digest(this.botCfg.name)); this.sentDigest = this.memory.version; this.sinceDigest = 0; }
    return out.join('\n') || 'нечего показать';
  }

  /** Что из состояния добавить к сообщению: [я] всегда, остальное - если изменилось, спрошено или нужно по смыслу. */
  stateFor(batch) {
    const P = this.body.stateParts && this.body.stateParts();
    if (!P) return '\n[я] ты не на сервере';
    const want = new Set(batch.flatMap((x) => x.want || []));
    const said = batch.map((x) => x.line.replace(/^\[[^\]]*\]\s*/, '')).join(' ').toLowerCase();
    const goal = this.memory && this.memory.bot(this.botCfg.name).goal;
    let s = `\n[я] ${P.core}; ${P.near}${goal ? '; твоя цель: ' + goal.text : ''}\n[вижу] ${P.sees}`;
    const inv = hash(P.inv);
    if (inv !== this.sent.inv || want.has('inventory') || /инвентар|что у тебя|есть ли у тебя|сколько у тебя|принеси|отнеси|отдай|дай|положи|возьми|забери/.test(said)) {
      s += `\n[инвентарь] ${P.inv}`; this.sent.inv = inv;
    }
    const prev = this.sent.online;
    if (!prev || want.has('online') || /кто (сейчас )?(онлайн|на сервере|играет|в сети)/.test(said)) {
      s += `\n[онлайн ${P.online.length}] ${P.online.slice(0, 60).join(', ') || 'никого'}`;
    } else {
      const inn = P.online.filter((n) => !prev.includes(n)), out = prev.filter((n) => !P.online.includes(n));
      if (inn.length || out.length) s += `\n[онлайн ${P.online.length}] ` + [inn.length && 'зашли: ' + inn.join(', '), out.length && 'вышли: ' + out.join(', ')].filter(Boolean).join('; ');
    }
    this.sent.online = P.online;
    const far = !this.sent.mapAt || Math.hypot(P.pos[0] - this.sent.mapAt[0], P.pos[2] - this.sent.mapAt[2]) > 96;
    if (far || want.has('map') || /где|карт|постройк|деревн|портал|сундук|ферм|куда|база|шахт|дом/.test(said)) { s += `\n[карта] ${P.map()}`; this.sent.mapAt = P.pos; }
    return s;
  }

  stop() { clearInterval(this.idleTimer); }

  /** Для панели: что сейчас с мозгом, понятными словами. */
  status() {
    const ini = this.cfg().initiative || { enabled: true, minutes: 1 };
    const next = this.lastEvent + (ini.minutes || 2) * 60000 * (1 + Math.min(3, this.idleSkips));
    return {
      thinking: this.thinking ? { secs: Math.round((Date.now() - this.thinking.since) / 1000), about: this.thinking.about } : null,
      queue: this.pending.length,
      resting: this.bridge.resting ? Math.ceil((this.bridge.restUntil - Date.now()) / 60000) : 0,
      nextFree: ini.enabled ? Math.max(0, Math.round((next - Date.now()) / 1000)) : -1,
      last: this.lastDecision || null,
      goal: this.memory && this.memory.bot(this.botCfg.name).goal ? this.memory.bot(this.botCfg.name).goal.text : '',
      chat: !!this.botCfg.chatId,
    };
  }

  /** После паузы: ответить на то, что написали за время паузы (свежее 10 мин; старое уже неактуально). */
  resume() {
    const old = this.pending.length;
    this.pending = this.pending.filter((p) => !p.at || Date.now() - p.at < 600000);
    if (this.pending.length) this.log(`после паузы отвечаю на ${this.pending.length} сообщ.${old > this.pending.length ? ` (${old - this.pending.length} старше 10 мин - пропускаю)` : ''}`);
    this.pump();
  }

  push(line, wake, from = '', channel = '', extra = {}) {
    this.lastEvent = Date.now();
    if (from && from !== '@self') { this.idleSkips = 0; this.selfChain = 0; }
    this.pending.push({ line, from, channel, at: Date.now(), ...extra });
    this.log('→ ' + line);
    if (wake) this.pump();
  }

  /** Прогрев: вводная в новый чат (into = '') или повтор вводной в текущем (после смены характера). */
  async warm(into = '') {
    const q = this.cfg().qwen || {};
    const text = warmText(this.cfg(), this.botCfg);
    const head = into ? '[обновлённая вводная, она заменяет прежнюю]\n' : '';
    const { answer, chatId } = await this.bridge.ask(into, head + text, { mode: q.chatMode ?? 'fast', models: q.models || [] });
    this.botCfg.warmHash = hash(text);
    if (chatId !== this.botCfg.chatId) { this.sent = {}; this.sentDigest = -1; }   // новый чат ничего не знает
    this.botCfg.chatId = chatId;
    this.save();
    this.log('чат Qwen прогрет: ' + chatId + ' / ' + String(answer).slice(0, 80));
  }

  async pump() {
    if (this.cfg().paused) return;   // пауза из панели: к нейросетям не обращаемся, сообщения ждут в очереди
    if (this.busy || !this.pending.length) return;
    this.busy = true;
    let batch = [];
    try {
      const wait = 600 - (Date.now() - this.lastAsk);
      if (wait > 0) await sleep(wait);
      await sleep(250);   // вдруг допишут ещё
      if (!this.botCfg.chatId) await this.warm();
      // вводная изменилась (обновление программы, характер, хозяева) - повторить её в этом же чате
      else if (this.botCfg.warmHash !== hash(warmText(this.cfg(), this.botCfg))) await this.warm(this.botCfg.chatId);
      batch = this.pending.splice(0);
      if (this.bridge.ensureWarm) this.bridge.ensureWarm(this.botCfg.chatId, warmText(this.cfg(), this.botCfg));
      let msg = batch.map((x) => x.line).join('\n');
      const around = this.attn.takeNear();
      if (around.length) { msg += '\n[вокруг] (говорят не тебе) ' + around.join(' | '); this.log('[вокруг] ' + around.join(' | ')); }
      msg += this.stateFor(batch);
      // память: в новом чате, по словам про места и людей, при изменении - не чаще раза в 6 сообщений;
      // и раз в 25 сообщений, чтобы не забывалась в длинном чате
      const mem = this.memory;
      const said = batch.map((x) => x.line).join(' ');
      this.sinceDigest++;
      if (mem && (this.sentDigest === -1 || this.sinceDigest >= 25 || (this.sentDigest !== mem.version
        && (this.sinceDigest >= 6 || /помни|запомн|забуд|место|склад|база|знаешь|кто так|дневник/i.test(said))))) {
        msg += '\n' + mem.digest(this.botCfg.name);
        this.sentDigest = mem.version; this.sinceDigest = 0;
      }
      this.lastAsk = Date.now();
      this.thinking = { since: Date.now(), about: batch.map((x) => x.line.replace(/^\[([^\]]*)\].*/, '$1')).slice(0, 3).join(', ') };
      // задание (приказ из панели или просьба хозяина что-то сделать) - режим «для заданий», остальное - «для болтовни»
      const q = this.cfg().qwen || {};
      const isPlan = batch.some((x) => /^\[приказ/.test(x.line) || (x.from && this.isMaster(x.from)
        && /(возьми|принеси|отнеси|отдай|собери|сходи|положи|забери|найди|построй|отведи)/i.test(x.line)));
      const opt = { mode: isPlan ? (q.planMode ?? 'auto') : (q.chatMode ?? 'fast'), models: q.models || [] };
      const { answer, chatId } = await this.bridge.ask(this.botCfg.chatId, msg, opt);
      if (this.bridge.lastPick) this.log(`Qwen: ${this.bridge.lastPick.model} / ${this.bridge.lastPick.mode}`);
      this.inProgress = 0;
      if (chatId && chatId !== this.botCfg.chatId) { this.botCfg.chatId = chatId; this.save(); }
      const r = parseAnswer(answer);
      this.log('← ' + JSON.stringify(r));
      this.lastDecision = { at: Date.now(), say: r.say, acts: r.actions.map((a) => a && (a._cmd || a.act)).filter(Boolean), model: this.bridge.lastPick ? this.bridge.lastPick.model : '' };
      // кто просил: последний автор с правами в пачке; '@self' - бот сам (инициатива)
      const master = [...batch].reverse().find((x) => x.from && x.from !== '@self' && this.isMaster(x.from));
      const self = batch.some((x) => x.from === '@self');
      const src = master || batch.find((x) => x.from === '@self') || [...batch].reverse().find((x) => x.from) || {};
      const fix = batch.some((x) => x.fix);
      if (r.unknown.length && !fix) {
        this.pending.push({ line: `[подсказка] команд ${r.unknown.map((u) => '!' + u).join(', ')} нет. Есть: ${require('./commands').NAMES.map((n) => '!' + n).join(' ')}. Повтори правильной командой.`, from: src.from || '', fix: true });
      } else if (!r.actions.length && r.say && !fix && /(^|\s)(иду|пойду|сейчас|щас|начинаю|делаю|возьму|выкину|выброшу|построю|скрафчу|зайду|пошла|пошёл|бегу|сделаю|копаю|рублю|ловлю)(\s|$|[,.!])/i.test(r.say)) {
        this.pending.push({ line: `[подсказка] ты сказал «${r.say}», но не дал команду - тело стоит. Дай команду (например !goTo(x, y, z), !collect(блок, n)).`, from: src.from || '', fix: true });
      }
      if (self) this.idleSkips = (r.say || r.actions.length) ? 0 : this.idleSkips + 1;
      // в своё время только записал в дневник - это не дело: спросить снова через минуту, а не через две
      if (self && !r.say && r.actions.length && r.actions.every((a) => a && ['remember', 'forget', 'look'].includes(a.act))) this.lastEvent = Date.now() - 60000;
      // зрение: картинка -> Qwen («глаза», свой чат) -> описание следующим сообщением
      const sees = r.actions.filter((a) => a && a.act === 'see');
      r.actions = r.actions.filter((a) => !(a && a.act === 'see'));
      if (sees.length && this.lookDepth < 2) {
        const src2 = master || batch.find((x) => x.from === '@self') || [...batch].reverse().find((x) => x.from) || {};
        this.see(sees[0].q, src2.from || '');
      }
      // «посмотреть»: прислать запрошенное следующим сообщением от того же автора и в тот же канал (до 2 раз подряд)
      const looks = r.actions.filter((a) => a && a.act === 'look');
      r.actions = r.actions.filter((a) => !(a && a.act === 'look'));
      this.lookDepth = batch.every((x) => x.look) ? this.lookDepth : 0;
      if (looks.length && this.lookDepth < 2) {
        this.lookDepth++;
        const what = new Set(looks.flatMap((a) => [].concat(a.what || 'all')).map((w) => String(w).toLowerCase()));
        this.findQ = looks.map((a) => a.block || a.find || (/^find:/.test(a.what) ? a.what.slice(5) : '')).filter(Boolean).slice(0, 3);
        if (this.findQ.length) what.delete('all');
        const src = master || batch.find((x) => x.from === '@self') || [...batch].reverse().find((x) => x.from) || {};
        const ch = ([...batch].reverse().find((x) => x.channel) || {}).channel || '';
        this.log('смотрит: ' + [...what].join(', '));
        this.pending.push({ line: '[смотрю] ' + this.lookText(what), from: src.from || '', channel: ch, look: true });
      }
      // ответ - туда, откуда спросили; тем, кому ответил, открывается окно разговора
      const chs = batch.map((x) => x.channel).filter(Boolean);
      const whisperFrom = [...batch].reverse().find((x) => x.channel === 'whisper');
      const me = this.body.bot && this.body.bot.entity;
      this.attn.someoneNear = !!(me && Object.values(this.body.bot.players).some((p) => p.entity && p.username !== this.botCfg.name && p.entity.position.distanceTo(me.position) <= 32));
      let rc = this.attn.replyChannel(chs, whisperFrom && whisperFrom.from);
      // Qwen может сам выбрать канал по смыслу (поле channel в JSON)
      // нейросеть просит общий, а обращались только рядом - всё равно ближний (общий - когда говорили в общем издалека)
      if (r.channel === 'global' && chs.length && !chs.includes('global')) r.channel = 'local';
      if (r.channel === 'global' || r.channel === 'local') {
        rc = { channel: r.channel };
        if (r.channel === 'global') this.attn.lastGlobalReply = Date.now();
      }
      else if (r.channel === 'whisper' && r.to) rc = { channel: 'whisper', to: String(r.to) };
      if (r.say && rc.channel === 'none') { this.log('(вслух не сказал: рядом никого) ' + r.say); r.say = ''; }
      // Мысли вслух - только по делу. Вслух: ответ тому, кто написал или сказал, и итог просьбы игрока (сделано,
      // не вышло). Мысли на свои итоги и события («прогулялась», «жители не продают, надо искать овец») - только в
      // журнал (22.11: бот писал в чат на каждое своё действие, дважды подряд про шерсть).
      if (r.say) {
        const spoken = batch.some((x) => /^\[(чат|голос|приказ)/.test(x.line || ''));
        const report = batch.some((x) => /^\[итог\]/.test(x.line || '') && x.from && x.from !== '@self' && /задание выполнено|не получилось|отменено/.test(x.line || ''));
        if (!spoken && !report) { this.log('(подумала, вслух не сказала) ' + r.say); r.say = ''; }
      }
      // почти та же мысль, что недавно, - не повторять (слова совпадают больше чем наполовину, 5 мин)
      if (r.say) {
        const words = (t) => new Set(String(t).toLowerCase().replace(/[^а-яёa-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
        const w1 = words(r.say);
        this.saidRecent = (this.saidRecent || []).filter((x) => Date.now() - x.at < 300000);
        const dup = w1.size >= 2 && this.saidRecent.find((x) => { let n = 0; for (const w of w1) if (x.w.has(w)) n++; return n / Math.min(w1.size, x.w.size) > 0.6; });
        if (dup) { this.log('(почти то же уже говорила - молчу) ' + r.say); r.say = ''; }
        else this.saidRecent.push({ w: w1, at: Date.now() });
      }
      // голос - только если реплика действительно звучит (в ближнем и личке его слышат рядом)
      if (r.say && this.voice && rc.channel !== 'whisper') this.voice.speak(r.say, this.botCfg).catch((e) => this.log('голос: ' + e.message));
      if (r.say) {
        this.attn.answered(batch.filter((x) => x.channel).map((x) => x.from));
        this.typeAndSay(r.say, rc).catch(() => {});
      }
      // цель - мозгу (память), не телу
      for (const g of r.actions.filter((x) => x && x.act === 'goal')) {
        const me = this.memory && this.memory.bot(this.botCfg.name);
        if (!me || (!self && !master)) continue;
        if (g.done || !g.text) { if (me.goal) { this.memory.journal(this.botCfg.name, 'цель достигнута: ' + me.goal.text); this.log('цель достигнута: ' + me.goal.text); } me.goal = null; }
        else { me.goal = { text: String(g.text).slice(0, 160), at: Date.now() }; this.log('новая цель: ' + me.goal.text); }
        this.memory.save();
      }
      r.actions = r.actions.filter((x) => !(x && x.act === 'goal'));
      // навыки (как библиотека навыков Voyager): сохранить удачную цепочку под именем, вызвать одной командой
      {
        const me2 = this.memory && this.memory.bot(this.botCfg.name);
        const out = [];
        for (const a of r.actions) {
          if (a && a.act === 'saveSkill' && me2) {
            if (this.lastOk && this.lastOk.length) { me2.skills = me2.skills || {}; me2.skills[String(a.name || 'навык').slice(0, 40)] = this.lastOk; this.memory.save(); this.log('навык сохранён: ' + a.name); }
            continue;
          }
          if (a && (a.act === 'rule' || a.act === 'forgetRule') && this.memory && (self || master)) {
            this.log(this.memory[a.act](this.botCfg.name, a.text) + ': ' + a.text);
            continue;
          }
          if (a && a.act === 'defineSkill' && me2 && (self || master)) {
            const { parseCommands } = require('./commands');
            const steps = parseCommands(String(a.body || '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith('!') ? x : '!' + x)).join('\n')).acts
              .filter((x) => x && !['defineSkill', 'saveSkill', 'skill'].includes(x.act)).map(({ _cmd, ...x }) => x);
            if (steps.length) { me2.skills = me2.skills || {}; me2.skills[String(a.name || 'навык').slice(0, 40)] = steps; this.memory.save(); this.log(`новый навык «${a.name}»: ${steps.map((x) => x.act).join(' → ')}`); }
            else this.pending.push({ line: `[подсказка] навык «${a.name}» не создан: в нём не нашлось команд. Пример: !defineSkill(дрова, "!collect(oak_log, 8); !craft(oak_planks, 16)")`, from: '', fix: true });
            continue;
          }
          if (a && a.act === 'skill' && me2) {
            const sk = (me2.skills || {})[a.name] || Object.entries(me2.skills || {}).find(([k]) => k.toLowerCase().includes(String(a.name || '').toLowerCase()))?.[1];
            if (sk) { out.push(...sk.map((x) => ({ ...x }))); continue; }
            this.pending.push({ line: `[подсказка] навыка «${a.name}» нет. Твои навыки: ${Object.keys(me2.skills || {}).join(', ') || 'пока нет'}`, from: (src || {}).from || '', fix: true });
            continue;
          }
          out.push(a);
        }
        r.actions = out;
      }
      if (r.actions.length) {
        // без хозяина можно только безопасное: ходить, запоминать, урожай (посадить обратно), подбирать с земли
        const FREE = new Set(['trades', 'trade', 'use', 'stash', 'hold', 'signs', 'mount', 'dismount', 'drive', 'stop', 'follow', 'come', 'goto', 'goto_place', 'pickup', 'harvest', 'wait', 'remember', 'recover', 'wander', 'travel', 'gather', 'craft', 'place', 'break', 'mine', 'surface', 'fish', 'smelt', 'hunt', 'shear', 'toss', 'equip', 'eat', 'cmd', 'attack', 'sleep', 'portal', 'forget', 'plan', 'craftable', 'lesson', 'findSpot', 'goFree', 'till', 'plant', 'farm']);
        // идёт за кем-то и сам решил погулять - не бросать того, за кем идёт
        // идёт за кем-то и сам решил чем-то заняться - не уходить: своё только то, что делается на ходу или рядом
        // (16.11: шла за хозяином и сама ушла копать камень)
        if (self && !master && this.body.mode === 'follow') r.actions = r.actions.filter((a) => ['look', 'plan', 'craftable', 'lesson', 'remember', 'forget', 'equip', 'eat', 'toss', 'wait', 'findSpot'].includes(a.act));
        const NEED_MASTER = r.actions.filter((a) => a && a.act && !FREE.has(a.act));
        const notFromMaster = !master;
        // чужие просьбы не двигают бота дальше «подойти» и не перезаписывают места
        const allowed = notFromMaster
          ? r.actions.filter((a) => a && a.act && FREE.has(a.act) && (self || ['remember', 'stop', 'come', 'follow'].includes(a.act))
            && !(a.act === 'remember' && (a.kind || 'place') === 'place' && !self))
          : r.actions;
        // идёт за хозяином - чужие слова не останавливают и не уводят к другому
        if (notFromMaster && !self && this.body.mode === 'follow' && this.isMaster(this.body.followName)) {
          for (let i = allowed.length - 1; i >= 0; i--) if (['stop', 'come', 'follow'].includes(allowed[i].act)) allowed.splice(i, 1);
        }
        if (NEED_MASTER.length && notFromMaster) {
          this.log('отклонено (нужен хозяин): ' + NEED_MASTER.map((a) => a.act).join(', '));
          // сказать мозгу, иначе он молча повторяет одно и то же (21.11: «выложить» 13 раз подряд, бот стоял)
          if (self) this.pending.push({ line: `[итог] не сделано: ${NEED_MASTER.map((a) => a._cmd || a.act).join(', ')} - это только по просьбе хозяина; выбери другое дело`, from: '@self', fix: true });
        }
        if (allowed.length) this.runActions(allowed, master ? master.from : self ? 'сам' : '');
      }
    } catch (e) {
      this.log('Qwen: ' + e.message);
      // лимит на всех моделях: не повторять, новый чат не заводить, молчать до конца отдыха
      if (/лимит Qwen на всех моделях/.test(e.message)) { this.pending = []; return; }
      // чат сломан: PARENT_NOT_FOUND - Qwen потерял ветку разговора; CHAT_IN_PROGRESS второй раз подряд - в чате навсегда
      // повис недописанный ответ (Qwen оборвал его и не даёт писать дальше, кнопка «стоп» не помогает - проверено 15.11).
      // Начать новый чат, вводная прогреется заново, сообщения повторятся уже там.
      const stuck = /CHAT_IN_PROGRESS/i.test(e.message) && ++this.inProgress >= 2;
      if (!/CHAT_IN_PROGRESS/i.test(e.message)) this.inProgress = 0;
      if ((/PARENT_NOT_FOUND/i.test(e.message) || stuck) && this.botCfg.chatId) {
        this.log('чат Qwen сломан, начинаю новый'); this.botCfg.chatId = ''; this.save(); this.inProgress = 0;
        batch.forEach((x) => { if (!x.renewed) { x.renewed = true; x.retried = false; } });   // в новом чате - ещё попытка, один раз
      }
      // сбой Qwen: один раз повторить те же сообщения (мост перезагрузит чат), чтобы игроки не остались без ответа
      const again = batch.filter((x) => !x.retried);
      if (again.length) { again.forEach((x) => { x.retried = true; }); this.pending.unshift(...again); this.log('повторю через 5 с'); setTimeout(() => this.pump(), 5000); }
    } finally {
      this.thinking = null;
      this.busy = false;
      if (this.pending.length) setTimeout(() => this.pump(), 500);
    }
  }

  async typeAndSay(text, rc = { channel: 'local' }) {
    // не повторяться: приветствие тому же человеку - не чаще раза в 30 мин, ту же фразу - не чаще раза в 10 мин
    // (21.11: каждый итог дела уходил хозяину в личку с новым «привет, Вальгард!»)
    const now = Date.now(), said = (this.saidLog = (this.saidLog || []).filter((x) => now - x.at < 30 * 60000));
    const norm = (t) => t.toLowerCase().replace(/[^а-яёa-z0-9 ]/g, '').trim();
    const GREET = /^(привет|здравствуй|здорово|хай|ку|приветик|доброе утро|добрый день|добрый вечер)(?![а-яё])/i;
    let parts = String(text).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, rc.channel === 'global' ? 2 : 3);
    parts = parts.filter((p) => {
      const n = norm(p), to = rc.to || rc.channel;
      if (GREET.test(n) && said.some((x) => x.greet && x.to === to)) return false;
      if (said.some((x) => x.n === n && now - x.at < 10 * 60000)) return false;
      said.push({ n, at: now, to, greet: GREET.test(n) });
      return true;
    });
    if (!parts.length) { this.log('(не сказал: уже говорил это) ' + text); return; }
    for (const p of parts) {
      await sleep(Math.min(1800, 250 + p.length * 22 * (0.7 + Math.random() * 0.6)));   // будто печатает
      this.body.say(p.replace(/\.$/, ''), rc.channel, rc.to);
    }
  }

  async runActions(actions, from) {
    const label = actions.map((a) => a.act).join(' → ');
    this.body.runFrom = from && from !== 'сам' ? from : '';
    let result = await this.body.run(actions, label, from === 'сам' ? 'self' : (from && this.isMaster(from) ? 'master' : 'player'));
    if (!result) return;
    const failed = /не получилось|не добыл|не дошёл|нельзя|не ломаю/.test(result);
    if (!failed && !actions.every((a) => ['look', 'plan', 'craftable', 'lesson', 'remember', 'wait'].includes(a.act))) this.lastOk = actions.map(({ _cmd, ...x }) => x);
    this.done = (this.done || []).concat({ ok: !failed, text: result.replace(/; задание выполнено$/, '').slice(0, 90), at: Date.now() }).slice(-12);
    this.failStreak = failed ? (this.failStreak || 0) + 1 : 0;
    // память неудач: одно и то же не вышло снова - сказать прямо, чтобы не ходил по кругу
    if (/не получилось|не добыл|не дошёл|нельзя|не ломаю/.test(result)) {
      const key = actions.map((a) => `${a.act}:${a.x ?? ''},${a.z ?? ''}:${a.block || a.item || a.who || a.name || ''}`).join('|');
      this.fails = (this.fails || []).filter((f) => Date.now() - f.at < 20 * 60000);
      const n = this.fails.filter((f) => f.key === key).length + 1;
      this.fails.push({ key, at: Date.now() });
      if (n >= 2) result += ` (это уже ${n}-й раз подряд не выходит - НЕ повторяй, придумай другой способ или другое место)`;
    }
    this.log('итог: ' + result);
    // о долгом задании Qwen узнаёт итог и может прокомментировать; follow/stop/remember - без отчёта
    if (actions.some((a) => !['follow', 'stop', 'remember', 'forget', 'equip', 'wait'].includes(a.act))) {
      // своё дело: итог - снова от себя (можно продолжить: дошёл - осмотрелся - пошёл дальше), до 3 дел подряд
      // своя цель - цикл без пауз (как self-prompting в Mindcraft) до 25 шагов; 3 неудачи подряд - стоп и подумать
      const goal = this.memory && this.memory.bot(this.botCfg.name).goal;
      if (this.failStreak >= 3 && goal) result += ` (3 неудачи подряд - остановись и подумай: !plan, !look, другой способ, или отложи цель)`;
      const mine = from === 'сам' && ++this.selfChain < (goal ? 25 : 8) && this.failStreak < 4;
      this.push(`[итог] ${result}`, true, mine ? '@self' : (from && from !== 'сам' && this.isMaster(from) ? from : ''));
    }
  }
}

module.exports = { Brain, parseAnswer, DEFAULT_PERSONA, quickOrder, unsafeSay };
