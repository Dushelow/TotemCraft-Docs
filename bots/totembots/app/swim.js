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
    // лиана или лестница: как игрок - встать в её клетку и упереться в стену, к которой она прицеплена; упор в стену из
    // воды даёт толчок вверх, и ноги попадают в лиану (стенд 22.11: плыл в саму лиану и не поднимался)
    let fx = v.x + 0.5 - p.x, fz = v.z + 0.5 - p.z;
    const cl = b.blockAt(v);
    if (cl && /vine|ladder/.test(cl.name) && Math.hypot(fx, fz) < 0.7) {
      const pr = cl.getProperties ? cl.getProperties() : {};
      if (/ladder/.test(cl.name)) { const F = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[pr.facing]; if (F) { fx = F[0]; fz = F[1]; } }
      else { const W = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]].find(([k]) => pr[k] === true || pr[k] === 'true'); if (W) { fx = W[1]; fz = W[2]; } }
    }
    face(tb, fx, 0, fz, 0);
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
function steer(tb, dx, dy, dz, head, go) {
  // Как плавает человек (22.11, владелец): в пути - с бегом чуть под поверхностью, в позе плавания; на месте и вблизи -
  // поплавком (полтела в воде, прыжок только когда осел); за кем-то на дно - нырнуть. Не дёргать прыжок каждый тик.
  const b = tb.bot, e = b.entity, p = e.position, f = p.floored(), hd = Math.hypot(dx, dz);
  let surf = 0; for (let k = 1; k < 30 && isWater(b, f.offset(0, k, 0)); k++) surf = k;
  const topY = f.y + surf + 0.89;   // уровень воды над нами
  const airSec = airLeft(tb) * 0.75;
  // не хватит воздуха подняться с этой глубины - сначала наверх; go - плыть к цели в любом случае (выход из-подо льда)
  const low = !go && head && airSec < surf / 3 + 3;
  const deep = !low && dy < -1.5;              // цель ниже - нырять
  const travel = go || (!low && (hd > 2.5 || deep));
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
  const hd = Math.hypot(dx, dz);
  if (!tb.swimming2 || tb._swimYaw === undefined) { tb._swimYaw = e.yaw; tb._swimPitch = e.pitch; }
  // цель прямо под или над нами - курс не менять (atan2 от нулей крутил бота волчком)
  const yaw = hd > 0.3 ? Math.atan2(-dx, -dz) : tb._swimYaw, pitch = usePitch ? Math.max(-1.2, Math.min(1.2, Math.atan2(dy, hd || 0.01))) : 0;
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
  // запас воздуха от сервера бывает неверным: журнал движения показал «воздух 0» на поверхности, с головой над водой -
  // бот считал, что задыхается, и всё время всплывал, а не нырял за хозяином (22.11). Неверное значение (меньше 20,
  // когда голова над водой) - больше ему не верить, считать самим
  const headIn = (() => { try { const k = b.blockAt(b.entity.position.offset(0, 1.6, 0).floored()); return !!(k && /water|bubble_column/.test(k.name)); } catch { return false; } })();
  if (typeof b.oxygenLevel === 'number' && b.oxygenLevel < 19 && !headIn && !tb._oxyBad) { tb._oxyBad = true; tb._oxyLive = false; }
  if (!tb._oxyBad && typeof b.oxygenLevel === 'number' && b.oxygenLevel < 20 && headIn) tb._oxyLive = true;
  if (tb._oxyLive && !tb._oxyBad) return b.oxygenLevel;
  if (!tb._underSince) return 20;
  return Math.max(0, 20 - (now - tb._underSince) / 750);
}

/**
 * Физика плавания игрока, которой нет в prismarine-physics (после её шага, каждый тик): поза плавания под водой с
 * бегом - горизонтальная инерция 0,9 вместо 0,8 и вертикаль по взгляду (как LivingEntity.travel в игре). Это ровно то,
 * что делает клиент, поэтому античит видит обычного пловца.
 */
