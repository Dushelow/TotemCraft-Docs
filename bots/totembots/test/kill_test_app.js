// Закрыть только тестовую программу: её узнаём по порту отладки 9223 в командной строке (у владельца его нет).
const { execSync } = require('child_process');
module.exports = function killTestApp() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port=9223' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
  try { execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'ignore' }); } catch {}
};
