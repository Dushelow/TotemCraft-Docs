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

// Помощник в странице сайта (вставляется в каждый вызов): поиск поля, кнопки отправки, ответа, признака «ещё пишет».
const HELP = `if (!window.__tb || window.__tb.v !== 5) window.__tb = (() => {
  const vis = (e) => { if (!e || !e.getBoundingClientRect) return false; const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const norm = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  const label = (b) => [b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-testid'), b.id, String(b.className && b.className.baseVal !== undefined ? b.className.baseVal : b.className || ''), (b.innerText || '').slice(0, 40)].filter(Boolean).join(' ');
  const SEND = /send|submit|отправ|发送|送信/i, NOT_SEND = /attach|voice|micro|\\bmic|upload|file|файл|голос|search|поиск|stop|стоп|останов|cancel|отмен|model|модел|tool|инструм|plus|add/i;
  const enabled = (b) => b && vis(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !/(^|\\s)disabled(\\s|$)/.test(String(b.className || ''));
  const input = (sel) => { const all = [...document.querySelectorAll(sel)].filter((e) => !e.closest('[aria-hidden=true]')); return all.find(vis) || all[0] || null; };
  const sendBtn = (ta, sel) => {
    let box = ta;
    for (let i = 0; i < 8 && box; i++) {
      box = box.parentElement; if (!box) break;
      const bs = [...box.querySelectorAll('button, [role=button]' + (sel ? ', ' + sel : ''))];
      const hit = (sel ? bs.filter((b) => b.matches(sel)) : []).find(enabled) || bs.find((b) => enabled(b) && SEND.test(label(b)) && !NOT_SEND.test(label(b)));
      if (hit) return hit;
    }
    if (sel) { const b = [...document.querySelectorAll(sel)].find(enabled); if (b) return b; }
    return null;
  };
  // сайт ещё пишет: видна кнопка «стоп»
  const busy = () => [...document.querySelectorAll('button, [role=button]')].some((b) => vis(b) && /stop|останов|прервать|停止/i.test([b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-testid')].join(' ')));
  // вход не сделан: страница входа или окно входа поверх
  const loginWall = () => [...document.querySelectorAll('[class*=login-modal]')].some(vis) || /login|sign[-_]?in|signin|\\/auth/i.test(location.pathname) || [...document.querySelectorAll('[role=dialog], dialog[open]')].some((d) => vis(d) && /log ?in|sign ?in|войти|вход|continue with google/i.test((d.innerText || '').slice(0, 2000)));
  // видна кнопка «Войти» - вход не сделан (без входа часть сайтов пишет «войдите, чтобы продолжить» вместо ответа)
  const loginBtn = () => [...document.querySelectorAll('a, button, [role=button]')].some((b) => vis(b) && /^(log ?in|sign ?in|войти|вход|login|sign up|sign up free|зарегистрироваться)$/i.test(norm(b.innerText)));
  // служебные строки сайтов, которые не надо считать ответом (кнопки под сообщением, подписи)
  const UI = /^(copy|edit|share|retry|regenerate|like|dislike|good response|bad response|read aloud|more|sources?|копировать|изменить|поделиться|повторить|ещё|источники|\\d+ ?\\/ ?\\d+|\\d+(\\.\\d+)?s|thought for .{0,20}|думал.{0,20})$/i;
  const DISCLAIM = /can make mistakes|may (display|produce) inaccurate|check important|может ошибаться|проверяйте важн|AI-generated|сгенерировано ИИ/i;
  // ход мыслей модели (Z.ai «Thought Process», Gemini «Show thinking») - не ответ
  const THINK = '[class*=think], [class*=reason], [class*=thought], model-thoughts, details, .not-prose';
  const read = (sel, tail, inSel) => {
    let n = 0, t = '';
    if (sel) {
      const a = [...document.querySelectorAll(sel)].filter((e) => norm(e.innerText) && !e.closest(THINK));
      const inner = a.filter((e) => !a.some((o) => o !== e && e.contains(o)));
      n = inner.length; t = n ? inner[n - 1].innerText.trim() : '';
      if (tail && norm(t).includes(tail)) t = '';   // это наш вопрос, а не ответ
    }
    // запасной путь: текст страницы после нашего вопроса (без служебных строк)
    let after = '';
    const ta = inSel ? input(inSel) : null;
    if (tail && !(ta && norm(ta.value || ta.innerText))) {   // вопрос ещё в поле ввода - не ушёл, ответа нет
      const lines = ((document.querySelector('main') || document.body).innerText || '').split('\\n');
      let at = -1; for (let i = lines.length - 1; i >= 0; i--) if (norm(lines[i]).includes(tail)) { at = i; break; }
      if (at >= 0) {
        const rest = lines.slice(at + 1).map((x) => x.trimEnd()).filter((x) => norm(x) && !UI.test(norm(x)));
        while (rest.length && DISCLAIM.test(rest[rest.length - 1])) rest.pop();
        after = rest.join('\\n').trim();
      }
    }
    return { n, t, after, busy: busy(), done: false };
  };
  return { v: 5, vis, norm, label, input, sendBtn, busy, loginWall, loginBtn, read };
})();`;

