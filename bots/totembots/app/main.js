// TotemBots: окно программы. Слева панель ботов, справа chat.qwen.ai под входом владельца.
// Вход в Qwen хранится в профиле программы (partition persist:qwen), не в Chrome владельца.
// Настройки и пароли ботов лежат только на этом компьютере: %APPDATA%/totembots/config.json.
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loginViaChrome } = require('./chrome-login');
const { QwenBridge } = require('./qwen-bridge');
const { TotemBot } = require('./bot');
const { Brain, DEFAULT_PERSONA } = require('./brain');

const PANEL_WIDTH = 440;
const QWEN_URL = 'https://chat.qwen.ai/';

// Google не пускает вход во встроенные браузеры по метке «Electron» в user agent: показываем обычный Chrome.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

let win, qwen, bridge;

// --- настройки
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
let cfg = { host: '127.0.0.1', port: 25566, masters: ['Valghard'], bots: [], qwen: { chatMode: 'fast', planMode: 'auto', models: [] } };
function loadCfg() {
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch {}
}
function saveCfg() {
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
}

// --- боты
const live = new Map();   // name -> { body, brain, log: [] }
function logTo(name, text) {
  const t = new Date().toLocaleTimeString('ru-RU');
  const l = live.get(name);
  if (!l) return;
  l.log.push(`${t} ${text}`);
  if (l.log.length > 400) l.log.splice(0, l.log.length - 400);
}

function startBot(name) {
  const bc = cfg.bots.find((b) => b.name === name);
  if (!bc) throw new Error('нет такого бота');
  let l = live.get(name);
  if (l && l.body && l.body.bot) return;
  if (!l) { l = { log: [] }; live.set(name, l); }
  const body = new TotemBot({ name: bc.name, password: bc.password, host: cfg.host, port: +cfg.port, combat: bc.combat || 'defend' });
  body.on('log', (t) => logTo(name, t));
  body.on('chat', (t) => logTo(name, '[чат] ' + t));
  body.on('end', () => logTo(name, 'бот выключен'));
  const brain = new Brain({ body, bridge, cfg: () => cfg, botCfg: bc, save: saveCfg, log: (t) => logTo(name, t) });
  Object.assign(l, { body, brain });
  body.start();
}

function stateForPanel() {
  return {
    host: cfg.host, port: cfg.port, masters: cfg.masters, birthYear: cfg.birthYear || '', qwen: cfg.qwen || {},
    bots: cfg.bots.map((b) => {
      const l = live.get(b.name);
      return { name: b.name, persona: b.persona, chatId: b.chatId || '', combat: b.combat || 'defend', state: l && l.body ? l.body.state() : { status: 'off' },
        log: l ? l.log.slice(-150) : [] };
    }),
  };
}

function layout() {
  const [w, h] = win.getContentSize();
  qwen.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, w - PANEL_WIDTH), height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 600,
    title: 'TotemBots', backgroundColor: '#1e1f22',
    webPreferences: { preload: path.join(__dirname, 'panel-preload.js') },
  });
  win.loadFile(path.join(__dirname, 'panel.html'));

  const qs = session.fromPartition('persist:qwen');
  qs.setUserAgent(CHROME_UA);
  qwen = new WebContentsView({ webPreferences: { session: qs, backgroundThrottling: false } });
  win.contentView.addChildView(qwen);
  qwen.webContents.loadURL(QWEN_URL);
  bridge = new QwenBridge(qwen.webContents);
  bridge.birthYear = () => cfg.birthYear || '';
  bridge.onAttention = (t) => { for (const name of live.keys()) logTo(name, t); win.webContents.send('qwen-login-status', t); };

  // Вход через Google открывается всплывающим окном: в том же профиле, чтобы вход сохранился.
  qwen.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 520, height: 700, webPreferences: { session: qs } },
  }));

  win.on('resize', layout);
  layout();
}

