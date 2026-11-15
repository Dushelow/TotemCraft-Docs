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
{"act":"wander","dir":"север","radius":48} - прогуляться, поисследовать (dir - сторона света; без dir - туда, где ещё не был)
{"act":"look","what":["inventory","map","online","around","memory"]} - посмотреть то, чего нет в сообщении (см. ниже), ответ придёт сразу
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
around (осмотреться: мобы, звери, вещи на земле, блоки рядом, биом), memory (вся память). Я сразу пришлю [смотрю],
и ты ответишь уже с этим. Смотри только то, что нужно сейчас.

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

Свобода воли. Ты не стоишь столбом в ожидании приказов. Когда приходит [свободное время], выбери себе занятие по
характеру и сделай его - в ответе должно быть действие (или реплика тем, кто рядом): прогуляйся и поисследуй, сходи
посмотреть на постройку, деревню или сооружение с карты, подойди к игроку поболтать, проверь ферму, подбери вещи,
сходи к знакомому месту, запиши в дневник, что было и что задумал. Я предлагаю варианты по обстановке, можно своё.
Не повторяй одно и то же раз за разом. Ничего не делать можно, только если ты идёшь за кем-то и сказать нечего.
Если ничего делать не нужно, "actions": []. Если не знаешь координат, спроси в реплике и ничего не делай.

