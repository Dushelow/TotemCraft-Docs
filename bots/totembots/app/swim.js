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
  // берег рядом (суша выше воды в ближайших точках пути): лицом к нему, вперёд и прыжок - через край выносит сама
  // физика игры (толчок 0,3 при упоре в стену), как у клиента
  for (let j = nx.i; j < Math.min(path.length, nx.i + 4); j++) {
    const n = path[j], v = new (p.constructor)(Math.floor(n.x), Math.floor(n.y), Math.floor(n.z));
    if (isWater(b, v) || n.y <= p.y + 0.3 || Math.hypot(v.x + 0.5 - p.x, v.z + 0.5 - p.z) > 2.6) continue;
    face(tb, v.x + 0.5 - p.x, 0, v.z + 0.5 - p.z, 0);
    b.setControlState('sprint', false); b.setControlState('forward', true); b.setControlState('jump', true); b.setControlState('sneak', false);
    tb.shoreNode = n; tb.swimming2 = true;
    return true;
  }
  tb.shoreNode = null;
  const head = isWater(b, p.offset(0, 1.6, 0).floored());
  const aim = nx.ahead && Math.hypot(nx.ahead.x - p.x, nx.ahead.z - p.z) > 1 ? nx.ahead : nx;
  steer(tb, aim.x - p.x, nx.y + 0.2 - p.y, aim.z - p.z, head);
  tb.swimming2 = true;
  return true;
}

/**
 * Плыть к точке только клавишами и взглядом, как клиент (22.11: Vulcan забанил Loki за Jesus B - скорость тела
 * задавалась напрямую, у поверхности он «стоял» на воде). Физика - как в игре: под водой с бегом - поза плавания,
 * тело идёт туда, куда смотрит (и вниз, и вверх), быстрее (инерция 0,9 вместо 0,8); на поверхности - вперёд и прыжок.
 * Вниз без бега - не держать прыжок (тонет медленно); вверх - прыжок. Воздуха мало для глубины - всплывать.
 */
function steer(tb, dx, dy, dz, head) {
  // Как плавает человек (22.11, владелец): в пути - с бегом чуть под поверхностью, в позе плавания; на месте и вблизи -
  // поплавком (полтела в воде, прыжок только когда осел); за кем-то на дно - нырнуть. Не дёргать прыжок каждый тик.
  const b = tb.bot, e = b.entity, p = e.position, f = p.floored(), hd = Math.hypot(dx, dz);
  let surf = 0; for (let k = 1; k < 30 && isWater(b, f.offset(0, k, 0)); k++) surf = k;
  const topY = f.y + surf + 0.89;   // уровень воды над нами
  const airSec = airLeft(tb) * 0.75;
  const low = head && airSec < surf / 3 + 3;   // не хватит воздуха подняться с этой глубины - сначала наверх
  const deep = !low && dy < -1.5;              // цель ниже - нырять
  const travel = !low && (hd > 2.5 || deep);
  // поза плавания: держать, пока в пути (гистерезис - без дёрганья туда-сюда)
  if (!travel || b.food <= 6) tb._pose = false; else if (travel && head) tb._pose = true;
  b.setControlState('sneak', false);
  if (tb._pose) {
    // в пути у поверхности - на 1 бл. под водой (тело чуть под поверхностью); глубже - к цели
    const want = deep ? dy : Math.min(dy, topY - 1.0 - p.y);
    b.setControlState('sprint', true); b.setControlState('forward', true); b.setControlState('jump', false);
    face(tb, dx, want, dz, 1);
    return;
  }
  b.setControlState('sprint', false);
  if (travel && !head) {
    // в путь, а голова над водой: без прыжка тело оседает, глаза уходят под воду - дальше поза плавания
    b.setControlState('forward', true); b.setControlState('jump', false);
    face(tb, dx, 0, dz, 0);
    return;
  }
  // поплавок: прыжок только когда осел ниже середины тела под водой; вверх (воздух) - держать прыжок
  b.setControlState('forward', hd > 0.4);
  b.setControlState('jump', low || dy > 0.6 || p.y < topY - 1.0);
  face(tb, dx, 0, dz, 0);
}

