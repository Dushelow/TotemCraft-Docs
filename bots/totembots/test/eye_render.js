// Проверка живого вида (eyeview.js) без сервера: маленький мир из чанков, кадр в PNG. Запуск: npx electron test/eye_render.js [день|ночь]
const { app, nativeImage } = require('electron');
const path = require('path'), fs = require('fs');
const R = path.resolve(__dirname, '../node_modules');
const registry = require(R + '/prismarine-registry')('1.21.4');
const Chunk = require(R + '/prismarine-chunk')(registry);
const { Vec3 } = require(R + '/vec3');
const { McTex } = require('../app/mctex');
const { EyeView } = require('../app/eyeview');
app.whenReady().then(() => {
  const night = process.argv.includes('ночь');
  const id = (n, p) => (p ? require(R + '/prismarine-block')(registry).fromProperties(n, p, 0).stateId : registry.blocksByName[n].defaultState);
  const cols = new Map();
  for (let cx = -3; cx <= 3; cx++) for (let cz = -4; cz <= 2; cz++) {
    const c = new Chunk({ minY: -64, worldHeight: 384 });
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const X = cx * 16 + x, Z = cz * 16 + z, h = 64 + Math.round(2 * Math.sin(X / 9) + 2 * Math.cos(Z / 11));
      for (let y = 50; y <= h; y++) c.setBlockStateId(new Vec3(x, y, z), id(y === h ? 'grass_block' : y > h - 3 ? 'dirt' : 'stone'));
      if (X > 6 && X < 14 && Z < -6 && Z > -14) for (let y = h - 1; y <= h; y++) c.setBlockStateId(new Vec3(x, y, z), id('water'));
      if (Math.abs(X) <= 1 && h >= 64) c.setBlockStateId(new Vec3(x, h, z), id('dirt_path'));
      if ((X * 7 + Z * 13) % 37 === 0 && Math.abs(X) > 3) c.setBlockStateId(new Vec3(x, h + 1, z), id('short_grass'));
      if ((X * 5 + Z * 3) % 53 === 0 && Math.abs(X) > 3) c.setBlockStateId(new Vec3(x, h + 1, z), id('poppy'));
      for (let y = 0; y < 384; y++) { try { c.setSkyLight(new Vec3(x, y - 64, z), 15); } catch {} }
    }
    cols.set(cx + ',' + cz, c);
  }
  const set = (X, Y, Z, n, p) => { const c = cols.get(Math.floor(X / 16) + ',' + Math.floor(Z / 16)); c.setBlockStateId(new Vec3(((X % 16) + 16) % 16, Y, ((Z % 16) + 16) % 16), id(n, p)); };
  // деревья
  for (const [tx, tz] of [[-8, -12], [-14, -20], [10, -24], [-5, -30], [16, -18]]) { const h = 64 + Math.round(2 * Math.sin(tx / 9) + 2 * Math.cos(tz / 11)); for (let y = 1; y <= 5; y++) set(tx, h + y, tz, 'oak_log'); for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 4; dy <= 6; dy++) if (Math.abs(dx) + Math.abs(dz) < 4 && !(dx === 0 && dz === 0 && dy < 6)) set(tx + dx, h + dy, tz + dz, 'oak_leaves'); }
  // домик
  for (let x = -12; x <= -6; x++) for (let z = -8; z <= -4; z++) for (let y = 66; y <= 69; y++) { const wall = x === -12 || x === -6 || z === -8 || z === -4; if (y === 69) set(x, y, z, 'spruce_planks'); else if (wall) set(x, y, z, (y === 67 && (x === -9 || z === -6)) ? 'glass' : x === -12 || x === -6 ? 'oak_log' : 'oak_planks'); }
  set(-9, 67, -4, 'air'); set(-9, 68, -4, 'air');
  set(-4, 66, -10, 'campfire'); set(-3, 66, -8, 'lantern');
  const bot = { registry, game: { dimension: 'overworld' }, time: { timeOfDay: night ? 18000 : 4000 }, entity: { position: new Vec3(0.5, 67, 2.5), yaw: 0.25, pitch: -0.12 },
    entities: { 1: { type: 'player', name: 'player', position: new Vec3(-2, 67, -5), height: 1.8, width: 0.6 }, 2: { type: 'mob', name: 'sheep', position: new Vec3(4, 66, -12), height: 1.3, width: 0.9 } },
    world: { getColumn: (x, z) => cols.get(x + ',' + z) || null } };
  const tex = new McTex(path.resolve(__dirname, '../local')); tex.ensure();
  const ev = new EyeView(tex);
  const t0 = Date.now();
  const tick = () => {
    const f = ev.frame({ bot });
    if (f) { fs.writeFileSync(path.resolve(__dirname, '../local/eye_' + (night ? 'night' : 'day') + '.png'), nativeImage.createFromDataURL(f).resize({ width: 1024, quality: 'good' }).toPNG()); console.log('кадр за', Date.now() - t0, 'мс, текстуры:', tex.ready); app.quit(); return; }
    setTimeout(tick, 50);
  };
  tick();
});