// Остальные сайты - по общему образцу (28.11, владелец: «другие пока заглушки - приведи в рабочий вид»).
// Сайты часто меняют вёрстку, поэтому не держимся за одно название элемента:
// - поле ввода: первое видимое из списка;
// - отправка: кнопка рядом с полем по смыслу (aria-label/title/data-testid «send/submit/отправить»), потом по
//   названию сайта, иначе Enter;
// - ответ: последний ответ нейросети по названию сайта; не нашёлся - текст страницы после нашего вопроса;
// - готово: текст 3 с не меняется и нет кнопки «стоп» (сайт ещё пишет).
// chatId сайта = путь страницы чата («c/<id>»), так продолжаем тот же чат без знания устройства адресов сайта.
const GEN = (name, home, input, send, answers, extra = {}) => ({
  name, home, input, send, answers, insert: true, generic: true,
  chatUrl: (id) => new URL(home).origin + '/' + String(id).replace(/^\/+/, ''),
  chatIdFrom: (url) => { try { const p = new URL(url).pathname.replace(/^\/+|\/+$/g, ''); return /[0-9a-z][0-9a-z_-]{15,}$/i.test(p) ? p : ''; } catch { return ''; } },
  loggedIn: `(() => { ${HELP} return !!__tb.input(${JSON.stringify(input)}) && !__tb.loginWall() && !__tb.loginBtn(); })()`, ...extra,
});
Object.assign(SITES, {
  kimi: GEN('Kimi (сайт)', 'https://www.kimi.com/', '.chat-input-editor, div[contenteditable=true], textarea', '.send-button-container, .send-button, [class*=send-button]',
    '.segment-assistant .markdown, .chat-content-item-assistant .markdown, [class*=assistant] .markdown'),
  glm: GEN('Z.ai GLM (сайт)', 'https://chat.z.ai/', 'textarea#chat-input, textarea', 'button#send-message-button',
    '.chat-assistant .chat-markdown, .chat-assistant .markdown-prose, [class*=assistant] .markdown-prose'),
  mistral: GEN('Mistral (сайт)', 'https://chat.mistral.ai/chat', 'div.ProseMirror, textarea, div[contenteditable=true]', 'button[type=submit]',
    '[data-message-author-role=assistant] [data-message-part-type=answer], [data-message-author-role=assistant] .markdown-container-style, [data-message-author-role=assistant]'),
  grok: GEN('Grok (сайт)', 'https://grok.com/', 'div.tiptap.ProseMirror, textarea, div[contenteditable=true]', 'button[type=submit]',
    '.message-bubble:not(.bg-surface-l1) .response-content-markdown, .response-content-markdown'),
  chatgpt: GEN('ChatGPT (сайт)', 'https://chatgpt.com/', '#prompt-textarea, div.ProseMirror, textarea[name=prompt]', '#composer-submit-button, button[data-testid=send-button]',
    '[data-message-author-role=assistant] .markdown, [data-message-author-role=assistant]'),
  gemini: GEN('Gemini (сайт)', 'https://gemini.google.com/app', 'rich-textarea .ql-editor, div.ql-editor, div[contenteditable=true]', 'button.send-button',
    'model-response message-content .markdown, model-response .markdown, message-content .markdown'),
  // 28.11: lmarena.ai переехал на arena.ai, прямой чат с одной моделью - /text/direct
  arena: GEN('LMArena (сайт)', 'https://arena.ai/text/direct', 'div.tiptap.ProseMirror, textarea[name=message], textarea', 'button[type=submit]',
    '[data-sentry-component*=Assistant] .prose, [class*=assistant] .prose, .prose'),
  // 28.11: copilot.microsoft.com ведёт на copilot.com
  copilot: GEN('Copilot (сайт)', 'https://copilot.com/', 'textarea#userInput, textarea, div[contenteditable=true]', 'button[data-testid=submit-button]',
    '[data-content=ai-message], [class*=ai-message]'),
  // 28.11: HuggingChat (открытые модели, бесплатно), Perplexity (поиск с ответом), Poe (много моделей), Character AI
  // поле ввода у HuggingChat есть и без входа (вход просит только после «Start chatting», 28.11): вход = виден
  // свой аватар или выход из аккаунта. Со входом владельца **не проверено**
  hugging: GEN('HuggingChat (сайт)', 'https://huggingface.co/chat/', 'textarea, div[contenteditable=true]', 'button[aria-label="Send message"], button[name=submit]',
    '[data-message-role=assistant] .prose, [data-message-type=assistant] .prose, .prose',
    { loggedIn: `(() => { ${HELP} return !!__tb.input('textarea') && !__tb.loginWall() && !!document.querySelector('a[href*="logout"], form[action*="logout"], img[src*="avatars"]'); })()` }),
  perplexity: GEN('Perplexity (сайт)', 'https://www.perplexity.ai/', '#ask-input, textarea, div[contenteditable=true]', 'button[data-testid=submit-button], button[aria-label=Submit]',
    '[id^=markdown-content], .prose'),
  // у Poe номер чата короткий (chat/2xq9k...)
  poe: GEN('Poe (сайт)', 'https://poe.com/', 'textarea, div[contenteditable=true]', 'button[data-button-send=true], button[class*=sendButton]',
    '[class*=Message_botMessageBubble] [class*=Markdown], [class*=botMessageBubble], [class*=Markdown_markdownContainer]',
    { chatIdFrom: (url) => { try { const p = new URL(url).pathname.replace(/^\/+|\/+$/g, ''); return /^chat\/[0-9a-z]{6,}$/i.test(p) ? p : ''; } catch { return ''; } } }),
  // чат = персонаж (chat/<id персонажа>), продолжение того же разговора - тот же адрес
  characterai: GEN('Character AI (сайт)', 'https://character.ai/', 'textarea, div[contenteditable=true]', 'button[aria-label*=Send i], button[type=submit]',
    '[data-testid=completed-message] [class*=prose], [class*=swiper-no-swiping] p, [class*=prose]',
    { keepPage: /character\.ai\/chat\/[\w-]{10,}/ }),
});