/** Повернуть голову к направлению плавно (до 0,3 рад за тик), со своим углом: pathfinder переписывает e.yaw каждый тик. */
function face(tb, dx, dy, dz, usePitch) {
  const b = tb.bot, e = b.entity;
  const yaw = Math.atan2(-dx, -dz), pitch = usePitch ? Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz) || 0.01))) : 0;
  if (!tb.swimming2 || tb._swimYaw === undefined) { tb._swimYaw = e.yaw; tb._swimPitch = e.pitch; }
  let d = yaw - tb._swimYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  tb._swimYaw += Math.max(-0.3, Math.min(0.3, d));
  tb._swimPitch += Math.max(-0.2, Math.min(0.2, pitch - tb._swimPitch));
  b.look(tb._swimYaw, tb._swimPitch, true);
}

/** Запас воздуха 0-20: от сервера, но не больше своего счёта времени под водой (сервер может не слать). */
function airLeft(tb) {
  const b = tb.bot, now = Date.now();
  // сервер шлёт запас (видели его ниже 20) - верить ему: свой счёт сбивался, когда голова у самой поверхности
  // (плывёт в позе плавания - то под водой, то над), и бот всплывал зря
  if (typeof b.oxygenLevel === 'number' && b.oxygenLevel < 20) tb._oxyLive = true;
  if (tb._oxyLive) return b.oxygenLevel;
  if (!tb._underSince) return 20;
  return Math.max(0, 20 - (now - tb._underSince) / 750);
}

/**
 * Физика плавания игрока, которой нет в prismarine-physics (после её шага, каждый тик): поза плавания под водой с
 * бегом - горизонтальная инерция 0,9 вместо 0,8 и вертикаль по взгляду (как LivingEntity.travel в игре). Это ровно то,
 * что делает клиент, поэтому античит видит обычного пловца.
 */
function swimPhysics(tb) {
  const b = tb.bot, e = b.entity;
  if (!e || !e.isInWater || !b.getControlState('sprint') || b.food <= 6) return;
  if (!isWater(b, e.position.offset(0, 1.6, 0).floored())) return;   // поза плавания - только с головой под водой
  e.velocity.x *= 0.9 / 0.8; e.velocity.z *= 0.9 / 0.8;
  const lookY = Math.sin(e.pitch);   // у mineflayer pitch > 0 - взгляд вверх
  const waterAbove = isWater(b, e.position.offset(0, 1.9, 0).floored());
  if (lookY <= 0 || b.getControlState('jump') || waterAbove) e.velocity.y += (lookY - e.velocity.y) * (lookY < -0.2 ? 0.085 : 0.06);
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
  const air = airLeft(tb);
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
  steer(tb, g.x - p.x, g.y - p.y + 1, g.z - p.z, true);
  return true;
}

/** Стоит в воде без пути (ждёт, смотрит на хозяина) - поплавком: прыжок, когда осел (22.11, журнал движения: висел у
 *  борта без единой клавиши, медленно тонул и смотрел вверх на хозяина). */
function floatTick(tb) {
  const b = tb.bot, e = b.entity;
  if (!e || b.vehicle || b.pathfinder.isMoving()) return false;
  const f = e.position.floored();
  if (!isWater(b, f) && !isWater(b, f.offset(0, 1, 0))) { if (tb._floating) { tb._floating = false; b.setControlState('jump', false); } return false; }
  let surf = 0; for (let k = 1; k < 30 && isWater(b, f.offset(0, k, 0)); k++) surf = k;
  const topY = f.y + surf + 0.89;
  tb._floating = true;
  b.setControlState('forward', false); b.setControlState('sprint', false);
  b.setControlState('jump', e.position.y < topY - 1.0);
  return true;
}

module.exports = { swimTick, airTick, floatTick, swimPhysics, nextPoint, SWIM_FAST, SWIM_SURF };
