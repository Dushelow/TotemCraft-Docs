// Прогулка, как у жителей в играх-песочницах (23.11, владелец: «ходит куда-нибудь, не по чётким прямым, не быстро,
// прогулочным шагом, по сторонам смотрит, как в ГТА жители чилят»). Без нейросети:
//   - точка в 4-10 бл. от себя, но не дальше радиуса от центра (дом, место, где стоит);
//   - путь с изгибом: через промежуточную точку сбоку от прямой;
//   - шагом, без бега;
//   - на месте постоять 2-6 с и поглядеть: на людей, животных, жителей, огонь, воду, вдаль;
//   - иногда постоять дольше (как будто задумался), иногда присесть на корточки посмотреть под ноги.
const { goals } = require('mineflayer-pathfinder');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

const LOOK_BLOCKS = /^(campfire|soul_campfire|lantern|torch|wall_torch|water|flower_pot|bell|lectern|composter|chest|barrel|crafting_table|furnace|beehive|bee_nest|.*_flower|poppy|dandelion|cornflower|sunflower|.*_tulip|rose_bush|peony|lilac|.*_sapling|wheat|carrots|potatoes|pumpkin|melon|hay_block|.*_sign|.*_wall_sign|.*_banner)$/;

/** Встать можно: под ногами твёрдое, на уровне ног и головы пусто, не вода, не лава, не огонь. */
function standY(b, x, z, y0) {
  const V = b.entity.position.constructor;
  for (let y = Math.floor(y0) + 3; y >= Math.floor(y0) - 4; y--) {
    const f = b.blockAt(new V(x, y - 1, z)), a = b.blockAt(new V(x, y, z)), h = b.blockAt(new V(x, y + 1, z));
    if (!f || !a || !h) continue;
    if (f.boundingBox !== 'block' || /lava|magma|fire|cactus|farmland|water|powder_snow|sweet_berry|chest|barrel|_bed$|crafting|furnace|smoker|anvil|lectern|composter|cauldron|_table$|leaves|hay_block|_fence|_wall$|_stairs$|trapdoor|shulker|bookshelf|loom|stonecutter|grindstone|bell|beehive|melon|pumpkin|_head$|_skull$|pot$/.test(f.name)) continue;   // только пол: на сундуки и мебель не вставать (23.11)
    if (a.boundingBox !== 'empty' || h.boundingBox !== 'empty' || /water|lava|fire|portal|berry|cobweb/.test(a.name + h.name)) continue;
    return y;
  }
  return null;
}

/** Куда поглядеть на остановке: люди, животные, жители, интересные блоки рядом, иначе - вдаль. */
function lookPick(b) {
  const me = b.entity.position, out = [];
  for (const e of Object.values(b.entities)) {
    if (!e.position || e === b.entity || e.name === 'item' || e.name === 'experience_orb') continue;
    const d = e.position.distanceTo(me);
    if (d > 14) continue;
    out.push({ w: e.type === 'player' ? 3 : /villager|cow|sheep|pig|chicken|horse|cat|wolf|fox|rabbit|bee|parrot|goat|llama/.test(e.name || '') ? 2 : 0.5, p: e.position.offset(0, (e.height || 1) * 0.85, 0) });
  }
  try {
    for (const p of b.findBlocks({ matching: (bl) => LOOK_BLOCKS.test(bl.name), maxDistance: 10, count: 12 })) out.push({ w: 1, p: p.offset(0.5, 0.5, 0.5) });
  } catch {}
  const far = () => { const a = Math.random() * 2 * Math.PI; return me.offset(Math.cos(a) * 12, rnd(0, 3), Math.sin(a) * 12); };
  if (!out.length || Math.random() < 0.25) return far();
  const sum = out.reduce((s, o) => s + o.w, 0); let r = Math.random() * sum;
  for (const o of out) { r -= o.w; if (r <= 0) return o.p; }
  return out[0].p;
}

