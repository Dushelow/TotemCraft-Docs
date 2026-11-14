// Отладка страницы Qwen внутри TotemBots: node test/cdp.js "<выражение JS>" [--net секунд]
// Программа должна быть запущена с --remote-debugging-port=9223.
const [expr, flag, secs] = process.argv.slice(2);

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map();
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const net = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Network.responseReceived') net.push(`${d.params.response.status} ${d.params.response.mimeType} ${d.params.response.url.slice(0, 160)}`);
    if (d.method === 'Network.webSocketCreated') net.push('WS ' + d.params.url.slice(0, 160));
  };
  if (flag === '--net') await send('Network.enable');
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result && (r.result.result.value ?? r.result.result.description ?? r.result), null, 1).slice(0, 6000));
  if (flag === '--net') {
    await new Promise((res) => setTimeout(res, (+secs || 8) * 1000));
    console.log(net.filter((l) => !/\.(js|css|png|svg|woff2?)(\?|$)/.test(l)).join('\n'));
  }
  ws.close();
})();
