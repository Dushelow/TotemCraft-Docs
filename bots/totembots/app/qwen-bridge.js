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
      const find = () => [...document.querySelectorAll('.wms-list__item')].find((n) => String((n.querySelector('.wms-list__name-info') || {}).textContent).trim().toLowerCase() === model.toLowerCase());
      const more = document.querySelector('.wms-more-entry__content');
      if (!find() && more) { fire(more); await pause(500); }
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
    this.wc.on('dom-ready', () => this.hook().catch(() => {}));
    // окно возраста может выскочить когда угодно (при загрузке, после ответа): проверяем раз в 20 с
    this.ageTimer = setInterval(() => this.checkAge().catch(() => {}), 20000);
  }

  async checkAge() {
    const year = this.birthYear();
    if (!year || this.wc.isDestroyed()) return;
    const r = await this.wc.executeJavaScript(AGE(year));
    if (r !== 'нет окна') this.onAttention('Qwen спросил возраст, ответил годом из настроек: ' + r);
  }

  hook() { return this.wc.executeJavaScript(HOOK); }

  /** Текст текущего (выбранного) ответа в чате - из истории Qwen, тем же запросом, что делает страница. */
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
  readAloud(chatId) {
    const run = () => this._readAloud(chatId);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

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
    const m = /^https:\/\/chat\.qwen\.ai\/c\/([A-Za-z0-9_-]+)/.exec(this.wc.getURL());
    return m ? m[1] : '';
  }

  async open(chatId) {
    const pid = this.projectId();
    const want = chatId ? `${ORIGIN}/c/${chatId}` : pid ? `${ORIGIN}/p/${pid}` : `${ORIGIN}/`;
    if (chatId && this.currentChat() === chatId) return;
    await this.wc.loadURL(want);
    await this.hook();
    await sleep(1500);
  }

  /**
   * Отправить text в чат chatId ('' - новый чат). Возвращает { answer, chatId }.
   * Запросы выстраиваются в очередь.
   */
  /** opt: { mode: 'fast'|'auto'|'think'|'', models: ['модель', 'запасная', ...] } */
  ask(chatId, text, opt = {}) {
    const run = () => this._askWithFallback(chatId, text, opt);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _askWithFallback(chatId, text, opt) {
    const models = (opt.models && opt.models.length) ? opt.models : [''];
    let last;
    for (let i = 0; i < models.length; i++) {
      try {
        return await this._ask(chatId, text, models[i], opt.mode || '');
      } catch (e) {
        last = e;
        if (!LIMIT.test(e.message) || i === models.length - 1) throw e;
        this.onAttention(`Qwen: модель ${models[i] || '(текущая)'} не ответила (${e.message.slice(0, 80)}), пробую ${models[i + 1]}`);
      }
    }
    throw last;
  }

  async _ask(chatId, text, model, mode) {
    if (!chatId) await this.beforeNewChat();
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
