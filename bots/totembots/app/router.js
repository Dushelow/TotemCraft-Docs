// Несколько «мозгов» по очереди: Qwen через сайт и нейросети по бесплатному ключу (Gemini, Groq, OpenRouter -
// у всех один формат запросов, как у OpenAI). Лимит, капча, сбой - сразу следующий. Разговор хранит программа:
// новый мозг получает вводную и последние события, поэтому бот не «теряет память» при переключении.
// Для мозга (brain.js) это тот же bridge: ask(chatId, text, opt) -> { answer, chatId }.
const crypto = require('crypto');

// Готовые бесплатные варианты (модель можно поменять в настройках: названия у сервисов иногда меняются)
const PRESETS = {
  gemini: { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek/deepseek-chat-v3-0324:free', keyUrl: 'https://openrouter.ai/keys' },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
};
const LIMITED = /limit|quota|429|rate|exceed|лимит|captcha|проверк|не начал|timeout|ECONN|ETIMEDOUT|fetch failed|5\d\d/i;

class Router {
  constructor({ qwen, cfg, log, webs = {} }) {
    this.qwen = qwen; this.cfg = cfg; this.log = log || (() => {}); this.webs = webs;   // webs: { deepseekweb: WebChat }
    this.chats = new Map();      // логический чат -> { warm, turns: [{q, a}], qwenId }
    this.rest = {};              // мозг -> до какого времени не трогать
    this.lastPick = null;
    this.onAttention = () => {};
  }

  // то, что brain/main берут у моста напрямую
  get resting() { return this.order().every((b) => this.isResting(b.id)); }
  get restUntil() { return Math.min(...this.order().map((b) => this.rest[b.id] || 0)); }
  get busy() { return this.qwen.busy; }
  get captcha() { return this.qwen.captcha; }
  transcribe(pcm) { return this.qwen.transcribe(pcm); }

  /** Мозги по порядку из настроек; Qwen-сайт - всегда есть, ключевые - только если ключ вставлен. */
  order() {
    const c = this.cfg().brains || {};
    const list = (c.order || ['qwen', 'deepseekweb', 'gemini', 'groq', 'openrouter', 'deepseek']).map((id) => {
      if (id === 'qwen') return c.qwen === false ? null : { id: 'qwen', name: 'Qwen (сайт)' };
      if (this.webs[id]) return { id, name: this.webs[id].site.name, web: this.webs[id] };
      const p = PRESETS[id], k = (c.keys || {})[id];
      return p && k ? { id, name: p.name, url: p.url, key: k, model: (c.models || {})[id] || p.model } : null;
    }).filter(Boolean);
    return list.length ? list : [{ id: 'qwen', name: 'Qwen (сайт)' }];
  }

  isResting(id) { return (id === 'qwen' && (this.qwen.resting || this.qwen.captcha)) || (this.rest[id] || 0) > Date.now(); }

  /** Настоящий чат Qwen для логического (для озвучки); пусто - последний ответ дал не Qwen. */
  qwenIdOf(chatId) { const ch = this.chats.get(chatId); return ch && this.lastBrain === 'qwen' ? ch.qwenId : (ch ? '' : chatId); }

  /** Вводная для чата, который пришёл с прошлого запуска (нужна ключевым мозгам при переключении). */
  ensureWarm(chatId, warm) { const ch = this.chats.get(chatId); if (ch && !ch.warm) ch.warm = warm; }

  async ask(chatId, text, opt = {}) {
    // логический чат с прошлого запуска программы - истории нет: пусть мозг начнёт новый (как PARENT_NOT_FOUND)
    if (chatId && chatId.startsWith('L-') && !this.chats.has(chatId)) throw new Error('PARENT_NOT_FOUND: чат с прошлого запуска');
    let id = chatId;
    if (!id) id = 'L-' + crypto.randomUUID();
    let ch = this.chats.get(id);
    if (!ch) {   // новый чат (или старый Qwen-чат с прошлого запуска - его история у Qwen)
      ch = { warm: chatId ? '' : text, turns: [], qwenId: chatId && !chatId.startsWith('L-') ? chatId : '' };
      this.chats.set(id, ch);
    }
    let last;
    for (const b of this.order()) {
      if (this.isResting(b.id)) continue;
      try {
        const answer = b.id === 'qwen' ? await this.askQwen(ch, text, opt) : b.web ? await this.askWeb(b, ch, text) : await this.askApi(b, ch, text);
        if (!answer || !String(answer).trim()) throw new Error('пустой ответ');
        ch.turns.push({ q: text, a: answer }); ch.turns = ch.turns.slice(-24);
        if (this.lastBrain !== b.id) { this.lastBrain = b.id; this.onAttention('мозг сейчас: ' + b.name); }
        this.lastPick = { model: b.id === 'qwen' ? (this.qwen.lastPick || {}).model || 'Qwen' : `${b.name} ${b.model}`, mode: b.id === 'qwen' ? (this.qwen.lastPick || {}).mode || '' : 'api' };
        return { answer, chatId: id };
      } catch (e) {
        last = e;
        // PARENT_NOT_FOUND / CHAT_IN_PROGRESS - чат Qwen сломан: следующий раз - новый чат Qwen с историей
        if (b.id === 'qwen' && /PARENT_NOT_FOUND|CHAT_IN_PROGRESS/i.test(e.message)) ch.qwenId = '';
        if (b.id !== 'qwen' && LIMITED.test(e.message)) this.rest[b.id] = Date.now() + (/429|limit|quota|rate/i.test(e.message) ? 10 : 2) * 60000;
        if (b.web && /вход|не робот|не начал|нет поля/.test(e.message)) { this.rest[b.id] = Date.now() + 3 * 60000; this.onAttention(e.message); }
        if (b.web && ch.webIds) delete ch.webIds[b.id];
        this.log(`мозг ${b.name}: ${e.message.slice(0, 120)} - пробую следующий`);
      }
    }
    if (this.order().every((b) => this.isResting(b.id))) throw new Error('лимит Qwen на всех моделях и других мозгов нет: ' + (last ? last.message : ''));
    throw last || new Error('нет доступных мозгов');
  }

  /** Qwen-сайт: свой чат; если его нет (переключились с другого мозга) - новый чат с вводной и последними событиями. */
  async askQwen(ch, text, opt) {
    let send = text;
    if (!ch.qwenId && ch.turns.length) send = this.recap(ch) + '\n\n' + text;
    else if (!ch.qwenId && ch.warm && ch.warm !== text) send = ch.warm + '\n\n' + text;
    const r = await this.qwen.ask(ch.qwenId, send, opt);
    ch.qwenId = r.chatId || ch.qwenId;
    return r.answer;
  }

  /** Сайт без ключа: свой чат; нет его - новый с вводной и последними событиями. */
  async askWeb(b, ch, text) {
    ch.webIds = ch.webIds || {};
    let send = text;
    if (!ch.webIds[b.id]) send = ch.turns.length ? this.recap(ch) + '\n\n' + text : (ch.warm && ch.warm !== text ? ch.warm + '\n\n' + text : text);
    const r = await b.web.ask(ch.webIds[b.id] || '', send);
    ch.webIds[b.id] = r.chatId || ch.webIds[b.id];
    return r.answer;
  }

  recap(ch) {
    const t = ch.turns.slice(-8).map((x) => `[было] ${String(x.q).slice(0, 400)}\n[ты ответил] ${String(x.a).slice(0, 300)}`).join('\n');
    return `${ch.warm}\n\n(продолжение разговора, который шёл в другом чате; последние события:)\n${t}`;
  }

  /** Ключевой мозг (формат OpenAI): вводная - system, история - по очереди, ответ - текст. */
  async askApi(b, ch, text) {
    const messages = [];
    if (ch.warm) messages.push({ role: 'system', content: ch.warm });
    for (const x of ch.turns.slice(-16)) { messages.push({ role: 'user', content: String(x.q) }); messages.push({ role: 'assistant', content: String(x.a) }); }
    if (text !== ch.warm) messages.push({ role: 'user', content: text });
    else messages.push({ role: 'user', content: 'Начинаем. Ответь: ок' });
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 40000);
    try {
      const res = await fetch(b.url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b.key, 'X-Title': 'TotemBots' },
        body: JSON.stringify({ model: b.model, messages, temperature: 0.8, max_tokens: 600 }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 160)}`);
      const j = JSON.parse(body);
      return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    } catch (e) { if (e.name === 'AbortError') throw new Error('timeout 40 с'); throw e; } finally { clearTimeout(timer); }
  }
}

module.exports = { Router, PRESETS };
