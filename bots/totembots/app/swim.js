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
      return { ...q, ahead: { x: Math.floor(f.x) + 0.5, y: f.y, z: Math.floor(f.z) + 0.5 }, last: path[path.length - 1] };
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
  // следующая точка на суше выше воды - это выход на берег: отдать существующей логике (толчок через край)
  const nxBlock = { x: Math.floor(nx.x), y: Math.floor(nx.y), z: Math.floor(nx.z) };
  const target = b.blockAt(new (p.constructor)(nxBlock.x, nxBlock.y, nxBlock.z));
  const landNext = target && !isWater(b, target.position) && nx.y > p.y + 0.3;
  if (landNext) { tb.swimming2 = false; return false; }

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
  const yaw = Math.atan2(-dx, -dz), pitch = fast ? Math.max(-0.8, Math.min(0.8, Math.atan2(vy, speed))) : 0;
  let dyaw = yaw - e.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  if (Math.abs(dyaw) > 0.04 || Math.abs(pitch - e.pitch) > 0.04) b.look(e.yaw + Math.max(-0.3, Math.min(0.3, dyaw)), e.pitch + Math.max(-0.15, Math.min(0.15, pitch - e.pitch)), true);
  tb.swimming2 = true;
  return true;
}

module.exports = { swimTick, nextPoint, SWIM_FAST, SWIM_SURF };
