// Умный чат (CHAT.md) на стенде с Qwen: что уходит в Qwen, что в «вокруг», что в фон; ответ в том же канале.
// Свои настройки в test/.data (как qwen_e2e). Запуск: node test/chat_e2e.js
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { clickActionPacket } = require('../app/bot');

const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killApp = require('./kill_test_app');
const DATA = path.join(__dirname, '.data');
const CFG = path.join(DATA, 'config.json');
const X = 1300, Y = 150, Z = 1300;
const results = [];
const check = (n, ok, info = '') => { const l = `${ok ? 'OK  ' : 'FAIL'} ${n}${info ? ' - ' + info : ''}`; results.push(l); console.log(l); };

if (/electron\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq electron.exe"').toString())) { console.log('программа открыта у владельца - не мешаю'); process.exit(2); }
{
  fs.mkdirSync(DATA, { recursive: true });
  const old = fs.existsSync(CFG) ? JSON.parse(fs.readFileSync(CFG, 'utf8')) : {};
  let year = ''; try { year = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'totembots', 'config.json'), 'utf8')).birthYear || ''; } catch {}
  const bot = (old.bots || [])[0] || {};
  fs.writeFileSync(CFG, JSON.stringify({ ...old, host: '127.0.0.1', port: 25566, masters: ['TbOwner'], birthYear: year,
    voice: { ...(old.voice || {}), enabled: false }, bots: [{ ...bot, name: 'TbAlex', password: 'Tb12345x', chatMode: 'normal' }] }, null, 2));
}

