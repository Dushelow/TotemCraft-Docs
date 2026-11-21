// Слух: звуки мира, которые человек слышит, не задумываясь (шипение крипера за спиной, шаги, лава, взрыв, рог
// рейда). Тело узнаёт опасное и сразу реагирует (крипер шипит рядом - отбежать, даже если его не видно), мозгу -
// короткая строка «слышу: ...» со стороной («сзади», «слева») и расстоянием.

// [образец имени звука, как назвать, важность: 2 - сразу в мозг, 1 - в сводку, 0 - не говорить]
const SOUNDS = [
  [/creeper\.primed/, 'шипит крипер', 2],
  [/generic\.explode|explosion/, 'взрыв', 2],
  [/raid\.horn/, 'рог рейда', 2],
  [/bell\.use|bell\.resonate/, 'звонит колокол', 1],
  [/arrow\.shoot|skeleton\.shoot|crossbow\.shoot/, 'кто-то стреляет', 1],
  [/zombie\.(ambient|step)|husk\.|drowned\./, 'зомби', 1],
  [/skeleton\.(ambient|step)|stray\./, 'скелет', 1],
  [/spider\.(ambient|step)/, 'паук', 1],
  [/enderman\./, 'эндермен', 1],
  [/witch\./, 'ведьма', 1],
  [/ghast\.(ambient|warn|shoot)/, 'гаст', 1],
  [/warden\./, 'ВАРДЕН', 2],
  [/lava\.(pop|ambient)/, 'лава', 1],
  [/water\.ambient|bubble_column/, 'вода', 0],
  [/player\.hurt|player\.attack/, 'драка', 1],
  [/door\.(open|close)|trapdoor\.|fence_gate\./, 'дверь', 0],
  [/chest\.(open|close)|barrel\.(open|close)/, 'сундук', 0],
  [/\.step$/, 'шаги', 0],
  [/villager\./, 'житель', 0],
];

class Hearing {
  /** Подключить слух (из bot.js при входе). */
  listen(bot) {
    this.heard = [];
    bot.on('soundEffectHeard', (name, pos) => { try { this.hear(String(name), pos); } catch {} });
  }

  hear(name, pos) {
    const b = this.bot;
    if (!b || !b.entity || !pos) return;
    const s = SOUNDS.find(([re]) => re.test(name));
    if (!s) return;
    const me = b.entity.position, d = pos.distanceTo(me);
    if (d > 48) return;
    const now = Date.now();
    this.heard = (this.heard || []).filter((h) => now - h.at < 15000);
    this.heard.push({ what: s[1], level: s[2], pos, d, at: now, name });
    if (this.heard.length > 30) this.heard.shift();
    // рефлекс: крипер шипит рядом - отбежать, даже если не видно (за спиной, за углом)
    if (/creeper\.primed/.test(name) && d < 7) this.heardPrime = { pos, at: now };
    // важное - мозгу сразу (не чаще раза в 20 с на один вид)
    if (s[2] === 2 && now - ((this._heardSaid || {})[s[1]] || 0) > 20000) {
      (this._heardSaid = this._heardSaid || {})[s[1]] = now;
      this.event(`слышу: ${s[1]} ${this.sideOf(pos)} ${Math.round(d)} бл.`, s[1] !== 'взрыв' || d < 24);
    }
  }

  /** Сторона звука относительно взгляда: впереди, сзади, слева, справа. */
  sideOf(pos) {
    const e = this.bot.entity, dx = pos.x - e.position.x, dz = pos.z - e.position.z;
    const ang = Math.atan2(-dx, -dz) - e.yaw;   // 0 - прямо по взгляду
    const a = ((ang % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(a) < Math.PI / 4 ? 'впереди' : Math.abs(a) > 3 * Math.PI / 4 ? 'сзади' : a > 0 ? 'слева' : 'справа';
  }

  /** Для мозга: что слышно за последние 15 с (кроме тихих бытовых звуков). */
  heardText() {
    const now = Date.now(), list = (this.heard || []).filter((h) => now - h.at < 15000 && h.level > 0);
    if (!list.length) return '';
    const by = new Map();
    for (const h of list) if (!by.has(h.what) || h.d < by.get(h.what).d) by.set(h.what, h);
    return 'слышу: ' + [...by.values()].sort((a, c) => c.level - a.level || a.d - c.d).slice(0, 4).map((h) => `${h.what} ${this.sideOf(h.pos)} ${Math.round(h.d)} бл.`).join(', ');
  }
}

module.exports = { Hearing, SOUNDS };
