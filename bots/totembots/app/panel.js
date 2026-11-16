const $ = (id) => document.getElementById(id);
const T = window.totem;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let selected = '';
let st = null;              // последнее состояние из программы
const botTab = new Map();   // ник -> открытая вкладка карточки
const showPass = new Set();
let settingsFilled = false, voiceFilled = false, brainsFilled = false;

// ---------- всплывающие сообщения (вместо красной строки внизу)
function toast(text, kind = '') {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = String(text).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  $('toasts').appendChild(t);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 5000);
}
// кнопка во время действия: крутилка и недоступна (видно, что нажатие принято)
async function act(fn, btn, okText) {
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try { const r = await fn(); if (okText) toast(okText, 'ok'); await refresh(); return r; }
  catch (e) { toast(e.message || e, 'bad'); }
  finally { if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
}
T.onLoginStatus((t) => toast(t, /не вышло|ошибка|нужен вход/i.test(t) ? 'bad' : /готово|пройдена/i.test(t) ? 'ok' : ''));

// ---------- разделы
let section = 'bots';
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => {
  section = b.dataset.sec;
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('on', s.id === 'sec-' + section));
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
      return `<button data-site="${s.id}" class="${s.id === v.site ? 'on' : ''} ${!s.logged && v.mode === 'work' ? 'off' : ''}" title="${esc(s.name)}: ${tip}"><span class="dot ${dot}"></span>${esc(s.name)}</button>`;
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
  $('stripHint').className = 'r2 ' + cls;
}
$('siteTabs').onclick = (e) => { const b = e.target.closest('[data-site]'); if (b) T.viewShow({ mode: (st.view || {}).mode || 'work', site: b.dataset.site }).then((v) => { st.view = v; paintStrip(); }); };
document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => T.viewShow({ mode: b.dataset.mode, site: (st.view || {}).site || 'qwen' }).then((v) => { st.view = v; paintStrip(); }); });
for (const [id, what] of [['navBack', 'back'], ['navReload', 'reload'], ['navHome', 'home']]) $(id).onclick = async () => { const r = await T.viewNav(what); if (r) toast(r); };
function openSite(site, mode) { T.viewShow({ mode, site }).then((v) => { st.view = v; paintStrip(); }); }

// ---------- шапка
let pausedNow = false;
function paintTop() {
  pausedNow = !!st.paused;
  $('pauseBtn').textContent = st.paused ? 'Продолжить' : 'Пауза';
  $('pauseBtn').className = (st.paused ? '' : 'sec') + ' small';
  const live = /play\.totemcraft/.test(st.host) ? 'TotemCraft' : /ru\.totemcraft/.test(st.host) ? 'Рос. вход' : /127\.0\.0\.1|localhost/.test(st.host) ? 'Тестовый' : st.host;
  $('srvChip').innerHTML = `сервер <b>${esc(live)}</b>`;
  const need = (st.siteList || []).filter((s) => s.inOrder && !s.logged).length + ((st.siteList || []).some((s) => s.captcha) ? 1 : 0);
  $('brainsBadge').style.display = need ? '' : 'none';
  $('brainsBadge').textContent = need;
  $('brainsBadge').title = 'сайты из порядка без входа или с проверкой';
}
$('pauseBtn').onclick = () => act(() => T.pause(!pausedNow), $('pauseBtn'));

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
  $('pinModel').value = B.pinModel || '';
  paintPinModel();
}
function paintPinModel() { const id = $('pinSel').value; $('pinModel').style.display = id === 'qwen' || (id && !/web$/.test(id)) ? '' : 'none'; $('pinOnly').parentElement.style.display = id ? '' : 'none'; }
$('pinSel').onchange = paintPinModel;
$('pinSave').onclick = () => act(() => T.brainPin({ id: $('pinSel').value, only: $('pinOnly').checked, model: $('pinModel').style.display === 'none' ? undefined : $('pinModel').value }), $('pinSave'),
  $('pinSel').value ? 'мозг выбран: ' + $('pinSel').selectedOptions[0].textContent : 'мозг: авто');