function swimPhysics(tb) {
  // поза - по своему решению прошлого такта (tb._pose): модуль пути в начале такта сбрасывает бег в воде, и по клавише
  // поза «пропадала» (стенд 26.3, 22.11: нырял по 0,4 бл./с)
  const b = tb.bot, e = b.entity;
  tb._phys = !e ? 'нет тела' : !e.isInWater ? 'не в воде' : !(tb._pose || b.getControlState('sprint')) ? 'без бега' : b.food <= 6 ? 'голоден' : !isWater(b, e.position.offset(0, 1.6, 0).floored()) ? 'голова над водой' : 'пловец';
  if (tb._phys !== 'пловец') return;
  e.velocity.x *= 0.9 / 0.8; e.velocity.z *= 0.9 / 0.8;
  // наклон - свой (tb._swimPitch): модуль пути в начале такта ставит голове наклон 0, и тело «смотрело прямо», хотя
  // бот смотрел вниз (стенд, 22.11: нырял по 0,4 бл./с). У mineflayer pitch > 0 - взгляд вверх
  const lookY = Math.sin(tb._swimPitch !== undefined ? tb._swimPitch : e.pitch);
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
  if (!headIn) { tb._underSince = 0; tb._airEsc = null; airResume(tb); return false; }
  tb._underSince = tb._underSince || now;
  const air = airLeft(tb), airSec = air * 0.75;
  // Над водой потолок (лёд, днище, свод пещеры)? Тогда «вверх» не спасёт: выход ищем заранее и плывём к нему, пока
  // воздуха хватает на дорогу (23.11 на стенде: подо льдом ждал до 6 с воздуха, выход в 21 бл. - не доплыл).
  const f0 = p.floored(); let wk = 1; while (wk < 30 && isWater(b, f0.offset(0, wk, 0))) wk++;
  const cap = b.blockAt(f0.offset(0, wk, 0)), capped = !!(cap && cap.boundingBox === 'block');
  if (!capped && air > 8) { airResume(tb); return false; }
  // Жмём «вверх», а тело не поднимается 1,2 с - над головой что-то, чего нет в блоках: лодка, корабельная шлюпка,
  // другой игрок (22.11, журнал движения: 15 с на одной высоте 61,20 с зажатым прыжком под лодкой у борта, и утонул).
  // Эту клетку - в закрытые на 15 с, искать выход в другом месте
  const B = (tb._blockedCols = (tb._blockedCols || new Map()));
  for (const [k, t] of B) if (now - t > 15000) B.delete(k);
  if (b.getControlState('jump') || tb._airEsc) {
    const S = tb._riseChk;
    if (!S || Math.abs(S.x - p.x) > 0.6 || Math.abs(S.z - p.z) > 0.6 || p.y > S.y + 0.15) tb._riseChk = { x: p.x, y: p.y, z: p.z, at: now };
    else if (now - S.at > 1200) { const k = `${Math.floor(p.x)},${Math.floor(p.z)}`; if (!B.has(k)) { B.set(k, now); tb.log(`всплыть не выходит - над головой преграда (${(overhead(b, p) || 'не блок')}), ищу другой выход`); tb._airEsc = null; } tb._riseChk = null; }
  }
  if (!tb._airEsc || now - tb._airEsc.at > 1000) {
    const V = p.constructor, f = p.floored();
    const open = (x, y, z) => { if (B.has(`${x},${z}`)) return false; const a = b.blockAt(new V(x, y + 1, z)); return a && !isWater(b, a.position) && a.boundingBox === 'empty' && !entityIn(b, x, y + 0.3, z, 2); };
    // обход в ширину по воде от ног: первая клетка с открытым верхом
    const seen = new Set([`${f.x},${f.y},${f.z}`]), q = [[f.x, f.y, f.z, 0]];
    let goal = null;
    while (q.length && !goal) {
      const [x, y, z, d] = q.shift();
      if (open(x, y, z)) { goal = { x: x + 0.5, y: y + 0.2, z: z + 0.5, d }; break; }
      if (d >= 28) continue;   // шире: подо льдом выход бывает далеко
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        if (seen.has(k) || seen.size > 12000) continue;
        seen.add(k);
        if (isWater(b, new V(x + dx, y + dy, z + dz))) q.push([x + dx, y + dy, z + dz, d + 1]);
      }
    }
    tb._airEsc = { at: now, goal };
    // под потолком, выход есть, а воздуха с запасом: дорога (бл.) / 3 бл. в с + 4 с - ещё не пора, плывём по своим делам
    if (capped && air > 8 && goal && airSec > goal.d / 3 + 4) { tb._airEsc = null; tb._airWait = now; airResume(tb); return false; }
    if (goal && (!tb._airSaid || now - tb._airSaid > 20000)) { tb._airSaid = now; tb.log(`воздух кончается - всплываю к ${Math.floor(goal.x)} ${Math.floor(goal.y)} ${Math.floor(goal.z)}`); }
  }
  airPause(tb);
  const g = tb._airEsc.goal;
  if (!g) {
    // выхода к воздуху нет (подо льдом, под днищем, в затопленной пещере) - пробить потолок над головой, как игрок:
    // лёд, снег, земля, камень рукой или инструментом (22.11: утонул подо льдом, упираясь в него 20 с)
    const top = p.offset(0, 2, 0).floored(), k = b.blockAt(top);
    if (k && k.boundingBox === 'block' && !tb._digUp && !/bedrock|obsidian|barrier|_planks|_log|glass|chest|barrel|door|trapdoor/.test(k.name)) {
      tb._digUp = true; tb.log(`воздуха нет, выхода не видно - пробиваю ${k.name} над головой`);
      b.setControlState('forward', false); b.setControlState('jump', false);
      (async () => { try { const t = b.pathfinder.bestHarvestTool ? b.pathfinder.bestHarvestTool(k) : null; if (t) await b.equip(t, 'hand'); await b.lookAt(top.offset(0.5, 0.5, 0.5), true); await b.dig(k, true); } catch (e) { tb.log('пробить не вышло: ' + e.message); } finally { tb._digUp = false; tb._airEsc = null; } })();
      return true;
    }
    if (tb._digUp) return true;
    b.setControlState('jump', true); return true;
  }
  if (tb._digUp) { try { b.stopDigging(); } catch {} tb._digUp = false; }   // выход нашёлся, пока долбил лёд - плыть к нему
  // к выходу - плыть, а не всплывать на месте: под льдом «вверх» упирается в лёд (рывком, в позе плавания)
  steer(tb, g.x - p.x, g.y - p.y + 1, g.z - p.z, true, Math.hypot(g.x - p.x, g.z - p.z) > 1.5);
  return true;
}