const LOGIN_ASK = /sign (up|in) to continue|log ?in to continue|sign up to|войдите|войти, чтобы|зарегистрируйтесь|login required/i;

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
  // код в странице с помощником __tb (поле ввода, кнопка отправки, «пишет ли ещё»)
  tb(code) { return this.js(`(() => { ${HELP} ${code} })()`); }

  async captcha() {
    return this.js(`(() => { const t = (document.body && document.body.innerText || '').slice(0, 20000);
      return /slide to verify|drag the slider|verify you are human|подтвердите, что вы человек|cloudflare/i.test(t) || !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"]'); })()`).catch(() => false)
  }

  // TB_WEB_ANON=1 - для проверки разработчиком без своих аккаунтов: «вошёл» = есть поле ввода (часть сайтов отвечает и так)
  async loggedIn() { return (process.env.TB_WEB_ANON && this.site.generic ? this.tb(`return !!__tb.input(${JSON.stringify(this.site.input)}) && !__tb.loginWall();`) : this.js(this.site.loggedIn)).catch(() => false); }

  ask(chatId, text) { return this.exclusive(() => this._ask(chatId, text)); }

  async _ask(chatId, text) {
    const gap = 4000 - (Date.now() - (this.lastSend || 0));
    if (gap > 0) await sleep(gap);
    this.lastSend = Date.now();
    this._r1 = this._r2 = false;
    const s = this.site, IN = JSON.stringify(s.input), SEND = JSON.stringify(s.send || ''), ANS = JSON.stringify(s.answers || '');
    // окно открыто у владельца (вход, своё) или вход не сделан - страницу не трогаем вообще
    // владелец печатает в этом окне (поле в фокусе и не пустое) - подождать, а не отказывать
    for (let i = 0; i < 30 && this.inUse && this.inUse() && await this.js(`(() => { const t = document.activeElement; return !!(t && (t.value || t.innerText || '').trim() && /TEXTAREA|DIV/.test(t.tagName)); })()`).catch(() => false); i++) await sleep(1000);
    for (let i = 0; i < 40 && !(await this.loggedIn()); i++) await sleep(400);   // окно могло только что открыться
    if (!(await this.loggedIn())) throw new Error(`${s.name}: нужен вход - «Мозги» в панели, «Войти через браузер»`);
    // Character AI: нового чата «вообще» нет, только с выбранным персонажем - остаёмся в его чате, открытом владельцем
    const keep = !chatId && s.keepPage && s.keepPage.test(this.wc.getURL());
    if (!chatId && s.keepPage && !keep) throw new Error(`${s.name}: откройте во вкладке чат с персонажем (свой или готовый), бот будет писать туда`);
    const want = chatId && s.chatUrl ? s.chatUrl(chatId) : s.home;
    if (!keep && (!chatId || !this.wc.getURL().startsWith(want))) { await this.wc.loadURL(want); await sleep(1500); }
    if (await this.captcha()) { this.onAttention(`${s.name}: проверка «не робот» - пройдите её во вкладке, жду до 3 мин`); let ok = false; for (let w = 0; w < 90; w++) { await sleep(2000); if (!(await this.captcha().catch(() => false))) { ok = true; break; } } if (!ok) { await this.js(LOCK_OFF).catch(() => {}); throw new Error(`${s.name}: проверка «не робот» не пройдена за 3 мин`); } }
    // приветственное окно поверх чата (HuggingChat «Start chatting», 28.11) - закрыть, как закрыл бы человек
    if (s.generic) await this.tb(`const d = [...document.querySelectorAll('[role=dialog], dialog[open], [class*=modal]')].filter(__tb.vis);
      for (const x of d) { const b = [...x.querySelectorAll('button')].find((b) => __tb.vis(b) && /^(start chatting|get started|got it|continue|okay|ok|понятно|начать)$/i.test(__tb.norm(b.innerText))); if (b) { b.click(); return 1; } }
      return 0;`).then((n) => n && sleep(800)).catch(() => {});
    // поле ввода
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await this.tb(`return !!__tb.input(${IN});`).catch(() => false); if (!ok) await sleep(250); }
    if (!ok && await this.tb('return __tb.loginWall() || __tb.loginBtn();').catch(() => false)) throw new Error(`${s.name}: сайт просит войти - «Мозги» в панели, «Войти через браузер»`);
    if (!ok) throw new Error(`${s.name}: нет поля ввода (сайт изменился?)`);
    // хвост вопроса - по нему ищем ответ на странице, если ответ не нашёлся по названию элемента
    const tail = (String(text).split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).pop() || '').slice(-40);
    const readNow = () => (s.history ? this.js(s.history) : this.tb(`return __tb.read(${ANS}, ${JSON.stringify(tail)}, ${IN});`)).catch(() => null);
    const before = s.history ? (chatId ? ((await readNow()) || { n: 0 }).n : 0) : ((await readNow()) || { n: 0 }).n;
    await this.tb(`const ta = __tb.input(${IN}); ta.focus();
      if (${!!s.insert} || ta.tagName !== 'TEXTAREA') { document.execCommand('selectAll', false); document.execCommand('insertText', false, ${JSON.stringify(text)}); }
      else { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;`);
    await sleep(400);
    // отправить кнопкой (Enter в скрытое окно не всегда доходит); кнопка не нашлась - Enter
    const sendNow = () => this.tb(`const ta = __tb.input(${IN}); if (!ta) return '';
      const b = __tb.sendBtn(ta, ${SEND});
      if (b) { b.click(); return 'кнопка'; }
      ta.focus(); for (const t of ['keydown', 'keypress', 'keyup']) ta.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return 'enter';`).catch(() => '');
    const how = await sendNow();
    if (!how) throw new Error(`${s.name}: нет поля ввода (сайт изменился?)`);
    // поле не очистилось - не ушло: настоящее нажатие Enter (окно в фокусе страницы)
    const leftText = () => this.tb(`const ta = __tb.input(${IN}); return ta ? (ta.value || ta.innerText || '').trim().length : 0;`).catch(() => 0);
    await sleep(1200);
    if ((await leftText()) > 0) {
      try { this.wc.focus(); await this.tb(`const ta = __tb.input(${IN}); if (ta) ta.focus(); return 1;`); for (const type of ['keyDown', 'char', 'keyUp']) this.wc.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' }); } catch {}
      await sleep(800);
    }
    // ответ: новое сообщение появилось, 3 с не меняется и сайт больше не пишет (нет кнопки «стоп»)
    const t0 = Date.now();
    let last = '', stableSince = 0;
    while (Date.now() - t0 < 180000) {
      await sleep(500);
      if (await this.captcha()) { await this.js(LOCK_OFF).catch(() => {}); this.onAttention(`${s.name}: проверка «не робот» - пройдите её во вкладке`); throw new Error(`${s.name}: проверка «не робот»`); }
      const r = (await readNow()) || { n: 0, t: '' };
      // сайт просит не частить («Messages too frequent. Try again later», DeepSeek 23.11) - не жать «повтор», а отдохнуть
      if (Date.now() - t0 > 1500 && Date.now() - (this._freqChk || 0) > 2000) {
        this._freqChk = Date.now();
        const freq = await this.js(`(() => /too frequent|try again later|слишком часто|请稍后|频繁|rate limit|usage limit|limit reached|reached (your|the) .{0,20}limit|лимит/i.test(document.body.innerText.slice(-4000)))()`).catch(() => false);
        if (freq && !(r.t && r.n > before)) throw new Error(`${s.name}: лимит или слишком частые сообщения (rate limit) - подождать`);
      }
      // ответ по названию элемента (новый, после нашего вопроса), иначе - текст после вопроса
      const got = s.history ? (r.n > before + 1 ? r.t : '') : (r.n > before && r.t ? r.t : r.after || '');
      // вместо ответа сайт просит войти (Grok без входа: «Sign up to continue», 28.11)
      if (got && got.length < 400 && LOGIN_ASK.test(got)) throw new Error(`${s.name}: сайт просит войти - «Мозги» в панели, «Войти через браузер»`);
      if (!got) {
        // не ушло или сайт показал ошибку - как человек: нажать «повторить», а если сообщения нет совсем - отправить
        // ещё раз; на 12-й и 30-й секунде
        const el = Date.now() - t0;
        // после отправки сайт открыл окно входа (Kimi без входа, 28.11) - ждать нечего
        if (el > 2500 && s.generic && await this.tb('return __tb.loginWall();').catch(() => false)) throw new Error(`${s.name}: сайт просит войти - «Мозги» в панели, «Войти через браузер»`);
        if ((el > 12000 && !this._r1) || (el > 30000 && !this._r2)) {
          if (el > 30000) this._r2 = true; else this._r1 = true;
          const how2 = await this.tb(`
            const re = /retry|regenerate|resend|try again|повтор|ещё раз|重试|重新/i;
            const btn = [...document.querySelectorAll('button, [role=button], .ds-icon-button')].reverse().find((b) => __tb.vis(b) && re.test(__tb.label(b)));
            if (btn) { btn.click(); return 'повтор'; }
            const ta = __tb.input(${IN});
            if (ta && (ta.value || ta.innerText || '').trim()) { const b = __tb.sendBtn(ta, ${SEND}); if (b) { b.click(); return 'отправил снова'; } }
            return '';`).catch(() => '');
          if (how2) this.onAttention(`${s.name}: сообщение не ушло - ${how2}`);
        }
        if (el > 60000) throw new Error(`${s.name}: не начал отвечать`);
        continue;
      }
      if (r.done) { last = got; break; }
      if (got !== last) { last = got; stableSince = Date.now(); continue; }
      if (Date.now() - stableSince > 3000 && !r.busy) break;
      if (Date.now() - stableSince > 30000) break;   // «стоп» висит, а текст 30 с не меняется - хватит
    }
    last = String(last || '').trim();
    if (!last) throw new Error(`${s.name}: пустой ответ`);
    return { answer: last, chatId: s.chatIdFrom(this.wc.getURL()) || chatId };
  }
}

module.exports = { WebChat, SITES, HELP };
