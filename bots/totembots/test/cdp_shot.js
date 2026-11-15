// Снимок страницы Qwen внутри программы: node test/cdp_shot.js <файл.png>
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://chat.qwen.ai'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { require('fs').writeFileSync(process.argv[2], Buffer.from(d.result.data, 'base64')); ws.close(); } };
  ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
})();
