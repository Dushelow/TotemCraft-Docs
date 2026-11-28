const $ = (id) => document.getElementById(id);
const T = window.totem;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let selected = '';
let st = null;              // последнее состояние из программы
const botTab = new Map();   // ник -> открытая вкладка карточки
const showPass = new Set();
let settingsFilled = false, voiceFilled = false, brainsFilled = false;

// ---------- понятные ошибки: технические сообщения - простыми словами и что сделать
const HUMAN = [
  [/ECONNREFUSED/, 'сервер не принимает подключение: он выключен или неверный адрес и порт («Настройки» → «Сервер»)'],
  [/ENOTFOUND|getaddrinfo|EAI_AGAIN/, 'адрес сервера не найден: проверьте интернет и адрес в «Настройках»'],
  [/ETIMEDOUT|timed? ?out/i, 'сервер не отвечает: проверьте интернет; если интернет есть - сервер может перезапускаться'],
  [/ECONNRESET|socket hang up|EPIPE/, 'связь с сервером оборвалась, бот переподключится сам'],
  [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/, 'нет интернета'],
  [/No path|noPath/, 'не нашла дорогу: цель за стеной или слишком далеко'],
  [/Took to long to decide path/, 'слишком долго искала дорогу: цель далеко или кругом препятствия'],
  [/goal was changed/i, 'цель поменяли по ходу'],
  [/disconnect\.quitting/, 'вышла с сервера'],
  [/duplicate_login|logged in from another location/i, 'под этим ником зашли с другого места'],
  [/whitelist|не в белом списке/i, 'ник не в белом списке сервера'],
  [/(\b429\b|rate.?limit|too many requests)/i, 'нейросеть просит подождать (лимит запросов), возьмётся следующая'],
  [/Cannot read properties of (null|undefined)|is not a function|is not defined/, 'внутренняя ошибка программы - она не ваша, напишите о ней разработчику'],
];
function human(text) {
  const t = String(text ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const h = HUMAN.find(([re]) => re.test(t));
  return h ? h[1] : t;
}

// ---------- всплывающие сообщения (вместо красной строки внизу); undo - кнопка «Вернуть» вместо «Вы уверены?»
function toast(text, kind = '', undo) {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = icon(kind === 'ok' ? 'circle-check' : kind === 'bad' ? 'circle-alert' : 'info') + '<div class="tx"></div>';
  t.querySelector('.tx').textContent = human(text);
  if (undo) {
    const b = document.createElement('button');
    b.className = 'undo'; b.textContent = undo.label || 'Вернуть';
    b.onclick = () => { t.remove(); act(undo.fn, null, undo.done); };
    t.appendChild(b);
  }
  $('toasts').appendChild(t);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => t.remove(), undo ? 10000 : kind === 'bad' ? 9000 : 5000);
}
// кнопка во время действия: крутилка и недоступна (видно, что нажатие принято)
// системные окна с возвратом фокуса (иначе поля ввода «мертвеют» после confirm в Electron)
function ask(t) { const r = window.confirm(t); try { T.refocus(); } catch {} return r; }
function tell(t) { window.alert(t); try { T.refocus(); } catch {} }
async function act(fn, btn, okText, undo) {
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try { const r = await fn(); if (okText) toast(okText, 'ok', undo); await refresh(); return r; }
  catch (e) { toast(e.message || e, 'bad'); }
  finally { if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
}
paintIcons();
T.onLoginStatus((t) => toast(t, /не вышло|ошибка|нужен вход/i.test(t) ? 'bad' : /готово|пройдена/i.test(t) ? 'ok' : ''));

// ---------- разделы
let section = 'bots';
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => {
  section = b.dataset.sec;
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('on', s.id === 'sec-' + section));
  if (st) paintTop();
}; });

// ---------- полоска над окнами сайтов
function paintStrip() {
  if (!st || !st.siteList) return;
  const v = st.view || { mode: 'work', site: 'qwen' };
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === v.mode));
  const sig = JSON.stringify([v, st.siteList]);
  if ($('siteTabs').dataset.sig !== sig) {
    $('siteTabs').dataset.sig = sig;
    $('siteTabs').innerHTML = st.siteList.map((s) => {
      const dot = s.captcha ? 'bad' : s.busy ? 'ok pulse' : s.logged ? 'ok' : '';
      const tip = s.captcha ? 'просит пройти проверку' : s.busy ? 'бот сейчас работает здесь' : s.logged ? 'вход выполнен' : 'вход не выполнен';
      return `<button data-site="${s.id}" class="${s.id === v.site ? 'on' : ''} ${!s.logged && v.mode === 'work' ? 'off' : ''}" title="${esc(s.name)}: ${tip}">${s.captcha ? icon('triangle-alert', 14).replace('class="i ', 'style="color:var(--bad)" class="i ') : `<span class="dot ${dot}"></span>`}${esc(s.name)}</button>`;
    }).join('');
  }
  const cur = st.siteList.find((s) => s.id === v.site) || {};
  let text, cls = '';
  if (v.mode === 'mine') text = `Ваше окно ${cur.name}: тот же вход, бот сюда не заходит. Здесь можно писать, менять настройки и голос.`;
  else if (cur.captcha) { text = `${cur.name} просит пройти проверку «не робот»: пройдите её прямо здесь, программа ждёт и ничего не нажимает.`; cls = 'bad'; }
  else if (cur.busy) { text = `Бот сейчас работает в этом окне: листать можно, нажимать и печатать нельзя. Писать самому - «Моё окно».`; cls = 'busy'; }
  else if (!cur.logged) { text = `Окно бота ${cur.name}: вход не выполнен. Кнопка «Войти через браузер» - в окне сайта справа.`; cls = 'bad'; }
  else text = `Окно бота ${cur.name}: бот может начать работу в любой момент. Писать самому - «Моё окно».`;
  $('stripText').textContent = text;
  if ($('stripHint').className !== 'r2 ' + cls) {
    $('stripHint').className = 'r2 ' + cls;
    $('stripHint').firstElementChild.outerHTML = icon(cls === 'bad' ? 'triangle-alert' : cls === 'busy' ? 'loader-circle' : 'info', 14, cls === 'busy' ? 'spin' : '');
  }
}
$('siteTabs').onclick = (e) => { const b = e.target.closest('[data-site]'); if (b) T.viewShow({ mode: (st.view || {}).mode || 'work', site: b.dataset.site }).then((v) => { st.view = v; paintStrip(); }); };
document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => T.viewShow({ mode: b.dataset.mode, site: (st.view || {}).site || 'qwen' }).then((v) => { st.view = v; paintStrip(); }); });
for (const [id, what] of [['navBack', 'back'], ['navReload', 'reload'], ['navHome', 'home']]) $(id).onclick = async () => { const r = await T.viewNav(what); if (r) toast(r); };
function openSite(site, mode) { T.viewShow({ mode, site }).then((v) => { st.view = v; paintStrip(); }); }

// ---------- шапка
let pausedNow = false;
function paintTop() {
  pausedNow = !!st.paused;
  // до старта - «Старт»; боты работают - «Пауза/Продолжить» и «Стоп»; рядом с названием - общее состояние
  // «Старт» вверху - только в других разделах: в «Ботах» запуск один - большая кнопка «Запустить» на стартовом экране
  $('startBtn').style.display = st.running || section === 'bots' ? 'none' : '';
  $('stopBtn').style.display = st.running ? '' : 'none';
  $('pauseBtn').style.display = st.running ? '' : 'none';
  const pb = st.paused ? 'Продолжить' : 'Пауза';
  if ($('pauseBtn').dataset.v !== pb) {
    $('pauseBtn').dataset.v = pb;
    $('pauseBtn').innerHTML = icon(st.paused ? 'play' : 'pause') + `<span>${pb}</span>`;
    $('pauseBtn').className = st.paused ? 'go' : '';
  }
  const run = !st.running ? ['', 'остановлено'] : st.paused ? ['warn', 'пауза'] : ['ok', 'работает'];
  const rp = `<span class="dot ${run[0]}${run[0] === 'ok' ? ' pulse' : ''}"></span>${run[1]}`;
  if ($('runPill').innerHTML !== rp) { $('runPill').innerHTML = rp; $('runPill').className = 'pill ' + run[0]; }
  const srv = `${icon('server', 14)}<span>Сервер</span><b>${esc(srvName(st.host))}</b>`;
  if ($('srvChip').innerHTML !== srv) $('srvChip').innerHTML = srv;
  const need = (st.siteList || []).filter((s) => s.inOrder && !s.logged).length + ((st.siteList || []).some((s) => s.captcha) ? 1 : 0);
  $('brainsBadge').style.display = need ? '' : 'none';
  $('brainsBadge').textContent = need;
  $('brainsBadge').title = 'сайты из порядка без входа или с проверкой';
}
$('srvChip').onclick = () => goSection('settings');
$('pauseBtn').onclick = () => act(() => T.pause(!pausedNow), $('pauseBtn'));
$('startBtn').onclick = () => act(() => T.botsStart(st.bots.filter((b) => b.pick).map((b) => b.name)), $('startBtn'), 'боты заходят на сервер');
$('stopBtn').onclick = () => {
  const was = st.bots.filter((b) => (b.state || {}).status && b.state.status !== 'off').map((b) => b.name);
  act(() => T.botsStop(), $('stopBtn'), 'боты вышли с сервера', { fn: () => T.botsStart(was), done: 'боты заходят обратно' });
};

// ---------- стартовый экран: пока ни один бот не запущен
const ST_ICON = { ok: 'circle-check', bad: 'circle-alert', warn: 'triangle-alert', spin: 'loader-circle', '': 'info' };
function stIcon(ic) { return `<div class="st ${ic}">${icon(ST_ICON[ic] || 'info', 18, ic === 'spin' ? 'spin' : '')}</div>`; }
function check(ic, title, hint, btn) {
  return `<div class="check">${stIcon(ic)}<div class="t"><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}</div>${btn || ''}</div>`;
}
function srvName(h) { return /^(127\.0\.0\.1|localhost)$/.test(h) ? 'этот компьютер' : h; }
function renderStart() {
  const idle = !st.running;
  $('startCard').style.display = idle ? '' : 'none';
  $('nowCard').style.display = idle ? 'none' : '';
  if (!idle) return;
  const sites = st.siteList || [];
  const ready = sites.filter((s) => s.inOrder && s.logged);
  const cap = sites.filter((s) => s.captcha);
  const picked = st.bots.filter((b) => b.pick);   // запуск - только отмеченные тумблером «в запуске»
  const B = st.brains || {};
  const pinName = B.pin ? ((B.choices || []).find((c) => c.id === B.pin) || {}).name || B.pin : '';
  const out = [
    check('ok', 'Сервер: ' + srvName(st.host), `${st.host}:${st.port}`, '<button class="ghost sm" data-go="settings">Сменить</button>'),
    cap.length ? check('bad', `${cap.map((s) => s.name).join(', ')} просит проверку «не робот»`, 'пройдите её в окне справа', '<button class="ghost sm" data-go="brains">Мозги</button>')
      : ready.length ? check('ok', 'Мозги: ' + ready.map((s) => s.name).join(', '), pinName ? 'выбран вручную: ' + pinName : 'по порядку, при лимите - следующий', '<button class="ghost sm" data-go="brains">Мозги</button>')
      : sites.some((s) => s.logged) ? check('bad', 'Вход есть, но мозг выключен', `вошли: ${sites.filter((s) => s.logged).map((s) => s.name).join(', ')} - включите галочку в разделе «Мозги»`, '<button class="pri sm" data-go="brains">Мозги</button>')
      : check('bad', 'Нет ни одного мозга с входом', 'войдите хотя бы в один сайт: раздел «Мозги»', '<button class="pri sm" data-go="brains">Войти</button>'),
    st.bots.length ? check(picked.length ? 'ok' : 'warn', picked.length ? `Запустятся: ${picked.map((b) => b.name).join(', ')}` : 'Не выбран ни один бот', 'кого запускать - переключатель «Запускать» в карточке бота')
      : check('warn', 'Ботов нет', 'добавьте первого внизу: «Добавить бота»'),
  ];
  const html = out.join('');
  if ($('startChecks').dataset.html !== html) { $('startChecks').dataset.html = html; $('startChecks').innerHTML = html; }
  $('startGo').disabled = !picked.length;
  $('startGo').lastElementChild.textContent = picked.length > 1 ? 'Запустить всех' : picked.length ? 'Запустить ' + picked[0].name : 'Запустить';
  if (document.activeElement !== $('startAuto')) $('startAuto').checked = !!st.startOnLaunch;
}
function goSection(sec) { const b = document.querySelector(`#nav button[data-sec="${sec}"]`); if (b) b.click(); }
$('startChecks').addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) goSection(g.dataset.go); });
$('startChecks').addEventListener('change', (e) => { const n = e.target.dataset.pick; if (n) act(() => T.botPick({ name: n, pick: e.target.checked })); });
$('startGo').onclick = () => act(() => T.botsStart(st.bots.filter((b) => b.pick).map((b) => b.name)), $('startGo'), 'боты заходят на сервер');
$('startAuto').onchange = () => act(() => T.startOnLaunch($('startAuto').checked), null, $('startAuto').checked ? 'при включении программы боты зайдут сами' : 'запуск только кнопкой');

