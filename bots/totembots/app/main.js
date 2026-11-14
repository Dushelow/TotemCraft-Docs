// TotemBots: окно программы. Слева панель ботов, справа chat.qwen.ai под входом владельца.
// Вход в Qwen хранится в профиле программы (partition persist:qwen), не в Chrome владельца.
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('path');
const { loginViaChrome } = require('./chrome-login');

const PANEL_WIDTH = 380;
const QWEN_URL = 'https://chat.qwen.ai/';

// Google не пускает вход во встроенные браузеры по метке «Electron» в user agent: показываем обычный Chrome.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

let win, qwen;

function layout() {
  const [w, h] = win.getContentSize();
  qwen.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, w - PANEL_WIDTH), height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'TotemBots', backgroundColor: '#1e1f22',
    webPreferences: { preload: path.join(__dirname, 'panel-preload.js') },
  });
  win.loadFile(path.join(__dirname, 'panel.html'));

  const qs = session.fromPartition('persist:qwen');
  qs.setUserAgent(CHROME_UA);
  qwen = new WebContentsView({ webPreferences: { session: qs } });
  win.contentView.addChildView(qwen);
  qwen.webContents.loadURL(QWEN_URL);

  // Вход через Google открывается всплывающим окном: в том же профиле, чтобы вход сохранился.
  qwen.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 520, height: 700, webPreferences: { session: qs } },
  }));

  const report = () => win.webContents.send('qwen-url', qwen.webContents.getURL());
  qwen.webContents.on('did-navigate', report);
  qwen.webContents.on('did-navigate-in-page', report);

  win.on('resize', layout);
  layout();
}

ipcMain.handle('qwen-reload', () => qwen.webContents.loadURL(QWEN_URL));
ipcMain.handle('qwen-state', async () => {
  // Вошёл ли владелец: у Qwen после входа в localStorage лежит token.
  try {
    return await qwen.webContents.executeJavaScript('({ url: location.href, loggedIn: !!localStorage.getItem("token") })');
  } catch (e) {
    return { url: qwen.webContents.getURL(), loggedIn: false, error: String(e) };
  }
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

app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => app.quit());
