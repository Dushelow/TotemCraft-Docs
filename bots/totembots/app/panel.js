const $ = (id) => document.getElementById(id);
const T = window.totem;
let selected = '';
let settingsFilled = false;
const openMap = new Set();
const openServer = new Set();
const showPass = new Set();
const openChats = new Set();
let voiceFilled = false;
const openPersona = new Set();

function err(e) { $('err').textContent = e ? String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''; }
async function act(fn) { try { err(''); await fn(); await refresh(); } catch (e) { err(e); } }

async function refreshQwen() {
  const s = await T.qwenState();
  $('qdot').className = 'dot ' + (s.loggedIn ? 'ok' : 'bad');
  qwenOk = !!s.loggedIn;
  $('qstate').textContent = s.loggedIn ? 'Qwen: вход выполнен' : 'Qwen: нужен вход (кнопка ниже)';
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function logLine(l) {
  const cls = / → /.test(l) ? 'in' : / ← /.test(l) ? 'out' : /\[чат\]/.test(l) ? 'chat' : /ошибка|не получилось|Qwen:|кикнули|отклонены/.test(l) ? 'err' : '';
  return `<div class="${cls}">${esc(l)}</div>`;
}

function botCard(b) {
  const s = b.state || {};
  const dot = s.status === 'online' ? 'ok' : s.status === 'connecting' ? 'warn' : '';
  const where = s.status === 'online' ? `${s.dim}, ${s.pos.join(' ')} · ❤ ${s.health} · еда ${s.food}` : s.status === 'connecting' ? 'захожу...' : 'выключен';
  const doing = s.mode === 'follow' ? `идёт за ${s.follow}` : s.mode === 'task' ? `задание: ${s.task}` : s.status === 'online' ? 'стоит' : '';
  const inv = s.items ? Object.entries(s.items).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
  return `<div class="card bot ${b.name === selected ? 'sel' : ''}" data-name="${esc(b.name)}">
    <div class="row"><span class="dot ${dot}"></span><h3 class="grow">${esc(b.name)}</h3>
      ${s.status === 'off' ? `<button data-a="start">Запустить</button>` : `<button data-a="stop" class="sec">Выключить</button>`}
    </div>
    <div class="muted">${esc(where)}${doing ? ' · ' + esc(doing) : ''}</div>
    ${inv ? `<div class="muted">инвентарь: ${esc(inv)}</div>` : ''}
    ${b.name === selected ? `
      <label>Приказ (как написали бы ему в игре)</label>
      <div class="row"><input class="grow" data-f="order" placeholder="иди за мной / возьми 2 стака шерсти из сундука 100 64 -20 и отнеси CaptianRage">
        <button data-a="order">Отправить</button></div>
      <label>Чат: на что бот отзывается${b.attention ? ` (обращений ${b.attention.address}, рядом ${b.attention.near}, в фон ${b.attention.background})` : ''}</label>
      <div class="row">
        ${[['quiet', 'Тихий: личка и имя'], ['normal', 'Обычный'], ['social', 'Общительный']].map(([v, t]) =>
          `<button data-a="chatmode" data-v="${v}" class="${b.chatMode === v ? '' : 'sec'}">${t}</button>`).join('')}
      </div>
      <div class="row" style="margin-top:4px"><input class="grow" data-f="aliases" value="${esc(b.aliases || '')}" placeholder="ещё прозвища через запятую: алексик, сашка"><button data-a="aliases" class="sec">Сохранить</button></div>
      <label>Мобы</label>
      <div class="row">
        ${[['defend', 'Защищать себя и меня'], ['flee', 'Убегать ко мне'], ['off', 'Не трогать']].map(([v, t]) =>
          `<button data-a="combat" data-v="${v}" class="${b.combat === v ? '' : 'sec'}">${t}</button>`).join('')}
      </div>
      <div class="row" style="margin-top:6px">
        <button data-a="chat" class="sec" ${b.chatId ? '' : 'disabled'}>Его чат в Qwen</button>
        <button data-a="newchat" class="sec">Новый чат</button>
        <button data-a="persona" class="sec">Характер</button>
        <button data-a="map" class="sec">${openMap.has(b.name) ? '▾' : '▸'} Карта</button>
        <button data-a="server" class="sec">${openServer.has(b.name) ? '▾' : '▸'} На сервере</button>
        <button data-a="remove" class="red">Удалить</button>
      </div>
      <div style="margin-top:8px">
        <button data-a="chats" class="sec">${openChats.has(b.name) ? '▾' : '▸'} Чаты Qwen (${(b.chats || []).length})</button>
      </div>
      ${openChats.has(b.name) ? `<div class="chats">
        <div class="muted">Сейчас: ${b.chatId ? esc(b.chatId.slice(0, 8)) + '…' : 'нет (начнётся новый при первом сообщении)'}</div>
        <div class="row" style="margin-top:4px">
          <button data-a="rewarm" class="sec" title="повторить вводную в этом чате, например после смены характера">Прогреть заново</button>
          <button data-a="newchat" class="sec">Новый чат</button>
        </div>
        <div class="row" style="margin-top:4px"><input class="grow" data-f="chatLink" placeholder="ссылка на чат Qwen https://chat.qwen.ai/c/..."><button data-a="chatUse" class="sec">Взять</button></div>
        ${(b.chats || []).map((c) => `<div class="row chatrow ${c.id === b.chatId ? 'cur' : ''}" data-id="${esc(c.id)}">
          <span class="grow"><b>${esc(c.note || c.id.slice(0, 8) + '…')}</b> <span class="muted">${new Date(c.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
          <button data-a="chatOpen" class="sec" title="открыть справа">Открыть</button>
          ${c.id === b.chatId ? '' : '<button data-a="chatPick" class="sec" title="вести разговор в этом чате">Сделать текущим</button>'}
          <button data-a="chatNote" class="sec" title="подписать">✎</button>
          <button data-a="chatForget" class="sec" title="убрать из списка (сам чат в Qwen останется)">✕</button>
        </div>`).join('')}
      </div>` : ''}
      ${openServer.has(b.name) ? `<div class="srv">
        <div class="muted">Чтобы бот вошёл на сервер, один раз нужно сделать на сервере (в консоли сервера или в игре от админа, с «/» в начале):</div>
        ${[['Аккаунт AuthMe (регистрация в игре выключена)', `authme register ${b.name} ${b.password}`],
           ['Если аккаунт уже есть - новый пароль', `authme changepassword ${b.name} ${b.password}`],
           ['Наш аддон античита не наказывает бота', `lp user ${b.name} permission set totemguard.bypass true`]].map(([t, c]) => `
          <div style="margin-top:5px">${t}</div>
          <div class="row"><span class="cmd grow">${esc(showPass.has(b.name) ? c : c.replace(b.password, '•'.repeat(8)))}</span><button data-a="copy" data-cmd="${esc(c)}" class="sec">Копировать</button></div>`).join('')}
        <div style="margin-top:5px">Доступ к вашим сундукам LWC - через базу LWC (это делает администратор, командой не выдаётся).</div>
        <div class="row" style="margin-top:6px">
          <button data-a="pass" class="sec">${showPass.has(b.name) ? 'Скрыть пароль' : 'Показать пароль'}</button>
          <button data-a="newpass" class="sec" title="новый пароль; потом выполните на сервере команду смены пароля">Новый пароль</button>
          <button data-a="probe" class="sec" title="зайти на сервер и сразу выйти, чтобы проверить пароль и доступ">Проверить вход</button>
        </div>
        <div class="muted" data-f="probe">${esc(b.probe || '')}</div>
      </div>` : ''}
      ${openMap.has(b.name) ? `<div class="srv"><canvas data-f="map" width="392" height="392" style="width:100%;border-radius:6px;background:#111"></canvas>
        <div class="muted" data-f="mapinfo">серое - суша, синее - вода, красное - лава, оранжевое - постройки; точки: жёлтая - сундуки, фиолетовая - портал, зелёная - ферма, голубая - деревня, белая - кровать, красная - спавнер. Бот в центре, север сверху.</div></div>` : ''}
      <div data-f="personaBox" style="display:${openPersona.has(b.name) ? 'block' : 'none'}">
        <label>Характер (после сохранения начнётся новый чат)</label><textarea data-f="persona" rows="4">${esc(b.persona || '')}</textarea>
        <div class="row" style="margin-top:6px"><button data-a="savePersona">Сохранить характер</button></div>
      </div>
      <div class="log" data-f="log">${b.log.map(logLine).join('')}</div>` : ''}
  </div>`;
}

let lastHtml = '', qwenOk = null;
// «Что сейчас происходит»: шаги от входа в Qwen до мозга бота, с пояснениями
function step(ic, title, hint) { return `<div class="step"><div class="ic ${ic}"></div><div><b>${esc(title)}</b>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div></div>`; }
let pausedNow = false;
function renderNow(st) {
  const out = [];
  pausedNow = !!st.paused;
  $('pauseBtn').textContent = st.paused ? 'Продолжить' : 'Пауза';
  $('pauseBtn').className = st.paused ? '' : 'sec';
  if (st.captcha) out.push(step('bad', 'Qwen просит пройти проверку', 'откройте «Окно бота» справа и пройдите её (ползунок) - программа ничего не нажимает и ждёт, потом продолжит сама'));
  if (st.paused) out.push(step('warn', 'Мозг на паузе', 'боты стоят на сервере, но к Qwen не обращаются и сами ничего не решают. «Продолжить» - снова думать'));
  out.push(step('', `Сервер: ${st.host}:${st.port}`, 'менять: «Настройки: сервер, хозяева...» ниже; пароль бота - в его карточке, «На сервере»'));
  out.push(qwenOk === null ? step('spin', 'Qwen: проверяю вход', '')
    : qwenOk ? step('ok', 'Qwen: вход выполнен', 'нейросеть - мозг ботов, работает в окне справа (вкладка «Окно бота»)')
      : step('bad', 'Qwen: нужен вход', 'нажмите «Войти через Chrome» ниже и войдите своим аккаунтом Google'));
  if (st.project && st.project.enabled) out.push(step(st.project.id ? 'ok' : 'spin', st.project.id ? 'Проект Qwen готов' : 'Проект Qwen создаётся', 'там чаты ботов и общая память; ' + (st.project.status || '')));
  if (!st.bots.length) out.push(step('warn', 'Ботов нет', 'добавьте бота внизу панели («Добавить бота»)'));
  for (const b of st.bots) {
    const s = b.state || {}, br = b.brain;
    if (s.status === 'online') out.push(step('ok', `${b.name} на сервере`, `${s.dim}, ${s.pos.join(' ')}; ${s.mode === 'follow' ? 'идёт за ' + s.follow : s.mode === 'task' ? 'занят: ' + s.task : 'свободен'}`));
    else if (s.status === 'connecting') out.push(step('spin', `${b.name} заходит на сервер`, 'вход и пароль AuthMe - секунд 10'));
    else { out.push(step('', `${b.name} выключен`, 'кнопка «Включить» в его карточке; при запуске программы боты заходят сами')); continue; }
    if (!br) continue;
    if (br.resting) out.push(step('bad', 'Мозг отдыхает: лимит у всех нейросетей', `снова попробует через ${br.resting} мин. Можно войти в Qwen другим аккаунтом Google или добавить ключи в «Мозги»`));
    else if (br.thinking) out.push(step('spin', `Мозг думает... ${br.thinking.secs} с`, 'о чём: ' + br.thinking.about + (br.queue ? `; ещё в очереди: ${br.queue}` : '')));
    else if (!br.chat) out.push(step('spin', 'Мозг просыпается', 'скоро создастся чат в Qwen и бот начнёт жить сам'));
    else out.push(step('ok', 'Мозг на связи, ждёт', br.nextFree >= 0 ? `своё дело придумает через ${br.nextFree > 60 ? Math.ceil(br.nextFree / 60) + ' мин' : br.nextFree + ' с'}, если раньше никто не позовёт` : 'свободная воля выключена'));
    if (br.last) {
      const ago = Math.round((Date.now() - br.last.at) / 1000);
      const what = [br.last.say && `сказал «${br.last.say}»`, br.last.acts.length && 'делает: ' + br.last.acts.join(', ')].filter(Boolean).join('; ') || 'решил ничего не делать';
      out.push(step('', `Последнее решение (${ago < 60 ? ago + ' с' : Math.round(ago / 60) + ' мин'} назад)`, what + (br.last.model ? ` · модель ${br.last.model}` : '')));
    }
    if (br.goal) out.push(step('', 'Цель: ' + br.goal, 'бот поставил её себе сам и продолжает между делами'));
  }
  $('steps').innerHTML = out.join('');
}
$('pauseBtn').onclick = async () => { await T.pause(!pausedNow); refresh(); };
let brainsFilled = false;
function renderBrains(st) {
  const B = st.brains; if (!B) return;
  $('brainsNow').textContent = (B.now ? 'сейчас думает: ' + B.now + '. ' : '') + 'включены: ' + (B.active.join(', ') || '-');
  if (brainsFilled) return;
  brainsFilled = true;
  $('brainOrder').value = B.order.join(', ');
  $('brainKeys').innerHTML = Object.entries(B.presets).map(([k, p]) => `<label>${esc(p.name)} - ключ ${B.has[k] ? '(вставлен; пусто - оставить, «-» - удалить)' : ''} · <a href="#" data-url="${esc(p.keyUrl)}" class="keylink">где взять</a></label>
    <div class="row"><input class="grow" data-key="${k}" placeholder="${B.has[k] ? '••••••••' : 'вставьте ключ'}"><input style="width:45%" data-model="${k}" value="${esc(B.models[k])}" title="модель"></div>`).join('');
  document.querySelectorAll('.keylink').forEach((a) => { a.onclick = (e) => { e.preventDefault(); T.openExternal(a.dataset.url); }; });
}
$('brainsSave').onclick = () => act(async () => {
  const keys = {}, models = {};
  document.querySelectorAll('[data-key]').forEach((i) => { keys[i.dataset.key] = i.value; i.value = ''; });
  document.querySelectorAll('[data-model]').forEach((i) => { models[i.dataset.model] = i.value; });
  await T.brainsSave({ keys, models, order: $('brainOrder').value });
  brainsFilled = false;
});
async function refresh() {
  const st = await T.state();
  renderNow(st);
  renderBrains(st);
  if (!settingsFilled) {
    $('host').value = st.host; $('port').value = st.port; $('masters').value = st.masters.join(', '); $('birthYear').value = st.birthYear || '';
    $('chatMode').value = st.qwen.chatMode ?? 'fast'; $('planMode').value = st.qwen.planMode ?? 'auto'; $('models').value = (st.qwen.models || []).join(', '); $('serviceModels').value = (st.qwen.serviceModels || []).join(', ');
    settingsFilled = true;
  }
  fillVoice(st.voice);
  if (st.project) {
    if (document.activeElement !== $('pEnabled')) $('pEnabled').checked = st.project.enabled;
    $('pStatus').textContent = (st.project.id ? `«${st.project.name}»` : 'проект создастся сам после входа в Qwen') + (st.project.status ? ': ' + st.project.status : '');
  }
  if (!selected && st.bots[0]) selected = st.bots[0].name;
  const box = $('bots');
  // не перерисовывать, пока человек печатает приказ или характер
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    const sel = st.bots.find((b) => b.name === selected);
    const log = box.querySelector('[data-f="log"]');
    if (sel && log) { const end = log.scrollTop + log.clientHeight >= log.scrollHeight - 20; log.innerHTML = sel.log.map(logLine).join(''); if (end) log.scrollTop = log.scrollHeight; }
    return;
  }
  const html = st.bots.map(botCard).join('') || '<div class="card muted">Ботов пока нет: добавьте ниже.</div>';
  if (html === lastHtml) return;
  const log = box.querySelector('[data-f="log"]');
  const atEnd = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  box.innerHTML = html;
  lastHtml = html;
  const log2 = box.querySelector('[data-f="log"]');
  if (log2 && atEnd) log2.scrollTop = log2.scrollHeight;
}

$('bots').addEventListener('click', (e) => {
  const card = e.target.closest('.bot');
  if (!card) return;
  const name = card.dataset.name;
  const a = e.target.dataset.a;
  if (!a) { if (selected !== name) { selected = name; lastHtml = ''; refresh(); } return; }
  const f = (n) => card.querySelector(`[data-f="${n}"]`);
  if (a === 'start') act(() => T.botStart(name));
  if (a === 'stop') act(() => T.botStop(name));
  if (a === 'order') { const v = f('order').value.trim(); if (v) act(async () => { await T.botOrder({ name, text: v }); f('order').value = ''; f('order').blur(); }); }
  if (a === 'chat') act(() => T.botChat(name));
  if (a === 'map') { openMap.has(name) ? openMap.delete(name) : openMap.add(name); lastHtml = ''; refresh().then(drawMaps); }
  if (a === 'server') { openServer.has(name) ? openServer.delete(name) : openServer.add(name); lastHtml = ''; refresh(); }
  if (a === 'pass') { showPass.has(name) ? showPass.delete(name) : showPass.add(name); lastHtml = ''; refresh(); }
  if (a === 'copy') { navigator.clipboard.writeText(e.target.dataset.cmd); e.target.textContent = 'Скопировано'; setTimeout(() => { e.target.textContent = 'Копировать'; }, 1500); }
  if (a === 'newpass' && confirm('Сделать новый пароль? Потом выполните на сервере команду «authme changepassword», иначе бот не войдёт.')) act(() => T.botNewPass(name));
  if (a === 'probe') act(() => T.botProbe(name));
  if (a === 'chats') { openChats.has(name) ? openChats.delete(name) : openChats.add(name); lastHtml = ''; refresh(); }
  if (a === 'rewarm') act(() => T.chatRewarm(name));
  if (a === 'chatUse') act(async () => { await T.chatUse({ name, link: f('chatLink').value }); f('chatLink').value = ''; f('chatLink').blur(); lastHtml = ''; });
  const cid = e.target.closest('.chatrow') && e.target.closest('.chatrow').dataset.id;
  if (a === 'chatOpen') act(() => T.chatOpen(cid));
  if (a === 'chatPick') act(() => T.chatUse({ name, link: cid }));
  if (a === 'chatForget') act(() => T.chatForget({ name, id: cid }));
  if (a === 'chatNote') {
    // подпись прямо в строке: Enter - сохранить, Esc - отмена
    const row = e.target.closest('.chatrow');
    const label = row.querySelector('b');
    const inp = document.createElement('input');
    inp.value = label.textContent.endsWith('…') ? '' : label.textContent;
    inp.placeholder = 'подпись, Enter';
    inp.dataset.f = 'note';
    label.replaceWith(inp);
    inp.focus();
    inp.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') { const v = inp.value; inp.blur(); act(async () => { await T.chatNote({ name, id: cid, note: v }); lastHtml = ''; }); }
      if (k.key === 'Escape') { inp.blur(); lastHtml = ''; refresh(); }
    });
  }
  if (a === 'chatmode') act(async () => { await T.botChatMode({ name, mode: e.target.dataset.v }); lastHtml = ''; });
  if (a === 'aliases') act(async () => { await T.botChatMode({ name, aliases: f('aliases').value }); f('aliases').blur(); lastHtml = ''; });
  if (a === 'combat') act(async () => { await T.botCombat({ name, combat: e.target.dataset.v }); lastHtml = ''; });
  if (a === 'newchat') act(() => T.botNewChat(name));
  if (a === 'persona') { openPersona.has(name) ? openPersona.delete(name) : openPersona.add(name); lastHtml = ''; refresh(); }
  if (a === 'savePersona') act(async () => { await T.botPersona({ name, persona: f('persona').value }); openPersona.delete(name); f('persona').blur(); lastHtml = ''; });
  if (a === 'remove' && confirm(`Удалить бота ${name}? Пароль его аккаунта на сервере забудется.`)) act(() => T.botRemove(name));
});
$('bots').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.f === 'order') { e.preventDefault(); e.target.closest('.bot').querySelector('[data-a="order"]').click(); }
});

