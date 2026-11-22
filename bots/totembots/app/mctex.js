// Настоящие текстуры Minecraft для окна «Жизнь» (22.11): значки предметов и блоки для живого вида глазами бота.
// Берутся из клиента владельца на этом компьютере (Legacy Launcher / обычный лаунчер), не из интернета и не из
// репозитория: текстуры принадлежат Mojang, в публичный репозиторий их класть нельзя. Один раз при запуске
// распаковываются системным tar.exe в local/mc (около 1 с), дальше читаются оттуда.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TINT_GRASS = [124, 189, 75], TINT_FOLIAGE = [96, 161, 59], TINT_WATER = [63, 118, 228];
const GRAY_TINTED = /^(grass_block_top|short_grass|tall_grass_(top|bottom)|fern|large_fern_(top|bottom)|vine|lily_pad|sugar_cane)$|_leaves$/;

class McTex {
  constructor(localDir) { this.dir = path.join(localDir, 'mc'); this.root = path.join(this.dir, 'assets', 'minecraft', 'textures'); this.icons = new Map(); this.bmps = new Map(); this.ready = false; }

  /** Найти клиент: самый новый .jar в папках версий известных лаунчеров (или путь из настроек). */
  findJar(hint) {
    if (hint && fs.existsSync(hint)) return hint;
    const app = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const roots = [path.join(app, '.tlauncher', 'legacy', 'Minecraft', 'game', 'versions'), path.join(app, '.minecraft', 'versions'), path.join(app, '.tlauncher', 'versions')];
    const jars = [];
    for (const r of roots) {
      let list = [];
      try { list = fs.readdirSync(r); } catch { continue; }
      for (const v of list) { const f = path.join(r, v, v + '.jar'); try { const st = fs.statSync(f); if (st.size > 20e6) jars.push({ f, v, t: st.mtimeMs }); } catch {} }
    }
    // предпочесть чистую версию (26.3), а не сборку с модами; среди них - самую новую по номеру
    const num = (v) => (String(v).match(/\d+(\.\d+)*/) || ['0'])[0].split('.').map(Number);
    jars.sort((a, c) => { const A = num(a.v), C = num(c.v); for (let i = 0; i < 3; i++) if ((C[i] || 0) !== (A[i] || 0)) return (C[i] || 0) - (A[i] || 0); return /fabric|forge|optifine/i.test(a.v) - /fabric|forge|optifine/i.test(c.v); });
    return jars[0] ? jars[0].f : null;
  }

  /** Распаковать (если ещё нет или клиент сменился). Возвращает true, если текстуры есть. */
  ensure(hint) {
    try {
      const jar = this.findJar(hint);
      const stamp = path.join(this.dir, 'from.txt');
      const have = fs.existsSync(path.join(this.root, 'item'));
      if (have && (!jar || (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === jar))) { this.ready = true; return true; }
      if (!jar) return (this.ready = have);
      fs.mkdirSync(this.dir, { recursive: true });
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', jar, '-C', this.dir, 'assets/minecraft/textures/item', 'assets/minecraft/textures/block'], { timeout: 60000, stdio: 'ignore' });
      fs.writeFileSync(stamp, jar);
      this.icons.clear(); this.bmps.clear();
      return (this.ready = fs.existsSync(path.join(this.root, 'item')));
    } catch { return (this.ready = fs.existsSync(path.join(this.root, 'item'))); }
  }

  /** Значок предмета data:URL (предмет или блок как предмет), '' - нет такого. */
  icon(name) {
    name = String(name || '').replace(/^minecraft:/, '').replace(/[^a-z0-9_]/g, '');
    if (!name || !this.ready) return '';
    if (this.icons.has(name)) return this.icons.get(name);
    const tries = [['item', name], ['block', name], ['item', name.replace(/_block$/, '')], ['block', name + '_side'], ['block', name + '_front'], ['block', name + '_top'], ['item', name + '_00']];
    let url = '';
    for (const [d, n] of tries) { const f = path.join(this.root, d, n + '.png'); if (fs.existsSync(f)) { url = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); break; } }
    this.icons.set(name, url);
    if (this.icons.size > 2000) this.icons.clear();
    return url;
  }

  /**
   * Текстура грани блока для отрисовки: { w, h, px (RGBA), alpha } или null. face: top | bottom | side.
   * Серые текстуры травы и листвы окрашиваются в зелень (как в игре цветом биома).
   */
  bitmap(block, face) {
    if (!this.ready) return null;
    const key = block + '|' + face;
    if (this.bmps.has(key)) return this.bmps.get(key);
    const { nativeImage } = require('electron');
    const base = block.replace(/^minecraft:/, '');
    const cand = face === 'top' ? [base + '_top', base, base.replace(/_(stairs|slab|wall|fence|fence_gate|pressure_plate|button)$/, ''), base.replace(/_(stairs|slab|wall|fence)$/, '') + '_planks', base + '_side']
      : face === 'bottom' ? [base + '_bottom', base, base + '_top', base.replace(/_(stairs|slab|wall|fence|fence_gate)$/, '')]
        : [base + '_side', base, base.replace(/_(stairs|slab|wall|fence|fence_gate|pressure_plate|button)$/, ''), base.replace(/_(stairs|slab|wall|fence)$/, '') + '_planks', base + '_front'];
    if (base === 'grass_block' && face === 'bottom') cand.unshift('dirt');
    if (/_log$|_wood$|_stem$/.test(base) && face !== 'side') cand.unshift(base.replace(/_wood$/, '_log') + '_top');
    if (base === 'water') cand.unshift('water_still');
    if (base === 'lava') cand.unshift('lava_still');
    let out = null;
    for (const n of cand) {
      const f = path.join(this.root, 'block', n + '.png');
      if (!fs.existsSync(f)) continue;
      const img = nativeImage.createFromPath(f);
      const { width: w } = img.getSize();
      if (!w) continue;
      const bgra = img.toBitmap(), h = w;   // анимированные (вода, лава) - высокая лента кадров: берём первый квадрат
      const px = Buffer.alloc(w * h * 4);
      const tint = GRAY_TINTED.test(n) ? (/_leaves$/.test(n) ? TINT_FOLIAGE : TINT_GRASS) : /^water/.test(n) ? TINT_WATER : null;
      let alpha = false;
      for (let i = 0; i < w * h; i++) {
        let r = bgra[i * 4 + 2], g = bgra[i * 4 + 1], bl = bgra[i * 4], a = bgra[i * 4 + 3];
        if (tint) { r = r * tint[0] / 255; g = g * tint[1] / 255; bl = bl * tint[2] / 255; }
        if (a < 128) alpha = true;
        px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = bl; px[i * 4 + 3] = a;
      }
      out = { w, h, px, alpha };
      break;
    }
    this.bmps.set(key, out);
    return out;
  }
}

module.exports = { McTex };