// ---------- «Что сейчас происходит»
function step(ic, title, hint) { return `<div class="step"><div class="ic ${ic}"></div><div><b>${esc(title)}</b>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div></div>`; }
function renderNow() {
  const out = [];
  const sites = st.siteList || [];
  const cap = sites.filter((s) => s.captcha);
  if (cap.length) out.push(step('bad', `${cap.map((s) => s.name).join(', ')}: просит пройти проверку`, 'откройте вкладку сайта справа («Окна бота») и пройдите её - программа ждёт'));
  if (st.paused) out.push(step('warn', 'Мозг на паузе', 'боты стоят на сервере, но к нейросетям не обращаются. «Продолжить» вверху - снова думать'));
  const logged = sites.filter((s) => s.inOrder && s.logged);
  out.push(logged.length ? step('ok', 'Мозги готовы: ' + logged.map((s) => s.name).join(', '), st.brains && st.brains.now ? 'сейчас думает через ' + st.brains.now : 'список и вход - раздел «Мозги»')
    : step('bad', 'Нет ни одного мозга с входом', 'раздел «Мозги»: войдите хотя бы в Qwen («Войти через Chrome»)'));
  if (!st.bots.length) out.push(step('warn', 'Ботов нет', 'добавьте бота ниже («Новый бот»)'));
  for (const b of st.bots) {
    const s = b.state || {}, br = b.brain;
    if (s.status === 'online') out.push(step('ok', `${b.name} на сервере`, `${s.dim}, ${s.pos.join(' ')} · ${s.mode === 'follow' ? 'идёт за ' + s.follow : s.mode === 'task' ? 'занят: ' + s.task : s.mode === 'ride' ? 'едет' : 'свободен'}`));
    else if (s.status === 'connecting') { out.push(step('spin', `${b.name} заходит на сервер`, 'вход и пароль AuthMe - секунд 10')); continue; }
    else { out.push(step('', `${b.name} выключен`, 'кнопка «Включить» в его карточке; при запуске программы боты заходят сами')); continue; }
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
function logLine(l) {
  const cls = / → /.test(l) ? 'in' : / ← /.test(l) ? 'out' : /\[чат\]/.test(l) ? 'chat' : /ошибка|не получилось|Qwen:|кикнули|отклонен/.test(l) ? 'err' : '';
  return `<div class="${cls}">${esc(l)}</div>`;
}
const TABS = [['log', 'Журнал'], ['behave', 'Поведение'], ['chats', 'Чаты'], ['persona', 'Характер'], ['map', 'Карта'], ['server', 'Сервер']];
function botCard(b) {
  const s = b.state || {};
  const on = s.status === 'online', conn = s.status === 'connecting';
  const doing = s.mode === 'follow' ? `идёт за ${s.follow}` : s.mode === 'task' ? `занят: ${s.task}` : s.mode === 'ride' ? 'едет' : on ? 'свободен' : '';
  const head = `<div class="row"><span class="dot ${on ? 'ok' : conn ? 'warn pulse' : ''}"></span><h3 class="grow">${esc(b.name)}</h3>
      ${s.status === 'off' ? `<button data-a="start" class="small">Включить</button>` : `<button data-a="stop" class="sec small">Выключить</button>`}</div>
    <div class="stats">${on ? `<span class="pill">${esc(s.dim)} ${esc(s.pos.join(' '))}</span><span class="pill ${s.health <= 6 ? 'bad' : 'ok'}">здоровье ${s.health}/20</span><span class="pill ${s.food <= 6 ? 'warn' : ''}">еда ${s.food}/20</span><span class="pill acc">${esc(doing)}</span>` : `<span class="pill">${conn ? 'заходит...' : 'выключен'}</span>`}</div>`;
  if (b.name !== selected) return `<div class="card bot" data-name="${esc(b.name)}">${head}<div class="muted" style="margin-top:6px">нажмите, чтобы открыть</div></div>`;
  const tab = botTab.get(b.name) || 'log';
  const inv = s.items ? Object.entries(s.items).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
  let body = '';
  if (tab === 'log') body = `
    <div class="row"><input class="grow" data-f="order" placeholder="приказ, как в игре: иди за мной, отнеси шерсть CaptianRage..."><button data-a="order">Отправить</button></div>
    ${inv ? `<div class="muted" style="margin:6px 0">инвентарь: ${esc(inv)}</div>` : ''}
    <div class="log" data-f="log" style="margin-top:8px">${b.log.map(logLine).join('')}</div>`;
  if (tab === 'behave') body = `
    <label>На что отзывается в чате${b.attention ? ` · обращений ${b.attention.address}, рядом ${b.attention.near}, в фон ${b.attention.background}` : ''}</label>
    <div class="seg">${[['quiet', 'Тихий'], ['normal', 'Обычный'], ['social', 'Общительный']].map(([v, t]) => `<button data-a="chatmode" data-v="${v}" class="${b.chatMode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="muted" style="margin-top:4px">Тихий - только личка и имя. Обычный - ещё ближний чат и хозяин рядом. Общительный - сам заговаривает с теми, кто рядом.</div>
    <label>Прозвища, на которые откликается (через запятую)</label>
    <div class="row"><input class="grow" data-f="aliases" value="${esc(b.aliases || '')}" placeholder="алексик, сашка"><button data-a="aliases" class="sec">Сохранить</button></div>
    <label>Мобы</label>
    <div class="seg">${[['defend', 'Защищать себя и меня'], ['flee', 'Убегать ко мне'], ['off', 'Не трогать']].map(([v, t]) => `<button data-a="combat" data-v="${v}" class="${b.combat === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  if (tab === 'chats') body = `
    <div class="muted">Сейчас: ${b.chatId ? esc(b.chatId.slice(0, 8)) + '…' : 'нет (начнётся при первом сообщении)'}</div>
    <div class="row" style="margin-top:6px"><button data-a="chat" class="sec small" ${b.chatId ? '' : 'disabled'}>Показать в окне бота</button><button data-a="rewarm" class="sec small" title="повторить вводную в этом чате">Прогреть заново</button><button data-a="newchat" class="sec small">Новый чат</button></div>
    <div class="row" style="margin-top:6px"><input class="grow" data-f="chatLink" placeholder="ссылка на чат Qwen https://chat.qwen.ai/c/..."><button data-a="chatUse" class="sec">Взять</button></div>
    <div class="box">${(b.chats || []).map((c) => `<div class="row chatrow ${c.id === b.chatId ? 'cur' : ''}" data-id="${esc(c.id)}">
      <span class="grow"><b>${esc(c.note || c.id.slice(0, 8) + '…')}</b> <span class="muted">${new Date(c.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
      <button data-a="chatOpen" class="sec small" title="открыть в моём окне Qwen">Открыть</button>
      ${c.id === b.chatId ? '<span class="pill acc">текущий</span>' : '<button data-a="chatPick" class="sec small">Сделать текущим</button>'}
      <button data-a="chatNote" class="ghost small" title="подписать">✎</button><button data-a="chatForget" class="ghost small" title="убрать из списка (в Qwen чат останется)">✕</button>
    </div>`).join('') || '<div class="muted">чатов пока нет</div>'}</div>`;
  if (tab === 'persona') body = `
    <label>Характер (после сохранения начнётся новый чат)</label><textarea data-f="persona" rows="6">${esc(b.persona || '')}</textarea>
    <div class="row" style="margin-top:8px"><button data-a="savePersona">Сохранить характер</button></div>`;
  if (tab === 'map') body = `<canvas data-f="map" width="392" height="392" style="width:100%;border-radius:8px;background:#111"></canvas>
    <div class="muted" data-f="mapinfo">серое - суша, синее - вода, красное - лава, оранжевое - постройки; точки: жёлтая - сундуки, фиолетовая - портал, зелёная - ферма, голубая - деревня, белая - кровать, красная - спавнер. Бот в центре, север сверху.</div>`;
  if (tab === 'server') body = `
    <div class="muted">Один раз выполнить на сервере (консоль сервера или в игре от админа, с «/» в начале):</div>
    ${[['Аккаунт AuthMe', `authme register ${b.name} ${b.password}`], ['Если аккаунт уже есть - новый пароль', `authme changepassword ${b.name} ${b.password}`],
       ['Наш аддон античита не наказывает бота', `lp user ${b.name} permission set totemguard.bypass true`]].map(([t, c]) => `
      <label>${t}</label><div class="row"><span class="cmd grow">${esc(showPass.has(b.name) ? c : c.replace(b.password, '•'.repeat(8)))}</span><button data-a="copy" data-cmd="${esc(c)}" class="sec small">Копировать</button></div>`).join('')}
    <div class="muted" style="margin-top:8px">Доступ к вашим сундукам LWC даёт администратор через базу LWC.</div>
    <div class="row" style="margin-top:8px"><button data-a="pass" class="sec small">${showPass.has(b.name) ? 'Скрыть пароль' : 'Показать пароль'}</button>
      <button data-a="newpass" class="sec small">Новый пароль</button><button data-a="probe" class="sec small" title="зайти и сразу выйти: проверить пароль и доступ">Проверить вход</button>
      <span class="grow"></span><button data-a="remove" class="red small">Удалить бота</button></div>
    <div class="muted" style="margin-top:6px">${esc(b.probe || '')}</div>`;
  return `<div class="card bot sel" data-name="${esc(b.name)}">${head}
    <div class="tabs2">${TABS.map(([k, t]) => `<button data-a="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>${body}</div>`;
}

let lastHtml = '';
function renderBots() {
  const box = $('bots');
  if (!selected && st.bots[0]) selected = st.bots[0].name;
  const sel = st.bots.find((b) => b.name === selected);
  const log = box.querySelector('[data-f="log"]');
  // не перерисовывать карточку, пока человек печатает: только журнал
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    if (sel && log) { const end = log.scrollTop + log.clientHeight >= log.scrollHeight - 20; log.innerHTML = sel.log.map(logLine).join(''); if (end) log.scrollTop = log.scrollHeight; }
    return;
  }
  const html = st.bots.map(botCard).join('') || '<div class="card empty">Ботов пока нет. Добавьте первого ниже.</div>';
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
  if (a === 'start') act(() => T.botStart(name), t);
  if (a === 'stop') act(() => T.botStop(name), t);
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
$('bots').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.f === 'order') { e.preventDefault(); e.target.closest('.bot').querySelector('[data-a="order"]').click(); }
});
$('addToggle').onclick = () => { const open = $('addBox').style.display === 'none'; $('addBox').style.display = open ? '' : 'none'; $('addToggle').textContent = open ? 'Скрыть' : 'Добавить'; if (open) $('newName').focus(); };
$('add').onclick = () => act(async () => {
  const name = $('newName').value.trim();
  if (!name) throw new Error('впишите ник');
  await T.botAdd({ name, persona: $('newPersona').value });
  selected = name; botTab.set(name, 'server'); $('newName').value = ''; $('newPersona').value = ''; $('addBox').style.display = 'none'; $('addToggle').textContent = 'Добавить'; lastHtml = '';
}, $('add'), 'бот добавлен: выполните команды на сервере');

// ---------- мозги: все сайты одинаково
let sitesSig = '';
function renderSites() {
  const sig = JSON.stringify(st.siteList);
  if (sig === sitesSig) return;
  sitesSig = sig;
  $('siteList').innerHTML = st.siteList.map((s) => {
    const pill = s.captcha ? '<span class="pill bad">просит проверку</span>' : s.busy ? '<span class="pill acc">работает</span>' : s.logged ? '<span class="pill ok">вошёл</span>' : '<span class="pill">нужен вход</span>';
    return `<div class="site"><div class="nm"><span class="dot ${s.logged ? 'ok' : ''}"></span>${esc(s.name)} ${pill}${s.inOrder ? '' : ' <span class="pill" title="не в порядке мозгов: бот его не спрашивает">не используется</span>'}</div><div></div>
      <div class="acts"><button class="sec small" data-site-work="${s.id}">Окно бота</button><button class="sec small" data-site-mine="${s.id}">Моё окно</button>
        <button class="small" data-site-login="${s.id}" title="откроется настоящий Chrome: войдите там, вход перенесётся в программу">Войти (Chrome)</button>${s.id !== 'qwen' ? `<button class="ghost small" data-site-mark="${s.id}" title="уже вошли прямо в окне сайта">Вошёл</button>` : ''}
        <button class="ghost small" data-site-test="${s.id}">Проверить</button></div></div>`;
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
  $('brainKeys').innerHTML = Object.entries(B.presets).map(([k, p]) => `<label>${esc(p.name)} ${B.has[k] ? '<span class="pill ok">ключ вставлен</span>' : ''} · <a href="#" data-url="${esc(p.keyUrl)}" class="keylink">где взять</a></label>
    <div class="row"><input class="grow" data-key="${k}" placeholder="${B.has[k] ? 'пусто - оставить, «-» - удалить' : 'вставьте ключ'}"><input style="width:42%" data-model="${k}" value="${esc(B.models[k])}" title="модель"></div>`).join('')
    + '<div class="row" style="margin-top:10px"><button id="keysSave">Сохранить ключи</button></div>';
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
    $('vEnabled').checked = !!v.enabled; $('vProvider').value = v.provider; $('vFallback').checked = !!v.fallback;
    $('vLocal').checked = !!v.local; $('vPlasmo').checked = !!v.plasmo; $('vVolume').value = v.volume;
    $('vPiperVoice').innerHTML = v.piper.voices.map((n) => `<option value="${n}">${VOICE_NAMES[n] || n}</option>`).join('');
    $('vPiperVoice').value = v.piperVoice;
    voiceFilled = true;
  }
  if (!$('vStatus').dataset.busy) $('vStatus').textContent = piperText(v.piper);
}
const voiceForm = () => ({ enabled: $('vEnabled').checked, provider: $('vProvider').value, fallback: $('vFallback').checked,
  local: $('vLocal').checked, plasmo: $('vPlasmo').checked, volume: $('vVolume').value, piperVoice: $('vPiperVoice').value });
$('vSave').onclick = () => act(() => T.voiceSave(voiceForm()), $('vSave'), 'голос сохранён');
$('vInstall').onclick = () => act(async () => {
  await T.voiceSave(voiceForm());
  $('vStatus').dataset.busy = '1';
  try { await T.voiceInstallPiper(); } finally { delete $('vStatus').dataset.busy; }
}, $('vInstall'));
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
  paintTop(); paintPin(); paintStrip(); renderNow(); renderBrains(); fillVoice(st.voice);
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
