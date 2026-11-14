// Мост к chat.qwen.ai внутри окна программы (по образцу тренажёра naparnik/trainer).
// В страницу ставится перехват fetch: ответ берётся из потока /api/chat/completions (копия, страница читает как обычно).
// Сообщение вписывается в поле и отправляется кнопкой. Запросы всех ботов идут строго по очереди: вкладка Qwen одна.
const ORIGIN = 'https://chat.qwen.ai';

// Код в мире страницы: перехват потока ответа. Итоги кладёт в window.__tb.done[rid].
const HOOK = `(() => {
  if (window.__tb) return true;
  const tb = window.__tb = { rid: 0, done: {} };
  const parse = (text, incremental) => {
    let answer = '', error = '';
    for (const raw of text.split('\\n')) {
      const l = raw.replace(/\\r$/, '');
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch (e) { continue; }
      if (j.error) error = String(j.error.message || j.error.code || 'ошибка');
      if (j.success === false && j.data) error = String(j.data.message || j.data.code || 'ошибка Qwen');
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (!d || typeof d.content !== 'string') continue;
      const phase = d.phase || (d.role === 'assistant' ? 'answer' : '');
      if (phase !== 'answer') continue;
      answer = incremental ? answer + d.content : (d.content || answer);
    }
    return { answer, error };
  };
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const p = orig.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      if (!/\\/api\\/(v2\\/)?chat\\/completions$/.test(new URL(url, location.href).pathname)) return p;
      let incremental = true;
      try { const b = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; if (b && b.incremental_output === false) incremental = false; } catch (e) {}
      const rid = ++tb.rid;
      p.then(async (res) => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/event-stream') || !res.body) {
          let msg = 'HTTP ' + res.status;
          try { const j = await res.clone().json(); msg = (j.data && (j.data.message || j.data.code)) || j.message || msg; } catch (e) {}
          tb.done[rid] = { answer: '', error: 'Qwen не дал ответ: ' + msg };
          return;
        }
        const text = await res.clone().text();
        tb.done[rid] = parse(text, incremental);
      }).catch((e) => { tb.done[rid] = { answer: '', error: 'обрыв ответа Qwen: ' + (e && e.message || e) }; });
    } catch (e) {}
    return p;
  };
  return true;
})()`;

// Вписать текст и нажать «Отправить». Возвращает номер запроса, после которого ждать ответ.
const SEND = (text) => `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el) => { for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true })); };
  // выбор «какой ответ лучше», оставшийся с прошлого раза, держит чат
  const ab = [...document.querySelectorAll('button')].find((b) => /предпочитаю этот ответ|prefer this (response|answer)/i.test(b.textContent));
  if (ab) { ab.click(); await pause(500); }
  let ta;
  for (let i = 0; i < 60 && !(ta = document.querySelector('textarea.message-input-textarea')); i++) await pause(250);
  if (!ta) return { error: 'не нашёл поле ввода в Qwen (вход? окно поверх?)' };
  const before = window.__tb.rid;
  ta.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  let btn;
  for (let i = 0; i < 80; i++) {
    btn = document.querySelector('button.send-button');
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') break;
    btn = null; await pause(250);
  }
  if (!btn) return { error: 'кнопка отправки в Qwen не появилась (Qwen ещё отвечает?)' };
  fire(btn);
  for (let i = 0; i < 12 && ta.isConnected && ta.value; i++) await pause(250);
  if (ta.isConnected && ta.value) {
    for (const t of ['keydown','keypress','keyup']) ta.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    for (let i = 0; i < 12 && ta.isConnected && ta.value; i++) await pause(250);
  }
  if (ta.isConnected && ta.value) {
    const age = [...document.querySelectorAll('div, h1, h2, h3, p, span')].some((n) => n.childElementCount === 0 && n.textContent.length < 80
      && /confirm your age|verify your age|подтвердите свой возраст/i.test(n.textContent) && n.getBoundingClientRect().width > 0);
    return age ? { age: true } : { error: 'Qwen не принял сообщение (загляните в окно Qwen)' };
  }
  return { rid: before };
})()`;

