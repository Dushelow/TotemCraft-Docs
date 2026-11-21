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
  [/goal was changed/i, 'цель поменялась по ходу'],
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
  else if (cur.busy) { text = `Бот сейчас работает в этом окне: листать можно, нажимать и печатать нельзя. Писать самому - «Мои окна».`; cls = 'busy'; }
  else if (!cur.logged) { text = `Окно бота ${cur.name}: вход не выполнен. Войдите здесь или кнопкой «Войти через Chrome» в разделе «Мозги».`; cls = 'bad'; }
  else text = `Окно бота ${cur.name}: бот может начать работу в любой момент. Писать самому лучше в «Мои окна».`;
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
  const srv = `${icon('server', 14)}<b>${esc(srvName(st.host))}</b>`;
  if ($('srvChip').innerHTML !== srv) $('srvChip').innerHTML = srv;
  const need = (st.siteList || []).filter((s) => s.inOrder && !s.logged).length + ((st.siteList || []).some((s) => s.captcha) ? 1 : 0);
  $('brainsBadge').style.display = need ? '' : 'none';
  $('brainsBadge').textContent = need;
  $('brainsBadge').title = 'сайты из порядка без входа или с проверкой';
}
$('srvChip').onclick = () => goSection('settings');
$('pauseBtn').onclick = () => act(() => T.pause(!pausedNow), $('pauseBtn'));
$('startBtn').onclick = () => act(() => T.botsStart(), $('startBtn'), 'боты заходят на сервер');
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
function srvName(h) { return /play\.totemcraft/.test(h) ? 'TotemCraft' : /ru\.totemcraft/.test(h) ? 'Российский вход' : /127\.0\.0\.1|localhost/.test(h) ? 'Тестовый' : h; }
function renderStart() {
  const idle = !st.running;
  $('startCard').style.display = idle ? '' : 'none';
  $('nowCard').style.display = idle ? 'none' : '';
  if (!idle) return;
  const sites = st.siteList || [];
  const ready = sites.filter((s) => s.inOrder && s.logged);
  const cap = sites.filter((s) => s.captcha);
  const picked = st.bots.filter((b) => b.pick);
  const B = st.brains || {};
  const pinName = B.pin ? ((B.choices || []).find((c) => c.id === B.pin) || {}).name || B.pin : '';
  const out = [
    check('ok', 'Сервер: ' + srvName(st.host), `${st.host}:${st.port}`, '<button class="ghost sm" data-go="settings">Сменить</button>'),
    cap.length ? check('bad', `${cap.map((s) => s.name).join(', ')} просит проверку «не робот»`, 'пройдите её в окне справа', '<button class="ghost sm" data-go="brains">Мозги</button>')
      : ready.length ? check('ok', 'Мозги: ' + ready.map((s) => s.name).join(', '), pinName ? 'выбран вручную: ' + pinName : 'по порядку, при лимите - следующий', '<button class="ghost sm" data-go="brains">Мозги</button>')
      : check('bad', 'Нет ни одного мозга с входом', 'войдите хотя бы в один сайт: раздел «Мозги»', '<button class="pri sm" data-go="brains">Войти</button>'),
    st.bots.length ? check(picked.length ? 'ok' : 'warn', picked.length ? `Ботов к запуску: ${picked.length}` : 'Отметьте, кого запустить', 'нажмите на ник, чтобы включить или убрать')
      + `<div class="picks">${st.bots.map((b) => `<label class="${b.pick ? 'on' : ''}"><input type="checkbox" data-pick="${esc(b.name)}" ${b.pick ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}</div>`
      : check('warn', 'Ботов нет', 'добавьте первого внизу: «Добавить бота»'),
  ];
  const html = out.join('');
  if ($('startChecks').dataset.html !== html) { $('startChecks').dataset.html = html; $('startChecks').innerHTML = html; }
  $('startGo').disabled = !picked.length;
  $('startGo').lastElementChild.textContent = picked.length > 1 ? `Запустить (${picked.length})` : 'Запустить';
  if (document.activeElement !== $('startAuto')) $('startAuto').checked = !!st.startOnLaunch;
}
function goSection(sec) { const b = document.querySelector(`#nav button[data-sec="${sec}"]`); if (b) b.click(); }
$('startChecks').addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) goSection(g.dataset.go); });
$('startChecks').addEventListener('change', (e) => { const n = e.target.dataset.pick; if (n) act(() => T.botPick({ name: n, pick: e.target.checked })); });
$('startGo').onclick = () => act(() => T.botsStart(), $('startGo'), 'боты заходят на сервер');
$('startAuto').onchange = () => act(() => T.startOnLaunch($('startAuto').checked), null, $('startAuto').checked ? 'при включении программы боты зайдут сами' : 'запуск только кнопкой');

