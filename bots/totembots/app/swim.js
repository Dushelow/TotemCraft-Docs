// Плавание (тело, без нейросети). Физика бота (prismarine-physics) в воде умеет только «идти и держаться прыжком»:
// медленно, с подскоками, по поверхности, нырять не может - отсюда «кружит как корова», «не плавает, а идёт как
// утопленник» (15-19.11). Здесь своё управление, как у игрока:
//  - глубже 1,5 блока и цель дальше 2 блоков - плыть рывком (поза плавания): прямо к следующей точке пути в 3D,
//    около 4 блоков в секунду, ныряя и всплывая по пути; воздух кончается - сначала наверх;
//  - мелко или цель рядом - плыть у поверхности ~2 блока в секунду, держась на воде;
//  - следующая точка пути на суше (уступ, берег) - не мешать: вылезает существующая логика выхода на берег.
// Скорость задаётся сразу в скорость тела (её сервер получает обычными пакетами движения), разгон плавный.
// Обход античита у бота выдан (vulcan.bypass), но скорость всё равно держим как у игрока.

const SWIM_FAST = 0.21;   // блоков за тик рывком под водой (~4,2 бл./с)
const SWIM_SURF = 0.11;   // у поверхности (~2,2 бл./с)
const WATER = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/;

function isWater(b, v) { const k = b.blockAt(v); return !!(k && (WATER.test(k.name) || (k.getProperties && k.getProperties().waterlogged))); }

/** Следующая точка пути (3D, середина клетки), хотя бы на 0,6 блока впереди. */
function nextPoint(tb) {
  const b = tb.bot, p = b.entity.position;
  const path = (tb.lastPath || {}).path || [];
  if (!path.length) return null;
  let i0 = 0, bd = Infinity;
  path.forEach((n, i) => { const d = Math.abs(Math.floor(n.x) + 0.5 - p.x) + Math.abs(n.y - p.y) * 0.3 + Math.abs(Math.floor(n.z) + 0.5 - p.z); if (d < bd) { bd = d; i0 = i; } });
  for (let i = i0; i < path.length; i++) {
    const n = path[i], q = { x: Math.floor(n.x) + 0.5, y: n.y, z: Math.floor(n.z) + 0.5 };
    // по горизонтали: на поверхности бот всегда выше точки пути, и с высотой он «не доплывал» и кружил вокруг неё
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.6) {
      // точка впереди на 3 шага: туда смотреть и по ней решать, плыть ли рывком (плавнее и без рыскания)
      const f = path[Math.min(path.length - 1, i + 3)];
      return { ...q, i, ahead: { x: Math.floor(f.x) + 0.5, y: f.y, z: Math.floor(f.z) + 0.5 }, last: path[path.length - 1] };
    }
  }
  return null;
}

