const $ = (id) => document.getElementById(id);
const T = window.totem;
let selected = '';
let settingsFilled = false;
const openPersona = new Set();

function err(e) { $('err').textContent = e ? String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''; }
async function act(fn) { try { err(''); await fn(); await refresh(); } catch (e) { err(e); } }

async function refreshQwen() {
  const s = await T.qwenState();
  $('qdot').className = 'dot ' + (s.loggedIn ? 'ok' : 'bad');
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
      <div class="row" style="margin-top:6px">
        <button data-a="chat" class="sec" ${b.chatId ? '' : 'disabled'}>Его чат в Qwen</button>
        <button data-a="newchat" class="sec">Новый чат</button>
        <button data-a="persona" class="sec">Характер</button>
        <button data-a="remove" class="red">Удалить</button>
      </div>
      <div data-f="personaBox" style="display:${openPersona.has(b.name) ? 'block' : 'none'}">
        <label>Характер (после сохранения начнётся новый чат)</label><textarea data-f="persona" rows="4">${esc(b.persona || '')}</textarea>
        <div class="row" style="margin-top:6px"><button data-a="savePersona">Сохранить характер</button></div>
      </div>
      <div class="log" data-f="log">${b.log.map(logLine).join('')}</div>` : ''}
  </div>`;
}

let lastHtml = '';
async function refresh() {
  const st = await T.state();
  if (!settingsFilled) {
    $('host').value = st.host; $('port').value = st.port; $('masters').value = st.masters.join(', '); $('birthYear').value = st.birthYear || '';
    settingsFilled = true;
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
  if (a === 'newchat') act(() => T.botNewChat(name));
  if (a === 'persona') { openPersona.has(name) ? openPersona.delete(name) : openPersona.add(name); lastHtml = ''; refresh(); }
  if (a === 'savePersona') act(async () => { await T.botPersona({ name, persona: f('persona').value }); openPersona.delete(name); f('persona').blur(); lastHtml = ''; });
  if (a === 'remove' && confirm(`Удалить бота ${name}? Пароль его аккаунта на сервере забудется.`)) act(() => T.botRemove(name));
});
$('bots').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.f === 'order') { e.preventDefault(); e.target.closest('.bot').querySelector('[data-a="order"]').click(); }
});

$('saveSettings').onclick = () => act(() => T.saveSettings({ host: $('host').value, port: $('port').value, masters: $('masters').value, birthYear: $('birthYear').value }));
$('add').onclick = () => act(async () => { await T.botAdd({ name: $('newName').value, persona: $('newPersona').value }); selected = $('newName').value.trim(); $('newName').value = ''; $('newPersona').value = ''; lastHtml = ''; });
$('chrome').onclick = async () => { $('chrome').disabled = true; await T.qwenLoginChrome(); $('chrome').disabled = false; refreshQwen(); };
$('reload').onclick = () => T.qwenReload();
T.onLoginStatus((t) => { $('login').textContent = t; });

setInterval(refresh, 1000);
setInterval(refreshQwen, 5000);
refresh(); refreshQwen();
