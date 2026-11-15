// Разведка: настоящий щелчок по «Add Files» в окне «Edit Project», перехват выбора файла. node test/cdp_upload2.js <файл>
const file = require('path').resolve(process.argv[2]);
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map(); const net = []; let chooser = null;
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Page.fileChooserOpened') chooser = d.params;
    if (d.method === 'Network.responseReceived' && /api|upload|oss|aliyun/.test(d.params.response.url)) net.push(`${d.params.response.status} ${d.params.response.url.slice(0, 140)}`);
  };
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
  const click = async (expr) => {
    const b = await ev(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!b) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
    return true;
  };
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  console.log('щёлкнул Add Files:', await click(`[...document.querySelectorAll('[role=dialog] button')].find(b => /Add Files/.test(b.textContent))`));
  await new Promise((r) => setTimeout(r, 1200));
  if (!chooser) {
    const menu = await ev(`[...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item, [role=menuitem]')].filter(n=>n.getBoundingClientRect().width>0).map(n=>n.textContent.trim())`);
    console.log('меню:', JSON.stringify(menu));
    if (menu && menu.length) {
      await click(`[...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item, [role=menuitem]')].find(n => n.getBoundingClientRect().width > 0 && /upload|device|local|загруз|компьют|file/i.test(n.textContent))`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  console.log('окно выбора файла:', !!chooser, chooser && chooser.mode);
  if (chooser) console.log('set:', JSON.stringify(await send('DOM.setFileInputFiles', { files: [file], backendNodeId: chooser.backendNodeId })));
  await new Promise((r) => setTimeout(r, 8000));
  console.log('окно:', await ev(`([...document.querySelectorAll('[role=dialog]')].filter(n=>n.getBoundingClientRect().width>0)[0]||{}).innerText`));
  console.log(net.join('\n'));
  await send('Page.setInterceptFileChooserDialog', { enabled: false });
  ws.close();
})();
