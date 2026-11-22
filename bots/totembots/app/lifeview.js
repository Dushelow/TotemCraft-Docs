// Жизнь бота для наблюдения (вкладка «Жизнь» в панели, 22.11: «как за тамагочи, как РПГ, которая сама в себя играет»).
// По образцу мобильных «наблюдалок» (Tsuki Adventure, Iris's Idle Log, CharaDiary): портрет со скином, нужды и
// настроение, что делает сейчас, мысли, дневник, который пишется сам из её дел, отношения к людям и счётчики жизни.
// Ничего не спрашивает у нейросети: всё из тела и журнала.
//
// Тихий режим: бот не пишет в общий и ближний чат (реплики, ответы, комментарии) - только личка хозяину, если он
// написал в личку. Жесты и дела остаются. Включается в панели или словами хозяина «тихо» / «можешь говорить».

// строка журнала -> запись дневника [значок, текст] (или null - в дневник не нужно)
const DIARY = [
  [/^сама: (.+)/, (m) => ['sparkles', m[1]]],
  [/^жест: (\S+) (.+)/, (m) => ['hand', `${m[1]} ${m[2]}`]],
  [/^села рядом(.*)/, (m) => ['house', 'присела рядом' + m[1].replace(/^ на /, ' на ')]],
  [/^у хозяина .* бросила ему (\S+)/, (m) => ['heart', `хозяину плохо - бросила ему ${m[1]}`]],
  [/^подарила хозяину (\S+)/, (m) => ['heart', `подарила хозяину ${m[1]}`]],
  [/^умер на (.+)/, (m) => ['skull', `погибла у ${m[1]}`]],
  [/^защищаюсь: (\S+)/, (m) => ['swords', `дерётся с ${m[1]}`]],
  [/^бой окончен/, () => ['shield', 'бой окончен']],
  [/^отбегаю от (\S+)/, (m) => ['footprints', `убегает от ${m[1]}`]],
  [/^отбила огненный шар/, () => ['shield', 'отбила огненный шар гаста']],
  [/^хозяин лёг спать/, () => ['circle-pause', 'хозяин лёг спать - пошла спать тоже']],
  [/^хозяин погиб/, () => ['skull', 'хозяин погиб - пошла к месту ждать его']],
  [/^хозяин крадётся/, () => ['footprints', 'крадётся следом за хозяином']],
  [/^метка: отметила «(.+)»/, (m) => ['map', `отметила на карте: ${m[1]}`]],
  [/^путь: (.+)/, (m) => ['map', `в путь: ${m[1]}`]],
  [/^итог: (?!не получилось|задание отменено|остановился)(.+?)(; задание выполнено)?$/, (m) => ['check', m[1]]],
  [/^итог: не получилось: (.+)/, (m) => ['circle-alert', 'не вышло: ' + m[1]]],
  [/^сама сказала \((.+)\)/, (m) => ['message-circle', `сказала о: ${m[1]}`]],
  [/^закончила: (.+)/, () => null],
  [/^толкнули к опасности/, () => ['shield', 'удержалась на краю после толчка']],
  [/^поставил факел/, () => ['sparkles', 'поставила факел - темно']],
  [/^\[сервер\] (\S+) joined the game/, (m) => ['user', `${m[1]} зашёл на сервер`]],
];

class LifeView {
  /** Из log(): важное - в дневник (до 300 записей, переживают перезапуск в памяти). */
  diaryFrom(text) {
    for (const [re, f] of DIARY) {
      const m = re.exec(text);
      if (!m) continue;
      const e = f(m);
      if (!e) return;
      const D = (this.diary = this.diary || (this.memory && this.memory.data.diary) || []);
      const last = D[D.length - 1];
      if (last && last.x === e[1] && Date.now() - last.t < 60000) return;   // то же самое подряд
      D.push({ t: Date.now(), i: e[0], x: String(e[1]).slice(0, 140) });
      if (D.length > 300) D.splice(0, D.length - 300);
      if (this.memory) { this.memory.data.diary = D; if (Date.now() - (this.diarySavedAt || 0) > 60000) { this.diarySavedAt = Date.now(); this.memory.save(); } }
      this.lifeStat('событий', 1);
      return;
    }
  }

  /** Мысль (не сказано) или реплика (сказано) - в ленту мыслей. */
  thought(text, said) {
    const T = (this.thoughts = this.thoughts || []);
    T.push({ t: Date.now(), x: String(text).slice(0, 200), said: !!said });
    if (T.length > 30) T.shift();
  }

  lifeStat(k, n) {
    if (!this.memory) return;
    const S = (this.memory.data.stats = this.memory.data.stats || {});
    S[k] = (S[k] || 0) + n;
  }