// ---------- ручной выбор мозга
let pinFilled = '';
function paintPin() {
  const B = st.brains; if (!B || !B.choices) return;
  const sig = JSON.stringify([B.choices, B.pin, B.pinOnly, B.pinModel]);
  if (pinFilled === sig || document.activeElement === $('pinModel') || document.activeElement === $('pinSel')) return;
  pinFilled = sig;
  $('pinSel').innerHTML = `<option value="">Мозг: авто (по порядку)</option>` + B.choices.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('pinSel').value = B.pin || '';
  $('pinOnly').checked = !!B.pinOnly;
  $('pinModel').value = B.pinModel || '';
  paintPinModel();
}
function paintPinModel() {
  const id = $('pinSel').value, withModel = id === 'qwen' || (id && !/web$/.test(id));
  $('pinModel').disabled = !withModel; $('pinModel').style.display = withModel ? '' : 'none'; $('pinOnly').disabled = !id;
  $('pinRow').style.display = id ? '' : 'none';
  $('pinLead').textContent = id ? `Выбран: ${$('pinSel').selectedOptions[0].textContent}. ${withModel ? 'Можно указать модель. ' : 'Модель меняется на самом сайте («Моё окно»). '}«Только он» - не переходить на запасные при лимите.`
    : 'Сейчас «авто»: бот спрашивает мозги по порядку ниже, при лимите или сбое - следующий. Выбрать один - в списке вверху.';
}
$('pinSel').onchange = () => {
  paintPinModel();
  const B = st.brains || {}, prev = { id: B.pin || '', only: !!B.pinOnly, model: B.pinModel };
  act(() => T.brainPin({ id: $('pinSel').value, only: $('pinOnly').checked, model: $('pinModel').disabled ? undefined : $('pinModel').value }), null,
    $('pinSel').value ? 'мозг: ' + $('pinSel').selectedOptions[0].textContent : 'мозг: авто, по порядку', { fn: () => { pinFilled = ''; return T.brainPin(prev); }, done: 'мозг как был' });
  $('pinSel').blur();
};
$('pinSave').onclick = () => {
  const B = st.brains || {}, prev = { id: B.pin || '', only: !!B.pinOnly, model: B.pinModel };
  act(() => T.brainPin({ id: $('pinSel').value, only: $('pinOnly').checked, model: $('pinModel').disabled ? undefined : $('pinModel').value }), $('pinSave'),
    $('pinSel').value ? 'мозг выбран: ' + $('pinSel').selectedOptions[0].textContent : 'мозг: авто', { fn: () => { pinFilled = ''; return T.brainPin(prev); }, done: 'мозг как был' });
};

