// Нейросеть через сайт без ключа (DeepSeek и т.п.): своё окно со своим входом, вопрос - в поле ввода, ответ - текст
// последнего сообщения, когда он перестал меняться. Проверку «не робот ли вы» проходит человек (программа ждёт).
const { lockOn, LOCK_OFF } = require('./lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = {
  deepseek: {
    name: 'DeepSeek (сайт)', home: 'https://chat.deepseek.com/',
    chatUrl: (id) => `https://chat.deepseek.com/a/chat/s/${id}`,
    chatIdFrom: (url) => { const m = /\/s\/([0-9a-f-]{16,})/i.exec(url); return m ? m[1] : ''; },
    loggedIn: `(() => { try { return !!(localStorage.getItem('userToken') || '').replace(/[\\s"{}]/g, '').length && !/sign_in|login/.test(location.pathname); } catch { return false; } })()`,
    input: 'textarea',
    send: '.ds-button--primary.ds-button--filled',
    // ответ - из переписки самой страницы (сообщения не рисуются, пока окно скрыто под другими - проверено 15.11)
    history: `(async () => { const tok = JSON.parse(localStorage.getItem('userToken') || '{}').value; const id = location.pathname.split('/').pop();
      if (!/^[0-9a-f-]{16,}$/i.test(id)) return { n: 0, t: '', done: false };
      const j = await (await fetch('/api/v0/chat/history_messages?chat_session_id=' + id, { headers: { authorization: 'Bearer ' + tok } })).json();
      const m = ((j.data && j.data.biz_data && j.data.biz_data.chat_messages) || []);
      const last = m[m.length - 1] || {};
      const t = (last.fragments || []).filter((f) => f.type === 'RESPONSE').map((f) => f.content).join('');
      return { n: m.length, t: last.role === 'ASSISTANT' ? t : '', done: last.status === 'FINISHED' }; })()`,
  },
};

// Остальные сайты - по общему образцу: поле ввода, кнопка отправки, последний ответ на странице.
// Названия элементов - лучшие известные; после входа владельца проверяются и правятся (сайты меняются).
const GEN = (name, home, input, send, answers, extra = {}) => ({
  name, home, chatUrl: null, chatIdFrom: (url) => { const m = /\/([0-9a-z][0-9a-z-]{15,})\/?$/i.exec(url); return m ? m[1] : ''; },
  loggedIn: `(() => !!document.querySelector(${JSON.stringify(input)}))()`, input, send, answers, insert: true, ...extra,
});
Object.assign(SITES, {
  kimi: GEN('Kimi (сайт)', 'https://www.kimi.com/', '.chat-input-editor, div[contenteditable=true], textarea', '.send-button, button[class*=send]', '.segment-assistant .markdown, [class*=assistant] .markdown, .markdown'),
  glm: GEN('Z.ai GLM (сайт)', 'https://chat.z.ai/', 'textarea#chat-input, textarea', 'button#send-message-button, button[type=submit]', '.chat-assistant .markdown-prose, [class*=assistant] [class*=markdown], .markdown-prose'),
  mistral: GEN('Mistral (сайт)', 'https://chat.mistral.ai/chat', 'textarea, div[contenteditable=true]', 'button[aria-label*=Send i], button[type=submit]', '[data-message-author-role=assistant], .prose'),
  grok: GEN('Grok (сайт)', 'https://grok.com/', 'textarea, div[contenteditable=true]', 'button[aria-label=Submit], button[type=submit]', '.response-content-markdown, .message-bubble .markdown'),
  chatgpt: GEN('ChatGPT (сайт)', 'https://chatgpt.com/', '#prompt-textarea, textarea[name=prompt], div[contenteditable=true]', '#composer-submit-button, button[data-testid=send-button], button[aria-label="Send message"]', '[data-message-author-role=assistant] .markdown, [data-message-author-role=assistant]'),
  gemini: GEN('Gemini (сайт)', 'https://gemini.google.com/app', 'rich-textarea .ql-editor, div[contenteditable=true]', 'button.send-button, button[aria-label*=Send i], button[aria-label*=Отправ]', 'model-response .markdown, message-content .markdown'),
  arena: GEN('LMArena (сайт)', 'https://lmarena.ai/?mode=direct', 'textarea[name=message], textarea', 'button[type=submit], button[aria-label*=Send i]', '.prose, [class*=message] [class*=markdown]'),
  copilot: GEN('Copilot (сайт)', 'https://copilot.microsoft.com/', 'textarea#userInput, textarea', 'button[aria-label*=Submit i], button[type=submit]', '[data-content=ai-message], [class*=ai-message]'),
});

class WebChat {
  constructor(wc, siteId, onAttention = () => {}) {
    this.wc = wc; this.site = SITES[siteId]; this.id = siteId; this.onAttention = onAttention;
    this.chain = Promise.resolve();
    this.busy = 0;
    wc.on('dom-ready', () => { if (this.busy) this.js(lockOn()).catch(() => {}); });
  }

  // пока программа работает в окне - замок (lock.js): владелец может листать, но не нажимать и не печатать
  exclusive(fn) {
    const run = async () => {
      this.busy = (this.busy || 0) + 1;
      this.js(lockOn(`Бот работает с ${this.site.name.replace(/ \(сайт\)$/, '')} в этом окне: листать можно, нажимать и печатать нельзя`)).catch(() => {});
      try { return await fn(); } finally { if (--this.busy === 0) this.js(LOCK_OFF).catch(() => {}); }
    };
    const p = this.chain.then(run, run); this.chain = p.catch(() => {}); return p;
  }

  js(code) { return this.wc.executeJavaScript(code); }

