// Окно входа поверх сайта (login-overlay.html): main.js присылает сайт, снимок страницы и логотип, кнопки уходят
// обратно в main.js через login-overlay-preload.js.
const $ = (id) => document.getElementById(id);
let site = '', name = '';
const busy = (on, text) => {
  $('login').disabled = on;
  $('login').innerHTML = on ? '<span class="spin"></span>Открыт браузер: войдите там' : 'Войти через браузер';
  if (text !== undefined) { $('status').textContent = text; $('status').className = ''; }
};
window.overlay.onShow((d) => {
  site = d.site; name = d.name;
  if (d.shot) $('shot').style.backgroundImage = `url("${d.shot}")`;
  $('title').textContent = `Войдите в ${name}`;
  $('lead').textContent = `Бот пишет ${name} от вашего аккаунта. Пока вход не выполнен, этот сайт ему недоступен.`;
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
  busy(true, 'Откроется ваш браузер. Войдите там как обычно, программа заберёт вход сама.');
  try { const r = await window.overlay.login(site); if (r && r.ok === false) busy(false); } catch (e) { busy(false, 'не вышло: ' + e.message); }
  busy(false);
};
$('here').onclick = () => window.overlay.here(site);
$('recheck').onclick = async () => {
  $('status').textContent = 'проверяю...'; $('status').className = '';
  const ok = await window.overlay.recheck(site);
  $('status').textContent = ok ? 'вход есть' : 'вход пока не найден';
  $('status').className = ok ? 'ok' : 'bad';
};
