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
const { Voice, PIPER_VOICES } = require('./voice');
const { Memory } = require('./memory');
const { WorldMap } = require('./worldmap');
const { Travel } = require('./travel');
const { QwenProject, PROJECT_NAME } = require('./qwen-project');
const { Router, PRESETS } = require('./router');
const { WebChat, SITES } = require('./web-chat');

const PANEL_WIDTH = 440;
const TAB_H = 34;   // полоска вкладок над Qwen: «Окно бота» и «Моё окно Qwen»
const QWEN_URL = 'https://chat.qwen.ai/';

// Google не пускает вход во встроенные браузеры по метке «Electron» в user agent: показываем обычный Chrome.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Всё своё (настройки, вход в Qwen, память, карта) - в папке программы local/, а не в %APPDATA%: так у владельца и
// у Claude один и тот же файл (15.11: %APPDATA% у них оказался разным - ярлык открывал старые настройки и другой вход).
// Первый запуск: перенести настройки из %APPDATA%/totembots, если там есть.
const LOCAL = path.join(__dirname, '..', 'local');
if (!process.env.TOTEMBOTS_CONFIG) {
  try {
    fs.mkdirSync(LOCAL, { recursive: true });
    const old = path.join(app.getPath('appData'), 'totembots', 'config.json');
    const neu = path.join(LOCAL, 'config.json');
    if (!fs.existsSync(neu) && fs.existsSync(old)) fs.copyFileSync(old, neu);
  } catch {}
  app.setPath('userData', path.join(LOCAL, 'userdata'));
}

let win, qwen, mine, dsView, bridge, router, voice, memory, project, worldMap, travel;
let tab = 'bot';

// --- настройки
// TOTEMBOTS_CONFIG / TOTEMBOTS_MEMORY - свои файлы для тестов, чтобы не трогать настройки владельца
const cfgPath = () => process.env.TOTEMBOTS_CONFIG || path.join(LOCAL, 'config.json');
// по умолчанию: настоящий сервер, хозяин - владелец, боты сами заходят при запуске программы, голос Qwen
let cfg = { host: 'play.totemcraft.net', port: 20098, masters: ['Valghard'], bots: [], autostart: true, birthYear: '2000',
  qwen: { chatMode: 'fast', planMode: 'auto', models: [] }, initiative: { enabled: true, minutes: 1 },
  voice: { enabled: true, provider: 'qwen', fallback: true, local: true, plasmo: true, volume: 0.8 } };
function loadCfg() {
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch {}
}
function saveCfg() {
  // история чатов каждого бота: новые сверху, до 30
  for (const b of cfg.bots) {
    b.chats = (b.chats || []).filter((c) => c && c.id);
    if (b.chatId && !b.chats.some((c) => c.id === b.chatId)) b.chats.unshift({ id: b.chatId, at: Date.now() });
    b.chats = b.chats.slice(0, 30);
  }
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
  try { const dir = path.join(LOCAL, 'logs'); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, name + '.log'), `${new Date().toISOString()} ${text}\n`); } catch {}
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
  const brain = new Brain({ body, bridge: router, cfg: () => cfg, botCfg: bc, save: saveCfg, log: (t) => logTo(name, t) });
  brain.voice = voice;
  brain.memory = memory;
  brain.onBackground = onBackground;
  body.memory = memory;
  body.worldMap = worldMap;
  body.travel = travel;
  // деревни, спавнеры, сооружения с карты - сразу в память мест; рядом - «момент» (может, захочет сказать)
  worldMap.attach(body, (v, dim) => {
    memory.place({ name: `${v.kind} у ${v.x} ${v.z}`, x: v.x, y: v.y, z: v.z, dim, note: 'нашёл по карте' }, bc.name);
    body.emit('moment', { kind: 'место', text: `рядом ${v.kind} (${v.x} ${v.y} ${v.z})`, pos: v });
  });
  body.on('end', () => { if (body.manual) brain.stop(); });
  Object.assign(l, { body, brain });
  body.start();
  // сознание включается сразу: через 30 с после входа - первое «свободное время» (создаётся чат Qwen, бот начинает жить)
  body.once('event', () => setTimeout(() => { brain.lastEvent = 0; brain.idle(); }, 30000));
}

