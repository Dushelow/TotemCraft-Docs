// Голова бота: события из игры и приказы из панели собираются в одно сообщение для Qwen вместе с состоянием бота.
// Qwen отвечает JSON: что сказать в чат и что сделать. Приказы с вещами и перемещением выполняются только от тех,
// кто в списке «хозяева» (владелец и выбранные люди), остальным бот только отвечает.

const DEFAULT_PERSONA = 'Обычный игрок ванильного сервера TotemCraft. Дружелюбный, спокойный, с юмором, любит строить ' +
  'и помогать. Пишет как в игровом чате: коротко, простыми словами, чаще с маленькой буквы, без эмодзи.';

function warmText(cfg, bot) {
  const masters = cfg.masters.join(', ');
  return `Ты управляешь персонажем ${bot.name} на сервере Minecraft TotemCraft (ванильное выживание, русскоязычные игроки).
Характер: ${bot.persona || DEFAULT_PERSONA}

Как это устроено: я присылаю тебе события из игры (чат, личные сообщения, итоги заданий, приказы хозяина) и состояние персонажа. Ты отвечаешь строго в таком виде:
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
{"act":"harvest","crop":"wheat","radius":16} - собрать спелый урожай рядом и посадить обратно (crop можно не указывать)
{"act":"goto_place","name":"склад"} - пойти к месту из памяти
{"act":"remember","kind":"place","name":"склад","x":0,"y":64,"z":0,"note":"сундуки хозяина"} - запомнить место (если говорят «тут» - координаты того, кто говорит; без x y z - где стоишь ты)
{"act":"remember","kind":"person","name":"Ник","note":"кто это, что любит, о чём договорились"} - запомнить про человека
{"act":"remember","kind":"fact","text":"..."} - запомнить факт о сервере или мире
{"act":"remember","kind":"journal","text":"..."} - записать в свой дневник (что было, что чувствуешь, что задумал)
{"act":"forget","kind":"place","name":"склад"} - забыть (kind: place, person, fact)

Память: я присылаю блок [память] с местами, людьми, фактами и твоим дневником, когда он меняется. Запоминай САМ, без
просьб, всё, что пригодится потом: новые места, людей и их просьбы, договорённости, интересные события. Ты живой
персонаж: у тебя есть свои интересы и настроение, ты можешь сам предложить заняться чем-то, пошутить, рассказать,
что видел. Когда приходит [тишина], реши сам, чем заняться (в рамках правил), или просто отдохни (actions пустой).
Если ничего делать не нужно, "actions": []. Если не знаешь координат, спроси в реплике и ничего не делай.

Правила:
1. Хозяева: ${masters}. Только их просьбы с вещами и сундуками ты выполняешь (взять, положить, отдать). Другим игрокам вежливо отказывай в таких просьбах, но болтать с ними, запоминать их и ходить рядом можно. По своей воле вещи из сундуков не берёшь.
2. Чужие постройки не ломаешь никогда. Ломать можно только урожай (и сразу сажать обратно). С мобами бот дерётся сам, игроков не бьёшь, команд сервера не пишешь.
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
  let say = '', actions = [];
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  let parsed = false;
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(body.slice(a, b + 1));
      actions = Array.isArray(j.actions) ? j.actions : [];
      if (typeof j.say === 'string') say = j.say;
      parsed = true;
    } catch {}
  }
  // текст вне блока кода (или вне JSON, если блока нет) - реплика
  const rest = fence ? outside : (parsed ? (raw.slice(0, raw.indexOf('{')) + raw.slice(raw.lastIndexOf('}') + 1)) : raw).trim();
  if (rest) say = rest;
  say = say.split('```')[0].split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ').slice(0, 240);
  return { say, actions };
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
    this.idleTimer = setInterval(() => this.idle(), 30000);
    body.on('end', () => {});

    body.on('player-chat', (m) => this.onChat(m));
    body.on('event', (e) => { if (e.important) this.push(`[событие] ${e.text}`, true); });
  }

  isMaster(name) { return this.cfg().masters.some((m) => m.toLowerCase() === String(name).toLowerCase()); }

  onChat({ from, text, whisper }) {
    const me = this.botCfg.name;
    const e = this.body.player(from);
    const dist = e && this.body.bot.entity ? Math.round(e.position.distanceTo(this.body.bot.entity.position)) : null;
    const mentioned = new RegExp(me, 'i').test(text);
    // реагируем на личку, на обращение по имени и на разговор рядом (до 12 блоков)
    if (!whisper && !mentioned && (dist === null || dist > 12)) return;
    const at = e ? `, стоит на ${Math.floor(e.position.x)} ${Math.floor(e.position.y)} ${Math.floor(e.position.z)}` : '';
    const where = (whisper ? 'лично тебе' : dist !== null ? `в чат, ${dist} бл. от тебя` : 'в чат') + at;
    const role = this.isMaster(from) ? ' (хозяин)' : '';
    this.push(`[чат] ${from}${role} пишет ${where}: ${text}`, true, from);
  }

  order(text) {
    const owner = this.cfg().masters[0] || 'владелец';
    this.push(`[приказ хозяина ${owner} из панели] ${text}`, true, owner);
  }

  // Инициатива: долго тихо - бот сам решает, чем заняться
  idle() {
    const ini = this.cfg().initiative || { enabled: true, minutes: 4 };
    if (!ini.enabled || !this.body.bot || this.body.status !== 'online' || this.body.mode === 'task' || this.busy) return;
    if (Date.now() - this.lastEvent < (ini.minutes || 4) * 60000) return;
    const mins = Math.round((Date.now() - this.lastEvent) / 60000);
    this.push(`[тишина] уже ${mins} мин ничего не происходит. Чем займёшься? Можно ничего.`, true, '@self');
  }

  stop() { clearInterval(this.idleTimer); }

  push(line, wake, from = '') {
    this.lastEvent = Date.now();
    this.pending.push({ line, from });
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
    this.botCfg.chatId = chatId;
    this.save();
    this.log('чат Qwen прогрет: ' + chatId + ' / ' + String(answer).slice(0, 80));
  }

  async pump() {
    if (this.busy || !this.pending.length) return;
    this.busy = true;
    try {
      const wait = 2500 - (Date.now() - this.lastAsk);
      if (wait > 0) await sleep(wait);
      await sleep(800);   // подождать, вдруг допишут ещё
      if (!this.botCfg.chatId) await this.warm();
      // вводная изменилась (обновление программы, характер, хозяева) - повторить её в этом же чате
      else if (this.botCfg.warmHash !== hash(warmText(this.cfg(), this.botCfg))) await this.warm(this.botCfg.chatId);
      const batch = this.pending.splice(0);
      let msg = batch.map((x) => x.line).join('\n') + `\n[состояние] ${this.body.stateText()}`;
      // память: целиком, когда изменилась, и раз в 25 сообщений, чтобы не забывалась в длинном чате
      const mem = this.memory;
      if (mem && (this.sentDigest !== mem.version || ++this.sinceDigest >= 25)) {
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
      if (chatId && chatId !== this.botCfg.chatId) { this.botCfg.chatId = chatId; this.save(); }
      const r = parseAnswer(answer);
      this.log('← ' + JSON.stringify(r));
      // кто просил: последний автор с правами в пачке; '@self' - бот сам (инициатива)
      const master = [...batch].reverse().find((x) => x.from && x.from !== '@self' && this.isMaster(x.from));
      const self = batch.some((x) => x.from === '@self');
      if (r.say && this.voice) this.voice.speak(r.say, this.botCfg).catch((e) => this.log('голос: ' + e.message));
      if (r.say) await this.typeAndSay(r.say);
      if (r.actions.length) {
        // без хозяина можно только безопасное: ходить, запоминать, урожай (посадить обратно), подбирать с земли
        const FREE = new Set(['stop', 'follow', 'come', 'goto', 'goto_place', 'pickup', 'harvest', 'wait', 'remember', 'recover']);
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
    } finally {
      this.busy = false;
      if (this.pending.length) setTimeout(() => this.pump(), 500);
    }
  }

  async typeAndSay(text) {
    const parts = String(text).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
    for (const p of parts) {
      await sleep(Math.min(6000, 600 + p.length * 70 * (0.7 + Math.random() * 0.6)));   // будто печатает
      this.body.say(p.replace(/\.$/, ''));
    }
  }

  async runActions(actions, from) {
    const label = actions.map((a) => a.act).join(' → ');
    const result = await this.body.run(actions, label);
    if (!result) return;
    this.log('итог: ' + result);
    // о долгом задании Qwen узнаёт итог и может прокомментировать; follow/stop/remember - без отчёта
    if (actions.some((a) => !['follow', 'stop', 'remember', 'forget'].includes(a.act))) this.push(`[итог задания (${from || 'хозяин'})] ${result}`, true, '');
  }
}

module.exports = { Brain, parseAnswer, DEFAULT_PERSONA };