/** Каждый тик физики. Возвращает true, если управлял сам (тогда старая логика воды не нужна). */
function swimTick(tb) {
  const b = tb.bot, e = b.entity;
  if (!e || tb.busyLook || !b.pathfinder.isMoving()) { if (tb.swimming2) { tb.swimming2 = false; b.setControlState('sprint', false); } return false; }
  const p = e.position, feet = p.floored();
  if (!isWater(b, feet) && !isWater(b, feet.offset(0, 1, 0))) { if (tb.swimming2) { tb.swimming2 = false; b.setControlState('sprint', false); } return false; }
  const nx = nextPoint(tb);
  if (!nx) return false;
  const path = tb.lastPath.path;
  // Пройденные точки убрать из пути pathfinder: он каждый тик поворачивает голову к path[0], а мы плывём к точкам
  // впереди - голова смотрела назад на пройденную точку («плавает жопой», 22.11), и он, не «дойдя» до неё,
  // каждые 3,5 с сбрасывал путь (плыла с остановками). Убираем только простые точки (без ломания и стройки).
  while (nx.i > 0 && path.length > 1 && !(path[0].toBreak || []).length && !(path[0].toPlace || []).length) { path.shift(); nx.i--; }
  // берег рядом (суша выше воды в ближайших точках пути): лицом к нему, вперёд и вверх - толчок через край даёт
  // waterExitTick (water.js). Раньше берег отдавался старой логике, только если суша - самая следующая точка, а
  // мы плыли мимо неё к дальней - и упирались в берег по 15 с («на берег опять долго выходила»)
  for (let j = nx.i; j < Math.min(path.length, nx.i + 4); j++) {
    const n = path[j], v = new (p.constructor)(Math.floor(n.x), Math.floor(n.y), Math.floor(n.z));
    if (isWater(b, v) || n.y <= p.y + 0.3 || Math.hypot(v.x + 0.5 - p.x, v.z + 0.5 - p.z) > 2.6) continue;
    const ddx = v.x + 0.5 - p.x, ddz = v.z + 0.5 - p.z, dd = Math.hypot(ddx, ddz) || 1;
    e.velocity.x += (ddx / dd * 0.09 - e.velocity.x) * 0.35;
    e.velocity.z += (ddz / dd * 0.09 - e.velocity.z) * 0.35;
    b.setControlState('sprint', false); b.setControlState('forward', true); b.setControlState('jump', true);
    tb._swimYaw = Math.atan2(-ddx, -ddz); tb._swimPitch = 0;
    b.look(tb._swimYaw, 0, true);
    tb.shoreNode = n; tb.swimming2 = true;
    return true;
  }
  tb.shoreNode = null;

  const head = isWater(b, p.offset(0, 1.6, 0).floored());
  let depth = 0;
  for (let dy = 0; dy < 6 && isWater(b, feet.offset(0, -dy, 0)); dy++) depth++;
  const aim = nx.ahead && Math.hypot(nx.ahead.x - p.x, nx.ahead.z - p.z) > 1 ? nx.ahead : nx;
  const dx = aim.x - p.x, dz = aim.z - p.z, hd = Math.hypot(dx, dz);
  const air = b.oxygenLevel !== undefined ? b.oxygenLevel : 20;
  const fast = (depth >= 2 || head) && hd > 1.8 && air > 6;

  let vy;
  if (fast) {
    // рывком: целимся в точку пути, но под поверхностью (на 0,6 ниже уровня воды) - так быстрее и как у игроков
    let surf = p.y; for (let dy = 0; dy < 12 && isWater(b, feet.offset(0, dy + 1, 0)); dy++) surf = feet.y + dy + 1;
    const wantY = Math.min(nx.y + 0.2, surf - 0.6);
    vy = Math.max(-0.12, Math.min(0.12, (wantY - p.y) * 0.25));
  } else {
    // у поверхности: держаться на воде (лицо над водой), как игрок с зажатым прыжком; воздух мало - вверх
    vy = head ? 0.06 : (p.y - Math.floor(p.y) < 0.6 ? 0.03 : 0.0);
    if (nx.y < p.y - 0.8 && air > 10) vy = -0.06;   // путь уходит вниз - нырнуть
  }
  if (air <= 6 && head) vy = 0.09;   // воздух кончается - сначала наверх
  const speed = fast ? SWIM_FAST : SWIM_SURF;
  const k = hd > 0.01 ? Math.min(speed, hd * 0.5) / hd : 0;
  // плавный разгон: к нужной скорости за несколько тиков, без рывков
  e.velocity.x += (dx * k - e.velocity.x) * 0.35;
  e.velocity.z += (dz * k - e.velocity.z) * 0.35;
  e.velocity.y += (vy - e.velocity.y) * 0.35;
  // поза и взгляд: рывок под водой - sprint (сервер включает позу плавания); голова - по ходу, плавно
  b.setControlState('sprint', fast && b.food > 6);
  b.setControlState('forward', true);
  b.setControlState('jump', false);
  // свой плавный поворот: e.yaw к этому тику уже переписан pathfinder (он смотрит на свою точку), поэтому
  // поворачиваем от своего прошлого угла и каждый тик ставим его заново - голова всегда по ходу
  const yaw = Math.atan2(-dx, -dz), pitch = fast ? Math.max(-0.8, Math.min(0.8, Math.atan2(vy, speed))) : 0;
  if (!tb.swimming2 || tb._swimYaw === undefined) { tb._swimYaw = e.yaw; tb._swimPitch = e.pitch; }
  let dyaw = yaw - tb._swimYaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  tb._swimYaw += Math.max(-0.3, Math.min(0.3, dyaw));
  tb._swimPitch += Math.max(-0.15, Math.min(0.15, pitch - tb._swimPitch));
  b.look(tb._swimYaw, tb._swimPitch, true);
  tb.swimming2 = true;
  return true;
}

