// Окно входа поверх сайта (login-overlay.html): main.js присылает сайт, снимок страницы и логотип, кнопки уходят
// обратно в main.js через login-overlay-preload.js.
const $ = (id) => document.getElementById(id);
let site = '', name = '';
const busy = (on, text) => {
  $('login').disabled = on;
  if (on) $('login').innerHTML = '<span class="spin"></span>Войдите в открывшемся браузере'; else paintLogin();
  if (text !== undefined) { $('status').textContent = text; $('status').className = ''; }
};
window.overlay.onShow((d) => {
  site = d.site; name = d.name;
  if (d.shot) $('shot').style.backgroundImage = `url("${d.shot}")`;
  $('title').textContent = `Войдите в ${name}`;
  const logo = $('logo');
  if (!d.keepStatus) { logo.textContent = name.slice(0, 1).toUpperCase(); logo.classList.remove('img'); }
  if (d.icon) { const img = new Image(); img.alt = ''; img.onload = () => { logo.classList.add('img'); logo.replaceChildren(img); }; img.src = d.icon; }
  if (!d.keepStatus) { busy(false, ''); showBrowser(); }   // браузер могли сменить в «Мозгах»
});
window.overlay.onStatus((t) => {
  $('status').textContent = t;
  $('status').className = /не вышло|ошибка|нужен вход/i.test(t) ? 'bad' : /готово|вошёл/i.test(t) ? 'ok' : '';
});
$('login').onclick = async () => {
  busy(true, '');
  try { const r = await window.overlay.login(site); if (r && r.ok === false) busy(false); } catch (e) { busy(false, 'не вышло: ' + e.message); }
  busy(false);
};

// главная кнопка называет браузер; «Другой браузер» - своё меню (как в «Мозгах»)
let br = { list: [], current: '' };
function paintLogin() { $('login').textContent = br.short ? `Войти через ${br.short}` : 'Войти через браузер'; }
async function showBrowser(r) { br = r || await window.overlay.browsers(); if (!$('login').disabled) paintLogin(); }
function menu(open) {
  const m = $('menu');
  if (!open) { m.hidden = true; return; }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const check = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  m.innerHTML = br.list.map((x) => `<button role="menuitemradio" aria-checked="${x.exe === br.current}" class="${x.exe === br.current ? 'on' : ''}" data-exe="${esc(x.exe)}"><span>${esc(x.name)}</span>${x.exe === br.current ? check : ''}</button>`).join('')
    + (br.list.length ? '<hr>' : '') + '<button role="menuitem" class="mu" data-pick="1">Указать другой...</button>';
  m.hidden = false;
}
$('browser').onclick = (e) => { e.stopPropagation(); menu($('menu').hidden); };
$('browser').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); menu($('menu').hidden); } };
$('menu').onclick = async (e) => {
  const it = e.target.closest('button'); if (!it) return;
  e.stopPropagation(); menu(false);
  showBrowser(it.dataset.pick ? await window.overlay.browserPick() : await window.overlay.browserSet(it.dataset.exe));
};
window.overlay.onBrowserChanged((r) => showBrowser(r));   // сменили в «Мозгах»
document.addEventListener('click', () => menu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu(false); });
showBrowser();
