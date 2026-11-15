// Зрение без новых пакетов: картинка из блоков, которые бот уже знает (мир в памяти mineflayer).
// Слева - вид глазами (лучи из глаз до первого блока, цвет по блоку, дальше - темнее), справа - карта сверху
// на 48 блоков (как Xaero: цвет верхнего блока, рельеф тенью, игроки и мобы точками, бот - белая стрелка, север вверху).
// Картинку смотрит мультимодальная нейросеть (Qwen) по команде !see и описывает словами.

// цвет блока по имени (грубо, но узнаваемо)
const PAL = [
  [/water|bubble_column|kelp|seagrass/, [52, 92, 196]], [/lava|magma/, [230, 100, 20]], [/ice/, [150, 190, 250]],
  [/snow|powder_snow/, [240, 245, 250]], [/sand(?!stone)|suspicious_sand/, [218, 205, 150]], [/sandstone/, [210, 195, 140]],
  [/grass_block|moss|azalea_leaves|fern|short_grass|tall_grass|vine|lily/, [95, 155, 60]], [/_leaves/, [55, 115, 45]],
  [/_log|_wood|_stem|bamboo/, [105, 80, 50]], [/_planks|_stairs|_slab|_fence|_door|_trapdoor|bookshelf|barrel|chest|crafting/, [165, 125, 80]],
  [/dirt|mud|farmland|podzol|mycelium|path/, [125, 90, 60]], [/gravel/, [130, 125, 120]], [/clay|terracotta/, [160, 110, 90]],
  [/bricks?|nether_brick/, [150, 70, 60]], [/glass|pane/, [190, 225, 235]], [/wool|carpet|concrete|bed/, [200, 60, 120]],
  [/ore/, [180, 150, 120]], [/deepslate|basalt|blackstone/, [70, 70, 75]], [/netherrack|crimson|warped/, [120, 40, 40]],
  [/stone|cobble|andesite|diorite|granite|tuff|calcite|gravel/, [125, 125, 125]],
  [/flower|poppy|dandelion|rose|tulip|orchid|allium|bluet|daisy|lilac|peony/, [230, 200, 60]],
  [/torch|lantern|glowstone|sea_lantern|shroomlight/, [255, 220, 120]], [/rail|iron|anvil|chain/, [170, 170, 175]],
];
const AIR = /^(air|cave_air|void_air|light)$/;
const THIN = /short_grass|tall_grass|fern|flower|poppy|dandelion|torch|button|pressure_plate|rail|carpet|snow$|vine|sapling|mushroom|seagrass|kelp|dead_bush/;

function colorOf(name) { for (const [re, c] of PAL) if (re.test(name)) return c; return [140, 140, 140]; }

class Vision {
  constructor(bot) { this.b = bot; this.cache = new Map(); }

  // stateId -> { name, rgb, solid }
  info(id) {
    let v = this.cache.get(id);
    if (!v) {
      const bl = this.b.registry.blocksByStateId[id];
      const name = bl ? bl.name : 'air';
      v = { name, rgb: colorOf(name), air: AIR.test(name), thin: THIN.test(name), water: /water/.test(name) };
      this.cache.set(id, v);
    }
    return v;
  }

  id(x, y, z) {
    const col = this.b.world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
    if (!col) return null;
    try { return col.getBlockStateId({ x: ((Math.floor(x) % 16) + 16) % 16, y: Math.floor(y), z: ((Math.floor(z) % 16) + 16) % 16 }); } catch { return null; }
  }

