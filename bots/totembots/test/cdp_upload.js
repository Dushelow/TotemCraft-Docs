// Разведка: загрузить файл в открытое окно «Edit Project» и сохранить. node test/cdp_upload.js <файл>
const file = require('path').resolve(process.argv[2]);
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map(); const net = [];
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Network.responseReceived' && /api|upload|oss/.test(d.params.response.url)) net.push(`${d.params.response.status} ${d.params.response.url.slice(0, 140)}`);
  };
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Network.enable');
  const doc = await send('DOM.getDocument', { depth: 0 });
  const q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: '[role=dialog] input[type=file]' });
  console.log('полей файла в окне:', q.result.nodeIds.length);
  console.log('set:', JSON.stringify(await send('DOM.setFileInputFiles', { files: [file], nodeId: q.result.nodeIds[0] })), file);
  console.log('в поле:', await ev("document.querySelector('[role=dialog] input[type=file]').files.length"));
  await new Promise((r) => setTimeout(r, 6000));
  console.log('окно:', await ev(`([...document.querySelectorAll('[role=dialog]')].filter(n=>n.getBoundingClientRect().width>0)[0]||{}).innerText`));
  console.log(net.join('\n'));
  ws.close();
})();