/**
 * Воздух кончается под водой - всплыть туда, где над водой открыто (22.11: зашёл в игру под днищем корабля и утонул
 * за 20 с: путь вёл к суше под днищем, а «вверх» упиралось в доски). Главнее пути: каждый тик физики.
 * Воздух: bot.oxygenLevel, а если сервер его не шлёт - своё время под водой (полный запас ~15 с).
 * Цель - ближайшая клетка воды (до 16 бл.), над которой воздух, а не блок; плыть к ней напрямую, рывком.
 */
function airTick(tb) {
  const b = tb.bot, e = b.entity;
  if (!e || b.vehicle) return false;
  const p = e.position, now = Date.now();
  const headIn = isWater(b, p.offset(0, 1.6, 0).floored());
  if (!headIn) { tb._underSince = 0; tb._airEsc = null; return false; }
  tb._underSince = tb._underSince || now;
  const est = Math.max(0, 20 - (now - tb._underSince) / 750);   // сервер может не слать запас воздуха - тогда своё время под водой
  const air = Math.min(b.oxygenLevel !== undefined && b.oxygenLevel !== null ? b.oxygenLevel : 20, est);
  if (air > 8) return false;
  if (!tb._airEsc || now - tb._airEsc.at > 1000) {
    const V = p.constructor, f = p.floored();
    const open = (x, y, z) => { const a = b.blockAt(new V(x, y + 1, z)); return a && !isWater(b, a.position) && a.boundingBox === 'empty'; };
    // обход в ширину по воде от ног: первая клетка с открытым верхом
    const seen = new Set([`${f.x},${f.y},${f.z}`]), q = [[f.x, f.y, f.z, 0]];
    let goal = null;
    while (q.length && !goal) {
      const [x, y, z, d] = q.shift();
      if (open(x, y, z)) { goal = { x: x + 0.5, y: y + 0.2, z: z + 0.5 }; break; }
      if (d >= 16) continue;
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        if (seen.has(k) || seen.size > 4000) continue;
        seen.add(k);
        if (isWater(b, new V(x + dx, y + dy, z + dz))) q.push([x + dx, y + dy, z + dz, d + 1]);
      }
    }
    tb._airEsc = { at: now, goal };
    if (goal && (!tb._airSaid || now - tb._airSaid > 20000)) { tb._airSaid = now; tb.log(`воздух кончается - всплываю к ${Math.floor(goal.x)} ${Math.floor(goal.y)} ${Math.floor(goal.z)}`); }
  }
  const g = tb._airEsc.goal;
  if (!g) { b.setControlState('jump', true); return false; }
  const dx = g.x - p.x, dy = g.y - p.y, dz = g.z - p.z, d = Math.hypot(dx, dy, dz) || 1;
  e.velocity.x += (dx / d * SWIM_FAST - e.velocity.x) * 0.4;
  e.velocity.z += (dz / d * SWIM_FAST - e.velocity.z) * 0.4;
  e.velocity.y += (Math.max(-0.05, dy / d * SWIM_FAST + 0.02) - e.velocity.y) * 0.4;
  b.setControlState('sprint', b.food > 6); b.setControlState('forward', true); b.setControlState('jump', Math.hypot(dx, dz) < 1);
  b.look(Math.atan2(-dx, -dz), Math.max(-0.8, Math.min(0.8, Math.atan2(dy, Math.hypot(dx, dz) || 1))), true);
  return true;
}

module.exports = { swimTick, airTick, nextPoint, SWIM_FAST, SWIM_SURF };
