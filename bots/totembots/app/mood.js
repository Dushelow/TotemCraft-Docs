// Характер в моменте, как в скрипте Сераны (22.11, разбор по UESP и снимку переменных DLC1NPCMentalModel из баг-трекера
// неофициального патча). В её квесте настроение - две оси: __axisGuardedToOpen (закрытая - открытая) и
// __axisSeriousToPlayful (серьёзная - игривая), сдвиги через RF_MoodChange (Guarded, Open, Playful, Serious), обход
// раз в SecondsBetweenPeriodicUpdates = 30 с. Реплики у неё привязаны к месту: город, край, «рядом пещера», «в пещере»,
// древние руины, двемерские руины, «пришли в красивое место», солнце и непогода снаружи. В паузах она садится, ест,
// читает, рубит дрова, добывает руду, танцует и хлопает бардам.
//
// Здесь то же для Minecraft, без нейросети:
//  - две оси настроения от -1 до 1, сами возвращаются к середине; события сдвигают их (подарок, привет - открытее;
//    удар, насмешка - закрытее; игра, музыка, ясный день - игривее; опасность, ночь, раненый хозяин, поручение -
//    серьёзнее). Настроение выбирает тон реплик и ответов жестами и одним словом уходит мозгу;
//  - реплики по месту, как у неё: «рядом вход в пещеру» и «в пещере» - разные, руины и сооружения (по карте),
//    деревня, город игроков, свой дом, новая находка («ого, красиво»), раз в 30 с проверка, тема - раз в 30 мин;
//  - музыка (нотный блок, проигрыватель): если спокойно и хозяин рядом - пританцовывает, как она хлопает бардам.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// [тема, проверка, игривые строки, серьёзные строки]
const PLACES = [
  ['у пещеры', (t) => t.nearCave(), ['пещера... ну что, посветим?', 'чую - там темно и интересно'], ['вход в пещеру. внизу темно, держись рядом', 'пещера. факелы бы не помешали']],
  ['в пещере', (t) => t.inCave(), ['эхо тут классное', 'подземная экскурсия, да?'], ['тут тяжёлый воздух. не отходи далеко', 'под землёй. слушай, что вокруг']],
  ['руины', (t) => t.nearStruct(/подземелье|шахта|крепость|бастион|древний город|храм|испытания|сокровищница|руины/), ['старые камни... кто тут жил?', 'руины! чур, сундуки мои'], ['старое место. ловушки тут бывают', 'осторожно, такие места не пустые']],
  ['деревня', (t) => t.inVillage(), ['жители! интересно, что продают', 'уютная деревня'], ['деревня. тут лучше ничего не трогать', 'жители... надеюсь, без рейда']],
  ['город игроков', (t) => t.inPlayerTown(), ['сколько тут всего понастроили', 'красиво строят люди'], ['чужой город. ничего не трогаю', 'здесь всё чьё-то']],
  ['дом', (t) => t.atHome(), ['дома хорошо', 'вот и дома'], ['дома. можно выдохнуть', 'дома, наконец']],
];

class Mood {
  mood() { return (this._mood = this._mood || { open: 0.1, play: 0.1, at: Date.now() }); }
  /** Сдвиг оси: axis 'open' (закрытая-открытая) или 'play' (серьёзная-игривая). */
  moodShift(axis, dv, why) {
    const m = this.mood();
    m[axis] = Math.max(-1, Math.min(1, m[axis] + dv));
    if (why) m.why = why;
  }
  /** Одно слово-два мозгу и для журнала. */
  moodWord() {
    const m = this.mood();
    const o = m.open > 0.35 ? 'открытая' : m.open < -0.35 ? 'настороженная' : '';
    const p = m.play > 0.35 ? 'игривая' : m.play < -0.35 ? 'серьёзная' : '';
    return [o, p].filter(Boolean).join(', ') || 'ровная';
  }
  playful() { return this.mood().play > 0.15; }

  /** Раз в секунду: оси тихо к середине, сдвиги от обстановки; раз в 30 с - реплика о месте. */
  moodTick(owner, now) {
    const b = this.bot, m = this.mood();
    if (!b || !b.entity) return;
    const dt = Math.min(5, (now - m.at) / 1000); m.at = now;
    // к своему фону (за ~3 мин наполовину): днём чуть игривее, ночью чуть серьёзнее
    const t0 = b.time && b.time.timeOfDay, nightBase = t0 !== undefined && /overworld/.test(b.game.dimension || '') && t0 > 13000 && t0 < 23000;
    const base = { open: 0.1, play: nightBase ? -0.15 : (this.precip && this.precip()) ? 0 : 0.1 }, k0 = 1 - Math.pow(0.996, dt);
    for (const k of ['open', 'play']) m[k] += (base[k] - m[k]) * k0;
    const th = this.threat ? this.threat().level : 'спокойно';
    if (th === 'опасно') this.moodShift('play', -0.05 * dt);
    else if (th === 'осторожно') this.moodShift('play', -0.01 * dt);
    if (this.musicAt && now - this.musicAt < 5000) this.moodShift('play', 0.02 * dt);
    if (this.errand && (() => { try { const e = this.errand(); return e && e.state === 'run'; } catch { return false; } })()) this.moodShift('play', -0.004 * dt);
    if (now - (this._placeAt || 0) > 30000) { this._placeAt = now; this.placeComment(owner, now); }
    this.musicTick(owner, now);
  }

