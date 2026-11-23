// Метки по ситуации (как опытный игрок ставит путевые точки сам, не дожидаясь просьбы): где полезно потом -
// ресурсы, путь, свои вещи, люди, опасность. Временные сами истекают, одинаковые рядом сливаются (memory.mark),
// места от хозяина не вытесняются. Находки по карте (деревня, спавнер...) ставит worldmap, смерть - bot.js.
const HERDS = { sheep: 'овцы', cow: 'коровы', pig: 'свиньи', chicken: 'куры', horse: 'лошади', goat: 'козы', rabbit: 'кролики', bee: 'пчёлы' };
const DAY = 86400000;

class Marks {
  /** Отметить место (обёртка memory.mark с журналом). */
  autoMark(name, pos, opt = {}) {
    if (!this.memory || !pos) return '';
    const r = this.memory.mark({ name, x: pos.x, y: pos.y, z: pos.z, dim: opt.dim || this.dimName(), note: opt.note, kind: opt.kind || name, radius: opt.radius, ttl: opt.ttl, one: opt.one }, this.opts.name);
    if (r) this.log('метка: ' + r);
    return r;
  }

  /** Раз в 5 с: стада рядом, вход в пещеру. */
  marksTick() {
    const b = this.bot;
    if (!b || !b.entity || !this.memory) return;
    this._mk = (this._mk || 0) + 1;
    if (this._mk % 5) return;
    // один раз: убрать «входы в пещеру», поставленные до 22.11 по ошибке (высокая постройка в чанке = «под землёй»)
    if (!(this.memory.data.migr || {}).cave22) {
      this.memory.data.migr = { ...(this.memory.data.migr || {}), cave22: 1 };
      for (const [k, pl] of Object.entries(this.memory.data.places || {})) if (pl.kind === 'вход в пещеру' || pl.name === 'вход в пещеру') delete this.memory.data.places[k];
      this.memory.save();
    }
    const me = b.entity.position;
    // стадо: 3+ одинаковых животных в 24 бл. - «овцы» (на 2 дня): знать, куда идти за шерстью и едой
    const cnt = {};
    for (const e of Object.values(b.entities)) if (HERDS[e.name] && e.position && e.position.distanceTo(me) < 24) { const c = (cnt[e.name] = cnt[e.name] || { n: 0, x: 0, y: 0, z: 0 }); c.n++; c.x += e.position.x; c.y += e.position.y; c.z += e.position.z; }
    for (const [k, c] of Object.entries(cnt)) if (c.n >= 3) this.autoMark(HERDS[k], { x: c.x / c.n, y: c.y / c.n, z: c.z / c.n }, { kind: 'стадо ' + k, radius: 64, ttl: 2 * DAY, note: `видела ${c.n}` });
    // вход в пещеру: был на поверхности - стал под землёй (неделя): выход наверх
    let under = '';
    try { under = this.worldMap ? this.worldMap.layerMode(this) : ''; } catch {}
    if (under && /подземный/.test(under) && this._surfacePos && this._surfacePos.y - me.y >= 4 && me.distanceTo(this._surfacePos) < 40) this.autoMark('вход в пещеру', this._surfacePos, { kind: 'вход в пещеру', radius: 24, ttl: 7 * DAY });
    if (!under && b.entity.onGround) this._surfacePos = me.clone();
  }

  /**
   * Факелы, как игрок в шахте: под землёй, в диком месте (не в городе, не у чужих построек), темно и факелы
   * есть - поставить на пол рядом, если ближайший свой факел дальше 12 блоков. Не чаще раза в 8 с, не в бою.
   */
  async torchTick() {
    const b = this.bot;
    if (!b || !b.entity || this.paused || (this.guard && this.guard.fighting) || this.busyLook || b.isSleeping) return;
    if (Date.now() - (this._torchAt || 0) < 8000) return;
    const torch = b.inventory.items().find((i) => i.name === 'torch');
    if (!torch || !this.worldMap) return;
    let under = ''; try { under = this.worldMap.layerMode(this); } catch {}
    if (!/подземный/.test(under)) return;
    let town = false; try { town = this.worldMap.settlements(this, 64).some((s) => s.inside); } catch {}
    if (town || (this.skills && this.skills.builtNear(b.entity.position.floored(), 4))) return;
    let dark = ''; try { dark = this.darkness(); } catch {}
    if (!dark) return;
    const me = b.entity.position;
    this.myTorches = (this.myTorches || []).filter((t) => Math.hypot(t.x - me.x, t.y - me.y, t.z - me.z) < 64);
    if (this.myTorches.some((t) => Math.hypot(t.x - me.x, t.y - me.y, t.z - me.z) < 12)) return;
    if (b.findBlock({ matching: (bl) => /torch|lantern|glowstone|shroomlight/.test(bl.name), maxDistance: 10 })) return;   // свет уже есть
    this._torchAt = Date.now();
    const { Vec3 } = require('vec3'), p = me.floored();
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at = b.blockAt(p.offset(dx, 0, dz)), floor = b.blockAt(p.offset(dx, -1, dz));
      if (!at || !floor || at.name !== 'air' && at.name !== 'cave_air' || floor.boundingBox !== 'block') continue;
      if (dx === 0 && dz === 0 && b.pathfinder.isMoving()) continue;   // под себя - только стоя
      this.busyLook = true;
      try {
        const held = b.heldItem;
        await b.equip(torch, 'hand');
        await b.placeBlock(floor, new Vec3(0, 1, 0));
        this.myTorches.push(p.offset(dx, 0, dz));
        this.log(`поставлено: факел у ${p.x + dx} ${p.y} ${p.z + dz} (темно)`);
        if (held && held.name !== 'torch') await b.equip(held, 'hand').catch(() => {});
      } catch {} finally { this.busyLook = false; }
      return;
    }
  }

  /**
   * Слова хозяина без координат: «запомни это место как склад», «это мой склад», «тут ферма», «отметь: шахта».
   * Место - где стоит хозяин (если видно), иначе где бот. Возвращает имя или ''.
   */
  markFromWords(text, from) {
    const t = String(text || '').trim().replace(/[.!]+$/, '');
    if (/\d/.test(t)) return '';   // с координатами - chatpoints
    let m = /^(?:запомни|запиши|отметь)[:,]?\s+(?:(?:это|тут|здесь)\s+)?(?:место\s*)?(?:как\s+)?[«"]?([^»"]{2,40})[»"]?$/i.exec(t);
    let name = m && m[1] && !/^место$/i.test(m[1]) ? m[1] : '';
    if (!name) { m = /^(?:это|тут|здесь)\s+(?:будет\s+)?((?:мой|моя|моё|мое|наш|наша|наше|наши|мои)\s+.{2,36})$/i.exec(t); if (m) name = m[1]; }
    if (!name && /^(?:запомни|отметь)\s+(?:это\s+)?место$/i.test(t)) name = 'место от ' + from;
    if (!name) return '';
    const e = this.player(from);
    const pos = e && e.position.distanceTo(this.bot.entity.position) < 64 ? e.position : this.bot.entity.position;
    const r = this.memory.place({ name, x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dim: this.dimName(), note: 'хозяин показал' }, `${this.opts.name} (со слов ${from})`);
    this.log('метка со слов хозяина: ' + r);
    return r;
  }
}

module.exports = { Marks, HERDS };