class Stroll {
  /**
   * Прогуляться вокруг центра: a.radius (по умолчанию 12), a.ms - сколько (по умолчанию 40 с), a.center - {x,y,z}.
   * Прерывается любым делом (токен), как всё у тела.
   */
  async stroll(a, tok) {
    const b = this.bot, start = b.entity.position.clone();
    const center = a.center ? new start.constructor(a.center.x, a.center.y ?? start.y, a.center.z) : start;
    const R = Math.max(6, Math.min(40, +a.radius || 12)), until = Date.now() + Math.max(10000, Math.min(10 * 60000, +a.ms || 40000));
    const mv = b.pathfinder.movements;
    // шагом. Прогулок может быть две подряд (своя прервана приказом, а её finally ещё не прошёл) - бег вернуть только
    // после последней (стенд 23.11: первая, закончившись, включала бег второй)
    if (!this._strollN) this._strollSprint = mv.allowSprinting;
    this._strollN = (this._strollN || 0) + 1;
    this.strolling = true;
    let stops = 0;
    try {
      while (Date.now() < until) {
        this.check(tok);
        mv.allowSprinting = false;
        const me = b.entity.position;
        let dest = null;
        for (let i = 0; i < 16 && !dest; i++) {
          const ang = Math.random() * 2 * Math.PI, d = rnd(6, 12);
          const x = Math.floor(me.x + Math.cos(ang) * d), z = Math.floor(me.z + Math.sin(ang) * d);
          if (Math.hypot(x + 0.5 - center.x, z + 0.5 - center.z) > R - 1) continue;
          if (this.zoneAt) { const zn = this.zoneAt(x, z); if (zn && /запрет|опасно/.test(zn.kind || '')) continue; }
          const y = standY(b, x, z, me.y);
          if (y !== null) dest = new me.constructor(x + 0.5, y, z + 0.5);
        }
        if (!dest) { await sleep(1500); continue; }
        // изгиб: сначала в точку сбоку от прямой (1-3 бл.), потом в цель - не по линейке
        const dx = dest.x - me.x, dz = dest.z - me.z, L = Math.hypot(dx, dz) || 1, side = (Math.random() < 0.5 ? -1 : 1) * rnd(1, 3);
        const mx = Math.floor(me.x + dx * 0.5 - dz / L * side), mz = Math.floor(me.z + dz * 0.5 + dx / L * side), my = Math.hypot(mx + 0.5 - center.x, mz + 0.5 - center.z) <= R - 1.5 ? standY(b, mx, mz, me.y) : null;
        try {
          if (my !== null && L > 5) await this.goto(new goals.GoalNear(mx + 0.5, my, mz + 0.5, 1.5), tok, 12000);
          await this.goto(new goals.GoalNear(dest.x, dest.y, dest.z, 1), tok, 15000);
        } catch (e) { if (this.isCancel(e)) throw e; }
        stops++;
        // постоять, поглядеть по сторонам: 2-3 взгляда; иногда дольше (задумался) или присесть посмотреть под ноги
        // чаще - мимоходом глянуть и дальше (ходить, а не стоять); иногда постоять подольше
        const r0 = Math.random(), looks = r0 < 0.35 ? 0 : r0 < 0.85 ? 1 : r0 < 0.95 ? 2 : 3;
        if (!looks) { this.lookTarget = lookPick(b); await sleep(rnd(300, 800)); }
        for (let k = 0; k < looks; k++) {
          this.check(tok);
          this.lookTarget = lookPick(b);
          if (Math.random() < 0.08) { try { b.setControlState('sneak', true); await sleep(900); b.setControlState('sneak', false); } catch {} }
          await sleep(rnd(1200, 2400));
        }
      }
    } finally {
      if (--this._strollN <= 0) { this._strollN = 0; mv.allowSprinting = this._strollSprint !== false; this.strolling = false; }
    }
    const p = b.entity.position;
    return `прогулка: ${stops} остановок, сейчас у ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;
  }
}

module.exports = { Stroll, standY, lookPick };
