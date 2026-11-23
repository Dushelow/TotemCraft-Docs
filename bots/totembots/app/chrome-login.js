// Вход в Qwen через настоящий Chrome: Google не пускает вход во встроенные окна, а в обычном Chrome пускает.
// Запускаем Chrome с отдельным чистым профилем (основной Chrome владельца не трогаем) и портом отладки,
// ждём, пока владелец войдёт в Qwen, забираем куки chat.qwen.ai и token из localStorage, закрываем Chrome.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 9333;
const QWEN = 'https://chat.qwen.ai/';
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];

function findChrome() {
  return CANDIDATES.find((p) => p && fs.existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Маленький клиент протокола отладки Chrome поверх WebSocket.
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const wait = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && wait.has(msg.id)) {
        const { ok, fail } = wait.get(msg.id);
        wait.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      }
    };
    ws.onerror = () => reject(new Error('нет связи с браузером'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((ok, fail) => {
        wait.set(++id, { ok, fail });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

// сайты: где войти, какой ключ в localStorage - признак входа (Qwen - token, DeepSeek - userToken не на странице входа)
const SITES = {
  qwen: { url: QWEN, name: 'Qwen', key: 'token', ready: 'localStorage.getItem("token")' },
  deepseek: { url: 'https://chat.deepseek.com/', name: 'DeepSeek', key: 'userToken',
    ready: '(!/sign_in|login/.test(location.pathname) && localStorage.getItem("userToken") && localStorage.getItem("userToken").length > 20) ? localStorage.getItem("userToken") : ""' },
};

// остальные сайты: вход = на странице есть поле ввода чата; берём куки и весь localStorage
for (const [id, s] of Object.entries(require('./web-chat').SITES)) {
  if (SITES[id]) continue;
  SITES[id] = { url: s.home, name: s.name, all: true, ready: `(document.querySelector(${JSON.stringify(s.input)}) && !/sign_in|login|auth/.test(location.pathname)) ? JSON.stringify(Object.assign({}, localStorage)) : ''` };
}

async function sitePage(url) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.find((t) => t.type === 'page' && t.url.startsWith(url));
}

/**
 * Открывает Chrome и ждёт входа. onStatus(text) - что показать в панели.
 * Возвращает { cookies, token }. Таймаут 10 минут.
 */
async function loginViaChrome(profileDir, onStatus, siteId = 'qwen') {
  const S = SITES[siteId];
  const exe = findChrome();
  if (!exe) { if (findFirefox()) return loginViaFirefox(profileDir + '-firefox', onStatus, S); throw new Error('не найден ни Chrome, ни Firefox: войдите без Google (почта и пароль) прямо в окне сайта'); }
  const proc = spawn(exe, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', '--new-window', S.url], { detached: false, stdio: 'ignore' });
  try {
    onStatus(`Войдите в ${S.name} в открывшемся окне Chrome`);
    const until = Date.now() + 10 * 60 * 1000;
    // В профиле входа уже может быть прошлый вход: раньше программа сразу забирала его и закрывала Chrome через
    // секунду (21.11: владелец хотел войти в другой аккаунт - лимиты). Теперь прошлый вход не берём: ждём, пока
    // вход сменится (выйти и войти в другой аккаунт). Закрыли Chrome, ничего не меняя, - остаётся прошлый вход.
    let first;
    while (Date.now() < until) {
      await sleep(2000);
      if (proc.exitCode !== null) throw new Error(first ? 'Chrome закрыли - вход не менялся, остался прежний аккаунт' : 'Chrome закрыли до входа');
      let page;
      try { page = await sitePage(S.url); } catch { continue; }
      if (!page) continue;
      const c = await cdp(page.webSocketDebuggerUrl);
      try {
        const r = await c.send('Runtime.evaluate', { expression: S.ready, returnByValue: true });
        const token = r.result && r.result.value;
        if (first === undefined) {
          first = token || '';
          if (first) { onStatus(`В Chrome уже есть вход в ${S.name}. Чтобы сменить аккаунт - выйдите там и войдите в другой; окно закроется само. Менять не нужно - просто закройте Chrome`); continue; }
        }
        if (!token || token === first) continue;
        const { cookies } = await c.send('Network.getCookies', S.all ? {} : { urls: [S.url] });
        onStatus('Вход получен, закрываю Chrome');
        return { cookies, token };
      } finally {
        c.close();
      }
    }
    throw new Error('не дождались входа за 10 минут');
  } finally {
    proc.kill();
  }
}

// Нет Chrome - Firefox (23.11: у друга только Firefox). Протокол WebDriver BiDi: отдельный чистый профиль, порт
// отладки, ждём вход, забираем куки и признак входа так же, как у Chrome.
const FF = ['C:\Program Files\Mozilla Firefox\firefox.exe', 'C:\Program Files (x86)\Mozilla Firefox\firefox.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox\firefox.exe')];
function findFirefox() { return FF.find((p) => p && fs.existsSync(p)); }
async function loginViaFirefox(profileDir, onStatus, S) {
  fs.mkdirSync(profileDir, { recursive: true });
  const proc = spawn(findFirefox(), ['-profile', profileDir, '-no-remote', '--remote-debugging-port', String(PORT), S.url], { stdio: 'ignore' });
  try {
    onStatus(`Войдите в ${S.name} в открывшемся окне Firefox`);
    let ws;
    for (let i = 0; i < 30 && !ws; i++) { await sleep(1000); try { ws = await cdp(`ws://127.0.0.1:${PORT}/session`); } catch {} }
    if (!ws) throw new Error('Firefox не дал подключиться');
    const raw = (method, params = {}) => ws.send(method, params);   // тот же формат {id, method, params}
    await raw('session.new', { capabilities: {} });
    const until = Date.now() + 10 * 60 * 1000;
    let first;
    try {
      while (Date.now() < until) {
        await sleep(2000);
        if (proc.exitCode !== null) throw new Error('Firefox закрыли до входа');
        const tree = await raw('browsingContext.getTree', {});
        const ctx = (tree.contexts || []).find((c) => String(c.url).startsWith(S.url)) || (tree.contexts || [])[0];
        if (!ctx) continue;
        let token = '';
        try { const r = await raw('script.evaluate', { expression: S.ready, target: { context: ctx.context }, awaitPromise: false }); token = r.result && r.result.value || ''; } catch { continue; }
        if (first === undefined) { first = token; if (first) onStatus(`В Firefox уже есть вход в ${S.name}. Чтобы сменить аккаунт - выйдите и войдите заново`); }
        if (!token || token === first) continue;
        const host = new URL(S.url).hostname.replace(/^chat\./, '');
        const { cookies } = await raw('storage.getCookies', {});
        const out = cookies.filter((c) => S.all || c.domain.includes(host)).map((c) => ({ name: c.name, value: c.value && c.value.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite === 'none' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax', expires: c.expiry || -1 }));
        onStatus('Вход получен, закрываю Firefox');
        return { cookies: out, token };
      }
      throw new Error('не дождались входа за 10 минут');
    } finally { ws.close(); }
  } finally { proc.kill(); }
}

module.exports = { loginViaChrome, findChrome: () => findChrome() || findFirefox(), SITES };
