// Отладка движения (22.11, владелец: «логируй движения и мир рядом, как он видит; не всю историю, последние события»).
// local/logs/<бот>.move.log перезаписывается раз в 2 с: последние 60 с движения (4 строки в секунду) и срез мира вокруг
// бота (9x9, от 3 бл. ниже ног до 8 выше), как его видит тело. При застревании, смерти и «нет пути» снимок
// копируется в <бот>.move.<время>.log (последние 10 таких) - чтобы разобрать именно тот случай.
const fs = require('fs');
const path = require('path');

const CHAR = (b) => {
  if (!b) return '?';
  const n = b.name;
  if (n === 'air' || n === 'cave_air' || n === 'void_air') return '.';
  if (/water|bubble_column/.test(n)) return '~';
  if (/kelp|seagrass/.test(n)) return '%';
  if (/lava/.test(n)) return 'L';
  if (/vine|ladder|scaffolding/.test(n)) return 'v';
  if (/_slab$|_stairs$/.test(n)) return '=';
  if (/_fence|_wall$|_pane|bars/.test(n)) return '|';
  if (/door|trapdoor|gate/.test(n)) return 'D';
  if (/leaves/.test(n)) return '*';
  if (/nether_portal/.test(n)) return 'O';
  if (b.boundingBox === 'empty') return ',';   // трава, цветы, факелы - проходимо
  return '#';
};

class MoveTrace {
  constructor(tb, dir) { this.tb = tb; this.dir = dir; this.lines = []; this.n = 0; this.writeAt = 0; }

  /** Каждый тик физики; запись раз в 5 тиков. */
  tick() {
    const tb = this.tb, b = tb.bot, e = b && b.entity;
    if (!e || ++this.n % 5) return;
    const p = e.position, v = e.velocity, c = (k) => (b.getControlState(k) ? 1 : 0);
    const ctl = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map((k, i) => (c(k) ? 'fblrjSn'[i] : '-')).join('');
    let goal = '';
    try { const g = b.pathfinder.goal; if (g) goal = g.constructor.name + (g.x !== undefined ? ` ${Math.floor(g.x)},${Math.floor(g.y ?? 0)},${Math.floor(g.z)}` : g.entity ? ' ' + (g.entity.username || g.entity.name) : ''); } catch {}
    const st = (tb.lastPath || {}).status || '';
    const pathS = (st && st !== 'success' ? `[${st}] ` : '') + ((tb.lastPath || {}).path || []).slice(0, 3).map((n) => `${Math.floor(n.x)},${Math.floor(n.y)},${Math.floor(n.z)}${n.swim ? 's' : ''}${n.leap ? 'L' : ''}`).join(' ');
    let headIn = false; try { const h = b.blockAt(p.offset(0, 1.6, 0)); headIn = !!(h && /water/.test(h.name)); } catch {}
    const line = `${new Date().toISOString().slice(11, 23)} ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} v${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)} yaw${e.yaw.toFixed(2)} p${e.pitch.toFixed(2)} ${ctl}`
      + ` ${e.onGround ? 'земля' : 'воздух'}${e.isInWater ? ' вода' : ''}${headIn ? ' голова-в-воде' : ''}${tb._pose ? ' поза' : ''}${tb._waterBy ? ' [' + tb._waterBy + ']' : ''} воздух${b.oxygenLevel ?? '?'}`
      + ` | ${tb.mode}${tb.task ? ':' + tb.task : ''} | цель ${goal || '-'} | путь ${pathS || '-'}${b.pathfinder.isMoving() ? '' : ' (стоит)'}${tb.guard && tb.guard.fighting ? ' | БОЙ' : ''}`;
    this.lines.push(line);
    if (this.lines.length > 240) this.lines.shift();
    if (Date.now() - this.writeAt > 2000) { this.writeAt = Date.now(); this.write(); }
  }

  /** Срез мира вокруг: слои по высоте, север сверху, B - бот, P - игроки, M - мобы. */
  world() {
    const b = this.tb.bot, e = b.entity, f = e.position.floored(), out = [];
    const ents = {};
    for (const x of Object.values(b.entities)) { if (!x.position || x === e) continue; const q = x.position.floored(); ents[`${q.x},${q.y},${q.z}`] = x.type === 'player' ? 'P' : 'M'; }
    for (let dy = 8; dy >= -3; dy--) {
      const rows = [];
      for (let dz = -4; dz <= 4; dz++) {
        let r = '';
        for (let dx = -4; dx <= 4; dx++) {
          const k = `${f.x + dx},${f.y + dy},${f.z + dz}`;
          if (!dx && !dz && (dy === 0 || dy === 1)) { r += 'B'; continue; }
          r += ents[k] || CHAR(b.blockAt(f.offset(dx, dy, dz)));
        }
        rows.push(r);
      }
      out.push(`y${f.y + dy}${dy === 0 ? ' (ноги)' : ''}:\n  ` + rows.join('\n  '));
    }
    return out.join('\n');
  }

  write() {
    try {
      const f = path.join(this.dir, `${this.tb.opts.name}.move.log`);
      const head = `Движение ${this.tb.opts.name}, последние ${this.lines.length / 4} с (раз в 0,25 с). Клавиши: f вперёд, b назад, l/r вбок, j прыжок, S бег, n присед.\n`
        + `Мир вокруг (9x9, север сверху, восток справа): # твёрдое . воздух ~ вода % водоросли v лиана/лестница = полублок/ступени | забор D дверь/люк * листва O портал , трава и т.п. B бот P игрок M моб\n\n`;
      fs.writeFileSync(f, head + this.world() + '\n\n' + this.lines.join('\n') + '\n');
    } catch {}
  }

  /** Снимок того самого случая (застрял, умер, нет пути) - отдельным файлом. */
  snapshot(why) {
    try {
      this.write();
      const src = path.join(this.dir, `${this.tb.opts.name}.move.log`);
      const dst = path.join(this.dir, `${this.tb.opts.name}.move.${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
      fs.writeFileSync(dst, `СЛУЧАЙ: ${why}\n` + fs.readFileSync(src, 'utf8'));
      const old = fs.readdirSync(this.dir).filter((x) => x.startsWith(`${this.tb.opts.name}.move.2`)).sort();
      for (const x of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(this.dir, x), { force: true });
    } catch {}
  }
}

module.exports = { MoveTrace };