// --- голос
const VOICE_NAMES = { 'ru_RU-denis-medium': 'Денис (мужской)', 'ru_RU-dmitri-medium': 'Дмитрий (мужской)', 'ru_RU-ruslan-medium': 'Руслан (мужской)', 'ru_RU-irina-medium': 'Ирина (женский)' };
function piperText(p) {
  if (!p) return '';
  return p.program && p.voice ? 'Piper скачан, голос готов' : p.program ? 'Piper скачан, этот голос нет: нажмите «Скачать»' : 'Piper не скачан: нажмите «Скачать» (около 85 МБ)';
}
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
$('vSave').onclick = () => act(() => T.voiceSave(voiceForm()));
$('vInstall').onclick = () => act(async () => {
  await T.voiceSave(voiceForm());
  $('vStatus').dataset.busy = '1'; $('vInstall').disabled = true;
  try { await T.voiceInstallPiper(); } finally { delete $('vStatus').dataset.busy; $('vInstall').disabled = false; }
});
$('vTest').onclick = () => act(async () => { await T.voiceSave(voiceForm()); await T.voiceTest(selected); });
T.onVoiceStatus((t) => { $('vStatus').textContent = t; });

// проигрывание: реплики идут по очереди, не накладываются
let audioCtx = null, playUntil = 0;
T.onVoicePcm(({ pcm, rate, volume }) => {
  audioCtx = audioCtx || new AudioContext();
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const n = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const buf = audioCtx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  gain.gain.value = +volume;
  src.buffer = buf; src.connect(gain).connect(audioCtx.destination);
  const at = Math.max(audioCtx.currentTime + 0.05, playUntil);
  src.start(at);
  playUntil = at + buf.duration + 0.15;
});
T.onVoiceSystem(({ text, volume }) => {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU'; u.volume = +volume;
  const ru = speechSynthesis.getVoices().find((v) => /^ru/i.test(v.lang));
  if (ru) u.voice = ru;
  speechSynthesis.speak(u);
});