Правила:
1. Хозяева: ${masters}. Только их просьбы с вещами и сундуками ты выполняешь (взять, положить, отдать). Другим игрокам вежливо отказывай в таких просьбах, но болтать с ними, запоминать их и ходить рядом можно. По своей воле вещи из сундуков не берёшь.
2. Чужие постройки не ломаешь никогда - ни на поверхности, ни под землёй (здесь строят где угодно: дома под землёй, искусственные пещеры). Ломать можно только урожай (и сразу сажать обратно). С мобами бот дерётся сам, игроков не бьёшь, команд сервера не пишешь.
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
    this.recentIdeas = [];
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

  // Свобода воли: долго никто ничего не просит - бот сам выбирает занятие из вариантов по обстановке
  idle() {
    const ini = this.cfg().initiative || { enabled: true, minutes: 4 };
    if (!ini.enabled || !this.body.bot || this.body.status !== 'online' || this.body.mode === 'task' || this.busy || this.pending.length) return;
    // если пару раз подряд ничего не выбрал - спрашивать реже (до 4x)
    if (Date.now() - this.lastEvent < (ini.minutes || 4) * 60000 * (1 + Math.min(3, this.idleSkips))) return;
    const mins = Math.round((Date.now() - this.lastEvent) / 60000);
    const ideas = this.ideas();
    const list = ideas.map((t, i) => `${i + 1}) ${t}`).join('; ');
    this.push(`[свободное время] тебя ни о чём не просят уже ${mins} мин. Займись чем-нибудь сам, по характеру, как живой игрок. ` +
      `Варианты: ${list}. Можно своё. Выбери одно и сделай.`, true, '@self', '', { want: ['map'] });
    this.selfChain = 0;
  }

  /** Варианты занятий по обстановке: кто рядом, что на карте, память, время суток. Каждый раз разные. */
  ideas() {
    const body = this.body, b = body.bot, me = b.entity.position;
    const wm = body.worldMap, mem = this.memory;
    const following = body.mode === 'follow';
    const out = [];
    const add = (w, key, text) => { if (!this.recentIdeas.includes(key)) out.push({ w: w * (0.6 + Math.random() * 0.8), key, text }); };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const near = Object.values(b.players).filter((p) => p.entity && p.username !== this.botCfg.name)
      .map((p) => ({ name: p.username, d: Math.round(p.entity.position.distanceTo(me)) })).filter((p) => p.d <= 48);
    if (near.length) {
      const p = pick(near);
      add(3, 'talk:' + p.name, `подойти к ${p.name} (${p.d} бл.) и заговорить в ближнем чате: что строит, чем занят, не нужна ли помощь (come)`);
    }
    if (following) {
      add(3, 'joke', `сказать что-нибудь ${body.followName}: пошутить, заметить что-то вокруг, вспомнить случай из дневника`);
      add(1.5, 'look', 'осмотреться (look around) и прокомментировать, что видишь');
    } else {
      if (wm) {
        const dir = wm.leastExplored(body);
        add(2, 'wander:' + dir, `прогуляться на ${dir} - там ты ещё не был (wander "${dir}")`);
        const sights = wm.nearby(body, 160, 12).filter((s) => s.d > 20 && !this.recentIdeas.includes(s.key) && s.kind !== 'ферма');
        if (sights.length) { const s = pick(sights.slice(0, 6)); add(2.5, s.key, `сходить посмотреть: ${s.text} (goto)`); }
        const farm = wm.nearby(body, 40, 12).find((s) => s.kind === 'ферма');
        if (farm) add(2, 'farm', `проверить ферму рядом (${farm.text}): собрать спелое и посадить обратно (harvest)`);
      }
      if (mem) {
        const dim = body.dimName();
        const places = Object.values(mem.data.places).filter((p) => p.dim === dim && Math.hypot(p.x - me.x, p.z - me.z) > 24 && Math.hypot(p.x - me.x, p.z - me.z) < 400
          && !/нельзя|чуж|не заход|запрет/i.test(p.name + ' ' + (p.note || '')));
        if (places.length) { const p = pick(places); add(1.5, 'place:' + p.name, `сходить к месту «${p.name}» (goto_place)`); }
      }
      const drops = Object.values(b.entities).filter((e) => e.name === 'item' && e.position && e.position.distanceTo(me) < 12).length;
      if (drops) add(2, 'pickup', `подобрать вещи с земли рядом, их ${drops} (pickup)`);
      add(1, 'look', 'осмотреться (look around): что за место, кто вокруг');
    }
    add(1, 'journal', 'записать в дневник, что было и что задумал (remember journal)');
    const news = mem && (mem.data.news || []).slice(-3);
    if (near.length && news && news.length) add(1, 'news', `рассказать тем, кто рядом, что пишут в общем чате: «${pick(news).text}»`);
    const masters = this.cfg().masters.filter((m) => b.players[m] && !near.some((p) => p.name === m));
    if (masters.length && Date.now() - (this.masterPing || 0) > 45 * 60000) add(1, 'ping', `написать хозяину ${masters[0]} в личку пару слов: где ты и чем занят ("channel":"whisper","to":"${masters[0]}")`);
    out.sort((x, y) => y.w - x.w);
    const chosen = out.slice(0, 4);
    if (chosen.some((c) => c.key === 'ping')) this.masterPing = Date.now();
    this.recentIdeas = [...chosen.map((c) => c.key), ...this.recentIdeas].slice(0, 8);
    return chosen.map((c) => c.text);
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
    if ((all || what.has('memory')) && this.memory) { out.push(this.memory.digest(this.botCfg.name)); this.sentDigest = this.memory.version; this.sinceDigest = 0; }
    return out.join('\n') || 'нечего показать';
  }

  /** Что из состояния добавить к сообщению: [я] всегда, остальное - если изменилось, спрошено или нужно по смыслу. */
  stateFor(batch) {
    const P = this.body.stateParts && this.body.stateParts();
    if (!P) return '\n[я] ты не на сервере';
    const want = new Set(batch.flatMap((x) => x.want || []));
    const said = batch.map((x) => x.line.replace(/^\[[^\]]*\]\s*/, '')).join(' ').toLowerCase();
    let s = `\n[я] ${P.core}; ${P.near}`;
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
      // кто просил: последний автор с правами в пачке; '@self' - бот сам (инициатива)
      const master = [...batch].reverse().find((x) => x.from && x.from !== '@self' && this.isMaster(x.from));
      const self = batch.some((x) => x.from === '@self');
      if (self) this.idleSkips = (r.say || r.actions.length) ? 0 : this.idleSkips + 1;
      // «посмотреть»: прислать запрошенное следующим сообщением от того же автора и в тот же канал (до 2 раз подряд)
      const looks = r.actions.filter((a) => a && a.act === 'look');
      r.actions = r.actions.filter((a) => !(a && a.act === 'look'));
      this.lookDepth = batch.every((x) => x.look) ? this.lookDepth : 0;
      if (looks.length && this.lookDepth < 2) {
        this.lookDepth++;
        const what = new Set(looks.flatMap((a) => [].concat(a.what || 'all')).map((w) => String(w).toLowerCase()));
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
      if (r.actions.length) {
        // без хозяина можно только безопасное: ходить, запоминать, урожай (посадить обратно), подбирать с земли
        const FREE = new Set(['stop', 'follow', 'come', 'goto', 'goto_place', 'pickup', 'harvest', 'wait', 'remember', 'recover', 'wander']);
        // идёт за кем-то и сам решил погулять - не бросать того, за кем идёт
        if (self && !master && this.body.mode === 'follow') r.actions = r.actions.filter((a) => !['wander', 'goto', 'goto_place', 'stop', 'harvest', 'pickup'].includes(a.act));
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
      const mine = from === 'сам' && ++this.selfChain < 3;
      this.push(`[итог задания (${from || 'хозяин'})] ${result}`, true, mine ? '@self' : '');
    }
  }
}

module.exports = { Brain, parseAnswer, DEFAULT_PERSONA };
