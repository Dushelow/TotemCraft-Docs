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
  const list = Object.values(m.data.places || {}).filter((p) => p.dim === dim && /(^|\s)(мой |наш )?(дом|база|хата|жильё)/i.test(p.name));
  return list.sort((a, b) => b.at - a.at)[0] || null;
}

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
  if (over && t !== undefined && t < 11000 && Date.now() - (tb.lifeHarvestAt || 0) > 5 * 60000) {
    const ripe = b.findBlock({ matching: (bl) => /^(wheat|carrots|potatoes|beetroots)$/.test(bl.name) && bl.getProperties && +bl.getProperties().age >= (bl.name === 'beetroots' ? 3 : 7), maxDistance: 12 });
    if (ripe && !tb.skills.builtNear(ripe.position, 0)) out.push({ k: 'урожай', s: 25, why: 'спелый урожай рядом' });
  }
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
  if (n.k === 'урожай') { tb.lifeHarvestAt = Date.now(); await tb.harvest({}, tok).catch(() => {}); }
}

/** Раз в 3 с: самое важное дело, если тело свободно. */
function start(tb) {
  if (tb.lifeTimer) clearInterval(tb.lifeTimer);
  tb.lifeTimer = setInterval(async () => {
    const b = tb.bot;
    if (!b || !b.entity || tb.status !== 'online' || tb.lifeBusy || tb.opts.life === false) return;
    if (tb.mode !== 'idle' || b.isSleeping || b.vehicle || (tb.guard && tb.guard.fighting)) return;
    let list;
    try { list = needs(tb); } catch { return; }
    const n = list[0];
    if (!n || n.s < 20) return;
    if (tb.lifeLast && tb.lifeLast.k === n.k && Date.now() - tb.lifeLast.at < 60000 && tb.lifeLast.failed) return;   // не долбить одно и то же
    tb.lifeBusy = true;
    tb.cancel();
    const tok = tb.token;
    tb.mode = 'life'; tb.task = n.why;
    tb.log(`сама: ${n.why}`);
    let failed = false;
    try { await act(tb, n, tok); } catch (e) { failed = !tb.isCancel(e); if (failed) tb.log(`сама не смогла (${n.k}): ${e.message.slice(0, 100)}`); }
    finally {
      tb.lifeBusy = false;
      tb.lifeLast = { k: n.k, at: Date.now(), failed };
      if (tok === tb.token && tb.mode === 'life') { tb.mode = 'idle'; tb.task = ''; }
    }
  }, TICK);
  tb.bot.once('end', () => clearInterval(tb.lifeTimer));
}

module.exports = { start, needs, home };
