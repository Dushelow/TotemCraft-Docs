// Ходьба по дому (тело, без нейросети): ступеньки, плиты, люки. Подключается к модулю ходьбы (mineflayer-pathfinder).
//
// 1. Ступенька и плита - это шаг, а не прыжок. Модуль ходьбы любой подъём на блок строит как прыжок и требует
//    свободную клетку над головой там, где бот стоит сейчас. В доме лестница на второй этаж идёт под потолок,
//    в проём: над головой нижних ступеней - перекрытие, ломать его нельзя -> «ближе пути нет» (63 раза, 15-19.11).
//    Игрок по ступенькам просто шагает (шаг до 0,6 блока). Здесь: если подъём не больше 0,6, нужна только свободная
//    клетка для головы там, куда шагаешь. Сам шаг физика бота делает сама (auto-step), прыжок не нажимается.
// 2. Люк. Закрытый деревянный люк над головой (проём в потолке) модуль считает стеной. Здесь он проходим по пути,
//    а тело само открывает люк, когда путь идёт через него (железный - только редстоуном, его не трогаем).
const Move = require('mineflayer-pathfinder/lib/move');

const WOOD_TRAPDOOR = (n) => /_trapdoor$/.test(n) && n !== 'iron_trapdoor';

function install(mv, bot) {
  // Люк тонкий, как ковёр: стоя на закрытом люке, модуль пути считал его целым блоком, «поднимал» бота на блок
  // выше - там голова упиралась в потолок, и путь был пустым (21.11: «застряла», стоя на люке в комнате).
  for (const bl of Object.values(bot.registry.blocksByName)) if (/_trapdoor$/.test(bl.name)) mv.carpets.add(bl.id);
  // люк сверху (half=top, закрыт) - проходим для расчёта пути: откроем по дороге
  const gb = mv.getBlock.bind(mv);
  mv.getBlock = function (pos, dx, dy, dz) {
    const b = gb(pos, dx, dy, dz);
    if (b && b.name && WOOD_TRAPDOOR(b.name) && b.getProperties) {
      const pr = b.getProperties();
      if (!pr.open && pr.half === 'top' && dy >= 1) return Object.assign(Object.create(Object.getPrototypeOf(b)), b, { safe: true, physical: false, trapdoor: true });
    }
    return b;
  };

  const jumpUp = mv.getMoveJumpUp.bind(mv);
  mv.getMoveJumpUp = function (node, dir, neighbors) {
    const n0 = neighbors.length;
    jumpUp(node, dir, neighbors);
    if (neighbors.length > n0) return;   // обычный подъём и так прошёл
    // ступенька или плита впереди: подъём до 0,6 блока
    const C = this.getBlock(node, dir.x, 0, dir.z), floor = this.getBlock(node, 0, -1, 0);
    if (!C.physical || !C.shapes || !C.shapes.length) return;
    const top = Math.max(...C.shapes.map((s) => s[4]));
    const rise = (C.position.y + top) - Math.max(floor.height, node.y);
    // ступенька, к которой подходишь с низкой стороны: на неё два полушага (0,5 + 0,5) - тоже шаг, не прыжок
    let stair = false;
    if (/_stairs$/.test(C.name) && C.getProperties) {
      const pr = C.getProperties(), F = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[pr.facing];
      stair = pr.half === 'bottom' && F && F[0] === dir.x && F[1] === dir.z;
    }
    if (rise <= 0 || (rise > 0.6 && !stair)) return;
    const B = this.getBlock(node, dir.x, 1, dir.z), H = this.getBlock(node, dir.x, 2, dir.z);
    if (!B.safe || !H.safe) return;      // голове там, куда шагаешь, должно быть место
    if (this.exclusionStep(B) >= 100) return;
    neighbors.push(new Move(B.position.x, B.position.y, B.position.z, node.remainingBlocks, 1.3 + this.exclusionStep(B), [], []));
  };
}

/**
 * Тик тела: идём по пути, впереди или над головой закрытый деревянный люк - открыть (как игрок, правый клик).
 * Не чаще раза в 0,6 с; только когда путь правда ведёт вверх через него.
 */
function trapdoorTick(tb) {
  const b = tb.bot;
  if (!b || !b.entity || !b.pathfinder.isMoving() || Date.now() - (tb.trapAt || 0) < 600) return;
  const p = b.entity.position.floored();
  // путь из path_update - целиком с начала: следующая точка - первая после ближайшей к боту
  const path = (tb.lastPath || {}).path || [];
  let i0 = 0, bd = Infinity;
  path.forEach((q, i) => { const d = Math.abs(q.x - b.entity.position.x) + Math.abs(q.y - b.entity.position.y) + Math.abs(q.z - b.entity.position.z); if (d < bd) { bd = d; i0 = i; } });
  const next = path[i0 + 1] || path[i0];
  const cands = [p.offset(0, 2, 0)];
  // путь вниз (в подвал под люком): люк под ногами и в клетке следующего шага - открыть (21.11 стояла на люке 4 мин)
  if (next && next.y < p.y) { cands.push(p, p.offset(0, -1, 0), new (p.constructor)(Math.floor(next.x), p.y, Math.floor(next.z)), new (p.constructor)(Math.floor(next.x), p.y - 1, Math.floor(next.z))); }
  if (next) { const nx = Math.floor(next.x), nz = Math.floor(next.z); cands.push(new (p.constructor)(nx, p.y + 1, nz), new (p.constructor)(nx, p.y + 2, nz)); }
  for (const v of cands) {
    const k = b.blockAt(v);
    if (!k || !WOOD_TRAPDOOR(k.name) || !k.getProperties) continue;
    const pr = k.getProperties();
    if (pr.open) continue;
    if (pr.half === 'top' && next && next.y <= p.y && v.y > p.y) continue;   // люк сверху, а путь не вверх - не трогать
    tb.trapAt = Date.now();
    b.activateBlock(k).then(() => tb.log(`открыл люк ${v.x} ${v.y} ${v.z}`)).catch(() => {});
    return;
  }
}

module.exports = { install, trapdoorTick };
