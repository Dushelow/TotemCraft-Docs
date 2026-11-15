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
    ws.onerror = () => reject(new Error('нет связи с Chrome'));
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
  if (!exe) throw new Error('Chrome не найден');
  const proc = spawn(exe, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', '--new-window', S.url], { detached: false, stdio: 'ignore' });
  try {
    onStatus(`Войдите в ${S.name} в открывшемся окне Chrome`);
    const until = Date.now() + 10 * 60 * 1000;
    while (Date.now() < until) {
      await sleep(2000);
      if (proc.exitCode !== null) throw new Error('Chrome закрыли до входа');
      let page;
      try { page = await sitePage(S.url); } catch { continue; }
      if (!page) continue;
      const c = await cdp(page.webSocketDebuggerUrl);
      try {
        const r = await c.send('Runtime.evaluate', { expression: S.ready, returnByValue: true });
        const token = r.result && r.result.value;
        if (!token) continue;
        const { cookies } = await c.send('Network.getCookies', { urls: [S.url] });
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

module.exports = { loginViaChrome, findChrome };
