// Разведка страницы проекта Qwen в широком окне: node test/cdp_wide.js "<выражение>" [ширина]
const [expr, width] = process.argv.slice(2);
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map();
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  if (width) await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 1500));
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result && (r.result.result.value ?? r.result.result.description), null, 1).slice(0, 6000));
  ws.close();
})();