// Окно «Confirm your age»: выбрать год рождения, который владелец сам вписал в настройках, и нажать Continue.
const AGE = (year) => `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el) => { for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true })); };
  const title = [...document.querySelectorAll('div, h1, h2, h3, p, span')].find((n) => n.childElementCount === 0
    && /confirm your age|verify your age|подтвердите свой возраст/i.test(n.textContent) && n.getBoundingClientRect().width > 0);
  if (!title) return 'нет окна';
  let box = title;
  while (box.parentElement && !box.querySelector('button')) box = box.parentElement;
  const y = ${JSON.stringify(String(year))};
  const sel = box.querySelector('select');
  if (sel) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, y);
    sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const shown = [...box.querySelectorAll('*')].find((n) => n.childElementCount === 0 && /^\\d{4}$/.test(n.textContent.trim()));
    if (shown && shown.textContent.trim() !== y) {
      fire(shown.closest('[role=combobox], button, [class*=select]') || shown);
      await pause(500);
      const opt = [...document.querySelectorAll('[role=option], li, div')].find((n) => n.childElementCount === 0 && n.textContent.trim() === y);
      if (!opt) return 'не нашёл год в списке';
      opt.scrollIntoView({ block: 'center' }); fire(opt); await pause(400);
    }
  }
  const btn = [...box.querySelectorAll('button')].find((b) => /continue|продолжить|подтвердить|confirm/i.test(b.textContent));
  if (!btn) return 'не нашёл кнопку';
  fire(btn); await pause(1000);
  return 'ok';
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QwenBridge {
  constructor(webContents, log = () => {}) {
    this.wc = webContents;
    this.log = log;
    this.onAttention = () => {};
    this.birthYear = () => '';
    this.chain = Promise.resolve();
    this.wc.on('dom-ready', () => this.hook().catch(() => {}));
  }

  hook() { return this.wc.executeJavaScript(HOOK); }

  currentChat() {
    const m = /^https:\/\/chat\.qwen\.ai\/c\/([A-Za-z0-9_-]+)/.exec(this.wc.getURL());
    return m ? m[1] : '';
  }

  async open(chatId) {
    const want = chatId ? `${ORIGIN}/c/${chatId}` : `${ORIGIN}/`;
    if (chatId && this.currentChat() === chatId) return;
    await this.wc.loadURL(want);
    await this.hook();
    await sleep(1500);
  }

  /**
   * Отправить text в чат chatId ('' - новый чат). Возвращает { answer, chatId }.
   * Запросы выстраиваются в очередь.
   */
  ask(chatId, text) {
    const run = () => this._ask(chatId, text);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _ask(chatId, text) {
    await this.open(chatId);
    await this.hook();
    let sent = await this.wc.executeJavaScript(SEND(text));
    // Qwen спрашивает возраст: отвечает сам владелец в окне справа, ждём до 10 минут и отправляем снова
    for (let i = 0; sent.age && i < 120; i++) {
      const year = this.birthYear();
      if (year && i < 3) {
        const r = await this.wc.executeJavaScript(AGE(year)).catch((e) => String(e));
        this.onAttention('Qwen спросил возраст, ответил годом из настроек: ' + r);
      } else if (i === 0 || i === 3) {
        this.onAttention('Qwen просит подтвердить возраст: ответьте в окне Qwen справа или впишите год рождения в настройках');
      }
      await sleep(5000);
      sent = await this.wc.executeJavaScript(SEND(text));
    }
    if (sent.age) throw new Error('Qwen ждёт подтверждения возраста');
    if (sent.error) throw new Error(sent.error);
    const until = Date.now() + 4 * 60 * 1000;
    let started = false;
    while (Date.now() < until) {
      await sleep(400);
      const r = await this.wc.executeJavaScript(
        `(() => { const tb = window.__tb; if (!tb) return null; const k = Object.keys(tb.done).map(Number).filter((n) => n > ${sent.rid}).sort((a,b)=>a-b)[0]; return { started: tb.rid > ${sent.rid}, done: k ? tb.done[k] : null }; })()`
      ).catch(() => null);
      if (!r) continue;
      if (r.started) started = true;
      if (!started && Date.now() > until - 4 * 60 * 1000 + 30000) throw new Error('Qwen не начал отвечать (вход, капча, лимит?)');
      if (r.done) {
        if (r.done.error && !r.done.answer) throw new Error(r.done.error);
        // новый чат получает адрес после первого ответа
        let id = this.currentChat();
        for (let i = 0; i < 20 && !id; i++) { await sleep(250); id = this.currentChat(); }
        return { answer: r.done.answer, chatId: id || chatId };
      }
    }
    throw new Error('Qwen отвечает дольше 4 минут');
  }
}

module.exports = { QwenBridge };
