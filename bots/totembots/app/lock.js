// Замок окна бота: пока программа сама работает на сайте нейросети, щелчки и клавиши владельца в это окно не проходят,
// а прокрутка - проходит (диалог можно листать и читать). Одинаково для Qwen, DeepSeek и всех остальных сайтов.
// Свои действия программы идут мимо замка: скрипты вызывают события прямо на элементах (isTrusted = false), а перед
// настоящим щелчком отладчиком ставится window.__tbPass.
// Сверху страницы - полоска «бот работает здесь», она не ловит мышь (pointer-events: none), колесо до сайта доходит.

const lockOn = (text) => `(() => {
  const was = window.__tbLocked;
  window.__tbLocked = true;
  if (!window.__tbLockInstalled) {
    window.__tbLockInstalled = true;
    const block = (e) => { if (window.__tbLocked && e.isTrusted && !window.__tbPass) { e.preventDefault(); e.stopImmediatePropagation(); } };
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup',
      'touchstart', 'keydown', 'keypress', 'keyup', 'paste', 'cut', 'drop', 'dragstart'])
      window.addEventListener(t, block, true);
  }
  let bar = document.getElementById('tb-lockbar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'tb-lockbar';
    bar.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' +
      'padding:5px 14px;border-radius:999px;background:rgba(43,45,49,.92);color:#e6e6e6;font:12.5px Segoe UI,sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);border:1px solid #5865f2';
    document.documentElement.appendChild(bar);
  }
  bar.textContent = ${JSON.stringify(text || 'Бот работает в этом окне: листать можно, нажимать и печатать нельзя')};
  bar.style.display = 'block';
  // только при включении замка (повторный вызов идёт, пока программа сама печатает в поле - фокус не сбивать)
  const ae = document.activeElement;
  if (!was && ae && (/INPUT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable)) ae.blur();
  return 1;
})()`;

const LOCK_OFF = `(() => { window.__tbLocked = false; const b = document.getElementById('tb-lockbar'); if (b) b.style.display = 'none'; return 1; })()`;

module.exports = { lockOn, LOCK_OFF };
