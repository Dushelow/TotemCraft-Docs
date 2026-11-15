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
  // окно целиком: поднимаемся, пока внутри не окажется именно кнопка «Continue» (а не крестик в шапке)
  const isGo = (b) => /continue|продолжить|подтвердить|confirm/i.test(b.textContent);
  let box = title;
  while (box.parentElement && ![...box.querySelectorAll('button')].some(isGo)) box = box.parentElement;
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
  const btn = [...box.querySelectorAll('button')].find(isGo);
  if (!btn) return 'не нашёл кнопку';
  fire(btn); await pause(1000);
  return 'ok';
})()`;

// Модель и режим («Быстро», «Авто», «Мышление») - настоящим меню Qwen, как в тренажёре naparnik/trainer.
// Пусто - не трогать. Возвращает, что выбрано на странице.
const PICK = (model, mode) => `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el) => { for (const t of ['pointerover','mouseover','pointerenter','mouseenter','pointerdown','mousedown','pointerup','mouseup','click'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: !/enter/.test(t), cancelable: true })); };
  const model = ${JSON.stringify(model || '')}, mode = ${JSON.stringify(mode || '')};
  const MODES = { auto: /^(авто|auto)/i, think: /^(мышление|think)/i, fast: /^(быстр|fast)/i };
  const modelNow = () => { const t = document.querySelector('[aria-label="Select Model"]'); return t ? t.textContent.trim() : ''; };
  const modeNow = () => { const l = document.querySelector('.qwen-thinking-selector .qwen-chat-v2-dropdown-menu-select-label'); return l ? l.textContent.trim() : ''; };
  let found = true;
  try {
    const trigger = document.querySelector('[aria-label="Select Model"]');
    if (model && trigger && trigger.textContent.trim().toLowerCase() !== model.toLowerCase()) {
      fire(trigger); await pause(400);
      const find = () => [...document.querySelectorAll('.wms-list__item')].find((n) => String((n.querySelector('.wms-list__name-text') || n.querySelector('.wms-list__name-info') || {}).textContent).trim().toLowerCase() === model.toLowerCase());
      const more = document.querySelector('.wms-more-entry__content');
      if (!find() && more) { fire(more); await pause(800); }
      const item = find();
      if (item) { fire(item); await pause(500); } else { found = false; fire(trigger); }
    }
    const rx = MODES[mode], mt = document.querySelector('.qwen-thinking-selector .qwen-chat-v2-dropdown-menu-select');
    if (rx && mt && !rx.test(modeNow())) {
      fire(mt); await pause(400);
      const it = [...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item')].find((n) => rx.test(n.textContent.trim()));
      if (it) { fire(it); await pause(400); } else fire(mt);
    }
  } catch (e) {}
  return { model: modelNow(), mode: modeNow(), found };
})()`;

// Ошибки, после которых пробуем следующую модель из списка
const LIMIT = /limit|лимит|quota|too many|429|exceed|unavailable|недоступ|rate/i;
const LIMIT_TEXT = /reached (today's|your|the) (chat |daily |usage )?limit|upgrade your (membership|plan)|chat limit|daily limit|limit reached|лимит (сообщений|чатов|на сегодня)|исчерпан/i;

// Qwen иногда отвечает двумя вариантами («Which response do you prefer?») и ждёт выбора: поток тогда содержит оба
// вперемешку. Берём текст первой карточки со страницы (реплика + JSON из блока кода) и выбираем её.
const AB = `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')].filter((b) => /prefer this (response|answer)|предпочитаю этот ответ/i.test(b.textContent));
  for (let i = 0; i < 6 && btns().length < 2; i++) await pause(250);
  const [a, b] = btns();
  if (!a || !b) return null;
  let card = a;
  while (card.parentElement && !card.parentElement.contains(b)) card = card.parentElement;
  let text = '';
  for (let i = 0; i < 12; i++) {   // страница дорисовывает текст после конца потока
    await pause(250);
    const now = card.innerText;
    if (now === text && text) break;
    text = now;
  }
  a.click();
  return text;
})()`;

// Текст карточки → обычный ответ: реплика строками до блока кода, JSON - от первой { до последней }.
function abToAnswer(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(response|ответ)\s*\d$/i.test(l) && !/prefer this|предпочитаю этот/i.test(l));
  const all = lines.join('\n');
  const a = all.indexOf('{'), b = all.lastIndexOf('}');
  const json = a >= 0 && b > a ? all.slice(a, b + 1).replace(/\n\d+\n/g, '\n') : '';
  const say = lines.filter((l) => !/^(json|\d+)$/i.test(l) && l.indexOf('{') < 0 && l.indexOf('}') < 0).join(' ');
  return (say ? say + '\n' : '') + (json ? '```json\n' + json + '\n```' : '');
}

// Заглушка поверх Qwen, пока программа сама работает в окне (пара секунд): щелчки и клавиши владельца не попадают
// в поле ввода и меню. Наши действия идут мимо неё: скрипты вызывают события прямо на элементах, а перед настоящим
// щелчком отладчиком заглушка на миг прячется.
const BUSY_ON = `(() => {
  let o = document.getElementById('tb-busy');
  if (!o) {
    o = document.createElement('div'); o.id = 'tb-busy'; o.tabIndex = -1;
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(20,20,24,.18);cursor:progress;display:flex;align-items:flex-end;justify-content:center;outline:none';
    o.innerHTML = '<div style="margin-bottom:18px;padding:6px 14px;border-radius:8px;background:#2b2d31;color:#e6e6e6;font:13px Segoe UI,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)">Бот работает с Qwen, подождите пару секунд</div>';
    for (const t of ['mousedown','mouseup','click','dblclick','wheel','contextmenu','keydown','keypress','keyup'])
      o.addEventListener(t, (e) => { if (e.isTrusted && !window.__tbPass) { e.preventDefault(); e.stopPropagation(); } }, true);
    document.documentElement.appendChild(o);
  }
  if (!window.__tbKeys) {   // клавиши владельца не уходят в поле ввода, пока заглушка на месте
    window.__tbKeys = true;
    for (const t of ['keydown', 'keypress', 'keyup', 'paste'])
      window.addEventListener(t, (e) => { if (e.isTrusted && document.getElementById('tb-busy') && !window.__tbPass) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }
  o.style.display = 'flex';
  if (document.activeElement && document.activeElement !== o) document.activeElement.blur();
  o.focus();
  return 1;
})()`;
const BUSY_OFF = `(() => { const o = document.getElementById('tb-busy'); if (o) o.remove(); return 1; })()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QwenBridge {
  constructor(webContents, log = () => {}) {
    this.wc = webContents;
    this.log = log;
    this.onAttention = () => {};
    this.birthYear = () => '';
    this.projectId = () => '';   // новые чаты - внутри проекта Qwen
    this.beforeNewChat = async () => {};   // убедиться, что проект есть
    this.chain = Promise.resolve();
    this.busy = 0;
    this.ageConfirmed = false;
    this.wc.on('dom-ready', () => {
      this.hook().catch(() => {});
      if (this.busy) this.wc.executeJavaScript(BUSY_ON).catch(() => {});
      this.watchAge();
    });
    this.wc.on('did-navigate-in-page', () => this.watchAge());
  }

  // Окно возраста Qwen показывает после запуска, при открытии чата; после одного подтверждения - до перезапуска нет.
  // Поэтому смотрим 30 с после каждого перехода, пока не подтвердили; дальше не тратим силы. Запасная проверка - при отправке.
  watchAge() {
    if (this.ageConfirmed || this.ageWatch) return;
    const until = Date.now() + 30000;
    this.ageWatch = setInterval(async () => {
      if (this.ageConfirmed || Date.now() > until || this.wc.isDestroyed()) { clearInterval(this.ageWatch); this.ageWatch = null; return; }
      await this.checkAge().catch(() => {});
    }, 2000);
  }

  async checkAge() {
    const year = this.birthYear();
    if (!year || this.wc.isDestroyed()) return;
    const r = await this.wc.executeJavaScript(AGE(year));
    if (r === 'нет окна') return;
    if (r === 'ok') this.ageConfirmed = true;
    this.onAttention('Qwen спросил возраст, ответил годом из настроек: ' + r);
  }


  /** Настоящий щелчок отладчиком (некоторые кнопки Qwen не реагируют на события из скрипта), сквозь заглушку. */
  async clickTrusted(expr) {
    this.attachDebugger();
    const b = await this.wc.executeJavaScript(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`).catch(() => null);
    if (!b) return false;
    await this.passThrough(true);
    try {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
    } finally { await this.passThrough(false); }
    return true;
  }

  /**
   * Распознать речь (PCM 48 кГц моно 16 бит) голосовым вводом Qwen: вместо микрофона странице подаётся этот звук.
   * Сообщение не отправляется: текст берётся из поля ввода, поле очищается. В общей очереди с вопросами.
   */
  transcribe(pcm) { return this.exclusive(() => this._transcribe(pcm)); }

  async _transcribe(pcm) {
    const dur = pcm.length / 2 / 48000;
    if (dur < 0.3) return '';
    const hasInput = await this.wc.executeJavaScript(`!!document.querySelector('[aria-label="Voice Input"]')`).catch(() => false);
    if (!hasInput) { await this.wc.loadURL(`${ORIGIN}/`); await this.hook(); for (let i = 0; i < 40; i++) { if (await this.wc.executeJavaScript(`!!document.querySelector('[aria-label="Voice Input"]')`).catch(() => false)) break; await sleep(250); } }
    await this.wc.executeJavaScript(`(() => {
      const raw = atob(${JSON.stringify(pcm.toString('base64'))}); const n = raw.length >> 1; const f = new Float32Array(n);
      for (let i = 0; i < n; i++) { let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; f[i] = v / 32768; }
      const ta = document.querySelector('textarea.message-input-textarea');
      window.__tbKeep = ta ? ta.value : '';
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext({ sampleRate: 48000 });
        const buf = ctx.createBuffer(1, f.length, 48000); buf.getChannelData(0).set(f);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const dst = ctx.createMediaStreamDestination(); src.connect(dst);
        setTimeout(() => src.start(), 300);
        return dst.stream;
      };
      return 1;
    })()`);
    if (!await this.clickTrusted(`document.querySelector('[aria-label="Voice Input"]')`)) throw new Error('нет кнопки голосового ввода Qwen');
    await sleep(dur * 1000 + 900);
    await this.clickTrusted(`document.querySelector('.button-confirm, [aria-label="Confirm"]')`);
    let text = '';
    for (let i = 0; i < 40 && !text; i++) {
      await sleep(250);
      text = await this.wc.executeJavaScript(`(() => { const ta = document.querySelector('textarea.message-input-textarea'); const v = ta ? ta.value : ''; return v && v !== window.__tbKeep ? v.slice((window.__tbKeep || '').length).trim() : ''; })()`).catch(() => '');
    }
    // поле - как было (распознанное не отправляем)
    await this.wc.executeJavaScript(`(() => { const ta = document.querySelector('textarea.message-input-textarea'); if (ta) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, window.__tbKeep || ''); ta.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`).catch(() => {});
    return text;
  }

  /** Всё, что программа делает в окне Qwen, - по очереди и под заглушкой. */
  exclusive(fn) {
    const run = async () => {
      this.busy++;
      await this.wc.executeJavaScript(BUSY_ON).catch(() => {});
      try { return await fn(); } finally {
        if (--this.busy === 0) await this.wc.executeJavaScript(BUSY_OFF).catch(() => {});
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Перед настоящим щелчком отладчиком - пропустить его сквозь заглушку. */
  passThrough(on) { return this.wc.executeJavaScript(`window.__tbPass = ${on ? 'true' : 'false'}; (() => { const o = document.getElementById('tb-busy'); if (o) o.style.pointerEvents = ${on ? "'none'" : "'auto'"}; })()`).catch(() => {}); }

  hook() { return this.wc.executeJavaScript(HOOK); }

  /** Текст текущего (выбранного) ответа в чате - из истории Qwen, тем же запросом, что делает страница. */
  /** Ответ Qwen на наше сообщение по истории чата: готов ли и что в нём (сообщение не старше sentAt). */
  async historyAnswer(chatId, sentAt) {
    if (!chatId) return null;
    return this.wc.executeJavaScript(`(async () => {
      const r = await fetch('/api/v2/chats/${chatId}', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      const d = (await r.json()).data; if (!d) return null;
      const m = d.chat.history.messages[d.currentId];
      if (!m || m.role !== 'assistant' || (m.timestamp || 0) * 1000 < ${sentAt} - 5000) return null;
      const parts = (m.content_list || []).filter((x) => x.phase === 'answer');
      const finished = m.done === true || parts.some((x) => x.status === 'finished');
      return { done: finished, text: parts.map((x) => x.content).join('') || m.content || '' };
    })()`).catch(() => null);
  }

  async lastAnswer(chatId) {
    return this.wc.executeJavaScript(`(async () => {
      const r = await fetch('/api/v2/chats/${chatId}', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      const d = (await r.json()).data; if (!d) return '';
      const m = d.chat.history.messages[d.currentId]; if (!m) return '';
      const parts = (m.content_list || []).filter((x) => x.phase === 'answer').map((x) => x.content);
      return parts.join('') || m.content || '';
    })()`);
  }

  // Озвучка ответа кнопкой Qwen «Read aloud». Звук берём из сети отладчиком Electron: страница шлёт запрос
  // /api/v2/tts/completions со своими подписями, мы его не подделываем, а только читаем ответ (поток base64 PCM).
  // Сама страница звук не играет: вкладка Qwen заглушена, играем мы, куда нужно.
  attachDebugger() {
    if (this.dbg) return;
    const d = this.wc.debugger;
    try { d.attach('1.3'); } catch (e) { if (!/already attached/i.test(e.message)) throw e; }
    this.dbg = d;
    this.tts = new Map();   // requestId -> resolve
    d.on('message', async (_e, method, params) => {
      if (method === 'Network.requestWillBeSent' && /\/api\/v2\/tts\/completions/.test(params.request.url)) {
        this.ttsReq = params.requestId;
      }
      if (method === 'Network.loadingFinished' && params.requestId === this.ttsReq && this.ttsWait) {
        try {
          const b = await d.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body;
          const parts = [];
          for (const l of text.split('\n')) { const m = /"tts":\s*"([^"]*)"/.exec(l); if (m && m[1]) parts.push(Buffer.from(m[1], 'base64')); }
          this.ttsWait.ok(Buffer.concat(parts));
        } catch (e) { this.ttsWait.fail(e); }
      }
    });
    d.sendCommand('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 100e6 });
    this.wc.setAudioMuted(true);
  }

  /** Прочитать вслух последний ответ в открытом чате. Возвращает { pcm, rate: 24000 }. В общей очереди с вопросами. */
  readAloud(chatId) { return this.exclusive(() => this._readAloud(chatId)); }

  async _readAloud(chatId) {
    this.attachDebugger();
    await this.open(chatId);
    const got = new Promise((ok, fail) => { this.ttsWait = { ok, fail }; setTimeout(() => fail(new Error('Qwen не дал звук за 30 с')), 30000); });
    const clicked = await this.wc.executeJavaScript(`(async () => {
      const fire = (el) => { for (const t of ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click'])
        el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true })); };
      const more = [...document.querySelectorAll('[aria-label="More actions"]')].pop();
      if (!more) return 'нет кнопки «More actions»';
      fire(more); await new Promise((r) => setTimeout(r, 600));
      const it = [...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item')].find((n) => /read aloud|прочитать|озвуч/i.test(n.textContent));
      if (!it) { fire(more); return 'нет пункта «Read aloud»'; }
      fire(it); return 'ok';
    })()`);
    if (clicked !== 'ok') { this.ttsWait = null; throw new Error(clicked); }
    try { return { pcm: await got, rate: 24000 }; } finally { this.ttsWait = null; }
  }

  currentChat() {
    // только настоящий номер чата: при создании адрес на миг бывает /c/new-chat (его принимали за номер - стенд 15.11)
    const m = /^https:\/\/chat\.qwen\.ai\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(this.wc.getURL());
    return m ? m[1] : '';
  }

  async open(chatId) {
    const pid = (this.noProjectUntil || 0) > Date.now() ? '' : this.projectId();
    const want = chatId ? `${ORIGIN}/c/${chatId}` : pid ? `${ORIGIN}/p/${pid}` : `${ORIGIN}/`;
    // после ошибки страница Qwen бывает в сломанном состоянии (PARENT_NOT_FOUND на каждое следующее сообщение) - перезагрузить
    if (chatId && this.currentChat() === chatId && !this.needReload) return;
    this.needReload = false;
    await this.wc.loadURL(want);
    await this.hook();
    // ждать готовности страницы, а не фиксированное время: страница проекта через 1,5 с ещё пустая (модель не выбрана),
    // и отправленное туда сообщение молча пропадало - бот молчал (15.11)
    for (let i = 0; i < 60; i++) {
      const ready = await this.wc.executeJavaScript(`(() => { const m = document.querySelector('[aria-label="Select Model"]');
        return !!(document.querySelector('textarea.message-input-textarea') && m && m.textContent.trim()); })()`).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    await sleep(700);
  }

  /**
   * Отправить text в чат chatId ('' - новый чат). Возвращает { answer, chatId }.
   * Запросы выстраиваются в очередь.
   */
  /** opt: { mode: 'fast'|'auto'|'think'|'', models: ['модель', 'запасная', ...] } */
  ask(chatId, text, opt = {}) { return this.exclusive(() => this._askWithFallback(chatId, text, opt)); }

  async _askWithFallback(chatId, text, opt) {
    try { return await this._askWithFallback2(chatId, text, opt); } catch (e) { this.needReload = true; throw e; }
  }

  async _askWithFallback2(chatId, text, opt) {
    try {
      return await this._askModels(chatId, text, opt);
    } catch (e) {
      // новый чат в проекте не отвечает (утром 15.11 так было 4 минуты подряд) - создать чат вне проекта,
      // полчаса проект для новых чатов не трогать; бот продолжает разговаривать
      if (chatId || !this.projectId() || !/не начал|PARENT|не принял/i.test(e.message)) throw e;
      this.noProjectUntil = Date.now() + 30 * 60000;
      this.onAttention('новый чат в проекте Qwen не ответил (' + e.message.slice(0, 60) + '), создаю чат вне проекта');
      this.needReload = true;
      return this._askModels(chatId, text, opt);
    }
  }

  /** Все модели из меню выбора Qwen, включая «Expand more models». */
  async menuModels() {
    return this.wc.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const fire = (el) => { for (const t of ['pointerover','mouseover','pointerenter','mouseenter','pointerdown','mousedown','pointerup','mouseup','click'])
        el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: !/enter/.test(t), cancelable: true })); };
      const trigger = document.querySelector('[aria-label="Select Model"]');
      if (!trigger) return [];
      fire(trigger); await pause(400);
      const more = document.querySelector('.wms-more-entry__content');
      if (more) { fire(more); await pause(800); }
      const names = [...document.querySelectorAll('.wms-list__name-text')].map((n) => n.textContent.trim()).filter(Boolean);
      fire(trigger); await pause(200);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return [...new Set(names)];
    })()`).catch(() => []);
  }

  modelNow() { return this.wc.executeJavaScript(`(document.querySelector('[aria-label="Select Model"]') || {}).textContent || ''`).then((t) => String(t).trim()).catch(() => ''); }

  // модели, упёршиеся в дневной лимит: до конца суток не трогаем
  // ключ - аккаунт Qwen (id из токена входа) и день: на другом аккаунте лимиты свои
  async limitedToday() {
    const acc = await this.wc.executeJavaScript(`(() => { try { const t = localStorage.getItem('token') || ''; const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.id || p.sub || p.email || t.slice(-16); } catch { return ''; } })()`).catch(() => '');
    const key = acc + '|' + new Date().toDateString();
    this.limitedBy = this.limitedBy || {};
    if (!this.limitedBy[key]) { this.limitedBy = { [key]: new Set() }; if (this.accKey && this.accKey !== acc) this.goodModel = ''; }
    this.accKey = acc;
    return this.limitedBy[key];
  }

  /** Лимит на всех моделях этого аккаунта: не спрашивать Qwen до restUntil. */
  get resting() { return this.restUntil && Date.now() < this.restUntil; }

  async _askModels(chatId, text, opt) {
    const lim = await this.limitedToday();
    if (this.resting) throw new Error('лимит Qwen на всех моделях, отдыхаю до ' + new Date(this.restUntil).toLocaleTimeString('ru-RU'));
    let models = (opt.models && opt.models.length) ? [...opt.models] : [this.goodModel || ''];
    models = models.filter((m) => !m || !lim.has(m));
    if (!models.length) models = [''];
    let last, auto = false;
    for (let i = 0; i < models.length && i < 25; i++) {
      try {
        const r = await this._ask(chatId, text, models[i], opt.mode || '');
        // лимит Qwen приходит обычным ответом («You've reached today's chat limit...») - это не реплика бота
        if (LIMIT_TEXT.test(r.answer || '')) throw new Error('лимит Qwen: ' + String(r.answer).slice(0, 80));
        this.goodModel = models[i] || (await this.modelNow()) || this.goodModel;
        return r;
      } catch (e) {
        last = e;
        if (!LIMIT.test(e.message)) throw e;
        const used = models[i] || (await this.modelNow());
        if (used) lim.add(used);
        if (this.goodModel === used) this.goodModel = '';
        if (i === models.length - 1 && !auto) {
          auto = true;
          const all = await this.menuModels();
          models.push(...all.filter((n) => !lim.has(n) && !models.includes(n)));
        }
        if (i === models.length - 1) { this.restUntil = Date.now() + 30 * 60000; this.onAttention('Qwen: лимит на всех моделях этого аккаунта - 30 мин не спрашиваю (другой аккаунт - лимиты свои)'); throw new Error('лимит Qwen на всех моделях'); }
        this.onAttention(`Qwen: ${used || 'модель'} упёрлась в лимит (до завтра не трогаю), переключаюсь на ${models[i + 1]}`);
      }
    }
    throw last;
  }

  async _ask(chatId, text, model, mode) {
    if (!chatId && !((this.noProjectUntil || 0) > Date.now())) await this.beforeNewChat();
    await this.open(chatId);
    await this.hook();
    if (model || mode) {
      const r = await this.wc.executeJavaScript(PICK(model, mode)).catch(() => null);
      if (r && model && !r.found) throw new Error('модель недоступна: ' + model);
      this.lastPick = r;
    }
    let sent = await this.wc.executeJavaScript(SEND(text));
    // Qwen спрашивает возраст: отвечает сам владелец в окне справа, ждём до 10 минут и отправляем снова
    for (let i = 0; sent.age && i < 120; i++) {
      const year = this.birthYear();
      if (year && i < 3) {
        const r = await this.wc.executeJavaScript(AGE(year)).catch((e) => String(e));
        if (r === 'ok') this.ageConfirmed = true;
        this.onAttention('Qwen спросил возраст, ответил годом из настроек: ' + r);
      } else if (i === 0 || i === 3) {
        this.onAttention('Qwen просит подтвердить возраст: ответьте в окне Qwen справа или впишите год рождения в настройках');
      }
      await sleep(5000);
      sent = await this.wc.executeJavaScript(SEND(text));
    }
    if (sent.age) throw new Error('Qwen ждёт подтверждения возраста');
    if (sent.error) throw new Error(sent.error);
    const sentAt = Date.now();
    const until = sentAt + 4 * 60 * 1000;
    let started = false;
    let lastHistory = 0;
    while (Date.now() < until) {
      await sleep(400);
      const r = await this.wc.executeJavaScript(
        `(() => { const tb = window.__tb; if (!tb) return null; const k = Object.keys(tb.done).map(Number).filter((n) => n > ${sent.rid}).sort((a,b)=>a-b)[0]; return { started: tb.rid > ${sent.rid}, done: k ? tb.done[k] : null }; })()`
      ).catch(() => null);
      // Запасной путь: при создании нового чата страница может перезагрузиться, и перехват потока теряется.
      // Тогда раз в 3 с смотрим историю чата: ответ Qwen на наше сообщение уже готов?
      if ((!r || !r.started) && Date.now() - lastHistory > 3000) {
        lastHistory = Date.now();
        if (!r) await this.hook().catch(() => {});
        const h = await this.historyAnswer(this.currentChat() || chatId, sentAt);
        if (h && h.done && h.text) return { answer: h.text, chatId: this.currentChat() || chatId };
        if (h) started = true;   // ответ пишется - ждём дальше
      }
      if (!r) continue;
      if (r.started) started = true;
      // первое сообщение нового чата (длинная вводная, в проекте Qwen ещё читает файлы) - дать больше времени
      if (!started && Date.now() > sentAt + (chatId ? 45000 : 90000)) throw new Error('Qwen не начал отвечать (вход, капча, лимит?)');
      if (r.done) {
        if (r.done.error && !r.done.answer) throw new Error(r.done.error);
        // новый чат получает адрес после первого ответа
        let id = this.currentChat();
        for (let i = 0; i < 20 && !id; i++) { await sleep(250); id = this.currentChat(); }
        const ab = await this.wc.executeJavaScript(AB).catch(() => null);
        if (ab) {
          this.onAttention('Qwen дал два варианта ответа, выбран первый');
          // выбранный ответ целиком (с блоком команд) - из истории чата; карточка на странице - запасной вариант
          await sleep(1500);
          const saved = await this.lastAnswer(id || chatId).catch(() => '');
          return { answer: saved || abToAnswer(ab) || r.done.answer, chatId: id || chatId };
        }
        return { answer: r.done.answer, chatId: id || chatId };
      }
    }
    throw new Error('Qwen отвечает дольше 4 минут');
  }
}

module.exports = { QwenBridge, abToAnswer };