  /** Вид глазами: W x H, обзор 80°, до 48 блоков. RGBA. */
  eye(W = 192, H = 112) {
    const b = this.b, e = b.entity, eye = e.position.offset(0, 1.62, 0);
    const yaw = e.yaw, pitch = e.pitch, fov = 80 * Math.PI / 180, aspect = W / H;
    const buf = Buffer.alloc(W * H * 4);
    // базис взгляда (mineflayer: yaw 0 - на север (-z), растёт против часовой)
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw), ry = 0, rz = -Math.sin(yaw);   // вправо
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;   // вверх = вправо x вперёд
    const ents = Object.values(b.entities).filter((x) => x !== e && x.position && x.position.distanceTo(e.position) < 40);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const sx = (2 * (px + 0.5) / W - 1) * Math.tan(fov / 2) * aspect, sy = (1 - 2 * (py + 0.5) / H) * Math.tan(fov / 2);
      let dx = fx + rx * sx + ux * sy, dy = fy + uy * sy, dz = fz + rz * sx + uz * sy;
      const len = Math.hypot(dx, dy, dz); dx /= len; dy /= len; dz /= len;
      const hit = this.march(eye, dx, dy, dz, 48);
      let c;
      if (!hit) c = dy > -0.05 ? [140 + 60 * Math.max(0, dy), 185 + 40 * Math.max(0, dy), 235] : [30, 30, 40];   // небо / пустота
      else {
        const shade = [1, 0.8, 0.9, 0.7][hit.face] * Math.max(0.35, 1 - hit.d / 56);
        c = hit.v.rgb.map((k) => Math.round(k * shade));
      }
      const i = (py * W + px) * 4; buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = 255;   // BGRA для nativeImage
    }
    // существа - красные (игроки) и жёлтые (мобы) метки поверх
    for (const x of ents) {
      const v = x.position.offset(0, (x.height || 1.8) * 0.6, 0).minus(eye);
      const f = v.x * fx + v.y * fy + v.z * fz; if (f <= 0.5) continue;
      const sx = (v.x * rx + v.z * rz) / f / Math.tan(fov / 2) / aspect, sy = (v.x * ux + v.y * uy + v.z * uz) / f / Math.tan(fov / 2);
      const px = Math.round((sx + 1) / 2 * W), py = Math.round((1 - sy) / 2 * H);
      const col = x.type === 'player' ? [255, 40, 40] : /zombie|skeleton|creeper|spider|enderman|witch|slime|phantom|drowned|pillager/.test(x.name || '') ? [255, 210, 0] : [255, 255, 255];
      const r = Math.max(1, Math.round(6 / Math.sqrt(f)));
      for (let yy = -r * 2; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const qx = px + xx, qy = py + yy; if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue; const i = (qy * W + qx) * 4; buf[i] = col[2]; buf[i + 1] = col[1]; buf[i + 2] = col[0]; }
    }
    return { W, H, buf };
  }

  // DDA по блокам: первый непрозрачный блок (тонкая трава, факелы - насквозь; вода - видна)
  march(o, dx, dy, dz, max) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    let tx = ((sx > 0 ? x + 1 - o.x : o.x - x)) * tdx, ty = ((sy > 0 ? y + 1 - o.y : o.y - y)) * tdy, tz = ((sz > 0 ? z + 1 - o.z : o.z - z)) * tdz;
    let face = 0, d = 0;
    for (let i = 0; i < 200 && d < max; i++) {
      if (tx < ty && tx < tz) { x += sx; d = tx; tx += tdx; face = 1; } else if (ty < tz) { y += sy; d = ty; ty += tdy; face = sy > 0 ? 3 : 0; } else { z += sz; d = tz; tz += tdz; face = 2; }
      const id = this.id(x, y, z);
      if (id === null) return null;
      const v = this.info(id);
      if (!v.air && !v.thin) return { v, d, face };
    }
    return null;
  }

  /** Карта сверху: R блоков во все стороны, клетка = S пикселей. RGBA (BGRA). */
  map(R = 48, S = 2) {
    const b = this.b, me = b.entity.position.floored(), N = 2 * R + 1, W = N * S;
    const buf = Buffer.alloc(W * W * 4);
    const top = new Int16Array(N * N);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = me.x + dx, z = me.z + dz;
      let c = [20, 20, 25], hy = -999;
      for (let y = me.y + 30; y >= me.y - 40; y--) {
        const id = this.id(x, y, z); if (id === null) break;
        const v = this.info(id); if (v.air || (v.thin && !v.water)) continue;
        c = v.rgb; hy = y; break;
      }
      top[(dz + R) * N + dx + R] = hy;
      // рельеф: выше северного соседа - светлее
      const n = dz > -R ? top[(dz + R - 1) * N + dx + R] : hy;
      const k = hy === -999 ? 1 : hy > n ? 1.18 : hy < n ? 0.8 : 1;
      for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
        const i = (((dz + R) * S + yy) * W + (dx + R) * S + xx) * 4;
        buf[i] = Math.min(255, c[2] * k); buf[i + 1] = Math.min(255, c[1] * k); buf[i + 2] = Math.min(255, c[0] * k); buf[i + 3] = 255;
      }
    }
    const dot = (x, z, col, r) => {
      const cx = (Math.floor(x) - me.x + R) * S + S / 2, cz = (Math.floor(z) - me.z + R) * S + S / 2;
      for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const qx = Math.round(cx + xx), qy = Math.round(cz + yy); if (qx < 0 || qy < 0 || qx >= W || qy >= W) continue; const i = (qy * W + qx) * 4; buf[i] = col[2]; buf[i + 1] = col[1]; buf[i + 2] = col[0]; }
    };
    for (const x of Object.values(b.entities)) {
      if (!x.position || x === b.entity || Math.abs(x.position.x - me.x) > R || Math.abs(x.position.z - me.z) > R) continue;
      dot(x.position.x, x.position.z, x.type === 'player' ? [255, 40, 40] : [255, 210, 0], 2);
    }
    // бот - белая стрелка по взгляду
    dot(me.x, me.z, [255, 255, 255], 3);
    for (let t = 1; t <= 8; t++) dot(me.x - Math.sin(b.entity.yaw) * t * 0.7, me.z - Math.cos(b.entity.yaw) * t * 0.7, [255, 255, 255], 1);
    return { W, H: W, buf };
  }

  /** Одна картинка: вид глазами (увеличен) слева, карта справа. Возвращает PNG (Buffer) - через nativeImage Electron. */
  snapshot() {
    const { nativeImage } = require('electron');
    const eye = this.eye(192, 112), map = this.map(48, 2);   // 194x194
    const k = 2, EW = eye.W * k, EH = eye.H * k, W = EW + 8 + map.W, H = Math.max(EH, map.H);
    const buf = Buffer.alloc(W * H * 4, 0);
    for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) { const s = ((Math.floor(y / k)) * eye.W + Math.floor(x / k)) * 4, d = (y * W + x) * 4; eye.buf.copy(buf, d, s, s + 4); }
    for (let y = 0; y < map.H; y++) map.buf.copy(buf, (y * W + EW + 8) * 4, y * map.W * 4, (y + 1) * map.W * 4);
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    return nativeImage.createFromBitmap(buf, { width: W, height: H }).toPNG();
  }
}

module.exports = { Vision };