// ---------- ручной выбор мозга
let pinFilled = '';
function paintPin() {
  const B = st.brains; if (!B || !B.choices) return;
  const sig = JSON.stringify([B.choices, B.pin, B.pinOnly, B.pinModel]);
  if (pinFilled === sig || document.activeElement === $('pinModel') || document.activeElement === $('pinSel')) return;
  pinFilled = sig;
  $('pinSel').innerHTML = `<option value="">Авто (по порядку)</option>` + B.choices.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('pinSel').value = B.pin || '';
  $('pinOnly').checked = !!B.pinOnly;
  $('pinModel').innerHTML = `<option value="${esc(B.pinModel || '')}">${esc(B.pinModel || '...')}</option>`; $('pinModel').value = B.pinModel || '';
  paintPinModel(); loadPinModels();
}
function paintPinModel() {
  const id = $('pinSel').value, withModel = id === 'qwen' || (id && !/web$/.test(id));
  $('pinModel').disabled = !withModel; $('pinModel').style.display = $('pinModelRe').style.display = withModel ? '' : 'none'; if (!withModel) $('pinModelNote').textContent = ''; $('pinOnly').disabled = !id;
  $('pinRow').style.display = id ? '' : 'none';
  $('pinLead').textContent = id ? `Выбран: ${$('pinSel').selectedOptions[0].textContent}. ${withModel ? 'Можно указать модель. ' : 'Модель меняется на самом сайте («Моё окно»). '}«Только он» - не переходить на запасные при лимите.`
    : 'Сейчас «авто»: бот спрашивает мозги по порядку ниже, при лимите или сбое - следующий. Выбрать один - в списке вверху.';
}
$('pinSel').onchange = () => {
  paintPinModel(); loadPinModels();
  const B = st.brains || {}, prev = { id: B.pin || '', only: !!B.pinOnly, model: B.pinModel };
  act(() => T.brainPin({ id: $('pinSel').value, only: $('pinOnly').checked, model: $('pinModel').disabled ? undefined : $('pinModel').value }), null,
    $('pinSel').value ? 'мозг: ' + $('pinSel').selectedOptions[0].textContent : 'мозг: авто, по порядку', { fn: () => { pinFilled = ''; return T.brainPin(prev); }, done: 'мозг как был' });
  $('pinSel').blur();
};
$('pinOnly').onchange = () => savePin();
$('pinModel').onchange = () => savePin();
$('pinModelRe').onclick = () => loadPinModels(true);
function savePin() {
  const B = st.brains || {}, prev = { id: B.pin || '', only: !!B.pinOnly, model: B.pinModel };
  act(() => T.brainPin({ id: $('pinSel').value, only: $('pinOnly').checked, model: $('pinModel').disabled ? undefined : $('pinModel').value }), null,
    $('pinSel').value ? 'мозг выбран: ' + $('pinSel').selectedOptions[0].textContent : 'мозг: авто', { fn: () => { pinFilled = ''; return T.brainPin(prev); }, done: 'мозг как был' });
};

// ---------- «Что сейчас происходит»
function step(ic, title, hint) { return `<div class="step">${stIcon(ic)}<div class="t"><b>${esc(title)}</b>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div></div>`; }
function renderNow() {
  const out = [];
  const sites = st.siteList || [];
  const cap = sites.filter((s) => s.captcha);
  if (cap.length) out.push(step('bad', `${cap.map((s) => s.name).join(', ')}: просит пройти проверку`, 'откройте вкладку сайта справа («Окно бота») и пройдите её - программа ждёт'));
  if (st.paused) out.push(step('warn', 'Пауза', 'боты стоят на сервере и ничего не делают сами, к нейросетям не обращаются; сообщения игроков копятся. «Продолжить» вверху - ответят и продолжат'));
  const logged = sites.filter((s) => s.inOrder && s.logged);
  out.push(logged.length ? step('ok', 'Мозги готовы: ' + logged.map((s) => s.name).join(', '), st.brains && st.brains.now ? 'сейчас думает через ' + st.brains.now : 'список и вход - раздел «Мозги»')
    : step('bad', 'Нет ни одного мозга с входом', 'раздел «Мозги»: войдите хотя бы в Qwen («Войти через браузер»)'));
  if (!st.bots.length) out.push(step('warn', 'Ботов нет', 'добавьте бота ниже: «Добавить бота»'));
  for (const b of st.bots) {
    const s = b.state || {}, br = b.brain;
    if (s.status === 'connecting') { out.push(step('spin', `${b.name} заходит на сервер`, 'вход и пароль AuthMe - секунд 10')); continue; }
    if (s.status !== 'online') continue;
    if (!br) continue;
    if (br.resting) out.push(step('bad', 'Мозг отдыхает: лимит у всех нейросетей', `снова попробует через ${br.resting} мин. Войдите в другой аккаунт или добавьте сайт или ключ в «Мозгах»`));
    else if (br.thinking) out.push(step('spin', `Думает... ${br.thinking.secs} с`, 'о чём: ' + br.thinking.about + (br.queue ? ` · в очереди ещё ${br.queue}` : '')));
    else if (!br.chat) out.push(step('spin', 'Мозг просыпается', 'скоро откроется его чат, и бот начнёт жить сам'));
    else out.push(step('ok', 'Мозг на связи', br.nextFree >= 0 ? `своё дело придумает через ${br.nextFree > 60 ? Math.ceil(br.nextFree / 60) + ' мин' : br.nextFree + ' с'}, если раньше никто не позовёт` : 'свободная воля выключена'));
    if (br.last) {
      const ago = Math.round((Date.now() - br.last.at) / 1000);
      const what = [br.last.say && `сказал «${br.last.say}»`, br.last.acts.length && 'делает: ' + br.last.acts.join(', ')].filter(Boolean).join('; ') || 'решил ничего не делать';
      out.push(step('', `Последнее решение, ${ago < 60 ? ago + ' с' : Math.round(ago / 60) + ' мин'} назад`, what + (br.last.model ? ` · ${br.last.model}` : '')));
    }
    if (br.goal) out.push(step('', 'Цель: ' + br.goal, 'поставил себе сам и продолжает между делами'));
  }
  const html = out.join('');
  if ($('steps').innerHTML !== html) $('steps').innerHTML = html;
}