  async captcha() {
    return this.js(`(() => { const t = (document.body && document.body.innerText || '').slice(0, 20000);
      return /slide to verify|drag the slider|verify you are human|подтвердите, что вы человек|cloudflare/i.test(t) || !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"]'); })()`).catch(() => false);
  }

  async loggedIn() { return this.js(this.site.loggedIn).catch(() => false); }

  ask(chatId, text) { return this.exclusive(() => this._ask(chatId, text)); }

  async _ask(chatId, text) {
    const gap = 4000 - (Date.now() - (this.lastSend || 0));
    if (gap > 0) await sleep(gap);
    this.lastSend = Date.now();
    this._r1 = this._r2 = false;
    const s = this.site;
    // окно открыто у владельца (вход, своё) или вход не сделан - страницу не трогаем вообще
    // владелец печатает в этом окне (поле в фокусе и не пустое) - подождать, а не отказывать
    for (let i = 0; i < 30 && this.inUse && this.inUse() && await this.js(`(() => { const t = document.activeElement; return !!(t && (t.value || t.innerText || '').trim() && /TEXTAREA|DIV/.test(t.tagName)); })()`).catch(() => false); i++) await sleep(1000);
    for (let i = 0; i < 40 && !(await this.loggedIn()); i++) await sleep(400);   // окно могло только что открыться
    if (!(await this.loggedIn())) throw new Error(`${s.name}: нужен вход - «Мозги» в панели, «Войти через Chrome»`);
    const want = chatId && s.chatUrl ? s.chatUrl(chatId) : (chatId && this.wc.getURL().includes(chatId) ? this.wc.getURL() : s.home);
    if (!this.wc.getURL().startsWith(want) || !chatId) { await this.wc.loadURL(want); await sleep(1500); }
    if (await this.captcha()) { await this.js(LOCK_OFF).catch(() => {}); throw new Error(`${s.name}: проверка «не робот» - пройдите её в окне бота`); }
    // поле ввода
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await this.js(`!!document.querySelector(${JSON.stringify(s.input)})`).catch(() => false); if (!ok) await sleep(250); }
    if (!ok) throw new Error(`${s.name}: нет поля ввода (сайт изменился?)`);
    const readNow = () => (s.history ? this.js(s.history) : this.js(`(() => { const a = document.querySelectorAll(${JSON.stringify(s.answers)}); return { n: a.length, t: a.length ? a[a.length - 1].innerText : '', done: false }; })()`)).catch(() => null);
    const before = s.history ? (chatId ? ((await readNow()) || { n: 0 }).n : 0) : ((await readNow()) || { n: 0 }).n;
    await this.js(`(() => {
      const ta = document.querySelector(${JSON.stringify(s.input)}); ta.focus();
      if (${!!s.insert} || ta.tagName !== 'TEXTAREA') { document.execCommand('selectAll', false); document.execCommand('insertText', false, ${JSON.stringify(text)}); }
      else { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 1; })()`);
    await sleep(300);
    // отправить кнопкой (Enter в скрытое окно не доходит)
    const sent = await this.js(`(() => { const ta = document.querySelector(${JSON.stringify(s.input)}); let box = ta; for (let i = 0; i < 6 && box; i++) box = box.parentElement;
      const b = (box || document).querySelector(${JSON.stringify(s.send)}) || document.querySelector(${JSON.stringify(s.send)});
      if (b) { b.click(); return true; }
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); return true; })()`).catch(() => false);
    if (!sent) throw new Error(`${s.name}: нет кнопки отправки (сайт изменился?)`);
    // ответ: новое сообщение появилось и 2,5 с не меняется
    const t0 = Date.now();
    let last = '', stableSince = 0;
    while (Date.now() - t0 < 120000) {
      await sleep(500);
      if (await this.captcha()) { await this.js(LOCK_OFF).catch(() => {}); this.onAttention(`${s.name}: проверка «не робот» - пройдите её во вкладке`); throw new Error(`${s.name}: проверка «не робот»`); }
      const r = (await readNow()) || { n: 0, t: '' };
      if (r.n <= before + (s.history ? 1 : 0) || !r.t) {
        // не ушло или сайт показал ошибку - как человек: нажать «повторить» (у DeepSeek - значок повторной отправки),
        // а если сообщения нет совсем - отправить ещё раз; на 12-й и 30-й секунде
        const el = Date.now() - t0;
        if ((el > 12000 && !this._r1) || (el > 30000 && !this._r2)) {
          if (el > 30000) this._r2 = true; else this._r1 = true;
          const how = await this.js(`(() => {
            const vis = (e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; };
            const re = /retry|regenerate|resend|try again|повтор|ещё раз|重试|重新/i;
            const btn = [...document.querySelectorAll('button, [role=button], .ds-icon-button')].reverse().find((b) => vis(b) && re.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.innerText || '')));
            if (btn) { btn.click(); return 'повтор'; }
            const ta = document.querySelector(${JSON.stringify(s.input)});
            if (ta && (ta.value || ta.innerText || '').trim()) { let box = ta; for (let i = 0; i < 6 && box; i++) box = box.parentElement; const b = (box || document).querySelector(${JSON.stringify(s.send)}); if (b) { b.click(); return 'отправил снова'; } }
            return ''; })()`).catch(() => '');
          if (how) this.onAttention(`${s.name}: сообщение не ушло - ${how}`);
        }
        if (el > 60000) throw new Error(`${s.name}: не начал отвечать`);
        continue;
      }
      if (r.done) { last = r.t; break; }
      if (r.t !== last) { last = r.t; stableSince = Date.now(); continue; }
      if (Date.now() - stableSince > 3000) break;
    }
    if (!last) throw new Error(`${s.name}: пустой ответ`);
    return { answer: last, chatId: s.chatIdFrom(this.wc.getURL()) || chatId };
  }
}

module.exports = { WebChat, SITES };
