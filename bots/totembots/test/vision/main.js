// Проба зрения на стенде (под Electron - нужен nativeImage): electron test/vision <x> <y> <z> <yaw>
const { app } = require('electron');
const fs = require('fs'); const path = require('path');
const { execSync } = require('child_process');
const { TotemBot } = require('../../app/bot');
const { Vision } = require('../../app/vision');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const [x, y, z, yaw] = process.argv.slice(-4);
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${x} ${y} ${z} ${yaw} 5`); await sleep(6000);
  const t0 = Date.now();
  const png = new Vision(tb.bot).snapshot();
  const out = path.join(__dirname, 'snap.png');
  fs.writeFileSync(out, png);
  console.log('снимок', png.length, 'байт за', Date.now() - t0, 'мс ->', out);
  tb.stop(); setTimeout(() => app.quit(), 300);
});