// ---------- карточки ботов
// вид строки журнала: чат, мозг (что получил и решил), ошибка, остальное - тело
const ERR = /ошибка|не получилось|не смогла|не вышло|кикнули|отклонен|Error|ECONN|ETIMEDOUT/;
function logKind(l) {
  if (/\[(общий|рядом|личка|клан|сервер)\]|\[голос\]/.test(l)) return 'chat';
  if (ERR.test(l)) return 'err';
  if (/ → | ← |мозг|Qwen|DeepSeek|Gemini|Arena|Claude|думает|прогрет/.test(l)) return 'brain';
  return 'body';
}
function logLine(l) {
  const k = logKind(l);
  const cls = / → /.test(l) ? 'in' : / ← /.test(l) ? 'out' : k === 'chat' ? 'chat' : k === 'err' ? 'err' : '';
  const h = k === 'err' ? human(l) : l;
  return `<div class="${cls}">${esc(l)}${h !== l ? `<div class="hint">↳ ${esc(h)}</div>` : ''}</div>`;
}
const logFilter = new Map();   // ник -> что показывать в журнале
const LOGF = [['all', 'Всё', 'list-checks'], ['chat', 'Чат', 'message-square'], ['brain', 'Мозг', 'brain'], ['body', 'Тело', 'footprints'], ['err', 'Ошибки', 'triangle-alert']];
function logLines(b) { const f = logFilter.get(b.name) || 'all'; return b.log.filter((l) => f === 'all' || logKind(l) === f); }
function errCount(b) { return b.log.filter((l) => logKind(l) === 'err').length; }
const TABS = [['life', 'Жизнь', 'heart'], ['log', 'Журнал', 'scroll-text'], ['behave', 'Поведение', 'smile'], ['chats', 'Чаты', 'message-circle'], ['persona', 'Характер', 'sparkles'], ['map', 'Карта', 'map'], ['server', 'Доступ', 'key-round']];
function meter(ic, val, label) {
  const v = Math.max(0, Math.min(20, +val || 0)), cls = v <= 6 ? 'bad' : v <= 12 ? 'warn' : '';
  return `<div class="meter ${cls}" title="${label} ${v} из 20">${icon(ic, 14)}<div class="bar"><i style="width:${v * 5}%"></i></div><span>${v}</span></div>`;
}
function doingText(s, on) {
  return s.mode === 'follow' ? `идёт за ${s.follow}` : s.mode === 'task' ? `занят: ${s.task}` : s.mode === 'ride' ? 'едет' : s.mode === 'life' ? 'своё: ' + s.task
    : s.mode === 'hold' ? 'ждёт на месте' : s.mode === 'paused' ? 'пауза' : on ? 'свободен' : '';
}
function botCard(b) {
  const s = b.state || {};
  const on = s.status === 'online', conn = s.status === 'connecting', off = !on && !conn;
  const where = on ? `${s.dim} · ${s.pos.join(' ')}` : conn ? 'заходит на сервер…' : 'выключен';
  const power = off && !st.running ? '' : off ? `<button data-a="start" class="go sm" title="Зайти на сервер">${icon('play', 14)}Включить</button>`
    : `<button data-a="stop" class="ghost sm" title="Бот выйдет с сервера">${icon('power', 14)}Выключить</button>`;
  const head = `<div class="bothead"><div class="ava">${esc(b.name[0] || '?').toUpperCase()}<span class="dot ${on ? 'ok' : conn ? 'warn pulse' : ''}"></span></div>
    <div class="grow"><div class="nm">${esc(b.name)}</div><div class="sub">${esc(where)}</div></div>${power}<label class="sw" title="${b.pick ? 'Запускается кнопкой «Запустить» и при автозапуске' : 'Кнопкой «Запустить» не запускается (включить можно вручную в карточке)'}"><input type="checkbox" data-pick="${esc(b.name)}" ${b.pick ? 'checked' : ''}><span class="tr"><span class="th"></span></span><span class="sl">Запускать</span></label></div>`;
  const stats = on ? `<div class="meters">${meter('heart', s.health, 'здоровье')}${meter('drumstick', s.food, 'еда')}
    <div class="doing">${icon(s.mode === 'paused' ? 'circle-pause' : s.mode === 'hold' ? 'hand' : s.mode === 'follow' ? 'footprints' : 'activity', 14)}<b>${esc(doingText(s, on))}</b></div></div>` : '';
  // поручение: шаги с отметками - видно, где бот и что не вышло; продолжить и отменить - тут же
  const E = s.errand;
  const errand = E ? `<div class="errand ${E.state}">
    <div class="eh">${icon(E.state === 'run' ? 'loader-circle' : E.state === 'stuck' ? 'triangle-alert' : 'circle-pause', 14, E.state === 'run' ? 'spin' : '')}<b>${E.state === 'run' ? 'Поручение' : E.state === 'stuck' ? 'Поручение застряло' : 'Поручение на паузе'}</b>
      <span class="grow"></span>${E.state !== 'run' ? `<button data-a="errandGo" class="go sm">${icon('play', 14)}Продолжить</button>` : ''}<button data-a="errandStop" class="quiet sm" title="Отменить поручение">${icon('x', 14)}Отменить</button></div>
    <ol>${E.steps.map((x, i) => `<li class="${x.st} ${i === E.cur ? 'cur' : ''}">${icon(x.st === 'done' ? 'check' : x.st === 'fail' ? 'circle-alert' : i === E.cur ? 'activity' : 'hourglass', 13)}<span>${esc(x.title)}${x.note && (x.st === 'fail' || i === E.cur) ? `<em>${esc(x.note)}</em>` : ''}</span></li>`).join('')}</ol></div>` : '';
  const faults = (Array.isArray(s.parts) ? s.parts : []).filter((h) => h.n);
  const health = faults.length ? `<div class="muted" style="margin-top:var(--s2);color:#ffa3a6" title="${esc(faults.map((h) => h.part + ': ' + h.last).join('\n'))}">${icon('triangle-alert', 13)} сбои: ${faults.map((h) => `${esc(h.part)} ×${h.n}`).join(', ')} - подробно в журнале; часть можно выключить в «Настройках»</div>` : '';
  if (b.name !== selected) return `<div class="card bot" data-name="${esc(b.name)}" title="Открыть">${head}${stats}${health}${errand}</div>`;
  const tab = botTab.get(b.name) || 'life';
  const inv = s.items ? Object.entries(s.items).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
  let body = '';
  if (tab === 'log') {
    const n = errCount(b), f = logFilter.get(b.name) || 'all';
    body = `
    <div class="logbar"><div class="seg">${LOGF.map(([k, t, ic]) => `<button data-a="logf" data-v="${k}" class="${f === k ? 'on' : ''}" title="${t}">${icon(ic, 13)}${t}${k === 'err' && n ? ` <span class="pill bad" style="height:16px;padding:0 5px">${n}</span>` : ''}</button>`).join('')}</div><button class="ghost sm" data-a="transcript" title="Что ушло нейросети и что она ответила - дословно, в блокноте">${icon('scroll-text', 13)}Переписка с нейросетью</button></div>
    <div class="log" data-f="log">${logLines(b).map(logLine).join('') || '<div class="hint">здесь пока пусто</div>'}</div>
    <div class="compose"><input class="grow" data-f="order" placeholder="Приказ, как в игре: иди за мной, отнеси шерсть…"><button data-a="order" class="pri icon" title="Отправить (Enter)" aria-label="Отправить">${icon('send')}</button></div>
    ${inv ? `<div class="muted" style="margin-top:var(--s2)">${icon('folder-open', 13)} ${esc(inv)}</div>` : ''}`;
  }
  if (tab === 'behave') body = `
    <label>На что отзывается в чате${b.attention ? ` · обращений ${b.attention.address}, рядом ${b.attention.near}, в фон ${b.attention.background}` : ''}</label>
    <div class="seg">${[['quiet', 'Тихий'], ['normal', 'Обычный'], ['social', 'Общительный']].map(([v, t]) => `<button data-a="chatmode" data-v="${v}" class="${b.chatMode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="muted" style="margin-top:6px">Тихий - только личка и имя. Обычный - ещё ближний чат и хозяин рядом. Общительный - сам заговаривает с теми, кто рядом.</div>
    <label>Прозвища, на которые откликается (через запятую)</label>
    <div class="row"><input class="grow" data-f="aliases" value="${esc(b.aliases || '')}" placeholder="алексик, сашка"></div>
    <label>Как близко идти за вами: <b data-f="fdv">${b.followDist || 3}</b> бл. (в игре можно сказать «ближе» или «подальше»)</label>
    <input type="range" data-f="fd" min="1.5" max="10" step="0.5" value="${b.followDist || 3}">
    <label>Мобы</label>
    <div class="seg">${[['defend', 'Защищать', 'shield'], ['flee', 'Убегать ко мне', 'footprints'], ['off', 'Не трогать', 'hand']].map(([v, t, ic]) => `<button data-a="combat" data-v="${v}" class="${b.combat === v ? 'on' : ''}">${icon(ic, 13)}${t}</button>`).join('')}</div>`;
  if (tab === 'chats') body = `
    <div class="muted">Текущий чат: ${b.chatId ? esc(b.chatId.slice(0, 8)) + '…' : 'нет (начнётся при первом сообщении)'}</div>
    <div class="row" style="margin-top:var(--s2)"><button data-a="chat" class="sm" ${b.chatId ? '' : 'disabled'}>${icon('app-window', 14)}Показать</button><button data-a="rewarm" class="sm" title="повторить вводную в этом чате">${icon('sparkles', 14)}Прогреть заново</button><button data-a="newchat" class="sm">${icon('plus', 14)}Новый чат</button></div>
    <div class="row" style="margin-top:var(--s2)"><input class="grow" data-f="chatLink" placeholder="ссылка на чат Qwen https://chat.qwen.ai/c/…"><button data-a="chatUse">Взять</button></div>
    <div class="box">${(b.chats || []).map((c) => `<div class="chatrow ${c.id === b.chatId ? 'cur' : ''}" data-id="${esc(c.id)}">
      <span class="grow"><b>${esc(c.note || c.id.slice(0, 8) + '…')}</b> <span class="muted">${new Date(c.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
      ${c.id === b.chatId ? '<span class="pill acc">текущий</span>' : `<button data-a="chatPick" class="quiet sm" title="Сделать текущим">${icon('check', 14)}Взять</button>`}
      <button data-a="chatOpen" class="quiet icon sm" title="Открыть в моём окне Qwen" aria-label="Открыть">${icon('external-link', 14)}</button>
      <button data-a="chatNote" class="quiet icon sm" title="Подписать" aria-label="Подписать">${icon('pencil', 14)}</button><button data-a="chatForget" class="quiet icon sm" title="Убрать из списка (в Qwen чат останется)" aria-label="Убрать">${icon('x', 14)}</button>
    </div>`).join('') || `<div class="empty">${icon('message-circle', 22)}чатов пока нет</div>`}</div>`;
  if (tab === 'persona') body = `
    <label>Характер (после сохранения начнётся новый чат)</label><textarea data-f="persona" rows="8">${esc(b.persona || '')}</textarea>
    <div class="row" style="margin-top:var(--s3)"><button data-a="savePersona" class="pri">${icon('check', 14)}Сохранить характер</button></div>`;
  if (tab === 'map') body = `<div data-f="mapslot"></div>`;
  if (tab === 'life') body = lifeTab(b);
  if (tab === 'server') body = `
    <div class="muted">Один раз выполнить на сервере (консоль или в игре от админа, с «/» в начале):</div>
    ${[['Аккаунт AuthMe', `authme register ${b.name} ${b.password}`], ['Если аккаунт уже есть - новый пароль', `authme changepassword ${b.name} ${b.password}`],
       ['Наш аддон античита не наказывает бота', `lp user ${b.name} permission set totemguard.bypass true`]].map(([t, c]) => `
      <label>${t}</label><div class="row" style="flex-wrap:nowrap"><span class="cmd grow">${esc(showPass.has(b.name) ? c : c.replace(b.password, '•'.repeat(8)))}</span><button data-a="copy" data-cmd="${esc(c)}" class="quiet icon sm" title="Копировать" aria-label="Копировать">${icon('copy', 14)}</button></div>`).join('')}
    <div class="muted" style="margin-top:var(--s2)">Доступ к вашим сундукам LWC даёт администратор через базу LWC.</div>
    <div class="row" style="margin-top:var(--s3)"><button data-a="pass" class="sm">${icon(showPass.has(b.name) ? 'eye-off' : 'eye', 14)}${showPass.has(b.name) ? 'Скрыть пароль' : 'Показать пароль'}</button>
      <button data-a="newpass" class="sm">${icon('key-round', 14)}Новый пароль</button><button data-a="probe" class="sm" title="зайти и сразу выйти: проверить пароль и доступ">${icon('log-in', 14)}Проверить вход</button></div>
    <div class="row" style="margin-top:var(--s3)"><span class="muted grow">${esc(b.probe || '')}</span><button data-a="remove" class="danger sm">${icon('trash-2', 14)}Удалить бота</button></div>`;
  return `<div class="card bot sel" data-name="${esc(b.name)}">${head}${stats}${health}${errand}
    <div class="tabs2">${TABS.map(([k, t, ic]) => `<button data-a="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>${body}</div>`;
}

let lastHtml = '';
function renderBots() {
  const box = $('bots');
  // при запуске ни одна карточка не раскрыта: раскрывается по щелчку (22.11)
  const sel = st.bots.find((b) => b.name === selected);
  const log = box.querySelector('[data-f="log"]');
  // не перерисовывать карточку, пока человек печатает: только журнал
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    if (sel && log) { const end = log.scrollTop + log.clientHeight >= log.scrollHeight - 20; log.innerHTML = logLines(sel).map(logLine).join(''); if (end) log.scrollTop = log.scrollHeight; }
    return;
  }
  const html = st.bots.map(botCard).join('') || `<div class="card empty">${icon('bot', 28)}<b>Ботов пока нет</b>добавьте первого кнопкой ниже</div>`;
  if (html === lastHtml) return;
  const atEnd = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 20, top = log ? log.scrollTop : 0;
  box.innerHTML = html; lastHtml = html;
  const log2 = box.querySelector('[data-f="log"]');
  if (log2) log2.scrollTop = atEnd ? log2.scrollHeight : top;
  if ((botTab.get(selected) || 'life') === 'map') drawMap();
}

$('bots').addEventListener('click', (e) => {
  const card = e.target.closest('.bot');
  if (!card) return;
  const name = card.dataset.name, t = e.target.closest('[data-a]'), a = t && t.dataset.a;
  if (!a) { if (selected !== name) { selected = name; lastHtml = ''; renderBots(); } return; }
  const f = (n) => card.querySelector(`[data-f="${n}"]`);
  const re = () => { lastHtml = ''; };
  if (a === 'tab') { botTab.set(name, t.dataset.v); re(); renderBots(); return; }
  if (a === 'lifeOpen') { lifeOpen(); return; }
  if (a === 'fullreset' && ask('Сбросить данные бота? Он забудет всё: память, карту, людей, чаты с нейросетью, журналы. Остаются сервер, ник хозяина и вход. Копия сохранится в папке local/backup-..., программа перезапустится.')) { T.fullReset(); return; }
  if (a === 'transcript') { T.openTranscript(name).then((ok) => { if (!ok) tell('Переписки пока нет: она появится после первого ответа нейросети'); }); return; }
  if (a === 'logf') { logFilter.set(name, t.dataset.v); re(); renderBots(); const lg = $('bots').querySelector('[data-f="log"]'); if (lg) lg.scrollTop = lg.scrollHeight; return; }
  if (a === 'start') act(() => T.botStart(name), t);
  if (a === 'stop') act(() => T.botStop(name), t, name + ' вышел с сервера', { fn: () => T.botStart(name), done: name + ' заходит обратно' });
  if (a === 'order') { const v = f('order').value.trim(); if (v) act(async () => { await T.botOrder({ name, text: v }); f('order').value = ''; f('order').blur(); }, t, 'приказ отправлен'); }
  if (a === 'chat') act(() => T.botChat(name), t);
  if (a === 'errandGo') act(() => T.botOrder({ name, text: 'продолжай' }), t, 'поручение продолжается');
  if (a === 'errandStop') act(() => T.botOrder({ name, text: 'отбой' }), t, 'поручение отменено');
  if (a === 'pass') { showPass.has(name) ? showPass.delete(name) : showPass.add(name); re(); renderBots(); }
  if (a === 'copy') { navigator.clipboard.writeText(t.dataset.cmd); toast('скопировано', 'ok'); }
  if (a === 'newpass' && ask('Сделать новый пароль? Потом выполните на сервере «authme changepassword», иначе бот не войдёт.')) act(() => T.botNewPass(name), t, 'новый пароль создан');
  if (a === 'probe') act(() => T.botProbe(name), t);
  if (a === 'rewarm') act(() => T.chatRewarm(name), t, 'вводная отправлена заново');
  if (a === 'chatUse') act(async () => { await T.chatUse({ name, link: f('chatLink').value }); f('chatLink').value = ''; f('chatLink').blur(); re(); }, t);
  const cid = t.closest('.chatrow') && t.closest('.chatrow').dataset.id;
  if (a === 'chatOpen') act(() => T.chatOpen(cid), t);
  if (a === 'chatPick') act(async () => { await T.chatUse({ name, link: cid }); re(); }, t);
  if (a === 'chatForget') act(async () => { await T.chatForget({ name, id: cid }); re(); }, t);
  if (a === 'chatNote') {   // подпись прямо в строке: Enter - сохранить, Esc - отмена
    const label = t.closest('.chatrow').querySelector('b');
    const inp = document.createElement('input');
    inp.value = label.textContent.endsWith('…') ? '' : label.textContent; inp.placeholder = 'подпись, Enter';
    label.replaceWith(inp); inp.focus();
    inp.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') { const v = inp.value; inp.blur(); act(async () => { await T.chatNote({ name, id: cid, note: v }); re(); }); }
      if (k.key === 'Escape') { inp.blur(); re(); renderBots(); }
    });
  }
  if (a === 'chatmode') act(async () => { await T.botChatMode({ name, mode: t.dataset.v }); re(); });
  if (a === 'aliases') act(async () => { await T.botChatMode({ name, aliases: f('aliases').value }); f('aliases').blur(); re(); }, t, 'прозвища сохранены');
  if (a === 'combat') act(async () => { await T.botCombat({ name, combat: t.dataset.v }); re(); });
  if (a === 'newchat') act(() => T.botNewChat(name), t, 'начнётся новый чат');
  if (a === 'savePersona') act(async () => { await T.botPersona({ name, persona: f('persona').value }); f('persona').blur(); re(); }, t, 'характер сохранён');
  if (a === 'remove' && ask(`Удалить бота ${name}? Пароль его аккаунта на сервере забудется.`)) act(() => T.botRemove(name), t);
});
// тумблер «в запуске» в карточке бота
$('bots').addEventListener('change', (e) => { const n = e.target.dataset && e.target.dataset.pick; if (n) { e.stopPropagation(); act(async () => { await T.botPick({ name: n, pick: e.target.checked }); lastHtml = ''; }, null, e.target.checked ? `${n}: запускается вместе со всеми` : `${n}: не запускается вместе со всеми`); } });
$('bots').addEventListener('input', (e) => { if (e.target.dataset.f === 'fd') { const c = e.target.closest('.bot'); c.querySelector('[data-f="fdv"]').textContent = e.target.value; } });
$('bots').addEventListener('change', (e) => {
  if (e.target.dataset.f === 'aliases') { const name = e.target.closest('.bot').dataset.name; act(async () => { await T.botChatMode({ name, aliases: e.target.value }); lastHtml = ''; }, null, 'прозвища сохранены'); return; } if (e.target.dataset.f === 'fd') { const name = e.target.closest('.bot').dataset.name; e.target.blur(); act(async () => { await T.botFollowDist({ name, dist: +e.target.value }); lastHtml = ''; }); } });