/** Спасаясь от удушья, тело ведёт только airTick: цель модуля пути (за хозяином, к берегу) отложить - иначе он крутит
 *  бота к своей цели каждый такт (23.11 стенд: подо льдом взгляд метался, бот 25 с на месте и утонул). Вернуть, когда
 *  отдышался. */
function airPause(tb) {
  const b = tb.bot, g = b.pathfinder && b.pathfinder.goal;
  if (!g) return;
  tb._airGoal = { g, dyn: !!g.entity };
  try { b.pathfinder.setGoal(null); } catch {}
}
function airResume(tb) {
  const s = tb._airGoal; if (!s) return;
  tb._airGoal = null;
  const b = tb.bot;
  try { if (!b.pathfinder.goal && (!s.g.entity || b.entities[s.g.entity.id])) b.pathfinder.setGoal(s.g, s.dyn); } catch {}
}

/** Сущность с телом (лодка, игрок, моб) в клетке x z от высоты y на h блоков вверх - туда не всплыть. */
function entityIn(b, x, y, z, h) {
  for (const e of Object.values(b.entities)) {
    if (!e.position || e === b.entity || e.name === 'item' || e.name === 'experience_orb') continue;
    const w = (e.width || 0.6) / 2, eh = e.height || 1;
    if (Math.abs(e.position.x - (x + 0.5)) < w + 0.5 && Math.abs(e.position.z - (z + 0.5)) < w + 0.5 && e.position.y < y + h && e.position.y + eh > y) return true;
  }
  return false;
}
function overhead(b, p) {
  for (const e of Object.values(b.entities)) if (e.position && e !== b.entity && Math.hypot(e.position.x - p.x, e.position.z - p.z) < 1.5 && e.position.y > p.y && e.position.y - p.y < 3.5) return e.name || e.username || e.type;
  return '';
}

/** Стоит в воде без пути (ждёт, смотрит на хозяина) - поплавком: прыжок, когда осел (22.11, журнал движения: висел у
 *  борта без единой клавиши, медленно тонул и смотрел вверх на хозяина). */
function floatTick(tb) {
  const b = tb.bot, e = b.entity;
  if (!e || b.vehicle) return false;
  const f = e.position.floored();
  if (!isWater(b, f) && !isWater(b, f.offset(0, 1, 0))) { if (tb._floating) { tb._floating = false; b.setControlState('jump', false); } return false; }
  // путь есть, но точка рядом (swimTick не взялся) - доплыть к ней спокойно; иначе модуль пути держит «прыжок» в воде
  // каждый такт, и бот подпрыгивал без конца (22.11)
  const n0 = b.pathfinder.isMoving() && ((tb.lastPath || {}).path || [])[0];
  if (n0) { const p = e.position; steer(tb, n0.x - p.x, n0.y - p.y, n0.z - p.z, isWater(b, p.offset(0, 1.6, 0).floored())); return true; }
  let surf = 0; for (let k = 1; k < 30 && isWater(b, f.offset(0, k, 0)); k++) surf = k;
  const topY = f.y + surf + 0.89;
  tb._floating = true;
  b.setControlState('forward', false); b.setControlState('sprint', false);
  b.setControlState('jump', e.position.y < topY - 1.0);
  return true;
}

module.exports = { swimTick, airTick, floatTick, swimPhysics, nextPoint, SWIM_FAST, SWIM_SURF };
