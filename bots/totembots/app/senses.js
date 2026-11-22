// Чувства (как игрок краем глаза следит за миникартой): не «кто рядом» списком, а что происходит - кто
// приближается и откуда, насколько опасно сейчас, и короткая память о живом (где видела врага или игрока
// пару минут назад, когда он ушёл из виду). Живое не записывается в карту - оно меняется каждую секунду.
const SEEN_MS = 3 * 60000;   // короткая память о живом: 3 минуты

class Senses {
  /** Раз в секунду (slowTick): обновить следы живых - положение, скорость, кто пропал из виду. */
  sensesTick() {
    const b = this.bot;
    if (!b || !b.entity) return;
    const now = Date.now(), me = b.entity.position;
    this.tracks = this.tracks || new Map();
    this.memoryLive = this.memoryLive || new Map();
    const alive = new Set();
    for (const e of Object.values(b.entities)) {
      if (e === b.entity || !e.position || e.name === 'item' || e.type === 'orb' || e.type === 'object') continue;
      const d = e.position.distanceTo(me);
      if (d > 48) continue;
      alive.add(e.id);
      const t = this.tracks.get(e.id);
      const kind = e.type === 'player' ? 'player' : this.isEnemy(e) ? 'enemy' : null;
      // скорость (бл./с) по прошлому положению; видно ли глазами (steer.js) - за стеной моб «слышен», а не «виден»
      const dt = t ? Math.max(0.2, (now - t.at) / 1000) : 1;
      const vx = t ? (e.position.x - t.pos.x) / dt : 0, vz = t ? (e.position.z - t.pos.z) / dt : 0;
      const seen = kind === 'enemy' && this.seesEntity ? this.seesEntity(e) : true;
      this.tracks.set(e.id, { id: e.id, name: e.username || e.name, kind, pos: e.position.clone(), d, at: now, prev: t && t.pos, prevD: t ? t.d : d, prevAt: t ? t.at : now, vx, vz, seen });
      if (kind) this.memoryLive.set(e.id, { name: e.username || e.name, kind, pos: e.position.clone(), at: now, gone: false, vx, vz });
      if (kind === 'player' && e.username) this.metTick(e.username, d, now);
    }
    for (const [id, t] of this.tracks) if (!alive.has(id)) { this.tracks.delete(id); const m = this.memoryLive.get(id); if (m) m.gone = true; }
    for (const [id, m] of this.memoryLive) if (now - m.at > SEEN_MS) this.memoryLive.delete(id);
    // стало опасно - мозгу сразу (не чаще раза в минуту), чтобы решил: уйти, позвать хозяина, драться
    const th = this.threat();
    // мобы только за стенами (не видно) - не тревога: тело слышит, мозгу не о чем решать
    const seenFoe = [...this.tracks.values()].some((t) => t.kind === 'enemy' && t.d < 16 && t.seen !== false);
    if (th.level === 'опасно' && seenFoe && this.lastThreat !== 'опасно' && now - (this.threatSaidAt || 0) > 60000 && this.event) {
      this.threatSaidAt = now;
      this.event('обстановка: опасно - ' + (this.motion().join('; ') || 'много врагов рядом') + '. Тело само отходит от крипера и бьёт мешающих; своё дело не бросай', true);
    }
    this.lastThreat = th.level;
  }

  /**
   * Встречи: кто рядом (до 12 бл.) после долгой разлуки (40+ мин, по памяти и между запусками) - событие 'reunion'
   * (мозг здоровается с хозяином и знакомыми). Пока рядом (до 24 бл.) - «виделись только что».
   */
  metTick(name, d, now) {
    if (name === (this.bot && this.bot.username)) return;
    const m = this.memory, M = m ? (m.data.met = m.data.met || {}) : (this.metMem = this.metMem || {});
    const last = M[name];
    if (d <= 12 && (!last || now - last > 40 * 60000)) {
      const gap = last ? Math.round((now - last) / 60000) : null;
      M[name] = now;
      this.emit('reunion', { name, gap });
    }
    else if (d <= 24 && M[name] && now - M[name] <= 40 * 60000) M[name] = now;   // ещё рядом после встречи
    if (m && now - (this.metSavedAt || 0) > 60000) { this.metSavedAt = now; const ks = Object.keys(M); if (ks.length > 200) for (const k of ks.sort((a, c) => M[a] - M[c]).slice(0, ks.length - 200)) delete M[k]; m.save(); }
  }