$('bots').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.f === 'order') { e.preventDefault(); e.target.closest('.bot').querySelector('[data-a="order"]').click(); }
});
function addOpen(open) { $('addBox').style.display = open ? '' : 'none'; $('addToggle').style.display = open ? 'none' : ''; if (open) $('newName').focus(); }
$('addToggle').onclick = () => addOpen(true);
$('newName').addEventListener('keydown', (e) => { if (e.key === 'Escape') addOpen(false); if (e.key === 'Enter') $('add').click(); });
$('add').onclick = () => act(async () => {
  const name = $('newName').value.trim();
  if (!name) throw new Error('впишите ник');
  await T.botAdd({ name, persona: $('newPersona').value });
  selected = name; botTab.set(name, 'server'); $('newName').value = ''; $('newPersona').value = ''; addOpen(false); lastHtml = '';
}, $('add'), 'бот добавлен: выполните команды на сервере');

// ---------- мозги: все сайты одинаково
let sitesSig = '';
function renderSites() {
  const sig = JSON.stringify(st.siteList);
  if (sig === sitesSig) return;
  sitesSig = sig;
  $('siteList').innerHTML = st.siteList.map((s) => {
    const pill = s.captcha ? `<span class="pill bad">${icon('triangle-alert', 12)}просит проверку</span>` : s.busy ? `<span class="pill acc">${icon('loader-circle', 12, 'spin')}работает</span>`
      : s.logged ? `<span class="pill ok">${icon('check', 12)}вошёл</span>` : '<span class="pill">нужен вход</span>';
    return `<div class="site"><div class="nm"><span class="dot ${s.logged ? 'ok' : ''}"></span>${esc(s.name)} ${pill}${s.inOrder ? '' : ' <span class="pill" title="не в порядке мозгов: бот его не спрашивает">не используется</span>'}</div>
      <div class="acts">${s.captcha ? `<button class="pri sm" data-site-work="${s.id}" title="пройти проверку в окне бота">${icon('triangle-alert', 14)}Пройти проверку</button>`
        : s.logged ? `<button class="sm" data-site-work="${s.id}" title="окно, где работает бот">${icon('app-window', 14)}Окно бота</button><button class="sm" data-site-mine="${s.id}" title="ваше окно с тем же входом: писать самому, менять модель и голос">${icon('user', 14)}Моё окно</button>
          <button class="quiet sm" data-site-test="${s.id}" title="проверить, отвечает ли">${icon('activity', 14)}Проверить</button>`
        : `<button class="pri sm" data-site-login="${s.id}" title="откроется ваш браузер (Chrome или Firefox): войдите там, вход перенесётся в программу">${icon('log-in', 14)}Войти через браузер</button><button class="sm" data-site-work="${s.id}" title="войти прямо в окне программы">${icon('app-window', 14)}Окно бота</button>
          ${s.id !== 'qwen' ? `<button class="quiet sm" data-site-mark="${s.id}" title="уже вошли прямо в окне сайта">${icon('check', 14)}Я вошёл</button>` : ''}`}</div></div>`;
  }).join('');
}
$('siteList').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.siteWork) openSite(t.dataset.siteWork, 'work');
  if (t.dataset.siteMine) openSite(t.dataset.siteMine, 'mine');
  if (t.dataset.siteLogin) act(() => T.siteLogin(t.dataset.siteLogin), t);
  if (t.dataset.siteMark) act(() => T.siteMarkLogged(t.dataset.siteMark), t, 'отмечено: вошёл');
  if (t.dataset.siteTest) act(async () => {
    const site = t.dataset.siteTest;
    const r = site === 'qwen' ? (await T.qwenState()).loggedIn ? 'Qwen: вход выполнен' : 'Qwen: нужен вход' : await T.siteTest(site);
    toast(r, /ошибка|нужен/.test(r) ? 'bad' : 'ok');
  }, t);
});
// Заполнить выпадающий список моделей ответом 'brain-models'. Сохранённой модели нет у сервиса - оставить её с пометкой,
// чтобы человек видел и выбрал другую (молча подменять нельзя: бот вдруг станет думать иначе)
function fillModels(sel, r, keep) {
  const cur = keep !== undefined ? keep : r.model, list = r.list || [];
  const opts = (r.auto !== undefined ? [{ id: '', name: r.auto }] : []).concat(list);
  if (cur && !opts.some((m) => m.id === cur)) opts.unshift({ id: cur, name: cur + (list.length ? ' - такой модели у сервиса нет, выберите другую' : '') });
  sel.innerHTML = opts.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  sel.value = cur || (opts[0] || {}).id || '';
}
async function loadKeyModels(k, key) {
  const sel = document.querySelector(`[data-model="${k}"]`), note = document.querySelector(`[data-mnote="${k}"]`); if (!sel) return;
  if (note) note.textContent = 'спрашиваю список моделей...';
  const r = await T.brainModels({ id: k, key: key || '' }).catch((e) => ({ list: [], note: e.message }));
  fillModels(sel, r, sel.value || r.model);
  if (note) { note.textContent = r.note || ('моделей у сервиса: ' + (r.list || []).length); note.style.color = r.bad ? 'var(--bad, #c33)' : ''; }
}
async function loadPinModels(refresh) {
  const id = $('pinSel').value, sel = $('pinModel'); if (!id || sel.disabled) { $('pinModelNote').textContent = ''; return; }
  $('pinModelNote').textContent = 'спрашиваю список моделей...';
  const r = await T.brainModels({ id, refresh: !!refresh }).catch((e) => ({ list: [], note: e.message }));
  if ($('pinSel').value !== id) return;
  fillModels(sel, r, (st.brains || {}).pin === id ? st.brains.pinModel : r.model);
  $('pinModelNote').textContent = r.note || '';
}
function renderBrains() {
  renderSites();
  const B = st.brains; if (!B) return;
  $('brainsNow').textContent = (B.now ? 'сейчас думает: ' + B.now + '. ' : '') + 'включены: ' + (B.active.join(', ') || '-');
  if (brainsFilled) return;
  brainsFilled = true;
  $('brainOrder').value = B.order.join(', ');
  renderOrder(B);
  $('brainKeys').innerHTML = Object.entries(B.presets).map(([k, p]) => `<label style="display:flex;align-items:center;gap:6px">${esc(p.name)} ${B.has[k] ? `<span class="pill ok">${icon('check', 12)}ключ вставлен</span>` : ''}<span class="grow"></span><a href="#" data-url="${esc(p.keyUrl)}" class="keylink">где взять ${icon('external-link', 12)}</a></label>
    <div class="row"><input class="grow" data-key="${k}" placeholder="${B.has[k] ? 'пусто - оставить, «-» - удалить' : 'вставьте ключ'}"><select style="width:42%" data-model="${k}" title="модель: список берётся у сервиса по ключу"><option value="${esc(B.models[k])}">${esc(B.models[k])}</option></select></div><div class="muted" data-mnote="${k}" style="margin:2px 0 6px"></div>`).join('')
    + `<div class="row" style="margin-top:var(--s3)"><button id="keysSave" class="pri">${icon('check')}Сохранить ключи</button></div>`;
  document.querySelectorAll('.keylink').forEach((a) => { a.onclick = (e) => { e.preventDefault(); T.openExternal(a.dataset.url); }; });
  // 28.11: модель - только из списка сервиса (текстом легко ошибиться в символе). Вставил ключ - сразу спросить список,
  // заодно видно, подходит ли ключ
  document.querySelectorAll('[data-key]').forEach((i) => { i.onchange = () => loadKeyModels(i.dataset.key, i.value.trim() === '-' ? '' : i.value); });
  for (const k of Object.keys(B.presets)) loadKeyModels(k);
  $('keysSave').onclick = () => saveBrains($('keysSave'));
}
function saveBrains(btn) {
  return act(async () => {
    const keys = {}, models = {};
    document.querySelectorAll('[data-key]').forEach((i) => { keys[i.dataset.key] = i.value; i.value = ''; });
    document.querySelectorAll('[data-model]').forEach((i) => { models[i.dataset.model] = i.value; });
    await T.brainsSave({ keys, models, order: $('brainOrder').value });
    brainsFilled = false;
  }, btn, 'сохранено');
}
$('brainOrder').addEventListener('change', () => saveBrains(null));
$('pEnabled').onchange = () => act(() => T.projectEnable($('pEnabled').checked));
$('pOpen').onclick = () => act(() => T.projectOpen(), $('pOpen'));
$('pSync').onclick = () => act(() => T.projectSync(), $('pSync'), 'память обновлена');

// ---------- голос
const VOICE_NAMES = { 'ru_RU-denis-medium': 'Денис (мужской)', 'ru_RU-dmitri-medium': 'Дмитрий (мужской)', 'ru_RU-ruslan-medium': 'Руслан (мужской)', 'ru_RU-irina-medium': 'Ирина (женский)' };
function piperText(p) { return !p ? '' : p.program && p.voice ? 'Piper скачан, голос готов' : p.program ? 'Piper скачан, этот голос нет: нажмите «Скачать»' : 'Piper не скачан: «Скачать» (около 85 МБ)'; }
function fillVoice(v) {
  if (!v || !v.piper) return;
  if (!voiceFilled) {
    $('vEnabled').checked = !!v.enabled; $('vProvider').value = v.provider; $('vFallback').checked = !!v.fallback; $('vEcho').checked = v.echo !== false;
    $('vLocal').checked = !!v.local; $('vPlasmo').checked = !!v.plasmo; $('vVolume').value = v.volume;
    $('vPiperVoice').innerHTML = v.piper.voices.map((n) => `<option value="${n}">${VOICE_NAMES[n] || n}</option>`).join('');
    $('vPiperVoice').value = v.piperVoice;
    if (v.edge) { $('vEdgeVoice').innerHTML = Object.entries(v.edge.voices).map(([k, n]) => `<option value="${k}">${n}</option>`).join(''); $('vEdgeVoice').value = v.edgeVoice; }
    $('vEdgeRate').value = v.edgeRate || 0; $('vEdgePitch').value = v.edgePitch || 0; $('vSapiRate').value = $('vSapiRate2').value = v.sapiRate || 0;
    voiceSaved = v; loadSapi();
    if (v.silero) { $('vSileroVoice').innerHTML = Object.entries(v.silero.voices).map(([k, n]) => `<option value="${k}">${n}</option>`).join(''); $('vSileroVoice').value = v.sileroVoice || 'xenia'; }
    voiceFilled = true;
  }
  showEng();
  if (!$('vStatus').dataset.busy) $('vStatus').textContent = engText(v);
}
// состояние выбранного способа одной строкой
function engText(v) {
  const p = $('vProvider').value;
  if (p === 'silero') return v.silero && v.silero.program && v.silero.voice ? 'Silero установлен' : 'Silero не установлен: «Скачать»';
  if (p === 'edge') return v.edge && v.edge.program ? 'Edge TTS установлен' : 'Edge TTS не установлен: «Скачать» (около 10 МБ)';
  if (p === 'piper') return piperText(v.piper);
  if (p === 'rhvoice') return sapiInfo ? (sapiInfo.rh.voices[$('vRhVoice').value] || {}).installed ? 'этот голос RHVoice установлен' : 'этот голос RHVoice не установлен: «Установить»' : 'спрашиваю Windows о голосах...';
  if (p === 'system') return sapiInfo ? `голосов в Windows: ${sapiInfo.list.length}` : '';
  return '';
}
// под выбранным способом - только его настройки
function showEng() { for (const d of document.querySelectorAll('.veng')) d.hidden = d.dataset.eng !== $('vProvider').value;
  const pc = (x, u) => `${+x > 0 ? '+' : ''}${x}${u}`;
  $('vEdgeRateV').textContent = pc($('vEdgeRate').value, '%'); $('vEdgePitchV').textContent = pc($('vEdgePitch').value, ' Гц');
  $('vSapiRateV').textContent = $('vSapiRateV2').textContent = pc($('vSapiRate').value, ''); }
