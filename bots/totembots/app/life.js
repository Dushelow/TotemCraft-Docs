// Жизнь тела (без нейросети), как у NPC в играх: выбор дела по нуждам (Utility AI, The Sims) + распорядок дня
// (расписание NPC в Skyrim). Раз в 3 с тело оценивает нужды очками 0-100 и делает самое важное, если свободно
// (не выполняет приказ, не идёт за хозяином, не ждёт, не едет). Нейросеть не нужна: решение за миллисекунды.
// Мозг по-прежнему сам придумывает большие дела в свободное время; любой его приказ прерывает дело тела.
//
// Нужды и очки:
//   опасность  - мало здоровья и враг рядом            -> уйти домой или от врага       до 95
//   ночь       - стемнело, есть дом и кровать         -> домой, лечь спать             70-80
//   вечер      - скоро ночь                            -> пойти к дому                  45
//   тяжело     - инвентарь полон, есть дом с сундуками -> домой, выложить лишнее        40-60
//   урожай     - день, рядом спелые грядки             -> собрать и посадить            25
// Ниже 20 очков - тело ничего само не делает (это свободное время мозга).
const { goals } = require('mineflayer-pathfinder');

const TICK = 3000;

function home(tb) {
  const m = tb.memory;
  if (!m) return null;
  const dim = tb.dimName();
  const all = Object.values(m.data.places || {}).filter((p) => p.dim === dim);
  // свой дом: «мой дом», «наш дом», «моя база»; чужие («дом Вальгарда», «дом на продажу») - не дом бота
  const mine = all.filter((p) => /^(мой|наш|моя|наша) (дом|база|хата)/i.test(p.name)).sort((a, b) => b.at - a.at)[0];
  if (mine) return mine;
  return all.filter((p) => p.kind === 'моя кровать' || (/^кровать у/i.test(p.name) && /спал/.test(p.note || ''))).sort((a, b) => b.at - a.at)[0] || null;
}

const ownerNear0 = (tb) => (tb.opts.masters || []).some((n) => tb.player && tb.player(n) && tb.bot && tb.player(n).position.distanceTo(tb.bot.entity.position) < 12);
function needs(tb) {
  const b = tb.bot, me = b.entity.position, out = [];
  const t = b.time && b.time.timeOfDay;
  const over = /overworld/.test(b.game.dimension || '');
  const h = home(tb);
  const dHome = h ? Math.hypot(h.x - me.x, h.z - me.z) : Infinity;
  const isHostile = (e) => (tb.guard ? tb.guard.isHostile(e) : e.type === 'hostile');
  const hostile = Object.values(b.entities).some((e) => e !== b.entity && e.position && isHostile(e) && e.position.distanceTo(me) < 10);
  if (b.health <= 8 && hostile) out.push({ k: 'опасность', s: 95 - b.health * 2, why: `мало здоровья (${b.health}/20), рядом враг` });
  if (over && t !== undefined) {
    const night = t >= 12542 && t <= 23460, evening = t >= 11000 && t < 12542;
    if (night && h) out.push({ k: 'ночь', s: dHome > 10 ? 70 : 80, why: dHome > 10 ? 'ночь - пора домой' : 'ночь - спать' });
    else if (evening && h && dHome > 30) out.push({ k: 'вечер', s: 45, why: 'вечереет - к дому' });
  }
  if (b.inventory.emptySlotCount() <= 2 && h) out.push({ k: 'тяжело', s: dHome < 16 ? 60 : 40, why: 'инвентарь почти полон - выложить дома' });
  // урожай сам - только свой: грядки у своего дома (40 бл.), а не чужое или общее поле (22.11: Loki зашёл и пошёл рвать
  // бамбук и пшеницу на общем поле у спавна). Чужое - только по просьбе
  if (h && over && t !== undefined && t < 11000 && Date.now() - (tb.lifeHarvestAt || 0) > 5 * 60000) {
    const ripe = b.findBlock({ matching: (bl) => /^(wheat|carrots|potatoes|beetroots)$/.test(bl.name) && bl.getProperties && +bl.getProperties().age >= (bl.name === 'beetroots' ? 3 : 7), maxDistance: 12 });
    if (ripe && !tb.skills.builtNear(ripe.position, 0) && Math.hypot(ripe.position.x - h.x, ripe.position.z - h.z) < 40) out.push({ k: 'урожай', s: 25, why: 'спелый урожай у дома', crop: ripe.name });
  }
  // дома без дел - иногда посидеть на стуле (ступенька или полублок под крышей на уровне пола, не лестница), раз в 10 мин
  if (!out.length && !ownerNear0(tb) && h && Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) < 16 && Date.now() - (tb.chairAt || 0) > 10 * 60000 && Date.now() - (tb.ownerAskAt || 0) > 3 * 60000) {
    const roof = (v) => { for (let dy = 1; dy <= 6; dy++) { const k = b.blockAt(v.offset(0, dy, 0)); if (k && k.boundingBox === 'block') return true; } return false; };
    const chair = b.findBlock({ matching: (bl) => /_stairs$|_slab$/.test(bl.name) && (!/_slab$/.test(bl.name) || String(bl.getProperties().type) === 'bottom'), maxDistance: 10, useExtraInfo: (bl) => {
      if (!roof(bl.position)) return false;
      const up = b.blockAt(bl.position.offset(0, 1, 0)); if (!up || up.boundingBox !== 'empty') return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [1, -1]) { const k = b.blockAt(bl.position.offset(dx, dy, dz)); if (k && /_stairs$|_slab$/.test(k.name)) return false; }   // пролёт лестницы
      return true; } });
    if (chair) out.push({ k: 'посидеть', s: 22, why: 'присел посидеть дома', chair: chair.position });
  }
  // делать нечего: хозяина рядом нет, давно ничего не просил - прогуляться у дома или где стоит, а не стоять истуканом
  // (23.11, владелец: «как в Скайриме компаньоны ходят что-то делают даже без нейронки»)
  const ownerNear = (tb.opts.masters || []).some((n) => tb.player && tb.player(n) && tb.player(n).position.distanceTo(b.entity.position) < 12);
  if (!out.length && !ownerNear && Date.now() - (tb.ownerAskAt || 0) > 3 * 60000 && !(tb.errand && tb.errand() && /run|stuck|pause/.test(tb.errand().state)))
    out.push({ k: 'прогулка', s: 21, why: 'гуляю, осматриваюсь', center: h && Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) < 40 ? h : null });
  return out.sort((x, y) => y.s - x.s);
}

