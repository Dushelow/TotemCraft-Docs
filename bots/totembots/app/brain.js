// Голова бота: события из игры и приказы из панели собираются в одно сообщение для Qwen вместе с состоянием бота.
// Qwen отвечает JSON: что сказать в чат и что сделать. Приказы с вещами и перемещением выполняются только от тех,
// кто в списке «хозяева» (владелец и выбранные люди), остальным бот только отвечает.

const DEFAULT_PERSONA = 'Обычный игрок ванильного сервера TotemCraft. Дружелюбный, спокойный, с юмором, любит строить ' +
  'и помогать. Пишет как в игровом чате: коротко, простыми словами, чаще с маленькой буквы, без эмодзи.';

function warmText(cfg, bot) {
  const masters = cfg.masters.join(', ');
  return `Ты управляешь персонажем ${bot.name} на сервере Minecraft TotemCraft (ванильное выживание, русскоязычные игроки).
Характер: ${bot.persona || DEFAULT_PERSONA}

Как это устроено: я присылаю тебе события из игры (чат, личные сообщения, итоги заданий, приказы хозяина) и состояние персонажа. Ты отвечаешь ТОЛЬКО одним JSON без пояснений:
{"say": "что написать в общий чат или пусто", "actions": [ ...действия... ]}

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
Если ничего делать не нужно, "actions": []. Если не знаешь координат, спроси в "say" и ничего не делай.

Правила:
1. Хозяева: ${masters}. Только их просьбы с действиями ты выполняешь (ходить, носить, брать, отдавать). Другим игрокам вежливо отказывай в таких просьбах, но болтать с ними можно.
2. Ты не ломаешь и не ставишь блоки, не дерёшься, команд сервера не пишешь.
3. Не притворяйся, что ты не бот: если кто-то всерьёз спрашивает, бот ли ты, честно скажи, что ты бот-помощник. Сам об этом не объявляй.
4. Никакого флирта и романтики, на сервере много детей. Не ругайся матом, не груби.
5. Отвечай в чат, только когда это уместно: к тебе обратились, ты рядом с разговором, или нужно сообщить о задании. На чужие разговоры не встревай, тогда "say": "".
6. Пиши коротко, одна-две фразы, как живой игрок в чате.
7. Перемещение между измерениями: через портал (portal), потом обычные действия уже в другом измерении.

Ответь на это сообщение JSON {"say":"","actions":[]} и жди событий.`;
}

// Достать JSON из ответа (бывает в ```json ... ``` или с текстом вокруг).
function parseAnswer(text) {
  const s = String(text || '').replace(/```(json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(s.slice(a, b + 1));
      return { say: typeof j.say === 'string' ? j.say : '', actions: Array.isArray(j.actions) ? j.actions : [] };
    } catch {}
  }
  // не JSON - считаем репликой
  return { say: s.trim().split('\n')[0].slice(0, 200), actions: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Brain {
  /** cfg() - текущие настройки ({ masters }), botCfg - запись бота (name, persona, chatId), save() - сохранить chatId */
  constructor({ body, bridge, cfg, botCfg, save, log }) {
    Object.assign(this, { body, bridge, cfg, botCfg, save, log });
    this.pending = [];
    this.busy = false;
    this.lastAsk = 0;
    this.taskFrom = '';

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
    const where = whisper ? 'лично тебе' : dist !== null ? `в чат, ${dist} бл. от тебя` : 'в чат';
    const role = this.isMaster(from) ? ' (хозяин)' : '';
    this.push(`[чат] ${from}${role} пишет ${where}: ${text}`, true, from);
  }

  order(text) {
    const owner = this.cfg().masters[0] || 'владелец';
    this.push(`[приказ хозяина ${owner} из панели] ${text}`, true, owner);
  }

  push(line, wake, from = '') {
    this.pending.push({ line, from });
    this.log('→ ' + line);
    if (wake) this.pump();
  }

  async warm() {
    const { answer, chatId } = await this.bridge.ask('', warmText(this.cfg(), this.botCfg));
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
      const batch = this.pending.splice(0);
      const msg = batch.map((x) => x.line).join('\n') + `\n[состояние] ${this.body.stateText()}`;
      this.lastAsk = Date.now();
      const { answer, chatId } = await this.bridge.ask(this.botCfg.chatId, msg);
      if (chatId && chatId !== this.botCfg.chatId) { this.botCfg.chatId = chatId; this.save(); }
      const r = parseAnswer(answer);
      this.log('← ' + JSON.stringify(r));
      // кто просил: последний автор с правами в пачке
      const master = [...batch].reverse().find((x) => x.from && this.isMaster(x.from));
      if (r.say) await this.typeAndSay(r.say);
      if (r.actions.length) {
        const touching = r.actions.filter((a) => a && a.act && a.act !== 'stop');
        if (touching.length && !master) {
          this.log('действия отклонены: просил не хозяин');
        } else {
          this.runActions(r.actions, master ? master.from : '');
        }
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
    // о долгом задании Qwen узнаёт итог и может прокомментировать; follow/stop - сразу, без отчёта
    if (actions.some((a) => !['follow', 'stop'].includes(a.act))) this.push(`[итог задания от ${from || 'хозяина'}] ${result}`, true, '');
  }
}

module.exports = { Brain, parseAnswer, DEFAULT_PERSONA };
