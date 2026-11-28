// Окно входа поверх сайта (login-overlay.html): main.js присылает сайт, снимок страницы и логотип, кнопки уходят
// обратно в main.js через login-overlay-preload.js.
const $ = (id) => document.getElementById(id);
let site = '', name = '';
const busy = (on, text) => {
  $('login').disabled = on;
  if (on) $('login').innerHTML = '<span class="spin"></span>Войдите в открывшемся браузере'; else paintLogin();
  if (text !== undefined) { $('status').textContent = text; $('status').className = ''; }
};
// картинка готова к показу (раскодирована), но не дольше 150 мс - иначе показываем без неё
const ready = (src) => new Promise((ok) => { if (!src) return ok(null); const img = new Image(); img.alt = ''; img.src = src; const t = setTimeout(() => ok(null), 150); img.decode().then(() => { clearTimeout(t); ok(img); }, () => { clearTimeout(t); ok(null); }); });
let showSeq = 0;
window.overlay.onShow(async (d) => {
  const seq = ++showSeq;
  site = d.site; name = d.name;
  const [shotImg, logoImg] = await Promise.all([ready(d.shot), $('logo').dataset.src === d.icon ? null : ready(d.icon)]);
  if (seq !== showSeq) return;   // пришёл более новый показ
  if (d.shot && shotImg) $('shot').style.backgroundImage = `url("${d.shot}")`;
  $('title').textContent = `Войдите в ${name}`;
  const logo = $('logo');
  if (!d.keepStatus && !logoImg && logo.dataset.src !== d.icon) { logo.textContent = name.slice(0, 1).toUpperCase(); logo.className = 'logo'; logo.dataset.src = ''; }
  if (logoImg) placeLogo(logo, d.icon, logoImg);
  if (!d.keepStatus) { busy(false, ''); showBrowser(); }   // браузер могли сменить в «Мозгах»
  document.querySelector('.card').classList.remove('blank'); $('shot').classList.remove('blank');
});
// окно спрятано (переключили на сайт со входом) - очистить, чтобы при следующем показе не мелькнул прошлый сайт
window.overlay.onHide(() => { showSeq++; document.querySelector('.card').classList.add('blank'); $('shot').classList.add('blank'); $('shot').style.backgroundImage = ''; });
// Логотип: смотрим саму картинку. Углы непрозрачные - у логотипа свой фон, показываем как есть во всю плитку.
// Прозрачный - подложка по яркости рисунка: тёмный рисунок на светлой, светлый на тёмной (28.11: чёрный квадрат
// на белой подложке выглядел уродливо).
function placeLogo(logo, src, img) {
  {
    let full = false, light = false;
    try {
      const n = 48, c = document.createElement('canvas'); c.width = c.height = n;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, n, n);
      const px = g.getImageData(0, 0, n, n).data, a = (x, y) => px[(y * n + x) * 4 + 3];
      // свой фон: углы непрозрачные или почти вся картинка залита (скруглённый квадрат Grok, Poe, Perplexity)
      let op = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 200) op++;
      full = [[1, 1], [n - 2, 1], [1, n - 2], [n - 2, n - 2]].every(([x, y]) => a(x, y) > 230) || op / (n * n) > 0.72;
      if (!full) {
        let sum = 0, cnt = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; cnt++; }
        light = cnt > 0 && sum / cnt < 110;   // тёмный рисунок
      }
    } catch {}
    logo.className = 'logo' + (full ? ' full' : light ? ' light' : '');
    logo.dataset.src = src; logo.replaceChildren(img);
  }
}
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
