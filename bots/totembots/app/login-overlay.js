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
  if (!d.keepStatus) busy(false, '');
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

// главная кнопка называет браузер и показывает его значок; «Другой браузер» - меню найденных
let br = {};
function paintLogin() {
  const b = $('login'); b.textContent = '';
  if (br.icon) { const img = new Image(); img.alt = ''; img.src = br.icon; b.appendChild(img); }
  b.appendChild(document.createTextNode(br.short ? `Войти через ${br.short}` : 'Войти через браузер'));
}
async function showBrowser() { br = await window.overlay.browsers(); if (!$('login').disabled) paintLogin(); }
const pick = async () => { await window.overlay.browserMenu(); showBrowser(); };
$('browser').onclick = pick;
$('browser').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
showBrowser();
