// Полная проверка на стенде tc-up: программа TotemBots (с Qwen) ведёт бота TbAlex, тестовый хозяин TbOwner пишет ему.
// Программа запускается с портом отладки 9223, кнопки панели жмём через window.totem.* (как человек в панели).
// Перед запуском: в %APPDATA%/totembots/config.json бот TbAlex (пароль Tb12345x), host 127.0.0.1:25566, masters [TbOwner].
// Запуск: node test/qwen_e2e.js
const { spawn, execSync } = require('child_process');
const path = require('path');
const mineflayer = require('mineflayer');
const { clickActionPacket } = require('../app/bot');

const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m|§./g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 1300, Y = 150, Z = 1300;

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
  rcon('difficulty peaceful');
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  rcon(`fill ${X - 30} ${Y - 1} ${Z - 30} ${X + 30} ${Y - 1} ${Z + 30} stone`);
  rcon(`fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 4} ${Z + 30} air`);
  rcon(`setblock ${X + 10} ${Y} ${Z} chest`);
  rcon(`data merge block ${X + 10} ${Y} ${Z} {Items:[{Slot:0b,id:"minecraft:white_wool",count:64},{Slot:1b,id:"minecraft:white_wool",count:64},{Slot:2b,id:"minecraft:oak_log",count:32}]}`);


  const owner = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'TbOwner', version: '1.21.11', auth: 'offline' });
  owner._client.on('show_dialog', (d) => { const id = (JSON.stringify(d).match(/"(authme:[^"]*submit)"/) || [])[1]; if (id) owner._client.writeRaw(clickActionPacket(id, { password: { type: 'string', value: 'Tb12345x' } })); });
  owner.on('physicsTick', () => { try { owner._client.write('tick_end', {}); } catch {} });
  owner.on('chat', (u, m) => { if (u !== 'TbOwner') console.log(`[игра] <${u}> ${m}`); });
  await new Promise((r) => owner.once('spawn', r));
  await sleep(2000);
  rcon('minecraft:clear TbOwner');
  rcon(`tp TbOwner ${X} ${Y} ${Z - 8}`);

  const app = spawn(path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd'), ['.', '--remote-debugging-port=9223'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  const ev = await panel();
  await sleep(4000);
  console.log('Qwen:', JSON.stringify(await ev('window.totem.qwenState()')));
  await ev('window.totem.botStart("TbAlex")');
  for (let i = 0; i < 30; i++) { await sleep(1000); const s = await ev('window.totem.state()'); if (s.bots[0].state.status === 'online') break; }
  await sleep(3000);
  rcon(`tp TbAlex ${X - 4} ${Y} ${Z - 8}`);
  await sleep(2000);

  const showLog = async (n = 12) => { const s = await ev('window.totem.state()'); console.log(s.bots[0].log.slice(-n).join('\n')); };

  console.log('\n== 1. болтовня');
  owner.chat('привет TbAlex, как дела?');
  await sleep(45000);
  await showLog();

  console.log('\n== 2. иди за мной');
  owner.chat('TbAlex иди за мной');
  await sleep(35000);
  rcon(`tp TbOwner ${X - 15} ${Y} ${Z + 10}`);
  await sleep(10000);
  const pa = rcon('data get entity TbAlex Pos'), pb = rcon('data get entity TbOwner Pos');
  console.log('бот', pa.replace(/.*: /, ''), '| хозяин', pb.replace(/.*: /, ''));
  await showLog(6);

  console.log('\n== 3. курьер из панели');
  await ev(`window.totem.botOrder({ name: "TbAlex", text: "возьми 2 стака белой шерсти из сундука ${X + 10} ${Y} ${Z} и отдай TbOwner" })`);
  await sleep(90000);
  await showLog(10);
  await sleep(3000);
  console.log('у TbOwner шерсти:', owner.inventory.items().filter((i) => i.name === 'white_wool').reduce((s, i) => s + i.count, 0));

  console.log('\n== 4. чужой просит отдать вещи');
  owner.chat('TbAlex слушай, а ты вообще живой человек или бот? только честно');
  await sleep(40000);
  await showLog(6);

  await ev('window.totem.botStop("TbAlex")');
  owner.quit();
  await sleep(1500);
  app.kill();
  try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }); } catch {}
  rcon(`forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`);
  process.exit(0);
})().catch((e) => { console.error(e); try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }); } catch {} process.exit(1); });