// --- панель
ipcMain.handle('qwen-reload', () => qwen.webContents.loadURL(QWEN_URL));
ipcMain.handle('qwen-state', async () => {
  try {
    return await qwen.webContents.executeJavaScript('({ url: location.href, loggedIn: !!localStorage.getItem("token") })');
  } catch (e) {
    return { url: qwen.webContents.getURL(), loggedIn: false, error: String(e) };
  }
});
ipcMain.handle('state', () => stateForPanel());
ipcMain.handle('save-settings', (_e, s) => {
  cfg.host = String(s.host || '').trim() || '127.0.0.1';
  cfg.port = +s.port || 25565;
  cfg.masters = String(s.masters || '').split(/[\s,]+/).filter(Boolean);
  const MODES = ['fast', 'auto', 'think', ''];
  cfg.qwen = {
    chatMode: MODES.includes(s.chatMode) ? s.chatMode : 'fast',
    planMode: MODES.includes(s.planMode) ? s.planMode : 'auto',
    models: String(s.models || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
  };
  cfg.birthYear = /^(19|20)\d\d$/.test(String(s.birthYear || '').trim()) ? String(s.birthYear).trim() : '';
  saveCfg();
  return true;
});
ipcMain.handle('bot-add', (_e, { name, persona }) => {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('ник: 3-16 латинских букв, цифр или _');
  if (cfg.bots.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new Error('такой бот уже есть');
  cfg.bots.push({ name, persona: String(persona || '').trim() || DEFAULT_PERSONA, password: crypto.randomBytes(9).toString('base64url'), chatId: '' });
  saveCfg();
  return true;
});
ipcMain.handle('bot-remove', (_e, name) => {
  const l = live.get(name);
  if (l && l.body) l.body.stop();
  live.delete(name);
  cfg.bots = cfg.bots.filter((b) => b.name !== name);
  saveCfg();
  return true;
});
ipcMain.handle('bot-persona', (_e, { name, persona }) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (b) { b.persona = String(persona || '').trim() || DEFAULT_PERSONA; b.chatId = ''; saveCfg(); }   // новый характер - новый чат
  return true;
});
ipcMain.handle('bot-combat', (_e, { name, combat }) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (!b || !['defend', 'flee', 'off'].includes(combat)) return false;
  b.combat = combat; saveCfg();
  const l = live.get(name);
  if (l && l.body && l.body.guard) l.body.guard.mode = combat;
  return true;
});
ipcMain.handle('bot-start', (_e, name) => { startBot(name); return true; });
ipcMain.handle('bot-stop', (_e, name) => { const l = live.get(name); if (l && l.body) l.body.stop(); return true; });
ipcMain.handle('bot-order', (_e, { name, text }) => {
  const l = live.get(name);
  if (!l || !l.brain || !l.body.bot) throw new Error('бот не запущен');
  l.brain.order(text);
  return true;
});
ipcMain.handle('bot-newchat', (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (b) { b.chatId = ''; saveCfg(); }
  logTo(name, 'следующий разговор начнётся в новом чате Qwen');
  return true;
});
ipcMain.handle('bot-chat', (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (b && b.chatId) qwen.webContents.loadURL(`${QWEN_URL}c/${b.chatId}`);
  return true;
});

// Вход через настоящий Chrome: забираем куки и token Qwen в профиль программы.
const SAME_SITE = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' };
ipcMain.handle('qwen-login-chrome', async () => {
  const status = (t) => win.webContents.send('qwen-login-status', t);
  try {
    const { cookies, token } = await loginViaChrome(path.join(app.getPath('userData'), 'chrome-login'), status);
    const qs = qwen.webContents.session;
    for (const c of cookies) {
      await qs.cookies.set({
        url: 'https://' + c.domain.replace(/^\./, '') + c.path, name: c.name, value: c.value, domain: c.domain,
        path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: SAME_SITE[c.sameSite] || 'unspecified',
        ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
      });
    }
    await qwen.webContents.loadURL(QWEN_URL);
    await qwen.webContents.executeJavaScript(`localStorage.setItem("token", ${JSON.stringify(token)})`);
    await qwen.webContents.loadURL(QWEN_URL);
    status('Готово: Qwen вошёл в программе');
    win.focus();
    return { ok: true, cookies: cookies.length };
  } catch (e) {
    status('Не вышло: ' + e.message);
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => { loadCfg(); Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => {
  for (const l of live.values()) if (l.body) l.body.stop();
  setTimeout(() => app.quit(), 300);
});