function robot(name) {
  const r = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: name, version: '1.21.11', auth: 'offline' });
  r._client.on('show_dialog', (d) => { const id = (JSON.stringify(d).match(/"(authme:[^"]*submit)"/) || [])[1]; if (id) r._client.writeRaw(clickActionPacket(id, { password: { type: 'string', value: 'Tb12345x' } })); });
  r.on('physicsTick', () => { try { r._client.write('tick_end', {}); } catch {} });
  r.heard = [];
  r.on('messagestr', (m, pos, json) => { const shown = json && json.unsigned ? String(json.unsigned.toString()) : m; if (/TbAlex/.test(shown)) r.heard.push(shown); });
  return new Promise((ok) => r.once('spawn', () => ok(r)));
}

async function panel() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9223/json')).json();
      const p = list.find((t) => t.url.endsWith('panel.html'));
      if (p) {
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((r) => { ws.onopen = r; });
        let id = 0; const wait = new Map();
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
        return (expr) => new Promise((r) => { wait.set(++id, (d) => r(d.result && d.result.result && d.result.result.value)); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error('панель не открылась');
}

(async () => {
  rcon('authme register TbVasya Tb12345x');
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  const owner = await robot('TbOwner'); await sleep(4500);
  const vasya = await robot('TbVasya'); await sleep(2000);
  rcon(`tp TbOwner ${X} ${Y} ${Z - 6}`);
  rcon(`tp TbVasya ${X + 400} ${Y} ${Z + 400}`);   // далеко

  const app = spawn(path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd'), ['.', '--remote-debugging-port=9223'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore', env: { ...process.env, TOTEMBOTS_CONFIG: CFG, TOTEMBOTS_MEMORY: DATA, TOTEMBOTS_PROJECT_NAME: 'TotemCraft · тест' } });
  const ev = await panel();
  await sleep(4000);
  await ev('window.totem.botStart("TbAlex")');
  for (let i = 0; i < 30; i++) { await sleep(1000); const s = await ev('window.totem.state()'); if (s.bots[0].state.status === 'online') break; }
  await sleep(3000);
  rcon(`tp TbAlex ${X} ${Y} ${Z}`);
  await sleep(2000);
  const st = () => ev('window.totem.state()');
  const asks = async () => (await st()).bots[0].log.filter((l) => / → /.test(l));
  const waitReply = async (ms = 45000) => { const t0 = Date.now(); const n0 = (await st()).bots[0].log.filter((l) => / ← /.test(l)).length; while (Date.now() - t0 < ms) { await sleep(1500); const n = (await st()).bots[0].log.filter((l) => / ← /.test(l)).length; if (n > n0) { await sleep(6000); return true; } } return false; };

  console.log('== 1. далёкий общий чат - в фон, не в Qwen');
  const a0 = (await asks()).length;
  vasya.chat('кто-нибудь продаёт алмазы? плачу железом');
  await sleep(6000);
  check('далёкий общий чат не ушёл в Qwen', (await asks()).length === a0);

  console.log('== 2. хозяин рядом в общий с именем - ответ в общий');
  owner.heard.length = 0;
  owner.chat('Alex, привет! как дела?');
  await waitReply();
  check('ответил в общий чат', owner.heard.some((h) => /^<TbAlex>/.test(h)), owner.heard.slice(-2).join(' | '));

  console.log('== 3. продолжение без имени - это всё ещё к нему');
  const a3 = (await asks()).length;
  owner.chat('а ты что сейчас делаешь?');
  await waitReply();
  check('продолжение разговора ушло в Qwen', (await asks()).length > a3);

  console.log('== 4. Вася рядом говорит хозяину - это «вокруг», а не обращение');
  rcon(`tp TbVasya ${X + 20} ${Y} ${Z}`); await sleep(2000);
  const a4 = (await asks()).length;
  vasya.chat('Valghard, го завтра в незер за кварцем');
  await sleep(5000);
  check('чужая реплика рядом не разбудила бота', (await asks()).length === a4);
  owner.chat('Alex, ты слышал, что Вася предлагает?');
  await waitReply();
  const last4 = (await asks()).slice(-1)[0] || '';
  const full = (await st()).bots[0].log.slice(-30).join('\n');
  check('к обращению приложено [вокруг] с репликой Васи', /\[вокруг\][^\n]*кварц/.test(full) || /вокруг/.test(last4));

  console.log('== 5. ближний чат - ответ в ближний');
  owner.heard.length = 0;
  owner.chat('!эй, ты меня слышишь по ближнему?');
  await waitReply();
  check('ответил в ближний', owner.heard.some((h) => /^\[Рядом\]\s*<TbAlex>/.test(h)), owner.heard.slice(-2).join(' | '));

  console.log('== 6. личка - ответ в личку');
  owner.heard.length = 0;
  owner.chat('/msg TbAlex скажи по секрету, ты бот?');
  await waitReply();
  check('ответил в личку', owner.heard.some((h) => /TbAlex\s*->/.test(h)), owner.heard.slice(-2).join(' | '));

  console.log('== 7. фон сжимается в новости');
  rcon(`tp TbVasya ${X + 400} ${Y} ${Z + 400}`); await sleep(1500);
  for (const t of ['народ, в субботу ивент у спавна, приходите', 'кто потерял лук у моста, он у меня', 'ищу напарника строить ферму золота',
    'продаю алмазы 1 за 9 железа', 'кто-то разобрал мост у деревни, админы посмотрите']) { vasya.chat(t); await sleep(1500); }
  await sleep(2000);
  console.log('   в фоне строк:', (await st()).background.waiting);
  await ev('window.totem.backgroundNow()');
  const bg = (await st()).background;
  check('фон сжат в новости', bg.news.length > 0, bg.status + ' | ' + bg.news.join(' / '));

  const s = await st();
  console.log('\nсчётчик внимания:', JSON.stringify(s.bots[0].attention));
  console.log('--- журнал бота (последнее):\n' + s.bots[0].log.slice(-45).filter((l) => !/(joined|left) the game/.test(l)).join('\n'));
  console.log('ИТОГ:\n' + results.join('\n'));
  await ev('window.totem.botStop("TbAlex")');
  owner.quit(); vasya.quit();
  await sleep(1500);
  killApp();
  rcon(`forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  process.exit(0);
})().catch((e) => { console.error(e); killApp(); process.exit(1); });
