// Зоны: куда нельзя и где опасно (22.11, владелец: «если сказал не ходить - значит не ходить туда, область; и опасные
// места пусть запоминает, а то умирала и опять пёрлась»). Она 4 раза погибла у Главного замка: хозяин поставил там
// блейзов и таблички «вход запрещён», сказал ей не ходить - а «ворота» легли обычным местом, смерть помнилась сутки
// на 5 блоков, и путь снова вёл туда к жителям.
//
// Зона - круг на карте (x, z, радиус) в измерении:
//   запрет - путь не заходит совсем (клетка непроходима), туда не ведёт ни одно дело, жители внутри не в счёт.
//            Ставит хозяин словами («сюда не ходи», «туда нельзя» - туда, куда он смотрит), командой мозга, табличка
//            «вход запрещён» (её зона - за табличкой), вторая смерть рядом с опасным местом.
//   опасно - путь обходит, если можно (дорого), дела туда идут, но мозг знает. Ставит смерть (7 дней) и блейз в
//            обычном мире (их там ставят как охрану).
// Снимает только хозяин («сюда можно», !allowArea). Внутри зоны (зашла до запрета) - выйти можно, вглубь - нет.
const NO_SIGN = /вход\s*запрещ|не\s*входить|не\s*заходить|запрещено|закрыт(ая|о)?\s*территори|посторонним|no\s*entry|keep\s*out|охраня/i;

class Zones {
  zones() {
    const m = this.memory;
    if (!m) return [];
    if (!m.data.zones) {
      // перенос старого: смерти (danger) и места со словами «нельзя/запрет» - в зоны
      m.data.zones = [];
      for (const d of m.data.danger || []) m.data.zones.push({ kind: 'опасно', name: `погибла ${new Date(d.at).toLocaleDateString('ru-RU')}`, x: d.x, y: d.y, z: d.z, r: 8, dim: d.dim, by: 'смерть', at: d.at, until: d.at + 7 * 86400000, deaths: 1 });
      for (const p of Object.values(m.data.places || {})) if (/нельзя|чуж|не заход|запрет/i.test(p.name + ' ' + (p.note || ''))) m.data.zones.push({ kind: 'запрет', name: p.name, x: p.x, y: p.y, z: p.z, r: 16, dim: p.dim, by: p.by || 'место', at: p.at || Date.now() });
      m.save();
    }
    const now = Date.now();
    const Z = m.data.zones;
    for (let i = Z.length - 1; i >= 0; i--) if (Z[i].until && now > Z[i].until) Z.splice(i, 1);
    return Z;
  }

  /** Зона в точке (самая строгая): запрет важнее опасности. */
  zoneAt(x, z, dim = this.dimName()) {
    let best = null;
    for (const q of this.zones()) {
      if (q.kind === 'можно') continue;
      if (q.dim !== dim || Math.hypot(q.x - x, q.z - z) > q.r) continue;
      if (!best || (q.kind === 'запрет' && best.kind !== 'запрет')) best = q;
    }
    return best;
  }

  /** Добавить или расширить зону (рядом такая же - объединить, а не плодить). */
  addZone(z) {
    const Z = this.zones(), dim = z.dim || this.dimName();
    // хозяин сказал «тут можно» - сама (таблички, блейзы, смерть) тут зону не ставит
    if (z.by !== 'хозяин' && z.kind !== 'можно' && Z.some((q) => q.kind === 'можно' && q.dim === dim && Math.hypot(q.x - z.x, q.z - z.z) <= q.r)) return null;
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
      if ((name && q.name.toLowerCase().includes(String(name).toLowerCase())) || (x !== undefined && q.dim === dim && Math.hypot(q.x - x, q.z - z) <= q.r)) Z.splice(i, 1);
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

  /** Действие zone: { on: true|false, name, radius, there, who } - от хозяина. */
  zoneAct(a) {
    const who = a.who || this.followName || (this.opts.masters || [])[0];
    const p = (a.x !== undefined && a.z !== undefined) ? { x: +a.x, y: +(a.y ?? 64), z: +a.z } : this.ownerAim(who, a.there) || this.bot.entity.position.floored();
    if (a.on === false) {
      const n = this.removeZone(a.name ? { name: a.name } : { x: p.x, z: p.z });
      if (!a.name) this.addZone({ kind: 'можно', name: 'хозяин разрешил', x: p.x, y: p.y, z: p.z, r: 16, by: 'хозяин' });
      return n ? `сняла запрет (${n} зон${n > 1 ? 'ы' : 'а'})` : 'тут запретной зоны нет';
    }
    const q = this.addZone({ kind: 'запрет', name: a.name || 'запретная зона', x: p.x, y: p.y, z: p.z, r: +a.radius || 16, by: 'хозяин' });
    // уже внутри - выйти
    const me = this.bot.entity.position;
    if (Math.hypot(me.x - q.x, me.z - q.z) <= q.r) this._leaveZone = q;
    return `запомнила запретную зону «${q.name}»: ${q.x} ${q.z}, радиус ${q.r} - туда не хожу`;
  }

  /** Смерть: опасное место; вторая смерть рядом за неделю - запрет. */
  zoneDeath(pt) {
    if (!this.memory) return;
    const dim = this.dimName(), b = this.bot;
    const foes = [...new Set(Object.values(b.entities).filter((e) => e.position && e !== b.entity && this.guard && this.guard.isHostile && this.guard.isHostile(e) && e.position.distanceTo(b.entity.position) < 16).map((e) => e.name))];
    const old = this.zones().find((q) => q.dim === dim && q.kind === 'опасно' && Math.hypot(q.x - pt.x, q.z - pt.z) < q.r + 12);
    if (old) {
      old.deaths = (old.deaths || 1) + 1;
      this.addZone({ kind: 'запрет', name: `погибала тут ${old.deaths} раза${foes.length ? ' (' + foes.join(', ') + ')' : ''}`, x: (old.x + pt.x) / 2, y: pt.y, z: (old.z + pt.z) / 2, r: Math.max(12, old.r + 4), by: 'смерть' });
      return;
    }
    this.addZone({ kind: 'опасно', name: `погибла тут${foes.length ? ' (' + foes.join(', ') + ')' : ''}`, x: pt.x, y: pt.y, z: pt.z, r: 8, by: 'смерть', until: Date.now() + 7 * 86400000 });
  }

  /** Раз в 5 с: таблички «вход запрещён», блейзы в обычном мире, выход из зоны, если оказалась внутри. */
  zonesTick() {
    const b = this.bot;
    if (!b || !b.entity || !this.memory) return;
    const me = b.entity.position, now = Date.now();
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
    return near.map((q) => `${q.kind === 'запрет' ? 'НЕЛЬЗЯ' : 'опасно'}: «${q.name}» ${q.x} ${q.z} r${q.r}`).join('; ');
  }
}

module.exports = { Zones, NO_SIGN };
