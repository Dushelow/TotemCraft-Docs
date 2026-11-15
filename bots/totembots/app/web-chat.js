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
    answers: '.ds-markdown',
  },
};

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
    const want = chatId ? s.chatUrl(chatId) : s.home;
    if (!this.wc.getURL().startsWith(want) || !chatId) { await this.wc.loadURL(want); await sleep(1500); }
    if (!(await this.loggedIn())) throw new Error(`${s.name}: нужен вход - войдите во вкладке «DeepSeek»`);
    if (await this.captcha()) throw new Error(`${s.name}: проверка «не робот» - пройдите её во вкладке`);
    // поле ввода
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await this.js(`!!document.querySelector(${JSON.stringify(s.input)})`).catch(() => false); if (!ok) await sleep(250); }
    if (!ok) throw new Error(`${s.name}: нет поля ввода (сайт изменился?)`);
    const before = await this.js(`document.querySelectorAll(${JSON.stringify(s.answers)}).length`).catch(() => 0);
    await this.js(`(() => {
      const ta = document.querySelector(${JSON.stringify(s.input)}); ta.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 1; })()`);
    await sleep(300);
    // отправить Enter (как человек)
    for (const type of ['keyDown', 'char', 'keyUp']) this.wc.sendInputEvent({ type, keyCode: 'Return' });
    // ответ: новое сообщение появилось и 2,5 с не меняется
    const t0 = Date.now();
    let last = '', stableSince = 0;
    while (Date.now() - t0 < 120000) {
      await sleep(500);
      if (await this.captcha()) { this.onAttention(`${s.name}: проверка «не робот» - пройдите её во вкладке`); throw new Error(`${s.name}: проверка «не робот»`); }
      const r = await this.js(`(() => { const a = document.querySelectorAll(${JSON.stringify(s.answers)}); return { n: a.length, t: a.length ? a[a.length - 1].innerText : '' }; })()`).catch(() => ({ n: 0, t: '' }));
      if (r.n <= before || !r.t) { if (Date.now() - t0 > 45000) throw new Error(`${s.name}: не начал отвечать (лимит, вход?)`); continue; }
      if (r.t !== last) { last = r.t; stableSince = Date.now(); continue; }
      if (Date.now() - stableSince > 2500) break;
    }
    if (!last) throw new Error(`${s.name}: пустой ответ`);
    return { answer: last, chatId: s.chatIdFrom(this.wc.getURL()) || chatId };
  }
}

module.exports = { WebChat, SITES };