function stateForPanel() {
  return {
    host: cfg.host, port: cfg.port, masters: cfg.masters, paused: !!cfg.paused,
    brains: { order: (cfg.brains && cfg.brains.order) || ['qwen', 'deepseekweb', 'gemini', 'groq', 'openrouter', 'deepseek'], has: Object.fromEntries(Object.keys(PRESETS).map((k) => [k, !!((cfg.brains || {}).keys || {})[k]])),
      models: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, ((cfg.brains || {}).models || {})[k] || p.model])), presets: PRESETS,
      now: router ? (router.order().find((b) => b.id === router.lastBrain) || {}).name || '' : '', active: router ? router.order().map((b) => b.name + (router.isResting(b.id) ? ' (отдыхает)' : '')) : [] }, birthYear: cfg.birthYear || '', qwen: cfg.qwen || {}, tab, botBusy: !!(bridge && bridge.busy), captcha: !!(bridge && bridge.captcha),
    voice: voice ? { ...voice.settings(), piper: voice.piperState() } : {},
    background: { waiting: background.lines.length, status: background.status, news: (memory && memory.data.news || []).slice(-3).map((n) => n.text) },
    project: { enabled: projectEnabled(), id: project ? project.id : '', name: PROJECT_NAME, status: projectState.status },
    bots: cfg.bots.map((b) => {
      const l = live.get(b.name);
      return { name: b.name, chatMode: b.chatMode || 'normal', aliases: (b.aliases || []).join(', '),
        attention: l && l.brain ? { ...l.brain.attn.count } : null, brain: l && l.brain && l.body && l.body.bot ? l.brain.status() : null, password: b.password, probe: b.probeText || '', persona: b.persona, chatId: b.chatId || '', chats: b.chats || [], combat: b.combat || 'defend', state: l && l.body ? l.body.state() : { status: 'off' },
        log: l ? l.log.slice(-150) : [] };
    }),
  };
}

function layout() {
  const [w, h] = win.getContentSize();
  const r = { x: PANEL_WIDTH, y: TAB_H, width: Math.max(0, w - PANEL_WIDTH), height: Math.max(0, h - TAB_H) };
  qwen.setBounds(r);
  if (mine) mine.setBounds(r);
  if (dsView) dsView.setBounds(r);
}

// Своё окно Qwen владельца: тот же вход, отдельная страница. Бот в нём ничего не делает, поэтому там можно менять
// настройки, голос, смотреть чаты, пока бот занят в своём окне. Окна лежат друг на друге: показанное - сверху,
// второе продолжает работать (бот отвечает и в скрытом окне).
function showTab(name) {
  if (name === 'mine' && !mine) {
    const qs = session.fromPartition('persist:qwen');
    mine = new WebContentsView({ webPreferences: { session: qs } });
    mine.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, webPreferences: { session: qs } } }));
    mine.webContents.loadURL(QWEN_URL);
  }
  tab = name === 'mine' ? 'mine' : name === 'deepseek' ? 'deepseek' : 'bot';
  win.contentView.addChildView(tab === 'mine' ? mine : tab === 'deepseek' ? dsView : qwen);   // уже добавленное окно переносится наверх
  layout();
  return tab;
}
function openMine(url) { showTab('mine'); mine.webContents.loadURL(url); }

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
  // мозги по очереди: Qwen-сайт и нейросети по ключу (router.js)
  // DeepSeek через сайт: своё окно со своим входом (под окном бота; показать - вкладка «DeepSeek»)
  const dss = session.fromPartition('persist:deepseek');
  dss.setUserAgent(CHROME_UA);
  dsView = new WebContentsView({ webPreferences: { session: dss, backgroundThrottling: false } });
  win.contentView.addChildView(dsView, 0);
  dsView.webContents.loadURL(SITES.deepseek.home);
  dsView.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, webPreferences: { session: dss } } }));
  const dsChat = new WebChat(dsView.webContents, 'deepseek', (t) => { try { win.webContents.send('qwen-login-status', t); } catch {} });
  router = new Router({ qwen: bridge, cfg: () => cfg, webs: { deepseekweb: dsChat }, log: (t) => { for (const name of live.keys()) logTo(name, t); } });
  project = new QwenProject({ bridge, cfg: () => cfg, save: saveCfg, dir: path.join(dataDir(), 'project'),
    log: (t) => { for (const name of live.keys()) logTo(name, t); win.webContents.send('qwen-login-status', t); } });
  bridge.projectId = () => (cfg.qwenProject && cfg.qwenProject.enabled !== false ? project.id : '');
  bridge.beforeNewChat = async () => {
    if (!projectEnabled()) return;
    try { if (!project.id || !(await project.exists())) await project._ensure(); } catch (e) { logAll('проект Qwen: ' + e.message + ' (чат будет вне проекта)'); }
  };
  startProjectSync();
  voice = new Voice({ cfg: () => cfg, bridge, dir: app.getPath('userData'), toPanel: (ch, d) => win.webContents.send(ch, d),
    log: (name, t) => logTo(name, t) });
  voice.qwenChat = (id) => router.qwenIdOf(id);
  voice.emitPcm = (name, pcm, rate) => {
    const l = live.get(name);
    if (l && l.body) l.body.sendVoice(pcm, rate).then((ok) => logTo(name, ok ? 'голос отправлен в Plasmo Voice' : 'голос в Plasmo Voice: бот не на сервере')).catch((e) => logTo(name, 'голос в Plasmo Voice: ' + e.message));
  };
  bridge.onAttention = (t) => { for (const name of live.keys()) logTo(name, t); win.webContents.send('qwen-login-status', t); };
  router.onAttention = bridge.onAttention;

  // Вход через Google открывается всплывающим окном: в том же профиле, чтобы вход сохранился.
  qwen.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 520, height: 700, webPreferences: { session: qs } },
  }));

  win.on('resize', layout);
  layout();
}

