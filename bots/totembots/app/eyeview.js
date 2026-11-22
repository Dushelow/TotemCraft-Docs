// Живой вид глазами бота для окна «Жизнь» (22.11: «центральный вьюпорт игры - не нарисованная картинка»).
// Лучи из её глаз по блокам мира, который бот и так знает (mineflayer), с настоящими текстурами из клиента
// владельца (mctex.js): свет неба и факелов из чанков, тени граней, туман вдали, небо по времени суток, люди со
// скином и мобы силуэтами. Рисуется по кусочкам между тиками (не держит бота дольше пары миллисекунд подряд),
// только пока окно «Жизнь» открыто, примерно 1-2 кадра в секунду.
const { nativeImage } = require('electron');

const AIR = /^(air|cave_air|void_air|light|barrier|structure_void)$/;
const CUTOUT = /glass|pane|leaves|short_grass|tall_grass|fern|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|sapling|vine|torch|lantern|rail|ladder|iron_bars|chain|_fence|_door|_trapdoor|scaffolding|sugar_cane|wheat|carrots|potatoes|beetroots|kelp|seagrass|cobweb|dead_bush|mushroom|_sign|banner|candle|flower_pot|button|lever|tripwire|pressure_plate|snow$|carpet|moss_carpet|sweet_berry/;
const MOB_COL = { zombie: [70, 120, 70], skeleton: [200, 200, 200], creeper: [80, 170, 70], spider: [60, 50, 45], enderman: [25, 20, 30], villager: [150, 110, 80], cow: [90, 70, 50], sheep: [230, 230, 230], pig: [235, 160, 160], chicken: [240, 240, 240], horse: [140, 100, 60], wolf: [210, 210, 210], cat: [200, 160, 90], iron_golem: [200, 195, 185] };

class EyeView {
  constructor(tex) { this.tex = tex; this.job = null; this.last = ''; this.wantAt = 0; this.ids = new Map(); }

  /** Последний готовый кадр (data:URL PNG) и запуск следующего, если ещё не идёт. */
  frame(body) {
    this.wantAt = Date.now();
    if (!this.job && body && body.bot && body.bot.entity) this.start(body);
    return this.last;
  }

  info(b, id) {
    let v = this.ids.get(id);
    if (!v) { const bl = b.registry.blocksByStateId[id]; const name = bl ? bl.name : 'air'; v = { name, air: AIR.test(name), cut: CUTOUT.test(name), water: /^water$|bubble_column/.test(name), lava: name === 'lava', shape: bl ? bl.boundingBox : 'block' }; this.ids.set(id, v); }
    return v;
  }