async function act(tb, n, tok) {
  const b = tb.bot, h = home(tb);
  if (n.k === 'опасность') {
    if (h && Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) < 120) await tb.walkTo({ x: h.x, y: h.y, z: h.z }, tok, 90000);
    else {
      const foe = Object.values(b.entities).filter((e) => e !== b.entity && e.position && (tb.guard ? tb.guard.isHostile(e) : e.type === 'hostile')).sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position))[0];
      if (foe) await tb.goto(new goals.GoalInvert(new goals.GoalFollow(foe, 16)), tok, 12000).catch(() => {});
    }
    return;
  }
  if (n.k === 'ночь' || n.k === 'вечер') {
    if (Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) > 10) await tb.walkTo({ x: h.x, y: h.y, z: h.z }, tok, 300000);
    if (n.k === 'ночь') { tb.check(tok); await tb.goSleep(tok).catch((e) => tb.log('спать не вышло: ' + e.message)); }
    return;
  }
  if (n.k === 'тяжело') {
    if (Math.hypot(h.x - b.entity.position.x, h.z - b.entity.position.z) > 12) await tb.walkTo({ x: h.x, y: h.y, z: h.z }, tok, 300000);
    await tb.stash({}, tok).catch((e) => tb.log('выложить не вышло: ' + e.message));
    return;
  }
  if (n.k === 'посидеть') {
    tb.chairAt = Date.now();
    if (tb.sitNear && await tb.sitNear(n.chair)) { if (tb.seat) tb.seat.chill = Date.now() + 60000 + Math.random() * 120000; }
    return;
  }
  if (n.k === 'прогулка') { await tb.stroll({ radius: n.center ? 16 : 12, ms: 60000 + Math.random() * 60000, center: n.center }, tok); return; }
  if (n.k === 'урожай') { tb.lifeHarvestAt = Date.now(); await tb.harvest({ crop: n.crop }, tok).catch(() => {}); }
}

/** Раз в 3 с: самое важное дело, если тело свободно. */
function start(tb) {
  if (tb.lifeTimer) clearInterval(tb.lifeTimer);
  tb.lifeTimer = setInterval(async () => {
    const b = tb.bot;
    if (!b || !b.entity || tb.status !== 'online' || tb.lifeBusy || tb.opts.life === false || tb.paused || tb._errandBusy) return;
    if (tb.mode !== 'idle' || b.isSleeping || b.vehicle || (tb.guard && tb.guard.fighting)) return;
    // мозг недавно сам что-то делал - не перебивать его (21.11: тело и мозг отменяли друг друга каждые 6 с)
    if (Date.now() - (tb.lastRunAt || 0) < 45000) return;
    let list;
    try { list = needs(tb); } catch { return; }
    const n = list[0];
    if (!n || n.s < 20) return;
    // не долбить одно и то же: не вышло - 5 мин перерыв, прервали - 2 мин
    if (tb.lifeLast && tb.lifeLast.k === n.k && Date.now() - tb.lifeLast.at < (tb.lifeLast.failed ? 300000 : 120000) && (tb.lifeLast.failed || tb.lifeLast.cut)) return;
    tb.lifeBusy = true;
    tb.cancel();
    const tok = tb.token;
    tb.mode = 'life'; tb.task = n.why;
    tb.log(`своё: ${n.why}`);
    let failed = false, cut = false;
    tb.taskOwner = null;   // жизнь тела - младше всех: любое дело мозга или хозяина её прервёт
    try { await act(tb, n, tok); } catch (e) { cut = tb.isCancel(e); failed = !cut; if (failed) tb.log(`своё не вышло (${n.k}): ${e.message.slice(0, 100)}`); }
    finally {
      tb.lifeBusy = false;
      tb.lifeLast = { k: n.k, at: Date.now(), failed, cut: cut || tok !== tb.token };
      if (tok === tb.token && tb.mode === 'life') { tb.mode = 'idle'; tb.task = ''; }
    }
  }, TICK);
  tb.bot.once('end', () => clearInterval(tb.lifeTimer));
}

module.exports = { start, needs, home };
