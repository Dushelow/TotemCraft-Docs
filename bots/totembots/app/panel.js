const $ = (id) => document.getElementById(id);
const T = window.totem;
let selected = '';
let settingsFilled = false;
const openChats = new Set();
let voiceFilled = false;
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
      <label>Мобы</label>
      <div class="row">
        ${[['defend', 'Защищать себя и меня'], ['flee', 'Убегать ко мне'], ['off', 'Не трогать']].map(([v, t]) =>
          `<button data-a="combat" data-v="${v}" class="${b.combat === v ? '' : 'sec'}">${t}</button>`).join('')}
      </div>
      <div class="row" style="margin-top:6px">
        <button data-a="chat" class="sec" ${b.chatId ? '' : 'disabled'}>Его чат в Qwen</button>
        <button data-a="newchat" class="sec">Новый чат</button>
        <button data-a="persona" class="sec">Характер</button>
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
    $('chatMode').value = st.qwen.chatMode ?? 'fast'; $('planMode').value = st.qwen.planMode ?? 'auto'; $('models').value = (st.qwen.models || []).join(', ');
    settingsFilled = true;
  }
  fillVoice(st.voice);
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
    $('vLocal').checked = !!v.local; $('vVolume').value = v.volume;
    $('vPiperVoice').innerHTML = v.piper.voices.map((n) => `<option value="${n}">${VOICE_NAMES[n] || n}</option>`).join('');
    $('vPiperVoice').value = v.piperVoice;
    voiceFilled = true;
  }
  if (!$('vStatus').dataset.busy) $('vStatus').textContent = piperText(v.piper);
}
const voiceForm = () => ({ enabled: $('vEnabled').checked, provider: $('vProvider').value, fallback: $('vFallback').checked,
  local: $('vLocal').checked, volume: $('vVolume').value, piperVoice: $('vPiperVoice').value });
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

$('saveSettings').onclick = () => act(() => T.saveSettings({ host: $('host').value, port: $('port').value, masters: $('masters').value, birthYear: $('birthYear').value, chatMode: $('chatMode').value, planMode: $('planMode').value, models: $('models').value }));
$('add').onclick = () => act(async () => { await T.botAdd({ name: $('newName').value, persona: $('newPersona').value }); selected = $('newName').value.trim(); $('newName').value = ''; $('newPersona').value = ''; lastHtml = ''; });
$('chrome').onclick = async () => { $('chrome').disabled = true; await T.qwenLoginChrome(); $('chrome').disabled = false; refreshQwen(); };
$('reload').onclick = () => T.qwenReload();
T.onLoginStatus((t) => { $('login').textContent = t; });

setInterval(refresh, 1000);
setInterval(refreshQwen, 5000);
refresh(); refreshQwen();
