// Зоны: куда нельзя и где опасно (22.11, владелец: «если сказал не ходить - значит не ходить туда, область; и опасные
// места пусть запоминает, а то умирала и опять пёрлась»). Она 4 раза погибла у Главного замка: хозяин поставил там
// блейзов и таблички «вход запрещён», сказал ей не ходить - а «ворота» легли обычным местом, смерть помнилась сутки
// на 5 блоков, и путь снова вёл туда к жителям.
//
// Зона - круг на карте (x, z, радиус) в измерении:
//   запрет - путь не заходит совсем (клетка непроходима), туда не ведёт ни одно дело, жители внутри не в счёт.
//            Ставит хозяин словами («сюда не ходи», «туда нельзя» - туда, куда он смотрит), командой мозга, табличка
//            «вход запрещён» (её зона - за табличкой). Смерти - только «опасно».
//   опасно - путь обходит, если можно (дорого), дела туда идут, но мозг знает. Ставит смерть (7 дней) и блейз в
//            обычном мире (их там ставят как охрану).
// Снимает только хозяин («сюда можно», !allowArea). Внутри зоны (зашла до запрета) - выйти можно, вглубь - нет.
// только запрет ВХОДА: «запрещено воровство, PvP» на спавне - правила сервера, а не закрытая территория (22.11: бот
// закрыл себе площадь у спавна и всё время «выходил» из неё, а не шёл за хозяином)
const NO_SIGN = /вход\s*(строго\s*)?запрещ|не\s*входить|не\s*заходить|посторонним|закрыт(ая|о)\s*территори|без\s*спроса\s*не\s*входить|no\s*entry|keep\s*out|private\s*property/i;

// постройка: блоки, которых в природе нет (стены, полы, заборы); пашня и рельсы - нет (поле рядом с замком - не замок)
const BUILT = /(_planks|_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|glass|glass_pane|bricks|_brick|_wool|_carpet|_concrete|terracotta|_wall|bookshelf|lantern|torch|barrel|chest|_bed|ladder|polished_|smooth_|chiseled_|cut_|quartz_block|quartz_pillar|iron_bars|chain|_banner|stripped_|cobblestone|purpur|prismarine|_copper|copper_|tuff_bricks|mud_bricks|end_stone_bricks|blackstone_bricks|sea_lantern|spawner|_bars)$/;