  // --- где она (для реплик по месту)
  nearCave() {
    try { const p = this.bot.entity.position; return !this.inCave() && Object.values(this.memory.data.places || {}).some((pl) => pl.kind === 'вход в пещеру' && pl.dim === this.dimName() && Math.hypot(pl.x - p.x, pl.z - p.z) < 10 && Math.abs(pl.y - p.y) < 6); } catch { return false; }
  }
  inCave() { try { return !!(this.worldMap && this.worldMap.underRock(this)); } catch { return false; } }
  nearStruct(re) {
    try { const p = this.bot.entity.position; const m = this.worldMap.load(this.bot.game.dimension); return Object.values(m.poi || {}).some((v) => v.seen && re.test(v.kind) && Math.hypot(v.x - p.x, v.z - p.z) < 32); } catch { return false; }
  }
  inVillage() { try { return this.worldMap.settlements(this, 64).some((s) => s.inside && /деревня/.test(s.kind)); } catch { return false; } }
  inPlayerTown() { try { return this.worldMap.settlements(this, 64).some((s) => s.inside && /поселение игроков/.test(s.kind)); } catch { return false; } }
  atHome() { try { return /^ты дома/.test(this.homeText ? this.homeText() : ''); } catch { return false; } }

  /** Реплика о месте: как у Сераны - при смене места, тема раз в 30 мин, общий счётчик реплик (раз в 4 мин). */
  placeComment(owner, now) {
    const b = this.bot, C = this.comp;
    if (!owner || !C || owner.position.distanceTo(b.entity.position) > 16 || now - (C.barkAt || 0) < 240000) return;
    const P = (this._placeSeen = this._placeSeen || {});
    for (const [topic, test, playful, serious] of PLACES) {
      let here = false; try { here = test(this); } catch {}
      const was = P[topic]; P[topic] = here;
      if (!here || was) continue;   // только при входе в место
      if (now - ((C.topic || {})[topic] || 0) < 30 * 60000) continue;
      C.topic[topic] = now; C.barkAt = now;
      try { this.say(pick(this.playful() ? playful : serious), 'local'); this.log(`сама сказала (${topic})`); } catch {}
      return;
    }
  }

  /** Новая находка рядом с хозяином (из карты) - как её «Oh wow. This is gorgeous. I'm glad you're here with me.» */
  foundComment(kind) {
    const b = this.bot, C = this.comp, owner = this.followName ? this.player(this.followName) : null;
    if (!/деревня|крепость|древний город|бастион|храм|испытания|сокровищница/.test(String(kind)) || !owner || !C || owner.position.distanceTo(b.entity.position) > 20 || Date.now() - (C.barkAt || 0) < 120000) return;
    C.barkAt = Date.now();
    this.moodShift('open', 0.1, 'находка');
    try { this.say(this.playful() ? pick([`ого, ${kind}! как хорошо, что мы тут вместе`, `смотри, ${kind}!`]) : pick([`${kind}. запомню это место`, `тут ${kind}`]), 'local'); } catch {}
  }

  /** Музыка рядом: подключить слух на нотные блоки и проигрыватели. */
  musicAttach(bot) {
    bot.on('noteHeard', (block) => { if (block && block.position && bot.entity && block.position.distanceTo(bot.entity.position) < 16) this.musicAt = Date.now(); });
    bot._client.on('world_event', (p) => { try { if (p.effectId === 1010 && p.data && bot.entity) { const q = p.location; if (Math.hypot(q.x - bot.entity.position.x, q.z - bot.entity.position.z) < 24) this.musicAt = Date.now(); } } catch {} });
  }
  /** Играет музыка, спокойно, хозяин рядом и сама не занята - пританцовывать (раз в 3-5 с), игривая - чаще. */
  musicTick(owner, now) {
    if (!this.musicAt || now - this.musicAt > 6000 || !owner || this.mode === 'task' || this._errandBusy || (this.guard && this.guard.fighting)) return;
    if (owner.position.distanceTo(this.bot.entity.position) > 16 || now - (this._danceAt || 0) < (this.playful() ? 3000 : 5000)) return;
    this._danceAt = now;
    if (!this._danceSaid) { this._danceSaid = true; this.log('сама: пританцовываю под музыку'); }
    if (this.gesture) this.gesture(Math.random() < 0.5 ? 'радость' : 'кружится').catch(() => {});
    setTimeout(() => { if (Date.now() - (this.musicAt || 0) > 6000) this._danceSaid = false; }, 7000);
  }
}

module.exports = { Mood, PLACES };
