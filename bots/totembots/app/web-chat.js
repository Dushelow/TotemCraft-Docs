// Нейросеть через сайт без ключа (DeepSeek и т.п.): своё окно со своим входом, вопрос - в поле ввода, ответ - текст
// последнего сообщения, когда он перестал меняться. Проверку «не робот ли вы» проходит человек (программа ждёт).
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
  copilot: GEN('Copilot (сайт)', 'https://copilot.microsoft.com/', 'textarea#userInput, textarea', 'button[aria-label*=Submit i], button[type=submit]', '[data-content=ai-message], [class*=ai-message]'),
});

class WebChat {
  constructor(wc, siteId, onAttention = () => {}) {
    this.wc = wc; this.site = SITES[siteId]; this.id = siteId; this.onAttention = onAttention;
    this.chain = Promise.resolve();
  }

  exclusive(fn) { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }

  js(code) { return this.wc.executeJavaScript(code); }

  async captcha() {
    return this.js(`(() => { const t = (document.body && document.body.innerText || '').slice(0, 20000);
      return /slide to verify|drag the slider|verify you are human|подтвердите, что вы человек|cloudflare/i.test(t) || !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"]'); })()`).catch(() => false);
  }

  async loggedIn() { return this.js(this.site.loggedIn).catch(() => false); }

  ask(chatId, text) { return this.exclusive(() => this._ask(chatId, text)); }

  async _ask(chatId, text) {
    const s = this.site;
    // окно открыто у владельца (вход, своё) или вход не сделан - страницу не трогаем вообще
    if (this.inUse && this.inUse()) throw new Error(`${s.name}: окно открыто у владельца - не трогаю`);
    for (let i = 0; i < 40 && !(await this.loggedIn()); i++) await sleep(400);   // окно могло только что открыться
    if (!(await this.loggedIn())) throw new Error(`${s.name}: нужен вход - «Мозги» в панели, «Войти через Chrome»`);
    const want = chatId && s.chatUrl ? s.chatUrl(chatId) : (chatId && this.wc.getURL().includes(chatId) ? this.wc.getURL() : s.home);
    if (!this.wc.getURL().startsWith(want) || !chatId) { await this.wc.loadURL(want); await sleep(1500); }
    if (await this.captcha()) throw new Error(`${s.name}: проверка «не робот» - пройдите её во вкладке`);
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
      if (await this.captcha()) { this.onAttention(`${s.name}: проверка «не робот» - пройдите её во вкладке`); throw new Error(`${s.name}: проверка «не робот»`); }
      const r = (await readNow()) || { n: 0, t: '' };
      if (r.n <= before + (s.history ? 1 : 0) || !r.t) { if (Date.now() - t0 > 45000) throw new Error(`${s.name}: не начал отвечать (лимит, вход?)`); continue; }
      if (r.done) { last = r.t; break; }
      if (r.t !== last) { last = r.t; stableSince = Date.now(); continue; }
      if (Date.now() - stableSince > 3000) break;
    }
    if (!last) throw new Error(`${s.name}: пустой ответ`);
    return { answer: last, chatId: s.chatIdFrom(this.wc.getURL()) || chatId };
  }
}

module.exports = { WebChat, SITES };
