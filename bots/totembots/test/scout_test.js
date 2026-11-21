// Модель без сервера: разведка (scout.js) на плоской земле с озером и стеной поперёк пути. «Ходьба» в модели -
// телепорт на цель отрезка, если до неё можно дойти по прямой без воды и стены (грубо, но проверяет выбор пути).
const path = require('path');
const { Vec3 } = require(path.resolve(__dirname, '../node_modules/vec3'));
const { explore } = require(path.resolve(__dirname, '../app/scout.js'));
const blocked = (x, z) => (x >= 40 && x <= 44 && z >= -30 && z <= 30) ? 'wall' : (Math.hypot(x - 80, z) < 14 ? 'water' : '');
const block = (x, y, z) => {
  const k = blocked(x, z);
  if (y < 64) return { name: 'grass_block', boundingBox: 'block' };
  if (k === 'wall' && y < 70) return { name: 'stone_bricks', boundingBox: 'block' };
  if (k === 'water' && y === 64) return { name: 'water', boundingBox: 'empty' };
  return { name: 'air', boundingBox: 'empty' };
};
function run(gx, gz) {
  const pos = new Vec3(0.5, 64, 0.5); let legs = 0, fails = 0;
  const tb = {
    bot: { entity: { position: pos }, blockAt: (v) => block(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)) },
    log: () => {}, check: () => {}, isCancel: () => false,
    goto: async (g) => {
      const tx = g.x, tz = g.z, n = Math.ceil(Math.hypot(tx - pos.x, tz - pos.z));
      for (let i = 1; i <= n; i++) { const x = Math.floor(pos.x + (tx - pos.x) * i / n), z = Math.floor(pos.z + (tz - pos.z) * i / n); if (blocked(x, z)) { fails++; throw new Error('не пройти'); } }
      pos.x = tx + 0.5; pos.z = tz + 0.5; legs++;
    },
  };
  return explore(tb, gx, gz, 0, 5000).then((r) => `дошла: ${r}; отрезков ${legs}, неудачных попыток ${fails}, итог у ${Math.round(pos.x)} ${Math.round(pos.z)}`).catch((e) => 'НЕ ДОШЛА: ' + e.message);
}
(async () => {
  console.log('через стену (обход):', await run(120, 0));
  console.log('в чистое поле:', await run(-150, 90));
})();
