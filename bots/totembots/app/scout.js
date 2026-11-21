// Разведка пути (тело, без нейросети): дойти туда, где тропы ещё нет, - как игрок, который идёт в незнакомое место:
// смотрит вперёд в сторону цели, выбирает, куда реально можно встать (земля, место для головы, не вода и не лава),
// идёт туда отрезком ~32 блока, не вышло - пробует левее/правее, совсем тупик - отходит назад и обходит шире.
// Модуль ходьбы видит только загруженные чанки и на дальнюю цель думает слишком долго («Took too long» 26 раз)
// или ведёт напрямик под землю. Пройденное тело само пишет в тропы (travel.js) - в следующий раз дорога знакома.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const LEG = 32;                 // длина отрезка
const ANGLES = [0, 20, -20, 40, -40, 65, -65, 90, -90, 120, -120];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Где в столбце (x, z) можно встать рядом с высотой y: твёрдый пол, 2 блока воздуха, не лава; вода - отдельно. */
const ROOF = /(_planks|_slab|_stairs|_wool|glass|bricks|_log|_wood|_leaves|_concrete|terracotta|_wall|_fence)$/;
function standable(b, x, z, y) {
  // сверху вниз от уровня головы+1: выше - это крыши домов и кроны (21.11 в городе бот выбирал крыши и не мог дойти)
  for (let yy = Math.floor(y) + 3; yy >= Math.floor(y) - 12; yy--) {
    const f = b.blockAt(new Vec3(x, yy, z));
    if (!f) return null;   // чанк не загружен
    if (f.boundingBox !== 'block') continue;
    if (yy > Math.floor(y) && ROOF.test(f.name)) return { bad: true };   // выше ног - крыша или забор, туда не идём
    const h1 = b.blockAt(new Vec3(x, yy + 1, z)), h2 = b.blockAt(new Vec3(x, yy + 2, z));
    if (!h1 || !h2) return null;
    if (/lava|fire|magma|cactus|campfire/.test(f.name + h1.name)) return { bad: true };
    if (h1.boundingBox === 'empty' && h2.boundingBox === 'empty') return { y: yy + 1, water: /water/.test(h1.name) };
  }
  return { bad: true };
}

/**
 * Дойти до (gx, gz) по незнакомой местности. tb - тело (TotemBot). Возвращает текст итога; бросает, если не вышло.
 */
async function explore(tb, gx, gz, tok, ms = 600000) {
  const b = tb.bot;
  const until = Date.now() + ms;
  const banned = [];            // точки, куда не вышло (не пробовать снова рядом)
  let best = Infinity, noGain = 0, legs = 0, side = 0;   // side: обход препятствия - держаться выбранной стороны (как игрок вдоль стены)
  tb.log(`разведка: иду в незнакомое место ${Math.round(gx)} ${Math.round(gz)} (${Math.round(Math.hypot(gx - b.entity.position.x, gz - b.entity.position.z))} бл.)`);
  while (Date.now() < until) {
    tb.check(tok);
    const p = b.entity.position, d = Math.hypot(gx - p.x, gz - p.z);
    if (d <= 8) return `дошла разведкой (${legs} отрезков)`;
    if (d < best - 6) { best = d; noGain = 0; side = 0; } else if (++noGain >= 14) throw new Error(`разведка: 6 отрезков без продвижения, застряла у ${Math.floor(p.x)} ${Math.floor(p.z)} (${Math.round(d)} бл. до цели) - нужен другой путь (портал, мост, лодка)`);
    const base = Math.atan2(gz - p.z, gx - p.x);
    const len = Math.min(LEG, d);
    // кандидаты: прямо, потом всё шире; по каждому направлению - дальний и ближний отрезок
    const cands = [];
    for (const a of ANGLES) for (const L of [len, len * 0.55]) {
      const ang = base + a * Math.PI / 180;
      const x = Math.floor(p.x + Math.cos(ang) * L), z = Math.floor(p.z + Math.sin(ang) * L);
      if (banned.some((q) => Math.hypot(q.x - x, q.z - z) < 6)) continue;
      const s = standable(b, x, z, p.y);
      if (!s || s.bad) continue;
      const gain = d - Math.hypot(gx - x, gz - z);              // насколько ближе к цели
      // в обходе - бонус своей стороне и штраф за возврат на другую (иначе бот мечется у препятствия)
      const sideBonus = side && a !== 0 ? (Math.sign(a) === side ? 12 : -12) : 0;
      const score = gain - Math.abs(s.y - p.y) * 0.6 - (s.water ? 10 : 0) - Math.abs(a) * 0.05 + sideBonus;
      cands.push({ x, y: s.y, z, score, a });
    }
    cands.sort((u, v) => v.score - u.score);
    if (!cands.length || cands[0].score < -LEG) {
      // впереди ничего пригодного (обрыв, океан, лава) - отойти назад и обойти шире
      const back = { x: Math.floor(p.x - Math.cos(base) * 10), z: Math.floor(p.z - Math.sin(base) * 10) };
      banned.push({ x: Math.floor(p.x + Math.cos(base) * LEG), z: Math.floor(p.z + Math.sin(base) * LEG) });
      tb.log('разведка: впереди пути нет - отхожу и обхожу');
      try { await tb.goto(new goals.GoalNearXZ(back.x, back.z, 3), tok, 25000); } catch (e) { if (tb.isCancel(e)) throw e; }
      continue;
    }
    let ok = false;
    for (const c of cands.slice(0, 4)) {
      tb.check(tok);
      try {
        await tb.goto(new goals.GoalNear(c.x, c.y, c.z, 3), tok, 35000);
        ok = true; legs++;
        if (!side && Math.abs(c.a) >= 40) side = Math.sign(c.a);   // пошли в обход - запомнить сторону
        break;
      } catch (e) {
        if (tb.isCancel(e)) throw e;
        banned.push({ x: c.x, z: c.z });
        if (!tb._scoutErrAt || Date.now() - tb._scoutErrAt > 10000) { tb._scoutErrAt = Date.now(); tb.log(`разведка: к ${c.x} ${c.y} ${c.z} не дошла: ${String(e.message).slice(0, 80)}`); }
      }
    }
    if (!ok) { if (!side) side = Math.random() < 0.5 ? 1 : -1; tb.log('разведка: в эту сторону не пройти - обхожу'); await sleep(1500); }
  }
  throw new Error('разведка: не дошла за отведённое время');
}

module.exports = { explore, standable };
