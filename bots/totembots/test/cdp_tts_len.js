// Разведка: сколько секунд звука Qwen делает из ответа (читает ли блок кода). node test/cdp_tts_len.js "<текст запроса>"
const prompt = process.argv[2];
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map(); let reqId = null; let pcm = null; let answer = '';
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Network.requestWillBeSent' && /tts\/completions/.test(d.params.request.url)) reqId = d.params.requestId;
    if (d.method === 'Network.loadingFinished' && d.params.requestId === reqId) {
      const b = await send('Network.getResponseBody', { requestId: reqId });
      const text = b.result.base64Encoded ? Buffer.from(b.result.body, 'base64').toString() : b.result.body;
      const parts = [];
      for (const l of text.split('\n')) { const m2 = /"tts": "([^"]*)"/.exec(l); if (m2 && m2[1]) parts.push(Buffer.from(m2[1], 'base64')); }
      pcm = Buffer.concat(parts);
    }
  };
  await send('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 100e6 });
  const fire = `const fire=(el)=>{for(const t of ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true}));};`;
  await send('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{ ${fire} const ta=document.querySelector('textarea.message-input-textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta, ${JSON.stringify(prompt)}); ta.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,500)); fire(document.querySelector('button.send-button')); return 1; })()` });
  await new Promise((r) => setTimeout(r, 15000));
  const a = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async()=>{ ${fire}
    const t=[...document.querySelectorAll('.qwen-markdown, [class*=response-message-content], [class*=markdown]')].map(n=>n.innerText).filter(Boolean).pop()||'';
    fire([...document.querySelectorAll('[aria-label="More actions"]')].pop()); await new Promise(r=>setTimeout(r,700));
    fire([...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item')].find(n=>/read aloud/i.test(n.textContent))); return t; })()` });
  answer = a.result.result.value;
  for (let i = 0; i < 80 && !pcm; i++) await new Promise((r) => setTimeout(r, 300));
  console.log('ответ на странице:', JSON.stringify(answer).slice(0, 400));
  console.log('звук:', pcm ? (pcm.length / 2 / 24000).toFixed(1) + ' с' : 'нет');
  if (pcm && process.argv[3]) require('fs').writeFileSync(process.argv[3], pcm);
  ws.close();
})();