  /** Раз в секунду: пройденный путь, дни жизни. */
  lifeTick() {
    const b = this.bot;
    if (!b || !b.entity) return;
    const p = b.entity.position;
    if (this.lastPos && !b.vehicle) { const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z); if (d < 20) this.lifeStat('пройдено блоков', d); }
    this.lastPos = p.clone();
  }

  /** Настроение одним словом и цветом по нуждам и событиям. */
  moodNow() {
    const b = this.bot, now = Date.now();
    const th = this.threat ? this.threat().level : 'спокойно';
    const D = this.diary || [];
    const recent = (re, ms) => D.some((e) => now - e.t < ms && re.test(e.x));
    if (b.health <= 6) return { w: 'ранена', c: 'bad' };
    if (th === 'опасно') return { w: 'в опасности', c: 'bad' };
    if (b.food <= 6) return { w: 'голодна', c: 'warn' };
    if (th === 'осторожно') return { w: 'насторожена', c: 'warn' };
    if (recent(/подарил|подарок|привет|радуется|кружится/, 180000)) return { w: 'рада', c: 'ok' };
    const t = b.time && b.time.timeOfDay;
    if (t > 13000 && t < 23000 && /overworld/.test(b.game.dimension || '')) return { w: 'сонная', c: 'muted' };
    if (this.sandbox || this.seat) return { w: 'отдыхает', c: 'ok' };
    if (this.mode === 'task' || this.travelling) return { w: 'занята делом', c: 'accent' };
    return { w: 'спокойна', c: 'ok' };
  }

  /** Всё для вкладки «Жизнь». */
  lifeView() {
    const b = this.bot;
    if (!b || !b.entity || this.status !== 'online') return null;
    const p = b.entity.position, now = Date.now();
    const me = b.players && b.players[b.username];
    let skin = '';
    try { skin = (me && me.skinData && me.skinData.url) || ''; } catch {}
    const t = b.time && b.time.timeOfDay;
    const doing = (this.sandbox && this.sandbox.phase === 'at' && this.sandbox.what) || (this.seat && 'сидит рядом') || this.task
      || (this.mode === 'follow' ? `идёт за ${this.followName}` : this.mode === 'hold' ? 'ждёт на месте' : this.mode === 'life' ? 'занята своим' : 'стоит, смотрит по сторонам');
    const A = (this.memory && this.memory.data.affinity) || {};
    const rel = Object.entries(A).map(([n, e]) => ({ n, v: e.v, last: e.last })).sort((a, c) => Math.abs(c.v) - Math.abs(a.v)).slice(0, 8);
    let where = '';
    try { where = [this.homeText && this.homeText(), this.district && this.district()].filter(Boolean).join('; '); } catch {}
    let biome = '';
    try { const bl = b.blockAt(p); biome = (bl && bl.biome && bl.biome.name) || ''; } catch {}
    const S = (this.memory && this.memory.data.stats) || {};
    return {
      name: b.username, skin, quiet: !!this.opts.quiet,
      hp: Math.round(b.health), food: b.food, xp: b.experience ? b.experience.level : 0, armor: b.entity.equipment ? b.entity.equipment.slice(2, 6).filter(Boolean).length : 0,
      held: b.heldItem ? b.heldItem.name : '',
      doing, mood: this.moodNow(), dim: this.dimName(), pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)], where, biome,
      time: t === undefined ? '' : t < 1000 || t > 23000 ? 'рассвет' : t < 6000 ? 'утро' : t < 11000 ? 'день' : t < 13000 ? 'вечер' : 'ночь',
      weather: (() => { const p = this.precip ? this.precip() : ''; return !p ? 'ясно' : (b.thunderState || 0) > 0.3 ? 'гроза' : p; })(),
      near: Object.values(b.players).filter((x) => x.entity && x.username !== b.username && x.entity.position.distanceTo(p) < 32).map((x) => x.username),
      thoughts: (this.thoughts || []).slice(-8).reverse(),
      diary: (this.diary || (this.memory && this.memory.data.diary) || []).slice(-60).reverse(),
      rel, stats: { 'пройдено блоков': Math.round(S['пройдено блоков'] || 0), 'событий в дневнике': S['событий'] || 0, 'людей знает': Object.keys(A).length },
      items: Object.entries(b.inventory.items().reduce((o, i) => (o[i.name] = (o[i.name] || 0) + i.count, o), {})).sort((a, c) => c[1] - a[1]).slice(0, 27),
      at: now,
      // для HUD: день мира, опыт до уровня, снаряжение, ценности, задание
      day: b.time && b.time.day !== undefined ? b.time.day : Math.floor((b.time && b.time.age || 0) / 24000),
      clock: t === undefined ? '' : (() => { const m = Math.floor(((t + 6000) % 24000) / 1000 * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); })(),
      xpp: b.experience ? Math.round((b.experience.progress || 0) * 100) : 0,
      gear: (() => { const sl = b.inventory.slots, n = (i) => (sl[i] ? sl[i].name : ''); return { head: n(5), chest: n(6), legs: n(7), feet: n(8), hand: b.heldItem ? b.heldItem.name : '', off: n(45) }; })(),
      emeralds: b.inventory.items().filter((i) => i.name === 'emerald').reduce((s, i) => s + i.count, 0),
      diamonds: b.inventory.items().filter((i) => i.name === 'diamond').reduce((s, i) => s + i.count, 0),
      quest: (() => { try { const e = this.errand && this.errand(); if (e && e.state !== 'done' && e.state !== 'cancel') return { title: e.text, steps: e.steps.map((x) => ({ t: x.title, st: x.st })) }; } catch {} return null; })(),
      goal: (() => { try { const m = this.memory && this.memory.bot && this.memory.bot(b.username); return m && m.goal ? m.goal.text : ''; } catch { return ''; } })(),
      places: (() => { try { return Object.values((this.memory && this.memory.data.places) || {}).filter((x) => x.dim === this.dimName()).length; } catch { return 0; } })(),
    };
  }
}

module.exports = { LifeView, DIARY };