// ---------- «Что сейчас происходит»
function step(ic, title, hint) { return `<div class="step">${stIcon(ic)}<div class="t"><b>${esc(title)}</b>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div></div>`; }
function renderNow() {
  const out = [];
  const sites = st.siteList || [];
  const cap = sites.filter((s) => s.captcha);
  if (cap.length) out.push(step('bad', `${cap.map((s) => s.name).join(', ')}: просит пройти проверку`, 'откройте вкладку сайта справа («Окна бота») и пройдите её - программа ждёт'));
  if (st.paused) out.push(step('warn', 'Пауза', 'боты стоят на сервере и ничего не делают сами, к нейросетям не обращаются; сообщения игроков копятся. «Продолжить» вверху - ответят и продолжат'));
  const logged = sites.filter((s) => s.inOrder && s.logged);
  out.push(logged.length ? step('ok', 'Мозги готовы: ' + logged.map((s) => s.name).join(', '), st.brains && st.brains.now ? 'сейчас думает через ' + st.brains.now : 'список и вход - раздел «Мозги»')
    : step('bad', 'Нет ни одного мозга с входом', 'раздел «Мозги»: войдите хотя бы в Qwen («Войти через Chrome»)'));
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
const TABS = [['log', 'Журнал', 'scroll-text'], ['behave', 'Поведение', 'smile'], ['chats', 'Чаты', 'message-circle'], ['persona', 'Характер', 'sparkles'], ['map', 'Карта', 'map'], ['server', 'Сервер', 'server']];
function meter(ic, val, label) {
  const v = Math.max(0, Math.min(20, +val || 0)), cls = v <= 6 ? 'bad' : v <= 12 ? 'warn' : '';
  return `<div class="meter ${cls}" title="${label} ${v} из 20">${icon(ic, 14)}<div class="bar"><i style="width:${v * 5}%"></i></div><span>${v}</span></div>`;
}
function doingText(s, on) {
  return s.mode === 'follow' ? `идёт за ${s.follow}` : s.mode === 'task' ? `занят: ${s.task}` : s.mode === 'ride' ? 'едет' : s.mode === 'life' ? 'сама: ' + s.task
    : s.mode === 'hold' ? 'ждёт на месте' : s.mode === 'paused' ? 'пауза' : on ? 'свободен' : '';
}
function botCard(b) {
  const s = b.state || {};
  const on = s.status === 'online', conn = s.status === 'connecting', off = !on && !conn;
  const where = on ? `${s.dim} · ${s.pos.join(' ')}` : conn ? 'заходит на сервер…' : 'выключен';
  const power = off ? `<button data-a="start" class="go sm" title="Зайти на сервер">${icon('play', 14)}Включить</button>`
    : `<button data-a="stop" class="ghost icon sm" title="Выйти с сервера" aria-label="Выключить">${icon('power', 14)}</button>`;
  const head = `<div class="bothead"><div class="ava">${esc(b.name[0] || '?').toUpperCase()}<span class="dot ${on ? 'ok' : conn ? 'warn pulse' : ''}"></span></div>
    <div class="grow"><div class="nm">${esc(b.name)}</div><div class="sub">${esc(where)}</div></div>${power}</div>`;
  const stats = on ? `<div class="meters">${meter('heart', s.health, 'здоровье')}${meter('drumstick', s.food, 'еда')}
    <div class="doing">${icon(s.mode === 'paused' ? 'circle-pause' : s.mode === 'hold' ? 'hand' : s.mode === 'follow' ? 'footprints' : 'activity', 14)}<b>${esc(doingText(s, on))}</b></div></div>` : '';
  if (b.name !== selected) return `<div class="card bot" data-name="${esc(b.name)}" title="Открыть">${head}${stats}</div>`;
  const tab = botTab.get(b.name) || 'log';
  const inv = s.items ? Object.entries(s.items).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
  let body = '';
  if (tab === 'log') {
    const n = errCount(b), f = logFilter.get(b.name) || 'all';
    body = `
    <div class="logbar"><div class="seg">${LOGF.map(([k, t, ic]) => `<button data-a="logf" data-v="${k}" class="${f === k ? 'on' : ''}" title="${t}">${icon(ic, 13)}${t}${k === 'err' && n ? ` <span class="pill bad" style="height:16px;padding:0 5px">${n}</span>` : ''}</button>`).join('')}</div></div>
    <div class="log" data-f="log">${logLines(b).map(logLine).join('') || '<div class="hint">здесь пока пусто</div>'}</div>
    <div class="compose"><input class="grow" data-f="order" placeholder="Приказ, как в игре: иди за мной, отнеси шерсть…"><button data-a="order" class="pri icon" title="Отправить (Enter)" aria-label="Отправить">${icon('send')}</button></div>
    ${inv ? `<div class="muted" style="margin-top:var(--s2)">${icon('folder-open', 13)} ${esc(inv)}</div>` : ''}`;
  }
  if (tab === 'behave') body = `
    <label>На что отзывается в чате${b.attention ? ` · обращений ${b.attention.address}, рядом ${b.attention.near}, в фон ${b.attention.background}` : ''}</label>
    <div class="seg">${[['quiet', 'Тихий'], ['normal', 'Обычный'], ['social', 'Общительный']].map(([v, t]) => `<button data-a="chatmode" data-v="${v}" class="${b.chatMode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="muted" style="margin-top:6px">Тихий - только личка и имя. Обычный - ещё ближний чат и хозяин рядом. Общительный - сам заговаривает с теми, кто рядом.</div>
    <label>Прозвища, на которые откликается (через запятую)</label>
    <div class="row"><input class="grow" data-f="aliases" value="${esc(b.aliases || '')}" placeholder="алексик, сашка"><button data-a="aliases">${icon('check', 14)}Сохранить</button></div>
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
  if (tab === 'map') body = `<canvas data-f="map" width="392" height="392" style="width:100%;border-radius:var(--r2);background:var(--bg);border:1px solid var(--line)"></canvas>
    <div class="muted" data-f="mapinfo">серое - суша, синее - вода, красное - лава, оранжевое - постройки; точки: жёлтая - сундуки, фиолетовая - портал, зелёная - ферма, голубая - деревня, белая - кровать, красная - спавнер. Бот в центре, север сверху.</div>`;
  if (tab === 'server') body = `
    <div class="muted">Один раз выполнить на сервере (консоль или в игре от админа, с «/» в начале):</div>
    ${[['Аккаунт AuthMe', `authme register ${b.name} ${b.password}`], ['Если аккаунт уже есть - новый пароль', `authme changepassword ${b.name} ${b.password}`],
       ['Наш аддон античита не наказывает бота', `lp user ${b.name} permission set totemguard.bypass true`]].map(([t, c]) => `
      <label>${t}</label><div class="row" style="flex-wrap:nowrap"><span class="cmd grow">${esc(showPass.has(b.name) ? c : c.replace(b.password, '•'.repeat(8)))}</span><button data-a="copy" data-cmd="${esc(c)}" class="quiet icon sm" title="Копировать" aria-label="Копировать">${icon('copy', 14)}</button></div>`).join('')}
    <div class="muted" style="margin-top:var(--s2)">Доступ к вашим сундукам LWC даёт администратор через базу LWC.</div>
    <div class="row" style="margin-top:var(--s3)"><button data-a="pass" class="sm">${icon(showPass.has(b.name) ? 'eye-off' : 'eye', 14)}${showPass.has(b.name) ? 'Скрыть пароль' : 'Показать пароль'}</button>
      <button data-a="newpass" class="sm">${icon('key-round', 14)}Новый пароль</button><button data-a="probe" class="sm" title="зайти и сразу выйти: проверить пароль и доступ">${icon('log-in', 14)}Проверить вход</button></div>
    <div class="row" style="margin-top:var(--s3)"><span class="muted grow">${esc(b.probe || '')}</span><button data-a="remove" class="danger sm">${icon('trash-2', 14)}Удалить бота</button></div>`;
  return `<div class="card bot sel" data-name="${esc(b.name)}">${head}${stats}
    <div class="tabs2">${TABS.map(([k, t, ic]) => `<button data-a="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>${body}</div>`;
}

let lastHtml = '';
function renderBots() {
  const box = $('bots');
  if (!selected && st.bots[0]) selected = st.bots[0].name;
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
  if ((botTab.get(selected) || 'log') === 'map') drawMap();
}

$('bots').addEventListener('click', (e) => {
  const card = e.target.closest('.bot');
  if (!card) return;
  const name = card.dataset.name, t = e.target.closest('[data-a]'), a = t && t.dataset.a;
  if (!a) { if (selected !== name) { selected = name; lastHtml = ''; renderBots(); } return; }
  const f = (n) => card.querySelector(`[data-f="${n}"]`);
  const re = () => { lastHtml = ''; };
  if (a === 'tab') { botTab.set(name, t.dataset.v); re(); renderBots(); return; }
  if (a === 'logf') { logFilter.set(name, t.dataset.v); re(); renderBots(); const lg = $('bots').querySelector('[data-f="log"]'); if (lg) lg.scrollTop = lg.scrollHeight; return; }
  if (a === 'start') act(() => T.botStart(name), t);
  if (a === 'stop') act(() => T.botStop(name), t, name + ' вышел с сервера', { fn: () => T.botStart(name), done: name + ' заходит обратно' });
  if (a === 'order') { const v = f('order').value.trim(); if (v) act(async () => { await T.botOrder({ name, text: v }); f('order').value = ''; f('order').blur(); }, t, 'приказ отправлен'); }
  if (a === 'chat') act(() => T.botChat(name), t);
  if (a === 'pass') { showPass.has(name) ? showPass.delete(name) : showPass.add(name); re(); renderBots(); }
  if (a === 'copy') { navigator.clipboard.writeText(t.dataset.cmd); toast('скопировано', 'ok'); }
  if (a === 'newpass' && confirm('Сделать новый пароль? Потом выполните на сервере «authme changepassword», иначе бот не войдёт.')) act(() => T.botNewPass(name), t, 'новый пароль создан');
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
  if (a === 'remove' && confirm(`Удалить бота ${name}? Пароль его аккаунта на сервере забудется.`)) act(() => T.botRemove(name), t);
});
$('bots').addEventListener('input', (e) => { if (e.target.dataset.f === 'fd') { const c = e.target.closest('.bot'); c.querySelector('[data-f="fdv"]').textContent = e.target.value; } });
$('bots').addEventListener('change', (e) => { if (e.target.dataset.f === 'fd') { const name = e.target.closest('.bot').dataset.name; e.target.blur(); act(async () => { await T.botFollowDist({ name, dist: +e.target.value }); lastHtml = ''; }); } });
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
        : `<button class="pri sm" data-site-login="${s.id}" title="откроется настоящий Chrome: войдите там, вход перенесётся в программу">${icon('log-in', 14)}Войти через Chrome</button><button class="sm" data-site-work="${s.id}" title="войти прямо в окне программы">${icon('app-window', 14)}Окно бота</button>
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
function renderBrains() {
  renderSites();
  const B = st.brains; if (!B) return;
  $('brainsNow').textContent = (B.now ? 'сейчас думает: ' + B.now + '. ' : '') + 'включены: ' + (B.active.join(', ') || '-');
  if (brainsFilled) return;
  brainsFilled = true;
  $('brainOrder').value = B.order.join(', ');
  $('brainKeys').innerHTML = Object.entries(B.presets).map(([k, p]) => `<label style="display:flex;align-items:center;gap:6px">${esc(p.name)} ${B.has[k] ? `<span class="pill ok">${icon('check', 12)}ключ вставлен</span>` : ''}<span class="grow"></span><a href="#" data-url="${esc(p.keyUrl)}" class="keylink">где взять ${icon('external-link', 12)}</a></label>
    <div class="row"><input class="grow" data-key="${k}" placeholder="${B.has[k] ? 'пусто - оставить, «-» - удалить' : 'вставьте ключ'}"><input style="width:42%" data-model="${k}" value="${esc(B.models[k])}" title="модель"></div>`).join('')
    + `<div class="row" style="margin-top:var(--s3)"><button id="keysSave" class="pri">${icon('check')}Сохранить ключи</button></div>`;
  document.querySelectorAll('.keylink').forEach((a) => { a.onclick = (e) => { e.preventDefault(); T.openExternal(a.dataset.url); }; });
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
$('brainsSave').onclick = () => saveBrains($('brainsSave'));
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
    if (v.silero) { $('vSileroVoice').innerHTML = Object.entries(v.silero.voices).map(([k, n]) => `<option value="${k}">${n}</option>`).join(''); $('vSileroVoice').value = v.sileroVoice || 'xenia'; }
    voiceFilled = true;
  }
  if (!$('vStatus').dataset.busy) $('vStatus').textContent = piperText(v.piper) + (v.silero ? (v.silero.program && v.silero.voice ? ' · Silero готов' : ' · Silero не установлен') : '');
}
const voiceForm = () => ({ enabled: $('vEnabled').checked, provider: $('vProvider').value, fallback: $('vFallback').checked, echo: $('vEcho').checked,
  local: $('vLocal').checked, plasmo: $('vPlasmo').checked, volume: $('vVolume').value, piperVoice: $('vPiperVoice').value, sileroVoice: $('vSileroVoice').value });
$('vSave').onclick = () => act(() => T.voiceSave(voiceForm()), $('vSave'), 'голос сохранён');
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
$('saveSettings').onclick = () => act(() => T.saveSettings({ host: $('host').value, port: $('port').value, masters: $('masters').value, birthYear: $('birthYear').value, chatMode: $('chatMode').value, planMode: $('planMode').value, models: $('models').value, serviceModels: $('serviceModels').value }),
  $('saveSettings'), 'настройки сохранены (новый сервер - после перезапуска бота)');

// ---------- карта бота: чанки вокруг (бот в центре, север сверху)
async function drawMap() {
  const card = document.querySelector('.bot.sel'), cv = card && card.querySelector('[data-f="map"]');
  if (!cv) return;
  const v = await T.botMap(selected);
  if (!v) return;
  const g = cv.getContext('2d'), n = v.r * 2 + 1, s = cv.width / n;
  g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
  for (const [x, z, k, built] of v.chunks) {
    g.fillStyle = built >= 12 ? '#c8813a' : k === 'w' ? '#2f5f9e' : k === 'l' ? '#a8382c' : '#4a4d52';
    g.fillRect((x + v.r) * s, (z + v.r) * s, s - 1, s - 1);
  }
  const COL = { 'сундуки': '#ffd23f', 'портал': '#b05cff', 'ферма': '#3ba55d', 'деревня': '#5fd3ff', 'кровать': '#ffffff', 'спавнер': '#ff4d4d', 'мастерская': '#ff9ff3' };
  for (const [x, z, kind] of v.poi) { g.fillStyle = COL[kind] || '#bbb'; g.beginPath(); g.arc((x + v.r + 0.5) * s, (z + v.r + 0.5) * s, Math.max(2, s / 3), 0, 7); g.fill(); }
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(v.r * s, v.r * s, s, s);
  const info = card.querySelector('[data-f="mapinfo"]');
  if (info && !info.dataset.n) { info.dataset.n = 1; info.textContent = `исследовано чанков: ${v.total}. ` + info.textContent; }
}
setInterval(() => { if ((botTab.get(selected) || 'log') === 'map') drawMap(); }, 5000);

// ---------- общий цикл
async function refresh() {
  try { st = await T.state(); } catch { return; }
  paintTop(); paintPin(); paintStrip(); renderStart(); renderNow(); renderBrains(); fillVoice(st.voice);
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
}
setInterval(refresh, 1000);
refresh();