// --- фон общего чата: один журнал на всех ботов, сжатие служебным чатом Qwen (CHAT.md)
const background = { lines: [], seen: new Map(), lastRun: Date.now(), busy: false, status: '' };
function onBackground({ from, text, at }) {
  const key = from + '|' + text;
  const prev = background.seen.get(key);
  if (prev && at - prev < 60000) return;   // одно сообщение слышат несколько ботов
  background.seen.set(key, at);
  if (background.seen.size > 500) background.seen.clear();
  const t = new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  background.lines.push(`${t} ${from}: ${String(text).slice(0, 200)}`);
  if (background.lines.length > 300) background.lines.splice(0, background.lines.length - 300);
}
const SERVICE_INTRO = 'Ты служебный помощник ботов сервера Minecraft TotemCraft. Я присылаю куски общего чата сервера. ' +
  'Сожми каждый кусок в 3-6 коротких строк по-русски, без лишних слов: кто что искал или просил, о чём договорились, ' +
  'события (рейд, ивент, гриф, ссора, поиск напарника, торговля), упоминания ботов. Пустую болтовню пропускай. ' +
  'Только строки, каждая с новой строки, без нумерации и без markdown. Если важного нет - ответь одним словом: пусто.';
async function summarizeBackground(force = false) {
  const n = background.lines.length;
  if (background.busy || !n) return;
  if (!force && n < 60 && (n < 5 || Date.now() - background.lastRun < 15 * 60000)) return;
  background.busy = true;
  const chunk = background.lines.splice(0, 120);
  try {
    const sc = cfg.serviceChat || {};
    const q = cfg.qwen || {};
    const opt = { mode: 'fast', models: q.serviceModels && q.serviceModels.length ? q.serviceModels : [] };
    if (!sc.id || (sc.uses || 0) >= 50) {   // новый служебный чат (внутри проекта, если он есть)
      const r = await router.ask('', SERVICE_INTRO + '\n\nОтветь «ок».', opt);
      sc.id = r.chatId; sc.uses = 0;
    }
    const { answer } = await router.ask(sc.id, 'Кусок общего чата:\n' + chunk.join('\n'), opt).catch(async (e) => {
      if (!/PARENT_NOT_FOUND/.test(e.message)) throw e;
      const r = await router.ask('', SERVICE_INTRO + '\n\nОтветь «ок».', opt); sc.id = r.chatId; sc.uses = 0;
      return router.ask(sc.id, 'Кусок общего чата:\n' + chunk.join('\n'), opt);
    });
    sc.uses = (sc.uses || 0) + 1;
    cfg.serviceChat = sc; saveCfg();
    const lines = String(answer).replace(/```[a-z]*|```/gi, '').split('\n').map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((l) => l && !/^пусто\.?$/i.test(l)).slice(0, 6);
    if (lines.length) memory.news(lines);
    background.status = `${new Date().toLocaleTimeString('ru-RU')}: сжато ${chunk.length} строк → ${lines.length} новостей`;
    for (const name of live.keys()) logTo(name, 'фон чата: ' + background.status);
  } catch (e) {
    background.lines.unshift(...chunk);   // не потерять - попробуем позже
    background.status = 'ошибка сжатия: ' + e.message;
  } finally { background.busy = false; background.lastRun = Date.now(); }
}
setInterval(() => summarizeBackground(false).catch(() => {}), 60000);

