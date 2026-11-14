// Разведка: что уходит в /api/v2/tts/completions и что приходит. Программа запущена с --remote-debugging-port=9223,
// в Qwen открыт чат с ответом. node test/cdp_tts.js
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map(); let reqId = null; let done = false; const info = {};
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Network.requestWillBeSent' && /tts\/completions/.test(d.params.request.url)) {
      reqId = d.params.requestId; info.url = d.params.request.url; info.method = d.params.request.method;
      info.body = d.params.request.postData; info.headers = Object.keys(d.params.request.headers);
    }
    if (d.method === 'Network.loadingFinished' && d.params.requestId === reqId) {
      const b = await send('Network.getResponseBody', { requestId: reqId });
      const text = b.result ? (b.result.base64Encoded ? Buffer.from(b.result.body, 'base64').toString() : b.result.body) : '';
      const lines = text.split('\n').filter(Boolean);
      info.lines = lines.length;
      info.first = lines.slice(0, 2).map((l) => l.slice(0, 500));
      info.last = lines.slice(-2).map((l) => l.slice(0, 300));
      done = true;
    }
  };
  await send('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 100e6 });
  await send('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{ const fire=(el)=>{for(const t of ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true}));};
    const b=[...document.querySelectorAll('[aria-label="More actions"]')].pop(); fire(b); await new Promise(r=>setTimeout(r,700));
    const it=[...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item')].find(n=>/read aloud/i.test(n.textContent)); fire(it); return 1; })()` });
  for (let i = 0; i < 60 && !done; i++) await new Promise((r) => setTimeout(r, 300));
  console.log(JSON.stringify(info, null, 1));
  ws.close();
})();
