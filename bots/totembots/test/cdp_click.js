// Настоящий щелчок мышью (через отладчик) по элементу: node test/cdp_click.js "<css-селектор>" [ждать мс]
// и вывод видимых текстов после щелчка.
const [sel, ms] = process.argv.slice(2);
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map();
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
  const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) { console.log('нет элемента'); ws.close(); return; }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, +ms || 1500));
  console.log(JSON.stringify(await ev(`({ dialogs: [...document.querySelectorAll('[role=dialog]')].filter(n=>n.getBoundingClientRect().width>0).map(n=>n.innerText.slice(0,900)),
    files: [...document.querySelectorAll('input[type=file]')].map(f=>(f.closest('[role=dialog]')?'в окне':'вне')+' accept='+f.accept) })`), null, 1));
  ws.close();
})();