// --- проект Qwen: создать при входе, память туда - если изменилась, не чаще раза в 10 минут
function logAll(t) { for (const name of live.keys()) logTo(name, t); }
function dataDir() { return process.env.TOTEMBOTS_MEMORY || app.getPath('userData'); }
let projectState = { status: '', syncedVersion: -1, syncedAt: 0, busy: false };
function projectEnabled() { return !cfg.qwenProject || cfg.qwenProject.enabled !== false; }
async function projectSync(force = false) {
  if (!projectEnabled() || projectState.busy) return;
  if (!force && (memory.version === projectState.syncedVersion || Date.now() - projectState.syncedAt < 10 * 60000)) return;
  projectState.busy = true;
  try {
    const logged = await qwen.webContents.executeJavaScript('!!localStorage.getItem("token")').catch(() => false);
    if (!logged) { projectState.status = 'ждёт входа в Qwen'; return; }
    if (!project.id || !(await project.run(() => project.exists()))) await project.ensure();
    const v = memory.version;
    projectState.status = 'обновляю память...';
    const r = await project.syncMemory(memory.markdown());
    projectState.syncedVersion = v; projectState.syncedAt = Date.now();
    projectState.status = r + ', ' + new Date().toLocaleTimeString('ru-RU');
  } catch (e) {
    projectState.status = 'ошибка: ' + e.message;
    projectState.syncedAt = Date.now();   // не долбить при ошибке, повтор через 10 минут
  } finally { projectState.busy = false; }
}
function startProjectSync() {
  setTimeout(() => projectSync(true), 15000);
  setInterval(() => projectSync(false), 60000);
}