/** Выпуклая оболочка точек [x, z] (монотонная цепь). */
function hull(pts) {
  const P = [...new Map(pts.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

class Zones {
  /**
   * Постройка вокруг точки (22.11, владелец: «если это здание - пусть именно как постройку определит»): столбцы, где
   * есть строительные блоки (от земли до +24), связанные между собой (щели до 2 бл. - одна постройка), до 64 бл.
   * Возвращает { poly (оболочка + 3 бл. запаса), cols, w, d } или null, если это не постройка (меньше 12 столбцов).
   */
  structureAt(p0) {
    const b = this.bot, V = b.entity.position.constructor;
    const y0 = Math.floor(p0.y);
    const colBuilt = new Map();
    const built = (x, z) => {
      const k = x + ',' + z;
      if (colBuilt.has(k)) return colBuilt.get(k);
      let r = false;
      for (let y = y0 - 4; y <= y0 + 24 && !r; y++) { const bl = b.blockAt(new V(x, y, z), false); if (bl === null) break; if (bl && BUILT.test(bl.name)) r = true; }
      colBuilt.set(k, r); return r;
    };
    // старт: ближайший строительный столбец в 4 бл. от точки
    let start = null;
    for (let r = 0; r <= 4 && !start; r++) for (let dx = -r; dx <= r && !start; dx++) for (const dz of [-r, r]) { if (built(Math.floor(p0.x) + dx, Math.floor(p0.z) + dz)) { start = [Math.floor(p0.x) + dx, Math.floor(p0.z) + dz]; break; } }
    if (!start) for (let r = 1; r <= 4 && !start; r++) for (let dz = -r; dz <= r && !start; dz++) for (const dx of [-r, r]) { if (built(Math.floor(p0.x) + dx, Math.floor(p0.z) + dz)) { start = [Math.floor(p0.x) + dx, Math.floor(p0.z) + dz]; break; } }
    if (!start) return null;
    const seen = new Set([start.join(',')]), q = [start], cols = [];
    while (q.length && cols.length < 6000) {
      const [x, z] = q.shift(); cols.push([x, z]);
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz, k = nx + ',' + nz;
        if (seen.has(k) || Math.hypot(nx - start[0], nz - start[1]) > 64) continue;
        seen.add(k);
        if (built(nx, nz)) q.push([nx, nz]);
      }
    }
    if (cols.length < 12) return null;
    const h = hull(cols.flatMap(([x, z]) => [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]));
    const cx = h.reduce((a, p) => a + p[0], 0) / h.length, cz = h.reduce((a, p) => a + p[1], 0) / h.length;
    const poly = h.map(([x, z]) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x + (x - cx) / d * 3, z + (z - cz) / d * 3]; });
    const xs = cols.map((c) => c[0]), zs = cols.map((c) => c[1]);
    return { poly, cols: cols.length, w: Math.max(...xs) - Math.min(...xs) + 1, d: Math.max(...zs) - Math.min(...zs) + 1 };
  }

  zones() {
    const m = this.memory;
    if (!m) return [];
    if (!m.data.zones) {
      // перенос старого: смерти (danger) и места со словами «нельзя/запрет» - в зоны
      m.data.zones = [];
      for (const d of m.data.danger || []) m.data.zones.push({ kind: 'опасно', name: `смерть ${new Date(d.at).toLocaleDateString('ru-RU')}`, x: d.x, y: d.y, z: d.z, r: 8, dim: d.dim, by: 'смерть', at: d.at, until: d.at + 7 * 86400000, deaths: 1 });
      for (const p of Object.values(m.data.places || {})) if (/нельзя|чуж|не заход|запрет/i.test(p.name + ' ' + (p.note || ''))) m.data.zones.push({ kind: 'запрет', name: p.name, x: p.x, y: p.y, z: p.z, r: 16, dim: p.dim, by: p.by || 'место', at: p.at || Date.now() });
      m.save();
    }
    const now = Date.now();
    const Z = m.data.zones;
    for (let i = Z.length - 1; i >= 0; i--) if ((Z[i].until && now > Z[i].until) || (Z[i].by === 'табличка' && !NO_SIGN.test(Z[i].name))) Z.splice(i, 1);
    for (const q of Z) if (q.by === 'смерть' && (q.kind === 'запрет' || !q.until || q.until - now > 2 * 86400000)) { q.kind = 'опасно'; q.until = Math.min(q.until || Infinity, now + 86400000); }   // прежние «запреты за смерти» - в «опасно»   // и табличные зоны по старому правилу
    return Z;
  }

  /** Точка в зоне: круг или многоугольник (граница, которую хозяин обошёл или задал углами). */
  zoneHas(q, x, z) {
    if (Math.hypot(q.x - x, q.z - z) > q.r) return false;
    if (!q.poly) return true;
    let inside = false;
    for (let i = 0, j = q.poly.length - 1; i < q.poly.length; j = i++) {
      const [xi, zi] = q.poly[i], [xj, zj] = q.poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Зона в точке (самая строгая): запрет важнее опасности. */
  zoneAt(x, z, dim = this.dimName()) {
    let best = null;
    for (const q of this.zones()) {
      if (q.kind === 'можно') continue;
      if (q.dim !== dim || !this.zoneHas(q, x, z)) continue;
      if (!best || (q.kind === 'запрет' && best.kind !== 'запрет')) best = q;
    }
    return best;
  }

  /** Добавить или расширить зону (рядом такая же - объединить, а не плодить). */
  addZone(z) {
    const Z = this.zones(), dim = z.dim || this.dimName();
    // хозяин сказал «тут можно» - сама (таблички, блейзы, смерть) тут зону не ставит
    if (z.by !== 'хозяин' && z.kind !== 'можно' && Z.some((q) => q.kind === 'можно' && q.dim === dim && this.zoneHas(q, z.x, z.z))) return null;
    if (z.poly) {   // граница точно по месту: не сливать с соседними кругами
      const cx = z.poly.reduce((a, p) => a + p[0], 0) / z.poly.length, cz = z.poly.reduce((a, p) => a + p[1], 0) / z.poly.length;
      const q = { kind: z.kind, name: String(z.name || (z.kind === 'запрет' ? 'запретная зона' : 'можно')).slice(0, 60), x: Math.round(cx), y: Math.round(z.y || 64), z: Math.round(cz), r: Math.ceil(Math.max(...z.poly.map((p) => Math.hypot(p[0] - cx, p[1] - cz)))) + 1, poly: z.poly.map((p) => [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2]), dim, by: z.by || '', at: Date.now() };
      Z.push(q); this.memory.save(); this._zonesVer = (this._zonesVer || 0) + 1;
      this.log(`зона: ${q.kind} «${q.name}» по границе из ${q.poly.length} точек, центр ${q.x} ${q.z}`);
      return q;
    }
    const near = Z.find((q) => q.dim === dim && q.kind === z.kind && Math.hypot(q.x - z.x, q.z - z.z) < Math.max(q.r, z.r));
    if (near) {
      near.r = Math.max(near.r, Math.round(Math.hypot(near.x - z.x, near.z - z.z) + z.r));
      if (z.name && near.by !== 'хозяин') near.name = z.name;
      if (z.by === 'хозяин') { near.by = 'хозяин'; delete near.until; }
      near.at = Date.now();
    } else Z.push({ kind: z.kind, name: String(z.name || (z.kind === 'запрет' ? 'запретная зона' : 'опасное место')).slice(0, 60), x: Math.round(z.x), y: Math.round(z.y || 64), z: Math.round(z.z), r: Math.max(4, Math.min(64, Math.round(z.r || 16))), dim, by: z.by || '', at: Date.now(), ...(z.until ? { until: z.until } : {}), ...(z.note ? { note: String(z.note).slice(0, 120) } : {}) });
    if (Z.length > 200) Z.splice(0, Z.length - 200);
    this.memory.save();
    this._zonesVer = (this._zonesVer || 0) + 1;
    const q = near || Z[Z.length - 1];
    this.log(`зона: ${q.kind} «${q.name}» ${q.x} ${q.z}, радиус ${q.r}`);
    return q;
  }

  /** Снять зону (только хозяин): по имени или в точке. */
  removeZone({ name, x, z }) {
    const Z = this.zones(), dim = this.dimName();
    const n0 = Z.length;
    for (let i = Z.length - 1; i >= 0; i--) {
      const q = Z[i];
      if ((name && q.name.toLowerCase().includes(String(name).toLowerCase())) || (x !== undefined && q.dim === dim && this.zoneHas(q, x, z))) Z.splice(i, 1);
    }
    if (Z.length !== n0) { this.memory.save(); this._zonesVer = (this._zonesVer || 0) + 1; }
    return n0 - Z.length;
  }

  /** Куда хозяин показывает взглядом (до 48 бл.), иначе где он стоит. */
  ownerAim(name, far) {
    const b = this.bot, pl = b.players[name], e = pl && pl.entity;
    if (!e) return null;
    if (far) {
      try {
        const eye = e.position.offset(0, 1.62, 0);
        const dir = { x: -Math.sin(e.yaw) * Math.cos(e.pitch), y: Math.sin(e.pitch), z: -Math.cos(e.yaw) * Math.cos(e.pitch) };
        const hit = b.world.raycast(eye, new (e.position.constructor)(dir.x, dir.y, dir.z), 48);
        if (hit && hit.position) return hit.position;
      } catch {}
    }
    return e.position.floored();
  }

  /**
   * Граница по месту (22.11, владелец: «рядом территория ок, а чуть подальше начинается не очень»): хозяин говорит
   * «отмечаю границу», обходит область по краю (или встаёт в углы и говорит «угол»), потом «готово». Обход - точки
   * каждые 2 бл. его шагов; два угла - прямоугольник; три и больше - многоугольник.
   */
  zoneDraw(a, who) {
    const D = this._draw;
    if (a.draw === 'start') {
      this._draw = { who, kind: a.on === false ? 'можно' : 'запрет', name: a.name || '', pts: [], corners: [], at: Date.now() };
      const p = this.ownerAim(who, false); if (p) this._draw.pts.push([p.x + 0.5, p.z + 0.5]);
      return `отмечаю границу ${a.on === false ? 'разрешённой' : 'запретной'} зоны: обойди её по краю (или встань в углы и скажи «угол»), в конце скажи «готово»`;
    }
    if (!D) return 'границу сейчас не отмечаю - скажи «отмечаю границу»';
    const p = this.ownerAim(D.who, false);
    if (a.draw === 'corner') { if (p) D.corners.push([p.x + 0.5, p.z + 0.5]); return `угол ${D.corners.length} запомнила`; }
    if (a.draw === 'cancel') { this._draw = null; return 'границу не сохраняю'; }
    // готово
    this._draw = null;
    let poly = D.corners.length >= 3 ? D.corners : D.corners.length === 2 ? [[D.corners[0][0], D.corners[0][1]], [D.corners[1][0], D.corners[0][1]], [D.corners[1][0], D.corners[1][1]], [D.corners[0][0], D.corners[1][1]]] : D.pts;
    if (p && poly === D.pts) poly = poly.concat([[p.x + 0.5, p.z + 0.5]]);
    if (poly.length < 3) return 'мало точек: обойди область по краю или отметь хотя бы 2 угла';
    const area = Math.abs(poly.reduce((s, q, i) => { const n = poly[(i + 1) % poly.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
    if (area < 4) return 'область получилась слишком маленькой - обойди её по краю ещё раз';
    if (D.kind === 'можно') for (const q of this.zones().filter((q) => q.kind !== 'можно' && poly.some((pt) => this.zoneHas(q, pt[0], pt[1])))) this.removeZone({ name: q.name });
    const q = this.addZone({ kind: D.kind, name: a.name || D.name || (D.kind === 'запрет' ? 'запретная зона' : 'хозяин разрешил'), poly, y: p ? p.y : 64, by: 'хозяин' });
    return `${D.kind === 'запрет' ? 'запретная' : 'разрешённая'} зона «${q.name}» сохранена по границе: ${poly.length} точек, около ${Math.round(area)} кв. бл.`;
  }

  /** Действие zone: { on: true|false, name, radius, there, who, draw } - от хозяина. */
  zoneAct(a) {
    const who = a.who || this.followName || (this.opts.masters || [])[0];
    if (a.draw) return this.zoneDraw(a, who);
    const p = (a.x !== undefined && a.z !== undefined) ? { x: +a.x, y: +(a.y ?? 64), z: +a.z } : this.ownerAim(who, a.there) || this.bot.entity.position.floored();
    if (a.on === false) {
      const n = this.removeZone(a.name ? { name: a.name } : { x: p.x, z: p.z });
      if (!a.name) this.addZone({ kind: 'можно', name: 'хозяин разрешил', x: p.x, y: p.y, z: p.z, r: 16, by: 'хозяин' });
      return n ? `сняла запрет (${n} зон${n > 1 ? 'ы' : 'а'})` : 'тут запретной зоны нет';
    }
    // «туда» - а взгляд никуда не попал (небо, дальше 48 бл.): спросить, а не ставить наугад
    if (a.there && a.x === undefined && !this.ownerAimHit(who)) return this.zoneAsk(who, a.name);
    return this.zonePlace({ x: p.x, y: p.y, z: p.z }, a.name, +a.radius || 0);
  }

  /** Поставить запрет в точке: постройка - по её стенам с запасом 3 бл., иначе круг. */
  zonePlace(p, name, radius) {
    this._zoneAsk = null;
    const st = this.structureAt(p);   // постройка - всегда по стенам; радиус - только для открытого места
    let q;
    if (st) q = this.addZone({ kind: 'запрет', name: name || 'постройка', poly: st.poly, y: p.y, by: 'хозяин' });
    else q = this.addZone({ kind: 'запрет', name: name || 'запретная зона', x: p.x, y: p.y, z: p.z, r: radius || 16, by: 'хозяин' });
    return st ? `запомнила: «${q.name}» - постройка ${st.w}x${st.d} бл. у ${q.x} ${q.z}, по стенам и 3 бл. вокруг - туда не хожу` : `запомнила запретную зону «${q.name}»: ${q.x} ${q.z}, радиус ${q.r} - туда не хожу`;
  }

  ownerAimHit(name) {
    const e = this.bot.players[name] && this.bot.players[name].entity;
    if (!e) return null;
    const p = this.ownerAim(name, true);
    return p && p.distanceTo && p.distanceTo(e.position) > 2 ? p : null;
  }

  /** Не поняла, где: спросить. Ответ - жест (ударить по блоку, глядя туда; прыжки или присед, глядя туда) или координаты в чате. */
  zoneAsk(who, name) {
    this._zoneAsk = { who, name: name || '', at: Date.now() };
    return 'покажи, где нельзя: посмотри туда и ударь рукой (или попрыгай, глядя туда), или напиши координаты, например «300 -610»';
  }

  /** Ответ на вопрос «где»: жест хозяина или координаты. true - зона поставлена. */
  zoneAnswer(from, { at, text } = {}) {
    const A = this._zoneAsk;
    if (!A || from !== A.who || Date.now() - A.at > 120000) return '';
    let p = at || null;
    if (!p && text) { const m = /(-?\d{1,6})[ ,;]+(-?\d{1,3}[ ,;]+)?(-?\d{1,6})/.exec(text); if (m) { const y = m[2] ? parseInt(m[2]) : (this.bot.entity.position.y); p = { x: +m[1], y, z: +m[3] }; } }
    if (!p && !text) p = this.ownerAimHit(from);
    if (!p) return '';
    return this.zonePlace({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, A.name, 0);
  }

  /**
   * Смерть: опасно, только если убило что-то снаружи - моб, лава, огонь, взрыв, ловушка, магма, кактус, порошковый
   * снег (22.11, владелец: «если умер из-за херни - не факт, что опасность, может это он тупой»). Утонул, задохнулся
   * в стене, разбился, умер с голоду - своя ошибка: зону не ставить, только в журнал. Зона на сутки, повтор - на двое.
   */
  zoneDeath(pt, msg = '') {
    if (!this.memory) return;
    const dim = this.dimName(), b = this.bot, m = String(msg).replace(this.opts.name, '').trim();
    const OWN = /drown|suffocat|starv|hit the ground|fell from|fell off|fell out of the world|experienced kinetic|squash|died$|^died|утонул|задохнул|разбил|упал|голод/i;
    const REAL = /slain|shot|blown up|blew up|burn|flames|lava|fire|magma|hot floor|pricked|cactus|stung|frozen|powder snow|fireball|magic|wither|killed|impaled|squished|sonic|stalagmite|stalactite|anvil|trident|убит|застрел|взорв|сгорел|лав|огн/i;
    const foes = [...new Set(Object.values(b.entities).filter((e) => e.position && e !== b.entity && this.guard && this.guard.isHostile && this.guard.isHostile(e) && e.position.distanceTo(b.entity.position) < 16).map((e) => e.name))];
    const real = m ? REAL.test(m) && !OWN.test(m) : foes.length > 0;
    if (!real) { this.log(`смерть ${m ? '(«' + m + '»)' : ''} - своя ошибка, а не опасность места: зону не ставлю`); return; }
    const why = m || foes.join(', ');
    const old = this.zones().find((q) => q.dim === dim && q.kind === 'опасно' && Math.hypot(q.x - pt.x, q.z - pt.z) < q.r + 8);
    if (old) {
      old.deaths = (old.deaths || 1) + 1;
      old.name = `место смерти, ${old.deaths} раза (${why})`.slice(0, 60);
      old.r = Math.min(12, old.r + 2); old.until = Date.now() + 2 * 86400000; old.at = Date.now();
      this.memory.save(); this.log(`зона: опасно «${old.name}» ${old.x} ${old.z}, радиус ${old.r}`);
      return;
    }
    this.addZone({ kind: 'опасно', name: `место смерти (${why})`.slice(0, 60), x: pt.x, y: pt.y, z: pt.z, r: 8, by: 'смерть', until: Date.now() + 86400000 });
  }

  /** Раз в 5 с: таблички «вход запрещён», блейзы в обычном мире, выход из зоны, если оказалась внутри. */
  zonesTick() {
    const b = this.bot;
    if (!b || !b.entity || !this.memory) return;
    const me = b.entity.position, now = Date.now();
    // хозяин обходит границу - точка каждые 2 бл. его шагов (5 мин максимум)
    if (this._draw) {
      const D = this._draw, p = this.ownerAim(D.who, false);
      if (now - D.at > 300000) { this._draw = null; this.log('граница: 5 мин без «готово» - не сохраняю'); }
      else if (p) { const l = D.pts[D.pts.length - 1]; if (!l || Math.hypot(l[0] - p.x - 0.5, l[1] - p.z - 0.5) >= 2) { D.pts.push([p.x + 0.5, p.z + 0.5]); if (D.pts.length > 400) D.pts.splice(1, 1); } }
    }
    // места, записанные под водой (тело тогда было в воде), - не место: убрать (раз в минуту, видимые чанки)
    if (now - (this._placeChkAt || 0) > 60000) {
      this._placeChkAt = now;
      try {
        const P = this.memory.data.places || {}, V = me.constructor;
        // метки из чата с мусорным именем - почистить или убрать (раз в минуту, все)
        const { cleanName } = require('./chatpoints');
        for (const [k, pl] of Object.entries(P)) {
          if (!/из чата/.test(pl.by || '')) continue;
          const n = cleanName(pl.name);
          if (!n) { delete P[k]; this.memory.save(); this.log(`метка «${pl.name}» - не название места, убрала`); }
          else if (n !== pl.name && !P[n.toLowerCase()]) { delete P[k]; P[n.toLowerCase()] = { ...pl, name: n }; this.memory.save(); this.log(`метка «${pl.name}» -> «${n}»`); }
        }
        for (const [k, pl] of Object.entries(P)) {
          if (pl.dim !== this.dimName() || Math.hypot(pl.x - me.x, pl.z - me.z) > 64) continue;
          const a = b.blockAt(new V(pl.x, pl.y, pl.z)), c = b.blockAt(new V(pl.x, pl.y + 1, pl.z));
          if (a && c && /water/.test(a.name) && /water/.test(c.name)) { delete P[k]; this.memory.save(); this.log(`место «${pl.name}» было под водой - убрала из памяти`); }
        }
      } catch {}
    }
    if (now - (this._zoneScanAt || 0) > 5000) {
      this._zoneScanAt = now;
      // таблички: зона - за табличкой (по ту сторону, куда она смотрит от бота), радиус 12
      try {
        const signs = b.findBlocks({ point: me, matching: (bl) => /_sign$/.test(bl.name), maxDistance: 16, count: 20 });
        const seen = (this._signSeen = this._signSeen || new Set());
        for (const v of signs) {
          const k = `${v.x},${v.y},${v.z}`;
          if (seen.has(k)) continue;
          seen.add(k);
          let t = '';
          try { const st = b.blockAt(v).getSignText(); t = (Array.isArray(st) ? st : [st]).join(' '); } catch {}
          if (!NO_SIGN.test(t)) continue;
          if (this.zoneAt(v.x, v.z) && this.zoneAt(v.x, v.z).kind === 'запрет') continue;
          const dx = v.x + 0.5 - me.x, dz = v.z + 0.5 - me.z, d = Math.hypot(dx, dz) || 1;
          this.addZone({ kind: 'запрет', name: `табличка «${t.replace(/\s+/g, ' ').trim().slice(0, 40)}»`, x: v.x + dx / d * 7, y: v.y, z: v.z + dz / d * 7, r: 8, by: 'табличка' });
        }
      } catch {}
      // блейзы в обычном мире - охрана, их ставят нарочно: опасно на 16 бл.
      if (/overworld/.test(b.game.dimension || '')) {
        for (const e of Object.values(b.entities)) {
          if (e.name !== 'blaze' || !e.position || e.position.distanceTo(me) > 40) continue;
          const z = this.zoneAt(e.position.x, e.position.z);
          if (!z) this.addZone({ kind: 'опасно', name: 'блейзы (охрана)', x: e.position.x, y: e.position.y, z: e.position.z, r: 16, by: 'увидела' });
        }
      }
    }
    // оказалась в запретной зоне (зона появилась, когда была внутри) - выйти наружу, если ничем не занята
    const z = this.zoneAt(me.x, me.z);
    if (z && z.kind === 'запрет' && this.mode !== 'task' && !this._leaving && now - (this._leaveAt || 0) > 8000) {
      this._leaveAt = now; this._leaving = true;
      const dx = me.x - z.x, dz = me.z - z.z, d = Math.hypot(dx, dz) || 1;
      const { goals } = require('mineflayer-pathfinder');
      this.log(`я в запретной зоне «${z.name}» - выхожу`);
      this.goto(new goals.GoalNearXZ(z.x + dx / d * (z.r + 3), z.z + dz / d * (z.r + 3), 2), this.token, 30000).catch(() => {}).finally(() => { this._leaving = false; if (this.mode === 'follow' && this.followName) this.follow(this.followName); });
    }
  }

  /** Цена шага для пути: запрет - нельзя (100 = клетка закрыта), опасно - дорого. Внутри запрета - только наружу. */
  zoneCost(x, z) {
    const q = this.zoneAt(x, z);
    if (!q) return 0;
    if (q.kind === 'опасно') return 20;
    const me = this.bot.entity.position;
    if (Math.hypot(me.x - q.x, me.z - q.z) <= q.r) return Math.hypot(x - q.x, z - q.z) < Math.hypot(me.x - q.x, me.z - q.z) - 0.5 ? 100 : 5;   // внутри: вглубь нельзя
    return 100;
  }

  /** Цель внутри запретной зоны - отказ с понятной причиной. */
  zoneGuard(x, z) {
    if (x === undefined || x === null || z === undefined) return;
    const q = this.zoneAt(x, z);
    if (q && q.kind === 'запрет') throw new Error(`туда нельзя: запретная зона «${q.name}» (${q.x} ${q.z}, радиус ${q.r}) - выбери другое место`);
  }

  /** Мозгу: зоны рядом (до 160 бл.). */
  zonesText() {
    const b = this.bot;
    if (!b || !b.entity) return '';
    const me = b.entity.position, dim = this.dimName();
    const near = this.zones().filter((q) => q.kind !== 'можно' && q.dim === dim && Math.hypot(q.x - me.x, q.z - me.z) < 160 + q.r).slice(0, 8);
    if (!near.length) return '';
    return near.map((q) => `${q.kind === 'запрет' ? 'НЕЛЬЗЯ' : 'опасно'}: «${q.name}» ${q.poly ? `область по границе вокруг ${q.x} ${q.z}` : `${q.x} ${q.z} r${q.r}`}`).join('; ');
  }
}

module.exports = { Zones, NO_SIGN };