$('pEnabled').onchange = () => act(() => T.projectEnable($('pEnabled').checked));
$('pOpen').onclick = () => act(() => T.projectOpen());
$('pSync').onclick = () => act(() => T.projectSync());

// быстрый выбор сервера: тестовый в Docker или настоящий через российский вход (прямой адрес из РФ не открывается)
$('srvTest').onclick = () => { $('host').value = '127.0.0.1'; $('port').value = '25566'; };
$('srvLive').onclick = () => { $('host').value = 'play.totemcraft.net'; $('port').value = '20098'; };
$('srvRu').onclick = () => { $('host').value = 'ru.totemcraft.net'; $('port').value = '20098'; };

$('saveSettings').onclick = () => act(() => T.saveSettings({ host: $('host').value, port: $('port').value, masters: $('masters').value, birthYear: $('birthYear').value, chatMode: $('chatMode').value, planMode: $('planMode').value, models: $('models').value, serviceModels: $('serviceModels').value }));
$('add').onclick = () => act(async () => { await T.botAdd({ name: $('newName').value, persona: $('newPersona').value }); selected = $('newName').value.trim(); $('newName').value = ''; $('newPersona').value = ''; lastHtml = ''; });
$('chrome').onclick = async () => { $('chrome').disabled = true; await T.qwenLoginChrome(); $('chrome').disabled = false; refreshQwen(); };
$('reload').onclick = () => T.qwenReload();
// вкладки над Qwen: окно бота и своё окно владельца
let curTab = 'bot';
function paintTabs(t, busy) {
  curTab = t || curTab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === curTab));
  $('tabHint').textContent = curTab === 'deepseek' ? 'DeepSeek - запасной мозг без ключа: войдите здесь один раз (бот спросит его, если у Qwen лимит или капча)'
    : curTab === 'mine' ? 'ваше окно: настройки Qwen, голос, свои чаты. Боты работают в соседней вкладке'
    : (busy ? 'бот сейчас думает в этом окне - лучше не трогать' : 'окно бота: тут Qwen отвечает за ботов');
}
document.querySelectorAll('#tabs [data-tab]').forEach((b) => { b.onclick = async () => paintTabs(await T.qwenTab(b.dataset.tab)); });
$('tabReload').onclick = () => T.qwenTabReload();
setInterval(async () => { try { const s = await T.state(); paintTabs(s.tab, s.botBusy); } catch {} }, 1500);
paintTabs('bot');
T.onLoginStatus((t) => { $('login').textContent = t; });

