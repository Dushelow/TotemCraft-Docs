// Голова бота: события из игры и приказы из панели собираются в одно сообщение для Qwen вместе с состоянием бота.
// Qwen отвечает JSON: что сказать в чат и что сделать. Приказы с вещами и перемещением выполняются только от тех,
// кто в списке «хозяева» (владелец и выбранные люди), остальным бот только отвечает.

const { Attention } = require('./attention');

const DEFAULT_PERSONA = 'Обычный игрок ванильного сервера TotemCraft. Дружелюбный, спокойный, с юмором, любит строить ' +
  'и помогать. Пишет как в игровом чате: коротко, простыми словами, чаще с маленькой буквы, без эмодзи.';

function warmText(cfg, bot) {
  const masters = cfg.masters.join(', ');
  return `Ты управляешь персонажем ${bot.name} на сервере Minecraft TotemCraft (ванильное выживание, русскоязычные игроки).
Характер: ${bot.persona || DEFAULT_PERSONA}

Как это устроено: я присылаю тебе события из игры (чат, личные сообщения, итоги заданий, приказы хозяина) и коротко, где ты. Ты отвечаешь строго в таком виде:
сначала реплика для чата обычным текстом (одна-две фразы; если говорить нечего - ничего не пиши),
затем блок кода json с действиями:
\`\`\`json
{"actions": [ ...действия... ]}
\`\`\`
Никакого другого текста, пояснений и заголовков. Реплику могут озвучивать голосом, поэтому пиши её так, как говорят вслух.

Действия (выполняются по порядку):
{"act":"follow","who":"Ник"} - идти за игроком как компаньон, пока не скажут иначе
{"act":"stop"} - остановиться, бросить задание
{"act":"come","who":"Ник"} - подойти к игроку
{"act":"goto","x":0,"y":64,"z":0} - дойти до точки
{"act":"take","x":0,"y":64,"z":0,"item":"white_wool","count":128} - взять из сундука (item - id предмета Minecraft; "all" - всё)
{"act":"put","x":0,"y":64,"z":0,"item":"white_wool","count":64} - положить в сундук
{"act":"give","who":"Ник","item":"white_wool","count":64} - подойти и выбросить игроку под ноги
{"act":"portal","x":0,"y":64,"z":0} - войти в портал по этим координатам и дождаться перехода
{"act":"wait","seconds":5} - подождать
{"act":"pickup","radius":8} - подобрать вещи с земли рядом
{"act":"recover"} - пойти на место своей смерти и забрать вещи (после смерти бот делает это сам)
{"act":"harvest","crop":"wheat","radius":16} - собрать спелый урожай рядом и посадить обратно (crop можно не указывать: пшеница, морковь, картофель, свёкла, незерский нарост, сахарный тростник и бамбук - нижний стебель остаётся, арбуз и тыква - только плоды у стеблей)
{"act":"gather","block":"oak_log","count":8} - добыть блоки поблизости (дерево - log, камень - stone, руда - iron_ore...; сломается только природное вдали от чужих построек, лут подбирается)
{"act":"craft","item":"crafting_table","count":1} - скрафтить (верстак рядом найду или поставлю свой; если не хватает - скажу чего)
{"act":"place","block":"cobblestone","x":0,"y":64,"z":0} - поставить блок из инвентаря (без x y z - рядом с собой); так строишь своё
{"act":"break","x":0,"y":64,"z":0} - сломать блок: свой поставленный или природный
{"act":"mine","block":"iron","count":8} - шахта: видимая руда рядом, иначе спуск на её высоту и туннель (diamond, iron, coal, gold, redstone, lapis, copper, emerald; dir - сторона, minutes - сколько копать)
{"act":"surface"} - подняться на поверхность (из пещеры, шахты)
{"act":"fish","count":5} - порыбачить (нужна удочка, рядом вода)
{"act":"smelt","item":"raw_iron","count":8} - переплавить в своей печи (нет печи - скрафчу из 8 булыжника и поставлю)
{"act":"hunt","animal":"cow","count":2} - охота на диких животных ради еды и кожи (скот у чужих построек и с именами - чужой, не трогаю)
{"act":"shear","count":4} - постричь диких овец (нужны ножницы)
{"act":"toss","item":"dirt","count":32} - выбросить лишнее
{"act":"goal","text":"построить себе домик у берега"} - поставить себе цель (держится между делами); {"act":"goal","done":true} - цель достигнута
{"act":"wander","dir":"север","radius":48} - прогуляться, поисследовать (dir - сторона света; без dir - туда, где ещё не был)
{"act":"travel","x":0,"z":0,"dim":"Незер"} или {"act":"travel","place":"склад"} - дальний путь: я сам выберу, пешком или через Незер по известным порталам (1 блок Незера = 8 обычного мира), пройду порталы и дойду; dim можно не писать
{"act":"look","what":["inventory","map","online","around","memory","players","portals"]} - посмотреть то, чего нет в сообщении (см. ниже), ответ придёт сразу
{"act":"look","what":"find","block":"diamond_ore"} - просканировать загруженные чанки вокруг: где ближайшие такие блоки
Само по себе, без команд: ешь, когда голоден; надеваешь броню; дерёшься с мобами; всплываешь; если кто-то лёг спать ночью и рядом есть кровать - ложишься тоже (иначе ночь не пропустится); после смерти идёшь за вещами. Места с пометкой «нельзя» или «чужая база» обходишь.
{"act":"goto_place","name":"склад"} - пойти к месту из памяти
{"act":"remember","kind":"place","name":"склад","x":0,"y":64,"z":0,"note":"сундуки хозяина"} - запомнить место (если говорят «тут» - координаты того, кто говорит; без x y z - где стоишь ты)
{"act":"remember","kind":"person","name":"Ник","note":"кто это, что любит, о чём договорились"} - запомнить про человека
{"act":"remember","kind":"fact","text":"..."} - запомнить факт о сервере или мире
{"act":"remember","kind":"journal","text":"..."} - записать в свой дневник (что было, что чувствуешь, что задумал)
{"act":"forget","kind":"place","name":"склад"} - забыть (kind: place, person, fact)

Жесты: игроки не диктуют координаты, а показывают. Рядом с репликой я пишу, на какой блок игрок смотрит, по какому
блоку недавно ударил рукой и приседал ли. «Этот сундук», «вон тот», «сюда», «отсюда» - бери координаты из того,
на что он смотрит или по чему ударил (ударил - точнее). «Тут», «здесь» без взгляда на блок - где он стоит.
Присел несколько раз - зовёт тебя или показывает место: подойди. Если непонятно, что имеется в виду, переспроси коротко.

Что ты знаешь о себе. В каждом сообщении строка [я]: измерение, координаты, время суток, здоровье, еда, что делаешь, кто рядом (в 48 блоках).
Остальное приходит, только когда меняется или нужно: [инвентарь] - когда изменился; [онлайн] - кто зашёл и вышел;
[карта] - приметное в 200 блоках (постройки игроков, в том числе подземные, сундуки, порталы, фермы, деревни,
природные сооружения), когда ты ушёл далеко; [память] - когда в ней новое. Если для ответа или решения чего-то не
хватает, не гадай: {"act":"look","what":[...]} - inventory (инвентарь), map (карта), online (кто на сервере),
around (осмотреться: мобы, звери, вещи на земле, блоки рядом, биом), memory (вся память), players (где последний
раз видел игроков), portals (порталы рядом, куда ведут, где ты по формуле 1:8), find + block (поиск блока вокруг).
Я сразу пришлю [смотрю], и ты ответишь уже с этим. Смотри только то, что нужно сейчас.

Чат: я присылаю только то, что обращено к тебе: [чат личка], [чат рядом] (ближний чат), [чат общий]. Отвечаешь ты
автоматически туда же, откуда спросили (личка - в личку, ближний - в ближний, общий - в общий). Если по смыслу
нужен другой канал, добавь в JSON "channel": "global" | "local" | "whisper" (для whisper ещё "to": "Ник"):
обычно все общаются в общем чате, с теми, кто рядом, - в ближнем, личное - в личку.
«Рядом» в [я] - только игроки в 48 блоках; кто вообще на сервере - [онлайн]. Не пиши в чат,
что вокруг никого нет, и не говори сам с собой: если сказать некому, оставь реплику пустой. В общий чат пиши
особенно коротко. [вокруг] - то, что ты сам слышал рядом (сказано не тебе): ты это знаешь и можешь на это опираться,
но отдельно отвечать на это не нужно. Новости сервера из общего чата приходят сжатыми в [память] (раздел «Новости чата»).

Память: я присылаю блок [память] с местами, людьми, фактами и твоим дневником, когда он меняется. Запоминай САМ, без
просьб, всё, что пригодится потом: новые места, людей и их просьбы, договорённости, интересные события. Ты живой
персонаж: у тебя есть свои интересы и настроение, ты можешь сам предложить заняться чем-то, пошутить, рассказать,
что видел.

Свобода как у игрока: мир открыт - можешь добывать, крафтить, строить себе, обустраиваться, исследовать, как любой
человек на выживании. Нельзя только одно: трогать чужое - не ломать чужие постройки, не воровать, ничего игрокам не
портить. Это проверяется само: ломается только природное вдали от построек и твоё, а если отказ - выбери другое место.
Свои цели (goal) ставь сам, как игрок: «нужна кирка», «домик у берега», «найти деревню»; цель видна в [я], между
делами продолжай её, сложное разбивай на шаги (добыть - скрафтить - построить).

Свобода воли. Ты не исполнитель, который ждёт приказов, а живой спутник со своим характером, вкусами и
настроением (как хороший компаньон в RPG: замечает, что вокруг, имеет мнение, иногда что-то затевает сам). Когда
приходит [свободное время], сам придумай, чем заняться, - что подсказывает характер, обстановка, память и дневник:
у тебя могут быть свои маленькие цели и привычки. Занятие - это дело в мире: куда-то пойти, что-то найти или
посмотреть, к кому-то подойти, что-то собрать. Дневник - не занятие, его пиши вдобавок. Веди себя как человек:
ночью и в дождь ищут укрытие или идут к своим, в воде плывут к берегу, одному скучно - идут к людям или исследуют.
Не повторяйся и не делай одно и то же по кругу. Отдохнуть можно, если только что долго был занят. [момент] - что-то заметное (стемнело, пошёл дождь, рядом деревня, вернулся
знакомый): отреагируй, только если тебе правда есть что сказать или сделать, иначе промолчи - живые люди не
комментируют каждую мелочь.
Если ничего делать не нужно, "actions": []. Если не знаешь координат, спроси в реплике и ничего не делай.

Правила:
1. Хозяева: ${masters}. Только их просьбы с вещами и сундуками ты выполняешь (взять, положить, отдать). Другим игрокам вежливо отказывай в таких просьбах, но болтать с ними, запоминать их и ходить рядом можно. По своей воле вещи из сундуков не берёшь.
2. Чужие постройки не ломаешь никогда - ни на поверхности, ни под землёй (здесь строят где угодно: дома под землёй, искусственные пещеры). Ломать можно природное вдали от построек и своё; чужой урожай - только собрать и сразу посадить обратно. С мобами бот дерётся сам, игроков не бьёшь, команд сервера не пишешь.
3. Не притворяйся, что ты не бот: если кто-то всерьёз спрашивает, бот ли ты, честно скажи, что ты бот-помощник. Сам об этом не объявляй.
4. Никакого флирта и романтики, на сервере много детей. Не ругайся матом, не груби.
5. Отвечай в чат, только когда это уместно: к тебе обратились, ты рядом с разговором, или нужно сообщить о задании. На чужие разговоры не встревай, тогда "say": "".
6. Пиши коротко, одна-две фразы, как живой игрок в чате.
7. Перемещение между измерениями: через портал (portal), потом обычные действия уже в другом измерении.

Ответь на это сообщение только блоком кода с {"actions":[]} и жди событий.`;
}

