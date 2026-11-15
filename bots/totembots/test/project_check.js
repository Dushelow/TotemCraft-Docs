// Проект Qwen без бота: программа с тестовыми настройками создаёт проект «TotemCraft · тест» и кладёт туда память.
// node test/project_check.js
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const DATA = path.join(__dirname, '.data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (/electron\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq electron.exe"').toString())) { console.log('программа уже открыта, не мешаю'); process.exit(2); }
(async () => {
  const app = spawn(path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd'), ['.', '--remote-debugging-port=9223'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore',
      env: { ...process.env, TOTEMBOTS_CONFIG: path.join(DATA, 'config.json'), TOTEMBOTS_MEMORY: DATA, TOTEMBOTS_PROJECT_NAME: 'TotemCraft · тест' } });
  const kill = require('./kill_test_app');
  try {
    let ev;
    for (let i = 0; i < 40 && !ev; i++) {
      await sleep(1000);
      try {
        const list = await (await fetch('http://127.0.0.1:9223/json')).json();
        const p = list.find((t) => t.url.endsWith('panel.html'));
        if (!p) continue;
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((r) => { ws.onopen = r; });
        let id = 0; const wait = new Map();
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
        ev = (e) => new Promise((r) => { wait.set(++id, (d) => r(d.result && d.result.result && d.result.result.value)); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, awaitPromise: true, returnByValue: true } })); });
      } catch {}
    }
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const s = await ev('window.totem.state()');
      console.log(new Date().toLocaleTimeString('ru-RU'), JSON.stringify(s.project));
      if (/обновлена|ошибка/.test(s.project.status)) break;
    }
    console.log('файл в настройках теста:', JSON.stringify(JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).qwenProject));
  } finally { kill(); }
})();