// карта бота: чанки вокруг (бот в центре, север сверху)
async function drawMaps() {
  for (const name of openMap) {
    const card = [...document.querySelectorAll('.bot')].find((c) => c.dataset.name === name);
    const cv = card && card.querySelector('[data-f="map"]');
    if (!cv) continue;
    const v = await T.botMap(name);
    if (!v) continue;
    const g = cv.getContext('2d'), n = v.r * 2 + 1, s = cv.width / n;
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    for (const [x, z, k, built] of v.chunks) {
      g.fillStyle = built >= 12 ? '#c8813a' : k === 'w' ? '#2f5f9e' : k === 'l' ? '#a8382c' : '#4a4d52';
      g.fillRect((x + v.r) * s, (z + v.r) * s, s - 1, s - 1);
    }
    const COL = { 'сундуки': '#ffd23f', 'портал': '#b05cff', 'ферма': '#3ba55d', 'деревня': '#5fd3ff', 'кровать': '#ffffff', 'спавнер': '#ff4d4d', 'мастерская': '#ff9ff3',
      'шахта': '#8a6a3f', 'подземелье': '#8a6a3f', 'крепость Края': '#9fa3a8', 'испытания': '#d08a4f', 'древний город': '#2a7f8f', 'крепость Незера': '#7a2a2a', 'бастион': '#555', 'подводный храм': '#3fb8a8' };
    for (const [x, z, kind] of v.poi) {
      g.fillStyle = COL[kind] || '#fff';
      g.beginPath(); g.arc((x + v.r + 0.5) * s, (z + v.r + 0.5) * s, Math.max(2, s / 3), 0, 7); g.fill();
    }
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(v.r * s, v.r * s, s, s);
    const info = card.querySelector('[data-f="mapinfo"]');
    if (info && !info.dataset.n) { info.dataset.n = 1; info.textContent = `исследовано чанков: ${v.total}. ` + info.textContent; }
  }
}
setInterval(drawMaps, 5000);
setInterval(refresh, 1000);
setInterval(refreshQwen, 5000);
refresh(); refreshQwen();