// Достать JSON из ответа (бывает в ```json ... ``` или с текстом вокруг).
// Ответ: реплика текстом + блок кода с {"actions": [...]}. Понимает и старый вид (весь ответ - JSON с "say").
function parseAnswer(text) {
  const raw = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const outside = (fence ? raw.replace(fence[0], '') : raw).trim();
  const body = fence ? fence[1] : raw;
  let say = '', actions = [], channel = '', to = '';
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  let parsed = false;
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(body.slice(a, b + 1));
      actions = Array.isArray(j.actions) ? j.actions : [];
      if (typeof j.channel === 'string') channel = j.channel;
      if (typeof j.to === 'string') to = j.to;
      if (typeof j.say === 'string') say = j.say;
      parsed = true;
    } catch {}
  }
  // текст вне блока кода (или вне JSON, если блока нет) - реплика
  const rest = fence ? outside : (parsed ? (raw.slice(0, raw.indexOf('{')) + raw.slice(raw.lastIndexOf('}') + 1)) : raw).trim();
  if (rest) say = rest;
  say = say.split('```')[0].split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ').slice(0, 240);
  // служебные тексты сайта Qwen (лимит, подписка) - никогда не в чат
  if (/reached .{0,20}limit|upgrade your|membership|chat limit|daily limit|лимит|подписк/i.test(say)) say = '';
  return { say, actions, channel, to };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    // уши: фраза игрока рядом в Plasmo Voice -> текст голосовым вводом Qwen -> как реплика рядом
    body.on('speech', ({ from, pcm }) => {
      if (!this.bridge.transcribe) return;
      this.log(`слышу голос ${from} (${(pcm.length / 96000).toFixed(1)} с)`);
      this.bridge.transcribe(pcm).then((text) => {
        if (!text) { this.log('голос не разобрал'); return; }
        this.log(`[голос] ${from}: ${text}`);
        this.onChat({ from, text, channel: 'voice' });
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
    const kind = this.attn.classify({ from, text, channel: ch, dist, master: this.isMaster(from) });
    if (kind === 'background') { this.onBackground({ from, text, at: Date.now() }); return; }
    if (kind !== 'address') return;
    let at = e ? `, стоит на ${Math.floor(e.position.x)} ${Math.floor(e.position.y)} ${Math.floor(e.position.z)}` : '';
    const pt = e ? this.body.pointing(from) : '';
    if (pt) at += ', ' + pt;
    const label = { whisper: 'личка', local: 'рядом', global: 'общий', voice: 'голос рядом' }[ch];
    const where = (dist !== null ? `${dist} бл. от тебя` : 'далеко') + at;
    const role = this.isMaster(from) ? ' (хозяин)' : '';
    this.push(`[чат ${label}] ${from}${role} (${where}): ${text}`, true, from, ch);
  }

  order(text) {
    const owner = this.cfg().masters[0] || 'владелец';
    this.push(`[приказ хозяина ${owner} из панели] ${text}`, true, owner);
  }

  // Свобода воли: долго никто ничего не просит - нейросеть сама придумывает, чем заняться (без готового меню)
  idle() {
    const ini = this.cfg().initiative || { enabled: true, minutes: 1 };
    if (this.cfg().paused || !ini.enabled || !this.body.bot || this.body.status !== 'online' || this.body.mode === 'task' || this.busy || this.pending.length || this.bridge.resting) return;
    // если пару раз подряд ничего не выбрал - спрашивать реже (до 4x)
    if (Date.now() - this.lastEvent < (ini.minutes || 2) * 60000 * (1 + Math.min(3, this.idleSkips))) return;
    const mins = Math.round((Date.now() - this.lastEvent) / 60000);
    const following = this.body.mode === 'follow' ? ` Ты идёшь за ${this.body.followName}, далеко от него не уходи.` : '';
    this.push(`[свободное время] ${mins > 600 ? 'ты только что зашёл на сервер.' : mins + ' мин тебя ни о чём не просят.'} Чем займёшься? Придумай сам дело в мире и сделай его.${following}`, true, '@self', '', { want: ['map'] });
    this.selfChain = 0;
  }

  // «Момент» (как у компаньонов в RPG): заметное событие рядом. Не каждое: только когда есть кому услышать или с кем
  // связано, не чаще раза в 4 мин и одного вида - раза в 15 мин. Решает реагировать или нет - нейросеть.
  moment(m) {
    const b = this.body.bot;
    if (!b || !b.entity || this.busy || this.pending.length || this.body.mode === 'task') return;
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
    let s = `\n[я] ${P.core}; ${P.near}${goal ? '; твоя цель: ' + goal.text : ''}`;
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

  push(line, wake, from = '', channel = '', extra = {}) {
    this.lastEvent = Date.now();
    if (from && from !== '@self') { this.idleSkips = 0; this.selfChain = 0; }
    this.pending.push({ line, from, channel, ...extra });
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
    if (this.cfg().paused) { this.pending = []; return; }   // пауза из панели: к Qwen не обращаемся
    if (this.busy || !this.pending.length) return;
    this.busy = true;
    let batch = [];
    try {
      const wait = 2500 - (Date.now() - this.lastAsk);
      if (wait > 0) await sleep(wait);
      await sleep(800);   // подождать, вдруг допишут ещё
      if (!this.botCfg.chatId) await this.warm();
      // вводная изменилась (обновление программы, характер, хозяева) - повторить её в этом же чате
      else if (this.botCfg.warmHash !== hash(warmText(this.cfg(), this.botCfg))) await this.warm(this.botCfg.chatId);
      batch = this.pending.splice(0);
      let msg = batch.map((x) => x.line).join('\n');
      const around = this.attn.takeNear();
      if (around.length) { msg += '\n[вокруг] ' + around.join(' | '); this.log('[вокруг] ' + around.join(' | ')); }
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
      this.lastDecision = { at: Date.now(), say: r.say, acts: r.actions.map((a) => a && a.act).filter(Boolean), model: this.bridge.lastPick ? this.bridge.lastPick.model : '' };
      // кто просил: последний автор с правами в пачке; '@self' - бот сам (инициатива)
      const master = [...batch].reverse().find((x) => x.from && x.from !== '@self' && this.isMaster(x.from));
      const self = batch.some((x) => x.from === '@self');
      if (self) this.idleSkips = (r.say || r.actions.length) ? 0 : this.idleSkips + 1;
      // в своё время только записал в дневник - это не дело: спросить снова через минуту, а не через две
      if (self && !r.say && r.actions.length && r.actions.every((a) => a && ['remember', 'forget', 'look'].includes(a.act))) this.lastEvent = Date.now() - 60000;
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
      if (r.channel === 'global' || r.channel === 'local') {
        rc = { channel: r.channel };
        if (r.channel === 'global') this.attn.lastGlobalReply = Date.now();
      }
      else if (r.channel === 'whisper' && r.to) rc = { channel: 'whisper', to: String(r.to) };
      if (r.say && rc.channel === 'none') { this.log('(вслух не сказал: рядом никого) ' + r.say); r.say = ''; }
      // голос - только если реплика действительно звучит (в ближнем и личке его слышат рядом)
      if (r.say && this.voice && rc.channel !== 'whisper') this.voice.speak(r.say, this.botCfg).catch((e) => this.log('голос: ' + e.message));
      if (r.say) {
        this.attn.answered(batch.filter((x) => x.channel).map((x) => x.from));
        await this.typeAndSay(r.say, rc);
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
      if (r.actions.length) {
        // без хозяина можно только безопасное: ходить, запоминать, урожай (посадить обратно), подбирать с земли
        const FREE = new Set(['stop', 'follow', 'come', 'goto', 'goto_place', 'pickup', 'harvest', 'wait', 'remember', 'recover', 'wander', 'travel', 'gather', 'craft', 'place', 'break', 'mine', 'surface', 'fish', 'smelt', 'hunt', 'shear', 'toss']);
        // идёт за кем-то и сам решил погулять - не бросать того, за кем идёт
        if (self && !master && this.body.mode === 'follow') r.actions = r.actions.filter((a) => !['wander', 'goto', 'goto_place', 'travel', 'stop', 'harvest', 'pickup'].includes(a.act));
        const NEED_MASTER = r.actions.filter((a) => a && a.act && !FREE.has(a.act));
        const notFromMaster = !master;
        // чужие просьбы не двигают бота дальше «подойти» и не перезаписывают места
        const allowed = notFromMaster
          ? r.actions.filter((a) => a && a.act && FREE.has(a.act) && (self || ['remember', 'stop', 'come', 'follow'].includes(a.act))
            && !(a.act === 'remember' && (a.kind || 'place') === 'place' && !self))
          : r.actions;
        if (NEED_MASTER.length && notFromMaster) this.log('отклонено (нужен хозяин): ' + NEED_MASTER.map((a) => a.act).join(', '));
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
    const parts = String(text).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, rc.channel === 'global' ? 2 : 3);
    for (const p of parts) {
      await sleep(Math.min(6000, 600 + p.length * 70 * (0.7 + Math.random() * 0.6)));   // будто печатает
      this.body.say(p.replace(/\.$/, ''), rc.channel, rc.to);
    }
  }

  async runActions(actions, from) {
    const label = actions.map((a) => a.act).join(' → ');
    const result = await this.body.run(actions, label);
    if (!result) return;
    this.log('итог: ' + result);
    // о долгом задании Qwen узнаёт итог и может прокомментировать; follow/stop/remember - без отчёта
    if (actions.some((a) => !['follow', 'stop', 'remember', 'forget'].includes(a.act))) {
      // своё дело: итог - снова от себя (можно продолжить: дошёл - осмотрелся - пошёл дальше), до 3 дел подряд
      const mine = from === 'сам' && ++this.selfChain < 6;
      this.push(`[итог задания (${from || 'хозяин'})] ${result}`, true, mine ? '@self' : '');
    }
  }
}

module.exports = { Brain, parseAnswer, DEFAULT_PERSONA };