// --- панель
ipcMain.handle('qwen-reload', () => qwen.webContents.loadURL(QWEN_URL));
ipcMain.handle('qwen-tab', (_e, name) => showTab(name));
ipcMain.handle('qwen-tab-reload', () => { if (tab === 'mine' && mine) mine.webContents.reload(); else qwen.webContents.reload(); return true; });
ipcMain.handle('qwen-state', async () => {
  try {
    return await qwen.webContents.executeJavaScript('({ url: location.href, loggedIn: !!localStorage.getItem("token") })');
  } catch (e) {
    return { url: qwen.webContents.getURL(), loggedIn: false, error: String(e) };
  }
});
ipcMain.handle('state', () => stateForPanel());
// мозги: ключи (только на этом компьютере, local/config.json), модели, порядок
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\/[a-z0-9.-]+\//i.test(String(url))) require('electron').shell.openExternal(String(url)); return true; });
ipcMain.handle('brains-save', (_e, v) => {
  const b = cfg.brains = cfg.brains || {};
  b.keys = b.keys || {}; b.models = b.models || {};
  for (const k of Object.keys(PRESETS)) {
    const key = String((v.keys || {})[k] || '').trim();
    if (key === '-') delete b.keys[k]; else if (key) b.keys[k] = key;   // пусто - оставить прежний, «-» - удалить
    const m = String((v.models || {})[k] || '').trim(); if (m) b.models[k] = m;
  }
  const ord = String(v.order || '').split(/[\s,>]+/).map((x) => x.trim().toLowerCase()).filter((x) => x === 'qwen' || x === 'deepseekweb' || PRESETS[x]);
  if (ord.length) b.order = [...new Set(ord)];
  saveCfg();
  return true;
});
ipcMain.handle('pause', (_e, on) => { cfg.paused = !!on; saveCfg(); for (const n of live.keys()) logTo(n, on ? 'мозг на паузе (кнопка в панели)' : 'мозг снова работает'); return cfg.paused; });
ipcMain.handle('save-settings', (_e, s) => {
  cfg.host = String(s.host || '').trim() || 'play.totemcraft.net';
  cfg.port = +s.port || 20098;
  cfg.masters = String(s.masters || '').split(/[\s,]+/).filter(Boolean);
  const MODES = ['fast', 'auto', 'think', ''];
  cfg.qwen = {
    chatMode: MODES.includes(s.chatMode) ? s.chatMode : 'fast',
    planMode: MODES.includes(s.planMode) ? s.planMode : 'auto',
    models: String(s.models || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
    serviceModels: String(s.serviceModels || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
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
ipcMain.handle('voice-save', (_e, v) => {
  const PROVIDERS = ['qwen', 'piper', 'system'];
  cfg.voice = {
    enabled: !!v.enabled, fallback: !!v.fallback, local: !!v.local, plasmo: !!v.plasmo,
    provider: PROVIDERS.includes(v.provider) ? v.provider : 'qwen',
    volume: Math.max(0, Math.min(1, +v.volume || 0)),
    piperVoice: PIPER_VOICES[v.piperVoice] ? v.piperVoice : 'ru_RU-denis-medium',
  };
  saveCfg();
  return true;
});
ipcMain.handle('voice-install-piper', async () => voice.installPiper((t) => win.webContents.send('voice-status', t)));
ipcMain.handle('voice-test', async (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name) || { name: name || 'проверка', chatId: '' };
  if (!live.get(b.name)) live.set(b.name, { log: [] });
  const was = cfg.voice && cfg.voice.enabled;
  cfg.voice = { ...(cfg.voice || {}), enabled: true };
  try { await voice.speak('Привет! Это проверка голоса бота.', b); } finally { cfg.voice.enabled = was; }
  return true;
});
ipcMain.handle('project-sync', () => projectSync(true));
ipcMain.handle('project-open', () => { if (project.id) openMine(`${QWEN_URL}p/${project.id}`); return true; });
ipcMain.handle('project-enable', (_e, on) => { cfg.qwenProject = { ...(cfg.qwenProject || {}), enabled: !!on }; saveCfg(); if (on) projectSync(true); return true; });
ipcMain.handle('bot-start', (_e, name) => { startBot(name); return true; });
// проверка ушей без игрока с Plasmo Voice: подать боту фразу из WAV (48 кГц моно 16 бит), как её прислал бы аддон
ipcMain.handle('debug-hear', (_e, { name, from, wav }) => { const l = live.get(name); if (!l || !l.body) return false; l.body.emit('speech', { from, pcm: fs.readFileSync(wav).subarray(44) }); return true; });
ipcMain.handle('bot-map', (_e, name) => { const l = live.get(name); return l && l.body && worldMap ? worldMap.view(l.body) : null; });
ipcMain.handle('bot-chatmode', (_e, { name, mode, aliases }) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (!b) return false;
  if (['quiet', 'normal', 'social'].includes(mode)) b.chatMode = mode;
  if (aliases !== undefined) {
    b.aliases = String(aliases).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
    const l = live.get(name);
    if (l && l.brain) l.brain.attn = new (require('./attention').Attention)(b.name, { mode: b.chatMode, aliases: b.aliases });
  }
  saveCfg();
  return true;
});
ipcMain.handle('background-now', () => summarizeBackground(true));
ipcMain.handle('bot-newpass', (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (b) { b.password = crypto.randomBytes(9).toString('base64url'); saveCfg(); }
  return true;
});
// Проверка входа: зайти и через пару секунд выйти; пишет, что ответил сервер (вошёл, неверный пароль, нет аккаунта, кик)
ipcMain.handle('bot-probe', async (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (!b) throw new Error('нет такого бота');
  const l = live.get(name);
  if (l && l.body && l.body.bot) { b.probeText = 'бот уже на сервере - вход работает'; return true; }
  b.probeText = `проверяю вход на ${cfg.host}:${cfg.port}...`;
  const probe = new TotemBot({ name: b.name, password: b.password, host: cfg.host, port: +cfg.port, combat: 'off' });
  const chat = [];
  probe.on('chat', (t) => chat.push(t));
  const res = await new Promise((resolve) => {
    const done = (t) => { clearTimeout(timer); resolve(t); };
    const timer = setTimeout(() => done('сервер не ответил за 40 с'), 40000);
    probe.on('event', () => setTimeout(() => {
      const wrong = chat.find((t) => /неверн|wrong|incorrect/i.test(t));
      done(wrong ? 'вошёл в мир, но AuthMe не принял пароль: ' + wrong : 'вход работает: бот зашёл и прошёл AuthMe');
    }, 4000));
    probe.on('log', (t) => { if (/^кикнули/.test(t)) done(t.replace('кикнули: ', 'сервер не пустил: ').slice(0, 300)); });
  });
  probe.stop();
  b.probeText = `${new Date().toLocaleTimeString('ru-RU')} ${res}`;
  saveCfg();
  return true;
});
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
// --- менеджер чатов Qwen
const chatIdOf = (link) => { const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(link || '')); return m ? m[1] : ''; };
ipcMain.handle('chat-use', (_e, { name, link }) => {
  const b = cfg.bots.find((x) => x.name === name);
  const id = chatIdOf(link);
  if (!b || !id) throw new Error('нужна ссылка вида https://chat.qwen.ai/c/...');
  b.chatId = id; saveCfg();
  logTo(name, 'чат Qwen: ' + id);
  return true;
});
ipcMain.handle('chat-open', (_e, id) => { if (chatIdOf(id)) openMine(`${QWEN_URL}c/${chatIdOf(id)}`); return true; });
ipcMain.handle('chat-forget', (_e, { name, id }) => {
  const b = cfg.bots.find((x) => x.name === name);
  if (b) { b.chats = (b.chats || []).filter((c) => c.id !== id); if (b.chatId === id) b.chatId = ''; saveCfg(); }
  return true;
});
ipcMain.handle('chat-note', (_e, { name, id, note }) => {
  const b = cfg.bots.find((x) => x.name === name);
  const c = b && (b.chats || []).find((x) => x.id === id);
  if (c) { c.note = String(note || '').slice(0, 60); saveCfg(); }
  return true;
});
ipcMain.handle('chat-rewarm', async (_e, name) => {
  const l = live.get(name);
  const b = cfg.bots.find((x) => x.name === name);
  if (!b) throw new Error('нет такого бота');
  if (!l || !l.brain) {   // бот не запущен - прогреть всё равно можно
    const tmp = new Brain({ body: { on() {} }, bridge, cfg: () => cfg, botCfg: b, save: saveCfg, log: (t) => logTo(name, t) });
    if (!live.get(name)) live.set(name, { log: [] });
    try { await tmp.warm(b.chatId || ''); } finally { tmp.stop(); }
    return true;
  }
  await l.brain.warm(b.chatId || '');
  return true;
});
ipcMain.handle('bot-chat', (_e, name) => {
  const b = cfg.bots.find((x) => x.name === name);
  // чат бота - в окне бота; пока бот отвечает, страницу не трогаем
  showTab('bot');
  if (b && b.chatId && !bridge.busy && !qwen.webContents.getURL().includes(b.chatId)) qwen.webContents.loadURL(`${QWEN_URL}c/${b.chatId}`);
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

app.whenReady().then(() => { loadCfg();
  try { fs.writeFileSync(path.join(require('os').tmpdir(), 'totembots-start.log'), JSON.stringify({ at: new Date().toISOString(), cfg: cfgPath(), userData: app.getPath('userData'), host: cfg.host, port: cfg.port, argv: process.argv, cwd: process.cwd(), env: process.env.TOTEMBOTS_CONFIG || '' }, null, 1)); } catch {} memory = new Memory(process.env.TOTEMBOTS_MEMORY || app.getPath('userData')); worldMap = new WorldMap(process.env.TOTEMBOTS_MEMORY || app.getPath('userData')); travel = new Travel(process.env.TOTEMBOTS_MEMORY || app.getPath('userData'), worldMap); Menu.setApplicationMenu(null); createWindow();
  // боты заходят сами (настройка autostart; выключить - в config.json "autostart": false)
  if (cfg.autostart !== false) setTimeout(() => { for (const b of cfg.bots) { try { startBot(b.name); } catch (e) { logTo(b.name, 'автозапуск: ' + e.message); } } }, 8000);
});
app.on('window-all-closed', () => {
  for (const l of live.values()) if (l.body) l.body.stop();
  setTimeout(() => app.quit(), 300);
});