let voiceSaved = null, sapiInfo = null;
// голоса Windows и RHVoice: Windows отвечает 1-2 с, спрашиваем отдельно
async function loadSapi() {
  try { sapiInfo = await T.voiceSapi(); } catch { return; }
  const v = voiceSaved || {};
  $('vRhVoice').innerHTML = Object.entries(sapiInfo.rh.voices).map(([k, x]) => `<option value="${k}">${x.name}${x.installed ? '' : ' - не установлен'}</option>`).join('');
  $('vRhVoice').value = v.rhVoice || 'Aleksandr';
  $('vSystemVoice').innerHTML = '<option value="">Голос Windows по умолчанию</option>' + sapiInfo.list.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${esc(x.lang)})</option>`).join('');
  $('vSystemVoice').value = v.systemVoice || '';
  if (!$('vStatus').dataset.busy) $('vStatus').textContent = engText(v);
}
const voiceForm = () => ({ enabled: $('vEnabled').checked, provider: $('vProvider').value, fallback: $('vFallback').checked, echo: $('vEcho').checked,
  local: $('vLocal').checked, plasmo: $('vPlasmo').checked, volume: $('vVolume').value, piperVoice: $('vPiperVoice').value, sileroVoice: $('vSileroVoice').value,
  edgeVoice: $('vEdgeVoice').value, edgeRate: $('vEdgeRate').value, edgePitch: $('vEdgePitch').value,
  rhVoice: $('vRhVoice').value || (voiceSaved || {}).rhVoice, systemVoice: $('vSystemVoice').options.length ? $('vSystemVoice').value : (voiceSaved || {}).systemVoice,
  sapiRate: $('vSapiRate').value });
// сохранение сразу при изменении - без кнопки «Сохранить»
$('sec-voice').addEventListener('change', (e) => { if (e.target.closest('input,select')) { if (e.target.id === 'vSapiRate2') $('vSapiRate').value = e.target.value; showEng(); if (voiceSaved) $('vStatus').textContent = engText(voiceSaved); act(() => T.voiceSave(voiceForm()), null, 'сохранено'); } });
$('sec-voice').addEventListener('input', (e) => { if (e.target.type === 'range') { if (e.target.id === 'vSapiRate2') $('vSapiRate').value = e.target.value; if (e.target.id === 'vSapiRate') $('vSapiRate2').value = e.target.value; showEng(); } });
$('vInstallEdge').onclick = () => act(async () => {
  await T.voiceSave(voiceForm());
  $('vStatus').dataset.busy = '1';
  try { voiceSaved = { ...voiceSaved, edge: await T.voiceInstallEdge() }; } finally { delete $('vStatus').dataset.busy; }
}, $('vInstallEdge'), 'Edge TTS установлен');
$('vInstallRh').onclick = () => act(async () => { await T.voiceSave(voiceForm()); await T.voiceInstallRh($('vRhVoice').value); }, $('vInstallRh'));
$('vSapiRe').onclick = $('vSapiRe2').onclick = () => act(() => loadSapi(), null, 'список голосов обновлён');
$('vInstall').onclick = () => act(async () => {
  await T.voiceSave(voiceForm());
  $('vStatus').dataset.busy = '1';
  try { await T.voiceInstallPiper(); } finally { delete $('vStatus').dataset.busy; }
}, $('vInstall'));
$('vInstallSilero').onclick = () => act(async () => {
  await T.voiceSave(voiceForm());
  $('vStatus').dataset.busy = '1';
  try { await T.voiceInstallSilero(); } finally { delete $('vStatus').dataset.busy; }
}, $('vInstallSilero'), 'Silero установлен');
$('vTest').onclick = () => act(async () => { await T.voiceSave(voiceForm()); await T.voiceTest(selected); }, $('vTest'));
T.onVoiceStatus((t) => { $('vStatus').textContent = t; });
// проигрывание: реплики по очереди, не накладываются
let audioCtx = null, playUntil = 0;
T.onVoicePcm(({ pcm, rate, volume }) => {
  audioCtx = audioCtx || new AudioContext();
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const n = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const buf = audioCtx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
  const src = audioCtx.createBufferSource(), gain = audioCtx.createGain();
  gain.gain.value = +volume;
  src.buffer = buf; src.connect(gain).connect(audioCtx.destination);
  const at = Math.max(audioCtx.currentTime + 0.05, playUntil);
  src.start(at); playUntil = at + buf.duration + 0.15;
});
T.onVoiceSystem(({ text, volume }) => {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU'; u.volume = +volume;
  const ru = speechSynthesis.getVoices().find((v) => /^ru/i.test(v.lang));
  if (ru) u.voice = ru;
  speechSynthesis.speak(u);
});

// ---------- настройки
document.querySelectorAll('#srvSeg button').forEach((b) => { b.onclick = () => { $('host').value = b.dataset.h; $('port').value = b.dataset.p; paintSrvSeg(); }; });
function paintSrvSeg() { document.querySelectorAll('#srvSeg button').forEach((b) => b.classList.toggle('on', b.dataset.h === $('host').value.trim() && b.dataset.p === $('port').value.trim())); }
$('host').oninput = paintSrvSeg; $('port').oninput = paintSrvSeg;
const saveSettings = () => act(() => T.saveSettings({ host: $('host').value, port: $('port').value, masters: $('masters').value, birthYear: $('birthYear').value, chatMode: $('chatMode').value, planMode: $('planMode').value, models: $('models').value, serviceModels: $('serviceModels').value }),
  null, 'сохранено' + (st.running ? ' (новый сервер - после перезапуска ботов)' : ''));
$('sec-settings').addEventListener('change', (e) => { if (e.target.closest('input,select') && !e.target.dataset.part) saveSettings(); });
document.querySelectorAll('#srvSeg button').forEach((b) => b.addEventListener('click', () => saveSettings()));

// ---------- части тела: выключатели (health.js)
const PARTS = [['nav', 'Ходьба по форме блоков', 'выключить - ходьба как раньше, модулем пути'], ['passcache', 'Кэш мира (пути через невидимые места)', ''], ['senses', 'Чувства: кто приближается, угроза', ''],
  ['hearing', 'Слух', ''], ['marks', 'Метки по ситуации', ''], ['torches', 'Факелы в пещерах', ''], ['atlas', 'Атлас: ледяные ветки, таблички', ''], ['hands', 'Что держать в руках', ''], ['reflexes', 'Рефлексы (огонь, вода, еда)', ''], ['gestures', 'Жесты: узнаёт и показывает без слов', 'двойной присед, кивок, мотание головой, «за мной», показать на блок, подарок, сесть рядом на ступеньку'], ['companion', 'Компаньон: занятия рядом, взгляд, жесты, реплики', 'когда хозяин стоит - не столбом, а у костра, верстака, книг; сама поворачивается к тому, кто заговорил'], ['balance', 'Равновесие после толчка', 'тело тянет прочь от лавы и обрыва, если отбросило']];
let featSig = '';
function renderFeatures() {
  const F = st.features || {}, sig = JSON.stringify(F);
  if (sig === featSig) return; featSig = sig;
  $('features').innerHTML = PARTS.map(([k, t, h]) => `<label class="chk" title="${esc(h)}"><input type="checkbox" data-part="${k}" ${F[k] === false ? '' : 'checked'}> ${esc(t)}</label>`).join('');
}
$('features').addEventListener('change', (e) => { const k = e.target.dataset.part; if (k) act(() => T.feature({ part: k, on: e.target.checked }), null, (e.target.checked ? 'включено: ' : 'выключено: ') + PARTS.find((p) => p[0] === k)[1]); });

// ---------- карта бота: чанки вокруг (бот в центре, север сверху)
// ---------- карта бота (22.11: «дёргается и неудобная»). Холст живёт сам по себе и не пересоздаётся с карточкой;
// чанки рисуются один раз в маленькие картинки и только переставляются; вид в координатах мира: тянуть мышью,
// колесо - ближе/дальше, двойной щелчок или «К боту» - снова следить за ботом (плавно, без скачков по чанкам).
const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ZOOMS = [1, 2, 3, 4, 6, 8, 12];
const POI_COL = { 'сундуки': '#ffd23f', 'портал': '#b05cff', 'ферма': '#3ba55d', 'деревня': '#5fd3ff', 'кровать': '#ffffff', 'спавнер': '#ff4d4d', 'мастерская': '#ff9ff3' };
const ENT_COL = { enemy: '#ff4d4d', animal: '#f2f2f2', villager: '#58d68d', vehicle: '#a0703c', player: '#5fa8ff' };
const MAP = { wrap: null, cv: null, tiles: new Map(), slices: new Map(), data: null, bot: '', dim: '', x: 0, z: 0, zoom: 3, follow: true, layer: 'auto', hover: null, drag: null, dirty: true, busy: false };
function mapTile(colors, c) {
  const [, , , k, built, px, hy, wd, my] = c;
  const t = document.createElement('canvas'); t.width = t.height = 16;
  const g = t.getContext('2d'), img = g.createImageData(16, 16), D = img.data;
  const OLD = { w: [47, 95, 158], l: [168, 56, 44], g: [74, 77, 82] };
  const hAt = (i) => { const hv = A64.indexOf(hy[i * 2]) * 64 + A64.indexOf(hy[i * 2 + 1]); return hv ? hv - 1 + my : null; };
  for (let i = 0; i < 256; i++) {
    let col;
    if (px) {
      col = colors[A64.indexOf(px[i])] || [0, 0, 0];
      let f = 1;
      const h0 = hy ? hAt(i) : null, hn = hy && i >= 16 ? hAt(i - 16) : null;
      if (h0 !== null && hn !== null) f = h0 > hn ? 1.15 : h0 < hn ? 0.82 : 1;
      if (wd) { const d = A64.indexOf(wd[i]); if (d) f = 1.1 - Math.min(0.55, d * 0.05); }
      col = [col[0] * f, col[1] * f, col[2] * f];
    } else col = built >= 12 ? [200, 129, 58] : OLD[k] || OLD.g;
    D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return t;
}
function mapEnsure() {
  if (MAP.wrap) return MAP.wrap;
  const w = document.createElement('div');
  w.className = 'mapw';
  w.innerHTML = `<div class="mapbar"><button class="ghost sm" data-m="follow" title="Следить за ботом (двойной щелчок по карте)">${icon('bot', 13)}К боту</button>
    <button class="ghost sm" data-m="in" title="Ближе (колесо мыши)">${icon('plus', 13)}</button><button class="ghost sm" data-m="out" title="Дальше (колесо мыши)">−</button>
    <div class="seg"><button data-m="auto" title="Под землёй и в Незере - срез на высоте бота">Авто</button><button data-m="surface" title="Всегда поверхность сверху">Поверхность</button></div>
    <span class="grow"></span><span class="muted" data-m="pos"></span></div>
    <canvas class="mapc"></canvas>
    <details class="maplegend"><summary class="muted">Что на карте</summary><div class="muted">Север сверху, бот - белая стрелка (куда смотрит). Круги: жёлтый - сундуки, фиолетовый - портал, зелёный - ферма, голубой - деревня, белый - кровать, красный - спавнер. Квадратики: красные - враги, белые - животные, зелёные - жители, синие - игроки. Ромбы с подписью - места из памяти. Тянуть мышью - двигать карту, колесо - ближе или дальше.</div></details>
    <div class="muted" data-m="info"></div>`;
  MAP.wrap = w; MAP.cv = w.querySelector('canvas');
  const cv = MAP.cv;
  const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: MAP.x + (e.clientX - r.left - r.width / 2) / MAP.zoom, z: MAP.z + (e.clientY - r.top - r.height / 2) / MAP.zoom }; };
  cv.addEventListener('mousedown', (e) => { MAP.drag = { x: e.clientX, y: e.clientY, mx: MAP.x, mz: MAP.z }; });
  window.addEventListener('mouseup', () => { if (MAP.drag && !MAP.follow) mapFetch(); MAP.drag = null; });
  cv.addEventListener('mousemove', (e) => {
    if (MAP.drag) { const dx = e.clientX - MAP.drag.x, dy = e.clientY - MAP.drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) MAP.follow = false; if (!MAP.follow) { MAP.x = MAP.drag.mx - dx / MAP.zoom; MAP.z = MAP.drag.mz - dy / MAP.zoom; } }
    MAP.hover = toWorld(e); MAP.dirty = true;
  });
  cv.addEventListener('mouseleave', () => { MAP.hover = null; MAP.dirty = true; });
  cv.addEventListener('dblclick', () => { MAP.follow = true; MAP.dirty = true; mapFetch(); });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toWorld(e), i = ZOOMS.indexOf(MAP.zoom), ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    if (ni === i) return;
    MAP.zoom = ZOOMS[ni];
    if (!MAP.follow) { const after = toWorld(e); MAP.x += before.x - after.x; MAP.z += before.z - after.z; }
    MAP.dirty = true; mapFetch();
  }, { passive: false });
  w.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m, i = ZOOMS.indexOf(MAP.zoom);
    if (m === 'follow') MAP.follow = true;
    if (m === 'in') MAP.zoom = ZOOMS[Math.min(ZOOMS.length - 1, i + 1)];
    if (m === 'out') MAP.zoom = ZOOMS[Math.max(0, i - 1)];
    if (m === 'auto' || m === 'surface') { MAP.layer = m; try { localStorage.setItem('mapLayer', m); } catch {} }
    MAP.dirty = true; mapFetch();
  });
  try { MAP.layer = localStorage.getItem('mapLayer') || 'auto'; MAP.zoom = +localStorage.getItem('mapZoom') || 3; } catch {}
  if (!ZOOMS.includes(MAP.zoom)) MAP.zoom = 3;
  new ResizeObserver(() => { MAP.dirty = true; }).observe(cv);
  requestAnimationFrame(mapFrame);
  return w;
}
async function mapFetch() {
  if (MAP.busy || !MAP.wrap || !MAP.wrap.isConnected || !selected) return;
  MAP.busy = true;
  try {
    if (MAP.bot !== selected) { MAP.bot = selected; MAP.tiles.clear(); MAP.follow = true; MAP.data = null; }
    const cv = MAP.cv, r = Math.min(28, Math.ceil(Math.max(cv.clientWidth, cv.clientHeight) / MAP.zoom / 32) + 2);
    const known = {};
    for (const [k, t] of MAP.tiles) known[k] = t.t;
    const v = await T.botMap({ name: selected, known, layer: MAP.layer, r, ...(MAP.follow ? {} : { cx: MAP.x, cz: MAP.z }) });
    if (!v) return;
    if (v.dim !== MAP.dim) { MAP.dim = v.dim; MAP.tiles.clear(); MAP.follow = true; MAP.data = null; return mapLater(); }
    for (const c of v.chunks) { const k = c[0] + ',' + c[1]; if (c.length > 3) MAP.tiles.set(k, { t: c[2], img: mapTile(v.colors, c) }); }
    MAP.slices = new Map(v.slice.map((s) => [s[0] + ',' + s[1], mapTile(v.colors, [s[0], s[1], 0, 'g', 0, s[2], s[3], '', s[4]])]));
    if (!MAP.data) { MAP.x = v.me[0]; MAP.z = v.me[2]; }
    MAP.data = v; MAP.dirty = true;
  } catch {} finally { MAP.busy = false; }
}
function mapLater() { setTimeout(() => { MAP.busy = false; mapFetch(); }, 50); }
function mapFrame() {
  requestAnimationFrame(mapFrame);
  const cv = MAP.cv, v = MAP.data;
  if (!cv || !cv.isConnected || !v) return;
  // плавно за ботом: центр подтягивается к нему, без скачков
  if (MAP.follow) { const dx = v.me[0] - MAP.x, dz = v.me[2] - MAP.z; if (Math.abs(dx) + Math.abs(dz) > 0.05) { MAP.x += dx * 0.2; MAP.z += dz * 0.2; MAP.dirty = true; } }
  if (!MAP.dirty) return;
  MAP.dirty = false;
  const dpr = window.devicePixelRatio || 1, Wc = cv.clientWidth, Hc = cv.clientHeight;
  if (!Wc || !Hc) return;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#111214'; g.fillRect(0, 0, Wc, Hc);
  const Z = MAP.zoom, sx = (x) => Wc / 2 + (x - MAP.x) * Z, sz = (z) => Hc / 2 + (z - MAP.z) * Z;
  const c0x = Math.floor((MAP.x - Wc / 2 / Z) / 16), c1x = Math.floor((MAP.x + Wc / 2 / Z) / 16), c0z = Math.floor((MAP.z - Hc / 2 / Z) / 16), c1z = Math.floor((MAP.z + Hc / 2 / Z) / 16);
  const under = !!v.layer;
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const k = cx + ',' + cz, s = under && MAP.slices.get(k), t = MAP.tiles.get(k);
    const img = s || (t && t.img);
    if (!img) continue;
    if (under && !s) g.globalAlpha = 0.35;   // под землёй: дальние чанки - поверхность бледно
    const X = Math.round(sx(cx * 16)), Y = Math.round(sz(cz * 16));
    g.drawImage(img, X, Y, Math.round(sx(cx * 16 + 16)) - X, Math.round(sz(cz * 16 + 16)) - Y);
    g.globalAlpha = 1;
  }
  // точки мест: одна на клетку 10x10 пикселей одного вида (в городе сотни сундуков - иначе каша)
  const seenPoi = new Set();
  // свет по времени суток (как у миникарт): день - как есть, сумерки - тёплые, ночь - тёмно-синяя; под землёй и в Незере - без
  const lt = mapLight(v);
  if (lt) { g.fillStyle = lt; g.fillRect(0, 0, Wc, Hc); }
  // зоны: запрет - красная штриховая область, опасно - жёлтая
  for (const q of v.zones || []) {
    const red = q.k === 'запрет';
    g.beginPath();
    if (q.poly) q.poly.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    else g.arc(sx(q.x + 0.5), sz(q.z + 0.5), q.r * Z, 0, 7);
    g.closePath();
    g.fillStyle = red ? 'rgba(229,72,77,.18)' : 'rgba(233,162,59,.16)'; g.fill();
    g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = red ? 'rgba(229,72,77,.9)' : 'rgba(233,162,59,.9)'; g.stroke(); g.setLineDash([]);
    if (q.r * Z > 18) { g.font = '600 11px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; const t = (red ? 'нельзя: ' : 'опасно: ') + q.n; g.strokeText(t, sx(q.x + 0.5), sz(q.z + 0.5)); g.fillStyle = red ? '#ffb4b6' : '#ffd99a'; g.fillText(t, sx(q.x + 0.5), sz(q.z + 0.5)); }
  }
  for (const [x, z, kind] of v.poi) {
    const X = sx(x + 0.5), Y = sz(z + 0.5);
    if (X < -8 || Y < -8 || X > Wc + 8 || Y > Hc + 8) continue;
    const key = kind + ':' + Math.floor(X / 10) + ',' + Math.floor(Y / 10);
    if (seenPoi.has(key)) continue; seenPoi.add(key);
    g.fillStyle = POI_COL[kind] || '#bbb'; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(X, Y, Math.max(2.5, Z * 0.6), 0, 7); g.fill(); g.stroke();
  }
  for (const [x, z, k] of v.ents) { const s = Math.max(4, Z); g.fillStyle = ENT_COL[k] || '#ccc'; g.strokeStyle = '#000'; g.lineWidth = 1; g.fillRect(sx(x + 0.5) - s / 2, sz(z + 0.5) - s / 2, s, s); g.strokeRect(sx(x + 0.5) - s / 2, sz(z + 0.5) - s / 2, s, s); }
  // подписи мест: без наложения (ближние к боту - первыми), мелким шрифтом
  g.font = '600 12px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  const boxes = [], me = v.me;
  for (const [x, z, name] of [...v.labels].sort((a, c) => Math.hypot(a[0] - me[0], a[1] - me[2]) - Math.hypot(c[0] - me[0], c[1] - me[2]))) {
    const X = sx(x + 0.5), Y = sz(z + 0.5);
    if (X < -40 || Y < -20 || X > Wc + 40 || Y > Hc + 20) continue;
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(X, Y - 5); g.lineTo(X + 4, Y); g.lineTo(X, Y + 5); g.lineTo(X - 4, Y); g.closePath(); g.fill();
    const tw = g.measureText(name).width, bx = { l: X - tw / 2 - 2, r: X + tw / 2 + 2, t: Y - 22, b: Y - 6 };
    if (boxes.some((o) => o.l < bx.r && bx.l < o.r && o.t < bx.b && bx.t < o.b)) continue;
    boxes.push(bx);
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(name, X, Y - 7); g.fillStyle = '#fff'; g.fillText(name, X, Y - 7);
  }
  // бот: стрелка по взгляду (в Minecraft вперёд = (-sin yaw, -cos yaw))
  const bx = sx(me[0]), bz = sz(me[2]), yaw = me[3], fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  g.save(); g.translate(bx, bz); g.rotate(Math.atan2(fz, fx) + Math.PI / 2);
  g.fillStyle = '#fff'; g.strokeStyle = '#e5484d'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke(); g.restore();
  // масштаб и север
  const len = [8, 16, 32, 64, 128].find((n) => n * Z >= 60) || 128;
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(8, Hc - 26, len * Z + 16, 20); g.fillStyle = '#fff'; g.fillRect(16, Hc - 14, len * Z, 2);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = '11px Segoe UI, sans-serif'; g.fillText(len + ' бл.', 18, Hc - 17);
  g.textAlign = 'center'; g.font = '700 12px Segoe UI, sans-serif'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText('С', Wc - 14, 18); g.fillStyle = '#fff'; g.fillText('С', Wc - 14, 18);
  // под курсором: координаты и что там
  const pos = MAP.wrap.querySelector('[data-m="pos"]');
  if (MAP.hover) {
    const hx = Math.floor(MAP.hover.x), hz = Math.floor(MAP.hover.z), rr = Math.max(1, 6 / Z);
    const near = (list) => list.find((q) => Math.abs(q[0] - hx) <= rr && Math.abs(q[1] - hz) <= rr && q[2]);
    const what = near(v.ents.map((e) => [Math.floor(e[0]), Math.floor(e[1]), e[3] || e[2]])) || near(v.labels) || near(v.poi);
    pos.textContent = `${hx} ${hz}${what ? ' - ' + what[2] : ''} (${Math.round(Math.hypot(hx - me[0], hz - me[2]))} бл. от бота)`;
  } else pos.textContent = `бот: ${Math.floor(me[0])} ${Math.floor(me[1])} ${Math.floor(me[2])}`;
  MAP.wrap.querySelectorAll('[data-m="auto"],[data-m="surface"]').forEach((b) => b.classList.toggle('on', b.dataset.m === MAP.layer));
  MAP.wrap.querySelector('[data-m="follow"]').classList.toggle('on', MAP.follow);
  const info = MAP.wrap.querySelector('[data-m="info"]');
  const it = `${v.layer ? 'Сейчас: ' + v.layer + ' (тёмное - стены, чёрное - обрыв). ' : ''}Исследовано чанков: ${v.total}.`;
  if (info.textContent !== it) info.textContent = it;
  try { localStorage.setItem('mapZoom', String(MAP.zoom)); } catch {}
}
/** Цвет «света» поверх карты по времени суток (0 - полдень). null - не затемнять. */
function mapLight(v) {
  if (v.layer || !/overworld/.test(v.dim || '')) return null;
  const t = ((v.time || 0) % 24000 + 24000) % 24000;
  // доля ночи 0..1: 12000-13800 темнеет, 22200-24000 светает
  const night = t < 12000 ? 0 : t < 13800 ? (t - 12000) / 1800 : t < 22200 ? 1 : (24000 - t) / 1800;
  const dusk = (t > 11000 && t < 13800) || (t > 22000 || t < 800) ? 0.12 : 0;
  const rain = v.rain ? 0.12 : 0;
  if (night > 0.02) return `rgba(8, 14, 42, ${Math.min(0.62, night * 0.58 + rain)})`;
  if (dusk) return `rgba(255, 140, 60, ${dusk})`;
  return rain ? `rgba(30, 40, 60, ${rain})` : null;
}
function drawMap() {
  const slot = document.querySelector('.bot.sel [data-f="mapslot"]');
  if (!slot || LIFE.open) return;
  const w = mapEnsure();
  if (w.parentNode !== slot) slot.appendChild(w);
  MAP.dirty = true;
  mapFetch();
}
setInterval(() => { if ((botTab.get(selected) || 'life') === 'map') mapFetch(); }, 2000);

// ---------- «Жизнь»: окно наблюдения в духе фэнтези-RPG (22.11, бриф владельца по образцу Merchant RPG).
// В центре - живой вид глазами бота из настоящих текстур клиента владельца (eyeview.js), а не нарисованная сцена;
// значки предметов - настоящие (mctex.js). Шапка, персонаж, миникарта, вкладки (инвентарь, задания, отношения,
// журнал), мысли. Всё из данных тела, без выдумок. Выход - «Выйти» или Esc; раскладка 1920-1366 и узкие окна.
const LIFE = { wrap: null, sig: {}, skins: {}, open: false, lastNote: 0, art: {}, icons: {}, iconAsk: new Set(), tab: 'inv', filter: 'all', eyeAt: 0 };
const MOOD_COL = { ok: '#8fc45a', warn: '#e8a33d', bad: '#e0533d', muted: '#b7a68a', accent: '#e6c36a' };
const ART = { frame: 'ui/frames/ui_frame_panel_9s', wood: 'textures/tex_wood_tile', parchment: 'textures/tex_parchment_tile', slot: 'ui/frames/ui_slot', portrait: 'ui/frames/ui_frame_portrait', banner: 'ui/frames/ui_banner_title', icons: 'ui/icons/ui_icons_atlas',
  scene_day: 'scenes/bg_scene_overworld_day', scene_dusk: 'scenes/bg_scene_overworld_dusk', scene_night: 'scenes/bg_scene_overworld_night', scene_dawn: 'scenes/bg_scene_overworld_dawn', scene_cave: 'scenes/bg_scene_cave', scene_nether: 'scenes/bg_scene_nether', scene_snow: 'scenes/bg_scene_snow' };
function artLoad(w) {
  for (const [n, f] of Object.entries(ART)) {
    const im = new Image(), src = `assets/${f}.png`;
    im.onload = () => { LIFE.art[n] = true; w.style.setProperty('--art-' + n, `url("${src}")`); w.classList.add('art-' + n); LIFE.sig = {}; };
    im.src = src;
  }
}
function skinFace(url, s = 9) {
  if (!url) return `<div class="lface ghost" style="width:${8 * s}px;height:${8 * s}px"></div>`;
  const p = (x, y) => `<div style="position:absolute;inset:0;background:url('${url}') -${x * s}px -${y * s}px / ${64 * s}px ${64 * s}px;image-rendering:pixelated"></div>`;
  return `<div class="lface" style="width:${8 * s}px;height:${8 * s}px">${p(8, 8)}${p(40, 8)}</div>`;
}
// значок предмета: настоящий из клиента; пока не пришёл или нет такого - аккуратная подпись, а не фигура
function itemIcon(name) {
  const n = String(name || '');
  const url = LIFE.icons[n];
  if (url === undefined) LIFE.iconAsk.add(n);
  if (url) return `<img class="lic" src="${url}" alt="" draggable="false">`;
  return `<span class="lic none">${esc(n.replace(/_/g, ' ').slice(0, 10))}</span>`;
}
function iconsFetch() {
  if (!LIFE.iconAsk.size) return;
  const ask = [...LIFE.iconAsk].slice(0, 60); ask.forEach((n) => LIFE.iconAsk.delete(n));
  for (const n of ask) LIFE.icons[n] = LIFE.icons[n] ?? null;
  T.itemIcons(ask).then((m) => { for (const [k, v] of Object.entries(m || {})) LIFE.icons[k] = v || ''; LIFE.sig.tabbody = LIFE.sig.gear = LIFE.sig.bars = LIFE.sig.wealth = null; if (LIFE.open) lifeDraw(); }).catch(() => {});
}
// вид предмета (для фильтра и подсказки)
const KIND = (n) => /_sword$|^bow$|^crossbow$|^trident$|^mace$|_spear$|_axe$/.test(n) ? 'оружие' : /_helmet$|_chestplate$|_leggings$|_boots$|^shield$|elytra/.test(n) ? 'броня' : /_pickaxe$|_shovel$|_hoe$|^shears$|^fishing_rod$|flint_and_steel|bucket/.test(n) ? 'инструмент'
  : /bread|beef|pork|chicken|mutton|cod|salmon|apple|carrot|potato|cookie|cake|pie|stew|soup|melon_slice|berries|beetroot|kelp|rabbit/.test(n) ? 'еда' : /^(diamond|emerald|gold_ingot|iron_ingot|netherite_ingot|netherite_scrap|copper_ingot|amethyst_shard|lapis_lazuli|redstone|quartz|coal)$|_nugget$|raw_/.test(n) ? 'ценности' : 'блоки и прочее';
const RARE = (n) => /netherite|elytra|totem|enchanted|nether_star|beacon|dragon/.test(n) ? 'epic' : /diamond|emerald|golden_apple/.test(n) ? 'rare' : /iron|gold|copper|lapis|redstone/.test(n) ? 'fine' : '';
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'только что' : s < 3600 ? Math.round(s / 60) + ' мин назад' : s < 86400 ? Math.round(s / 3600) + ' ч назад' : Math.round(s / 86400) + ' дн назад'; };
// тип записи журнала - цвет и подпись
const LOGKIND = (e) => /дерётся|бой|убегает|отбила|погиб|удержалась/.test(e.x) ? 'fight' : /отметила|в путь|осматрива|деревн|нашла|место/.test(e.x) ? 'explore' : /не вышло/.test(e.x) ? 'fail' : /жест|сказала|присела|приседает|кивнул|мотает|машет/.test(e.x) ? 'social' : /достала|взяла|подобрала|бросила|подарила|постригла/.test(e.x) ? 'loot' : 'life';
const RU_SLOT = { hand: 'в руке', off: 'вторая рука', head: 'шлем', chest: 'нагрудник', legs: 'поножи', feet: 'ботинки' };

function lifeEnsure() {
  if (LIFE.wrap) return LIFE.wrap;
  const w = document.createElement('div');
  w.className = 'lifeov';
  w.innerHTML = `<header class="lhud">
      <div class="llogo">TotemBots<span>наблюдение</span></div>
      <div class="lpill live" title="Тело и мозг действуют сами, вы только смотрите"><i></i>сама живёт</div>
      <div class="lpill" data-l="clock"></div>
      <div class="lpill lgrow" data-l="doinghud"></div>
      <div class="lpill" data-l="wealth"></div>
      <label class="lpill lquiet" title="Не пишет в общий и ближний чат - можно молча наблюдать. Личка хозяину остаётся. В игре: «тихо» / «можешь говорить»"><input type="checkbox" data-l="quiet"><span>Тихо</span></label>
      <button class="lpill lbtn" data-l="close" title="Вернуться (Esc)">${icon('x', 15)}<span>Выйти</span></button></header>
    <main class="lmain">
      <aside class="lcard lchar">
        <div class="lchead"><div class="lportrait" data-l="face"></div><div class="lwho"><div class="lname" data-l="name"></div><div class="lclass">компаньон · <span data-l="mood"></span></div><div class="lxp" data-l="xp"></div></div></div>
        <div class="lbars" data-l="bars"></div>
        <h3>Снаряжение</h3><div class="lgear" data-l="gear"></div>
        <h3>Жизнь в цифрах</h3><div class="lstats" data-l="stats"></div>
      </aside>
      <div class="lview">
        <div class="lscreen" data-l="screen"><img class="leye" data-l="eye" alt=""><div class="lscene" data-l="scene"></div>
          <div class="lvhud"><span data-l="place"></span><span data-l="compass"></span></div>
          <div class="lact" data-l="act"></div><div class="lnotes" data-l="notes"></div></div>
      </div>
      <aside class="lright">
        <div class="lcard lmini"><h3>${icon('map', 14)} Карта</h3><div data-l="mapslot" class="lmapslot"></div><div class="lwhere" data-l="where"></div></div>
        <div class="lcard lthink"><h3>${icon('message-circle', 14)} Мысли</h3><div data-l="thoughts"></div></div>
      </aside>
      <div class="lcard ltabs">
        <nav class="ltabbar" data-l="tabbar"></nav>
        <div class="ltabbody" data-l="tabbody"></div>
      </div>
    </main>`;
  w.querySelector('[data-l="quiet"]').addEventListener('change', (e) => { T.botQuiet({ name: selected, on: e.target.checked }); });
  w.querySelector('[data-l="close"]').addEventListener('click', () => lifeClose());
  w.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-flt]'); if (!t) return;
    if (t.dataset.tab) LIFE.tab = t.dataset.tab; if (t.dataset.flt) LIFE.filter = t.dataset.flt;
    LIFE.sig.tabbar = LIFE.sig.tabbody = null; lifeDraw();
  });
  artLoad(w);
  LIFE.wrap = w;
  return w;
}
function lifeOpen() {
  const w = lifeEnsure();
  if (!w.isConnected) document.body.appendChild(w);
  LIFE.open = true; LIFE.sig = {};
  try { T.panelFull(true); } catch {}
  setTimeout(() => w.classList.add('on'), 16);
  const slot = w.querySelector('[data-l="mapslot"]'), m = mapEnsure();
  if (m.parentNode !== slot) slot.appendChild(m);
  MAP.dirty = true; mapFetch();
  lifeDraw();
}
function lifeClose() {
  if (!LIFE.wrap) return;
  LIFE.open = false;
  try { T.panelFull(false); } catch {}
  LIFE.wrap.classList.remove('on');
  setTimeout(() => { if (!LIFE.open && LIFE.wrap.isConnected) LIFE.wrap.remove(); lastHtml = ''; renderBots(); }, 220);
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && LIFE.open) lifeClose(); });
setInterval(() => { if (LIFE.open) mapFetch(); }, 2000);
// живой вид: кадр раз в ~0,4 с, пока окно открыто
setInterval(async () => {
  if (!LIFE.open || !LIFE.wrap || !selected) return;
  try { const f = await T.botEye(selected); const img = LIFE.wrap.querySelector('[data-l="eye"]'); if (f && img) { if (img.src !== f) img.src = f; LIFE.eyeAt = Date.now(); } } catch {}
  LIFE.wrap.querySelector('[data-l="screen"]').classList.toggle('live', Date.now() - LIFE.eyeAt < 4000);
}, 400);
function lifeSet(key, html) { if (LIFE.sig[key] === html) return; LIFE.sig[key] = html; const el = LIFE.wrap.querySelector(`[data-l="${key}"]`); if (el) el.innerHTML = html; }
function lifeTab(b) {
  const v = b.state && b.state.life;
  return `<div class="lifeteaser"><div><b>${v ? esc(v.doing) : 'бот не в игре'}</b><div class="muted">${v ? esc(v.mood.w) + ' · ' + esc(v.time) + ' · ' + esc(v.weather) : 'запустите бота, и здесь появится его жизнь'}</div></div>
    <button class="pri" data-a="lifeOpen">${icon('eye', 15)}Открыть «Жизнь» ${esc(b.name)}</button></div>`;
}
function lifeDraw() {
  if (!LIFE.open || !LIFE.wrap) return;
  const b = st.bots.find((x) => x.name === selected), v = b && b.state && b.state.life;
  if (!v) { lifeSet('doinghud', 'бот не в игре - запустите бота, и здесь появится его жизнь'); return; }
  if (v.skin && LIFE.skins[v.skin] === undefined) { LIFE.skins[v.skin] = ''; T.botSkin(v.skin).then((d) => { LIFE.skins[v.skin] = d || ''; LIFE.sig.face = null; }).catch(() => {}); }
  const skin = LIFE.skins[v.skin] || '';
  // шапка
  lifeSet('clock', `${icon(v.time === 'ночь' ? 'circle-pause' : 'sparkles', 14)}<b>День ${v.day}</b> ${esc(v.clock)} · ${esc(v.time)}${v.weather !== 'ясно' ? ' · ' + esc(v.weather) : ''}`);
  lifeSet('doinghud', `${icon('activity', 14)} ${esc(v.doing)}`);
  lifeSet('wealth', `${itemIcon('emerald')}<b>${v.emeralds}</b>${itemIcon('diamond')}<b>${v.diamonds}</b>`);
  const q = LIFE.wrap.querySelector('[data-l="quiet"]'); if (document.activeElement !== q) q.checked = !!v.quiet;
  // персонаж
  lifeSet('face', skinFace(skin, window.innerWidth < 760 ? 7 : 9));
  lifeSet('name', esc(v.name));
  lifeSet('mood', `<span class="lmood" style="--mc:${MOOD_COL[v.mood.c] || '#b7a68a'}">${esc(v.mood.w)}</span>`);
  lifeSet('xp', `<span>ур. ${v.xp}</span><div><i style="width:${v.xpp}%"></i></div><span>${v.xpp}%</span>`);
  const bar = (ic, val, max, cls, t) => `<div class="lbar ${cls}" title="${t}">${itemIcon(ic)}<div><i style="width:${Math.max(0, Math.min(100, val / max * 100))}%"></i><span>${val} / ${max}</span></div></div>`;
  lifeSet('bars', bar('red_dye', v.hp, 20, 'hp', 'здоровье') + bar('cooked_beef', v.food, 20, 'food', 'сытость') + bar('iron_chestplate', v.armor, 4, 'arm', 'броня, частей'));
  lifeSet('gear', ['hand', 'off', 'head', 'chest', 'legs', 'feet'].map((k) => `<div class="lslot ${v.gear[k] ? RARE(v.gear[k]) : 'empty'}" title="${RU_SLOT[k]}: ${esc((v.gear[k] || 'пусто').replace(/_/g, ' '))}">${v.gear[k] ? itemIcon(v.gear[k]) : `<em>${RU_SLOT[k]}</em>`}</div>`).join(''));
  lifeSet('stats', [['пройдено', Math.round(v.stats['пройдено блоков'] || 0).toLocaleString('ru-RU') + ' бл.'], ['событий', v.stats['событий в дневнике'] || 0], ['знает людей', v.stats['людей знает'] || 0], ['мест в памяти', v.places || 0]]
    .map(([k, n]) => `<div class="lstat"><b>${n}</b><span>${k}</span></div>`).join(''));
  // вид: живой кадр или (пока кадра нет) сцена по времени суток
  const tod = MAP.data && MAP.data.time !== undefined ? MAP.data.time : 6000;
  const scr = LIFE.wrap.querySelector('[data-l="screen"]');
  scr.dataset.tod = tod > 13000 && tod < 23000 ? 'night' : tod > 11500 && tod <= 13000 ? 'dusk' : 'day';
  lifeSet('place', esc([v.where.split(';')[0], v.biome].filter(Boolean).join(' · ')));
  lifeSet('compass', `${esc(v.dim)} ${v.pos.join(' ')}`);
  lifeSet('act', v.doing ? `<span>${esc(v.doing)}</span>` : '');
  const top = v.diary[0];
  if (top && top.t > LIFE.lastNote) {
    if (LIFE.lastNote) { const n = document.createElement('div'); n.className = 'lnote ' + LOGKIND(top); n.textContent = top.x; LIFE.wrap.querySelector('[data-l="notes"]').appendChild(n); setTimeout(() => n.remove(), 4200); }
    LIFE.lastNote = top.t;
  }
  // справа
  lifeSet('where', esc([v.where, v.near.length ? 'рядом: ' + v.near.join(', ') : ''].filter(Boolean).join(' · ')));
  lifeSet('thoughts', v.thoughts.length ? v.thoughts.slice(0, 4).map((x) => `<div class="lth ${x.said ? 'said' : ''}"><em>${x.said ? 'сказала' : 'думает'} · ${ago(x.t)}</em>${esc(x.x)}</div>`).join('') : '<div class="lmuted">пока молчит</div>');
  // вкладки
  const TABS = [['inv', 'Инвентарь', v.items.length], ['quest', 'Задания', (v.quest ? 1 : 0) + (v.goal ? 1 : 0)], ['rel', 'Отношения', v.rel.length], ['log', 'Журнал', v.diary.length]];
  lifeSet('tabbar', TABS.map(([k, t, n]) => `<button data-tab="${k}" class="${LIFE.tab === k ? 'on' : ''}">${t}<i>${n}</i></button>`).join(''));
  let body = '';
  if (LIFE.tab === 'inv') {
    const kinds = ['all', 'оружие', 'броня', 'инструмент', 'еда', 'ценности', 'блоки и прочее'];
    const list = v.items.filter(([n]) => LIFE.filter === 'all' || KIND(n) === LIFE.filter);
    const cells = list.map(([n, c]) => `<div class="lslot ${RARE(n)}" title="${esc(n.replace(/_/g, ' '))} ×${c} · ${KIND(n)}">${itemIcon(n)}${c > 1 ? `<b>${c}</b>` : ''}</div>`);
    const total = v.items.reduce((s, x) => s + x[1], 0);
    while (cells.length < 27) cells.push('<div class="lslot empty"></div>');
    body = `<div class="lflt">${kinds.map((k) => `<button data-flt="${k}" class="${LIFE.filter === k ? 'on' : ''}">${k === 'all' ? 'всё' : k}</button>`).join('')}<span class="lmuted">${v.items.length} видов, ${total} шт.</span></div><div class="lslots">${cells.join('')}</div>`;
  } else if (LIFE.tab === 'quest') {
    if (v.quest) body += `<div class="lq act"><div class="lqt">${icon('list-checks', 14)} ${esc(v.quest.title || 'поручение')}</div>${v.quest.steps.map((s) => `<div class="lqs ${s.st}">${s.st === 'done' ? icon('check', 12) : s.st === 'fail' ? icon('x', 12) : '<i></i>'} ${esc(s.t)}</div>`).join('')}</div>`;
    if (v.goal) body += `<div class="lq"><div class="lqt">${icon('sparkles', 14)} Своя цель</div><div class="lqs">${esc(v.goal)}</div></div>`;
    body += `<div class="lq"><div class="lqt">${icon('map', 14)} Исследование</div><div class="lqs">мест в памяти: ${v.places}; пройдено ${Math.round(v.stats['пройдено блоков'] || 0).toLocaleString('ru-RU')} бл.</div></div>`;
    if (!v.quest && !v.goal) body = `<div class="lmuted" style="margin-bottom:8px">Поручений сейчас нет - дайте ей задачу словами в игре.</div>` + body;
  } else if (LIFE.tab === 'rel') {
    body = v.rel.length ? v.rel.map((r) => `<div class="lrel" title="${esc(r.last || '')}"><span class="lrn">${esc(r.n)}</span><div><i style="${r.v >= 0 ? 'left:50%;width:' + r.v / 2 + '%;background:#8fc45a' : 'right:50%;width:' + -r.v / 2 + '%;background:#e0533d'}"></i></div><b>${r.v > 0 ? '+' : ''}${Math.round(r.v)}</b><em>${esc(r.last || '')}</em></div>`).join('') : '<div class="lmuted">Пока ни к кому особого отношения: оно копится по делам - подарки, приветствия, обиды.</div>';
  } else {
    let day = '';
    for (const e of v.diary.slice(0, 60)) {
      const d = new Date(e.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      if (d !== day) { day = d; body += `<div class="lday">${d}</div>`; }
      body += `<div class="lent ${LOGKIND(e)}"><span class="lt">${new Date(e.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span><span class="ld">${icon(e.i, 13)}</span><span>${esc(e.x)}</span></div>`;
    }
    body = `<div class="llog">${body || '<div class="lmuted">Журнал пишется сам, по делам бота.</div>'}</div>`;
  }
  lifeSet('tabbody', body);
  iconsFetch();
}

// ---------- общий цикл
async function refresh() {
  try { st = await T.state(); } catch { return; }
  paintTop(); paintPin(); paintStrip(); renderStart(); renderNow(); renderFeatures(); renderBrains(); fillVoice(st.voice);
  if (!settingsFilled) {
    $('host').value = st.host; $('port').value = st.port; $('masters').value = st.masters.join(', '); $('birthYear').value = st.birthYear || '';
    $('chatMode').value = st.qwen.chatMode ?? 'fast'; $('planMode').value = st.qwen.planMode ?? 'auto'; $('models').value = (st.qwen.models || []).join(', '); $('serviceModels').value = (st.qwen.serviceModels || []).join(', ');
    settingsFilled = true; paintSrvSeg();
  }
  if (st.project) {
    if (document.activeElement !== $('pEnabled')) $('pEnabled').checked = st.project.enabled;
    $('pStatus').textContent = (st.project.id ? `«${st.project.name}»` : 'создастся сам после входа в Qwen') + (st.project.status ? ': ' + st.project.status : '');
  }
  renderBots();
  if (LIFE.open) lifeDraw();
}
setInterval(refresh, 1000);
refresh();


// Данные ботов (Настройки): три уровня очистки, каждый с подтверждением
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-reset]'); if (!b) return;
  const k = b.dataset.reset;
  if (k === 'chats' && ask('Начать все чаты с нейросетью заново? Память и карта останутся.')) act(() => T.resetChats(), b, 'чаты начнутся заново со следующего сообщения');
  if (k === 'memory' && ask('Очистить память всех ботов (места, люди, дневник, зоны, чаты)? Карта мира останется. Копия - в local/backup-..., программа перезапустится.')) T.fullReset('memory');
  if (k === 'all' && ask('Сбросить всё у всех ботов: память, карту, чаты, журналы? Остаются сервер, хозяева, ники и пароли. Копия - в local/backup-..., программа перезапустится.')) T.fullReset('all');
});

// Версия игры (Настройки): каким клиентом заходят боты
(async () => {
  const sel = document.getElementById('mcver'), st = document.getElementById('mcver-st');
  if (!sel || !T.mcVersion) return;
  try { sel.value = await T.mcVersion(null); } catch {}
  sel.addEventListener('change', async () => { const v = await T.mcVersion(sel.value); sel.value = v; st.textContent = 'сохранено: ' + v + ' - перезапустите ботов'; });
})();

// Мастер первого запуска: сервер, ваш ник (хозяин бота), первый бот. Показывается, пока не заполнено.
(async () => {
  if (!T.setupState) return;
  let st; try { st = await T.setupState(); } catch { return; }
  if (st.done) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px';
  box.innerHTML = `<div class="card" style="max-width:460px;width:100%;max-height:92vh;overflow:auto">
    <h2>Добро пожаловать в TotemBots</h2>
    <p class="lead">Бот-компаньон заходит на сервер Minecraft как игрок. Заполните три вещи - остальное потом в Настройках.</p>
    <label>Адрес сервера<br><input id="su-host" placeholder="play.example.net" style="width:100%"></label><br><br>
    <label>Порт<br><input id="su-port" value="25565" style="width:100%"></label><br><br>
    <label>Ваш ник в игре (бот будет слушаться вас)<br><input id="su-master" style="width:100%"></label><br><br>
    <label>Ник бота (отдельный аккаунт; на сервере с «пиратским» входом можно любой)<br><input id="su-bot" style="width:100%"></label><br><br>
    <label>Пароль бота для входа на сервере (AuthMe), если нужен. Аккаунт бота уже есть - впишите его пароль, бот войдёт через /login; новый бот зарегистрируется с этим паролем сам<br><input id="su-pass" type="password" style="width:100%"></label><br><br>
    <label>Характер бота (по желанию)<br><textarea id="su-persona" rows="3" style="width:100%" placeholder="весёлый парень, любит рыбалку"></textarea></label><br><br>
    <label>Версия игры<br><select id="su-ver"><option value="26.1">26.1</option><option value="1.21.11">1.21.11</option></select></label>
    <p class="lead">Сервер должен пускать такого бота: у некоторых серверов белый список или вход только с лицензией. Ботом пользуйтесь по правилам сервера.</p>
    <p id="su-err" style="color:#e66"></p>
    <button id="su-ok">Готово</button></div>`;
  document.body.appendChild(box);
  if (st.host) box.querySelector('#su-host').value = st.host;
  if (st.port) box.querySelector('#su-port').value = st.port;
  if (st.masters && st.masters[0]) box.querySelector('#su-master').value = st.masters[0];
  box.querySelector('#su-ver').value = st.version || '26.1';
  box.querySelector('#su-ok').onclick = async () => {
    const v = (id) => box.querySelector(id).value;
    const r = await T.setupSave({ host: v('#su-host'), port: v('#su-port'), master: v('#su-master'), bot: v('#su-bot'), password: v('#su-pass'), persona: v('#su-persona'), version: v('#su-ver') });
    if (r && r.ok) { box.remove(); location.reload(); } else box.querySelector('#su-err').textContent = 'Проверьте: ' + ((r && r.error) || 'поля');
  };
})();

// Порядок мозгов - списком с кнопками: выше - спрашивается первым; галочка - включён (выключенные не спрашиваются)
const BRAIN_NAMES = { qwen: 'Qwen (сайт)', deepseekweb: 'DeepSeek (сайт)', geminiweb: 'Gemini (сайт)', arenaweb: 'LM Arena (сайт)', kimiweb: 'Kimi (сайт)', glmweb: 'GLM (сайт)', mistralweb: 'Mistral (сайт)', grokweb: 'Grok (сайт)', chatgptweb: 'ChatGPT (сайт)', copilotweb: 'Copilot (сайт)', huggingweb: 'HuggingChat (сайт)', perplexityweb: 'Perplexity (сайт)', poeweb: 'Poe (сайт)', characteraiweb: 'Character AI (сайт)', claude: 'Claude (ключ)', gemini: 'Gemini (ключ)', groq: 'Groq (ключ)', openrouter: 'OpenRouter (ключ)', deepseek: 'DeepSeek (ключ)' };
function renderOrder(B) {
  const box = $('brainOrderList'); if (!box) return;
  const on = B.order.filter((x) => !String(x).startsWith('-'));
  const all = on.concat(Object.keys(BRAIN_NAMES).filter((k) => !on.includes(k)));
  const save = (list) => { $('brainOrder').value = list.join(', '); saveBrains(null); B.order = list; renderOrder(B); };
  box.innerHTML = all.map((k, i) => `<div class="row" style="gap:6px;align-items:center">
    <input type="checkbox" data-bo-on="${k}" ${on.includes(k) ? 'checked' : ''}>
    <span class="grow">${i < on.length ? (i + 1) + '. ' : ''}${esc(BRAIN_NAMES[k] || k)}</span>
    <button class="ghost" data-bo-up="${k}" ${i === 0 || !on.includes(k) ? 'disabled' : ''}>вверх</button>
    <button class="ghost" data-bo-down="${k}" ${i >= on.length - 1 || !on.includes(k) ? 'disabled' : ''}>вниз</button></div>`).join('');
  box.querySelectorAll('[data-bo-on]').forEach((c) => { c.onchange = () => { const k = c.dataset.boOn; save(c.checked ? on.concat(k) : on.filter((x) => x !== k)); }; });
  box.querySelectorAll('[data-bo-up]').forEach((btn) => { btn.onclick = () => { const k = btn.dataset.boUp, l = on.slice(), i = l.indexOf(k); if (i > 0) { [l[i - 1], l[i]] = [l[i], l[i - 1]]; save(l); } }; });
  box.querySelectorAll('[data-bo-down]').forEach((btn) => { btn.onclick = () => { const k = btn.dataset.boDown, l = on.slice(), i = l.indexOf(k); if (i >= 0 && i < l.length - 1) { [l[i + 1], l[i]] = [l[i], l[i + 1]]; save(l); } }; });
}

// браузер для «Войти через браузер»: найденные на компьютере, автоматически или другой (файл)
async function fillBrowsers() {
  const sel = $('browserSel'); if (!sel || !T.browsers) return;
  const { list, current, auto } = await T.browsers();
  sel.innerHTML = `<option value="">${esc(auto ? `Автоматически (${auto})` : 'Автоматически')}</option>` + list.map((b) => `<option value="${esc(b.exe)}">${esc(b.name)}</option>`).join('') + '<option value="?">Другой браузер...</option>';
  sel.value = current;
}
if ($('browserSel')) { $('browserSel').onchange = async (e) => { if (e.target.value === '?') await T.pickBrowser(); else await T.browserSet(e.target.value); fillBrowsers(); }; fillBrowsers(); }