  isEnemy(e) {
    const info = this.bot.registry.entitiesByName[e.name] || {};
    return /hostile/i.test(info.category || '') || /^(slime|magma_cube|ghast|phantom|shulker|hoglin|piglin_brute|warden)$/.test(e.name || '');
  }

  /** Кто приближается или уходит (за 1-3 с): «zombie приближается сзади, 8 бл.». */
  motion() {
    const out = [];
    for (const t of (this.tracks || new Map()).values()) {
      if (!t.kind || t.prevD === undefined || t.at === t.prevAt) continue;
      const dd = t.d - t.prevD, secs = Math.max(0.5, (t.at - t.prevAt) / 1000), v = dd / secs;
      const side = this.sideOf ? this.sideOf(t.pos) : '';
      if (t.kind === 'enemy' && v < -0.6 && t.d < 20) out.push({ w: 3 - t.d / 10 - (t.seen === false ? 1 : 0), text: `${t.name} приближается ${side}${t.seen === false ? ' (за стеной, не вижу)' : ''}, ${Math.round(t.d)} бл.` });
      else if (t.kind === 'player' && Math.abs(v) > 1.5 && t.d < 32) out.push({ w: 1, text: `${t.name} ${v < 0 ? 'идёт к тебе' : 'уходит'} ${side}, ${Math.round(t.d)} бл.` });
    }
    return out.sort((a, c) => c.w - a.w).slice(0, 3).map((x) => x.text);
  }

  /**
   * Угроза одним словом (как цвет точек на радаре): враги рядом с весом по виду и близости, ночь, здоровье.
   * «спокойно» / «осторожно» / «опасно» - тело и мозг решают по нему, а не по списку мобов.
   */
  threat() {
    const b = this.bot;
    if (!b || !b.entity) return { level: 'спокойно', score: 0 };
    const W = { creeper: 4, warden: 10, witch: 3, skeleton: 2, stray: 2, pillager: 2, vindicator: 3, evoker: 4, ravager: 6, blaze: 3, ghast: 3, wither_skeleton: 3, piglin_brute: 4, enderman: 1 };
    let score = 0;
    for (const t of (this.tracks || new Map()).values()) {
      if (t.kind !== 'enemy' || t.d > 24) continue;
      score += (W[t.name] || 1.5) * (t.d < 6 ? 2 : t.d < 12 ? 1 : 0.4) * (t.prevD !== undefined && t.d < t.prevD - 0.5 ? 1.3 : 1) * (t.seen === false && t.d > 6 ? 0.35 : 1);
    }
    const tod = b.time && b.time.timeOfDay, night = tod !== undefined && tod > 13000 && tod < 23000;
    if (night && /overworld/.test(b.game.dimension || '')) score += 1;
    if (b.health <= 8) score *= 1.6;
    return { level: score >= 8 ? 'опасно' : score >= 3 ? 'осторожно' : 'спокойно', score: Math.round(score * 10) / 10 };
  }

  /** Короткая память о живом: кто пропал из виду недавно и где был. */
  recentLive() {
    const now = Date.now(), out = [];
    for (const m of (this.memoryLive || new Map()).values()) {
      if (!m.gone) continue;
      const mins = Math.round((now - m.at) / 60000);
      const go = Math.hypot(m.vx || 0, m.vz || 0) > 0.8 ? ', шёл на ' + (Math.abs(m.vx) > Math.abs(m.vz) ? (m.vx > 0 ? 'восток' : 'запад') : (m.vz > 0 ? 'юг' : 'север')) : '';
      out.push(`${m.name} ${m.kind === 'enemy' ? '(враг) ' : ''}был у ${Math.floor(m.pos.x)} ${Math.floor(m.pos.y)} ${Math.floor(m.pos.z)}${go} ${mins ? mins + ' мин назад' : 'только что'}`);
    }
    return out.slice(-4);
  }

  /** Для мозга одной строкой: угроза, движение, недавно видела. */
  senseText() {
    const th = this.threat(), mv = this.motion(), rl = this.recentLive();
    const parts = [];
    if (th.level !== 'спокойно') parts.push(`обстановка: ${th.level}`);
    if (mv.length) parts.push(mv.join('; '));
    if (rl.length) parts.push('недавно видела: ' + rl.join('; '));
    return parts.join('; ');
  }
}

module.exports = { Senses };
