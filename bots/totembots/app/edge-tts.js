// Голоса Microsoft Edge («Читать вслух» в браузере Edge): бесплатные нейроголоса, без ключа, любой текст - значит,
// озвучка работает, какая бы нейросеть ни ответила (DeepSeek, Gemini...). Неофициальный способ: Microsoft может
// поменять или закрыть - тогда сработает запасной голос (Qwen, Piper).
// Протокол как у открытого edge-tts: WebSocket, запрос SSML, ответ - куски звука. Формат - сырой PCM 24 кГц.
const crypto = require('crypto');

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VER = '1-130.0.2849.68';
const EDGE_VOICES = {
  'ru-RU-SvetlanaNeural': 'Светлана (женский)',
  'ru-RU-DariyaNeural': 'Дарья (женский)',
  'ru-RU-DmitryNeural': 'Дмитрий (мужской)',
};

// подпись запроса: время Windows (100 нс от 1601 г.), округлённое до 5 минут, + токен -> SHA-256
function gec() {
  const ticks = BigInt(Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300) * 10000000n;
  return crypto.createHash('sha256').update(ticks.toString() + TOKEN, 'ascii').digest('hex').toUpperCase();
}
const xml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// Маленький WebSocket-клиент: встроенный в Node не даёт задать заголовки (Origin), без них Microsoft отвечает 403.
function wsConnect(url, headers) {
  const https = require('https');
  return new Promise((ok, fail) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = https.request(url, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
    req.on('response', (res) => fail(new Error('Edge: HTTP ' + res.statusCode)));
    req.on('error', (e) => fail(new Error('Edge: ' + e.message)));
    req.on('upgrade', (_res, sock, head) => {
      const ws = { onText: () => {}, onBin: () => {}, onClose: () => {} };
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      ws.send = (text) => {
        const data = Buffer.from(text, 'utf8'), mask = crypto.randomBytes(4), n = data.length;
        const hdr = n < 126 ? Buffer.from([0x81, 0x80 | n]) : n < 65536 ? Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
        const body = Buffer.alloc(n); for (let i = 0; i < n; i++) body[i] = data[i] ^ mask[i & 3];
        sock.write(Buffer.concat([hdr, mask, body]));
      };
      ws.close = () => { try { sock.end(); } catch {} };
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const data = buf.subarray(off, off + len); buf = buf.subarray(off + len);
          if (op === 1) ws.onText(data.toString('utf8')); else if (op === 2) ws.onBin(Buffer.from(data)); else if (op === 8) { ws.close(); ws.onClose(); return; }
        }
      };
      sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
      sock.on('close', () => ws.onClose());
      sock.on('error', () => ws.onClose());
      ok(ws); pump();
    });
    req.end();
  });
}

/** Текст -> { pcm: Buffer (16 бит моно), rate }. */
async function edgeSpeak(text, voice = 'ru-RU-SvetlanaNeural', rate = '+0%', pitch = '+0Hz') {
  const id = crypto.randomUUID().replace(/-/g, '');
  const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=${VER}&ConnectionId=${id}`;
  const ws = await wsConnect(url, { Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', Pragma: 'no-cache', 'Cache-Control': 'no-cache' });
  return new Promise((ok, fail) => {
    const parts = [];
    let done = false;
    const end = (e) => { if (done) return; done = true; clearTimeout(timer); ws.close(); const pcm = Buffer.concat(parts); if (e) fail(e); else if (pcm.length) ok({ pcm, rate: 24000 }); else fail(new Error('Edge: пустой звук')); };
    const timer = setTimeout(() => end(new Error('Edge: нет ответа 20 с')), 20000);
    ws.onText = (t) => { if (t.includes('Path:turn.end')) end(); };
    ws.onBin = (b) => { const hl = b.readUInt16BE(0); if (b.subarray(2, 2 + hl).toString().includes('Path:audio')) parts.push(b.subarray(2 + hl)); };
    ws.onClose = () => end(parts.length ? null : new Error('Edge: соединение закрыто без звука'));
    const ts = new Date().toString();
    ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"raw-24khz-16bit-mono-pcm"}}}}');
    ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${xml(text)}</prosody></voice></speak>`);
  });
}

module.exports = { edgeSpeak, EDGE_VOICES };