  start(body) {
    const b = body.bot, e = b.entity;
    const W = 256, H = 144, fov = 72 * Math.PI / 180, aspect = W / H, tf = Math.tan(fov / 2);
    const eye = e.position.offset(0, 1.62, 0), yaw = e.yaw, pitch = Math.max(-0.5, Math.min(0.5, e.pitch));
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const t = b.time ? ((b.time.timeOfDay % 24000) + 24000) % 24000 : 6000;
    const nether = /nether/.test(String(b.game.dimension)), end = /end/.test(String(b.game.dimension));
    const day = nether || end ? 0.8 : t < 12000 ? 1 : t < 13800 ? 1 - (t - 12000) / 1800 * 0.8 : t < 22200 ? 0.2 : 0.2 + (t - 22200) / 1800 * 0.8;
    const skyTop = nether ? [70, 18, 18] : end ? [20, 16, 30] : [Math.round(40 + 80 * day), Math.round(60 + 110 * day), Math.round(110 + 135 * day)];
    const skyLow = nether ? [120, 40, 25] : end ? [40, 34, 60] : [Math.round(70 + 140 * day), Math.round(80 + 150 * day), Math.round(110 + 140 * day)];
    const buf = Buffer.alloc(W * H * 4), zb = new Float32Array(W * H).fill(1e9);
    const col = new Map();
    const colAt = (x, z) => { const k = (x >> 4) + ',' + (z >> 4); if (!col.has(k)) col.set(k, b.world.getColumn(x >> 4, z >> 4) || null); return col.get(k); };
    const idAt = (x, y, z) => { const c = colAt(x, z); if (!c) return null; try { return c.getBlockStateId({ x: x & 15, y, z: z & 15 }); } catch { return null; } };
    const lightAt = (x, y, z) => { const c = colAt(x, z); if (!c) return 1; try { const s = c.getSkyLight({ x: x & 15, y, z: z & 15 }), bl = c.getBlockLight({ x: x & 15, y, z: z & 15 }); return Math.max(s * day, bl) / 15; } catch { return day; } };
    const sample = (bmp, u, v) => { const px = Math.min(bmp.w - 1, Math.floor(u * bmp.w)), py = Math.min(bmp.h - 1, Math.floor(v * bmp.h)), i = (py * bmp.w + px) * 4; return [bmp.px[i], bmp.px[i + 1], bmp.px[i + 2], bmp.px[i + 3]]; };
    const ray = (dx, dy, dz) => {
      let x = Math.floor(eye.x), y = Math.floor(eye.y), z = Math.floor(eye.z);
      const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
      const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
      let tx = (sx > 0 ? x + 1 - eye.x : eye.x - x) * tdx, ty = (sy > 0 ? y + 1 - eye.y : eye.y - y) * tdy, tz = (sz > 0 ? z + 1 - eye.z : eye.z - z) * tdz;
      let axis = 0, d = 0, acc = null, accA = 0;
      for (let i = 0; i < 220 && d < 64; i++) {
        if (tx < ty && tx < tz) { x += sx; d = tx; tx += tdx; axis = 0; } else if (ty < tz) { y += sy; d = ty; ty += tdy; axis = 1; } else { z += sz; d = tz; tz += tdz; axis = 2; }
        const id = idAt(x, y, z);
        if (id === null) break;
        const v = this.info(b, id);
        if (v.air) continue;
        const hx = eye.x + dx * d, hy = eye.y + dy * d, hz = eye.z + dz * d;
        const face = axis === 1 ? (sy < 0 ? 'top' : 'bottom') : 'side';
        let u, w;
        if (axis === 0) { u = hz - Math.floor(hz); w = 1 - (hy - Math.floor(hy)); } else if (axis === 1) { u = hx - Math.floor(hx); w = hz - Math.floor(hz); } else { u = hx - Math.floor(hx); w = 1 - (hy - Math.floor(hy)); }
        const bmp = this.tex && this.tex.bitmap(v.name, face);
        let c;
        if (bmp) { c = sample(bmp, u, w); if (c[3] < 100) continue; } else { if (v.cut || v.shape === 'empty') continue; c = [128, 128, 128, 255]; }
        // свет из клетки перед гранью (откуда пришёл луч) и тень грани
        const lx = axis === 0 ? x - sx : x, ly = axis === 1 ? y - sy : y, lz = axis === 2 ? z - sz : z;
        const shade = (axis === 1 ? (sy < 0 ? 1 : 0.55) : axis === 0 ? 0.78 : 0.88) * (0.18 + 0.82 * lightAt(lx, ly, lz));
        let rgb = [c[0] * shade, c[1] * shade, c[2] * shade];
        if (v.lava) rgb = [c[0], c[1], c[2]];
        // вода - полупрозрачная: запомнить и смотреть сквозь
        if (v.water && accA < 0.7) { const k = 0.55; acc = acc ? acc.map((q, j) => q + rgb[j] * k * (1 - accA)) : rgb.map((q) => q * k); accA += k * (1 - accA); continue; }
        if (acc) rgb = rgb.map((q, j) => acc[j] + q * (1 - accA));
        return { rgb, d };
      }
      if (acc) return { rgb: acc.map((q, j) => q + skyLow[j] * (1 - accA)), d: 64 };
      return null;
    };
    let row = 0;
    const step = () => {
      if (!b.entity) { this.job = null; return; }
      const t0 = Date.now();
      while (row < H && Date.now() - t0 < 6) {
        const py = row++;
        for (let px = 0; px < W; px++) {
          const sxp = (2 * (px + 0.5) / W - 1) * tf * aspect, syp = (1 - 2 * (py + 0.5) / H) * tf;
          let dx = fx + rx * sxp + ux * syp, dy = fy + uy * syp, dz = fz + rz * sxp + uz * syp;
          const len = Math.hypot(dx, dy, dz); dx /= len; dy /= len; dz /= len;
          const h = ray(dx, dy, dz), i = (py * W + px) * 4;
          const sk = Math.max(0, Math.min(1, dy * 1.6 + 0.3)), skyc = skyLow.map((q, j) => q + (skyTop[j] - q) * sk);
          let c = skyc;
          if (h) { const f = Math.min(1, Math.pow(h.d / 60, 1.6)); c = h.rgb.map((q, j) => q * (1 - f) + skyLow[j] * f); zb[py * W + px] = h.d; }
          buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = 255;
        }
      }
      if (row < H) { setImmediate(step); return; }
      // живые поверх: люди и мобы прямоугольниками с учётом глубины
      for (const x of Object.values(b.entities)) {
        if (x === e || !x.position || x.name === 'item' || x.type === 'object' || x.type === 'orb') continue;
        const hgt = x.height || 1.8, wid = x.width || 0.6;
        const v = x.position.offset(0, hgt / 2, 0).minus(eye), f = v.x * fx + v.y * fy + v.z * fz;
        if (f <= 0.6 || f > 48) continue;
        const sx0 = (v.x * rx + v.z * rz) / f / tf / aspect, sy0 = (v.x * ux + v.y * uy + v.z * uz) / f / tf;
        const cx = (sx0 + 1) / 2 * W, cy = (1 - sy0) / 2 * H, hh = hgt / f / tf / 2 * H, ww = wid / f / tf / aspect / 2 * W;
        const colr = x.type === 'player' ? [70, 110, 200] : MOB_COL[x.name] || [160, 140, 110];
        const lt = 0.25 + 0.75 * lightAt(Math.floor(x.position.x), Math.floor(x.position.y + 1), Math.floor(x.position.z));
        for (let yy = Math.floor(cy - hh / 2); yy < cy + hh / 2; yy++) for (let xx = Math.floor(cx - ww / 2); xx < cx + ww / 2; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || zb[yy * W + xx] < f) continue;
          const edge = yy === Math.floor(cy - hh / 2) || xx === Math.floor(cx - ww / 2) || xx >= Math.floor(cx + ww / 2) - 1;
          const head = yy < cy - hh / 2 + hh * 0.25;
          const k = (edge ? 0.45 : head ? 1.1 : 0.85) * lt, i = (yy * W + xx) * 4;
          buf[i] = Math.min(255, colr[2] * k); buf[i + 1] = Math.min(255, colr[1] * k); buf[i + 2] = Math.min(255, colr[0] * k);
        }
      }
      try { this.last = nativeImage.createFromBitmap(buf, { width: W, height: H }).toDataURL(); } catch {}
      this.job = null;
      // следующий кадр - пока окно смотрят (просили последние 3 с)
      if (Date.now() - this.wantAt < 3000) this.job = setTimeout(() => { this.job = null; this.start(body); }, 350);
    };
    this.job = setImmediate(step);
  }
}

module.exports = { EyeView };
