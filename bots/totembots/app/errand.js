// Поручения: длинная задача хозяина как список шагов, который выполняет тело, а не нейросеть.
//
// Раньше длинную задачу («принеси шерсть капитану на 10к через Незер и вернись») держала нейросеть: каждый шаг -
// новый вопрос, при лимите, ошибке или перезапуске нить терялась, и хозяину приходилось вести бота за руку.
// Теперь нейросеть один раз переводит слова хозяина в план (!errand), а дальше тело:
//   - делает шаги по очереди и проверяет каждый по факту (инвентарь, место, ответ игрока);
//   - не вышло - пробует ещё раз (до 3 раз с паузой), потом пишет хозяину в личку и ждёт «продолжай» или «отбой»;
//   - план хранится в памяти: переживает лимит нейросети, перезапуск программы, смерть (после смерти - забрать вещи
//     и продолжить с того же шага);
//   - хозяин видит поручение в панели, отменяет словом «отбой», продолжает - «продолжай».
//
// Шаги (через «;»): come ник | wait предмет сколько | gear | goto x y z [мир] | place название | find ник [x z] |
//   give ник предмет [сколько] | confirm ник | home | say ник текст
const { goals } = require('mineflayer-pathfinder');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLES = {
  come: (a) => `подойти к ${a.who}`, wait: (a) => `дождаться ${a.count} ${a.item}`, gear: () => 'снарядиться в дорогу',
  goto: (a) => `дойти до ${a.x} ${a.y ?? ''} ${a.z}${a.dim ? ' (' + a.dim + ')' : ''}`, place: (a) => `дойти до «${a.name}»`,
  find: (a) => `найти ${a.who}${a.x !== undefined ? ' у ' + a.x + ' ' + a.z : ''}`, give: (a) => `отдать ${a.who} ${a.count || ''} ${a.item}`,
  confirm: (a) => `убедиться, что у ${a.who} всё в порядке`, home: () => 'вернуться домой', say: (a) => `написать ${a.who}`,
};

/** Разбор плана из строки нейросети: «come Valghard; wait white_wool 128; gear; goto 10000 70 200; ...». */
function parse(text) {
  const steps = [];
  for (const raw of String(text || '').split(/[;\n]+/)) {
    const w = raw.trim().replace(/^[-*\d.)\s]+/, '').split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    const k = w[0].toLowerCase(), n = (i) => (w[i] !== undefined && !isNaN(+w[i]) ? +w[i] : undefined);
    let a = null;
    if (k === 'come') a = { do: 'come', who: w[1] };
    else if (k === 'wait') a = { do: 'wait', item: w[1], count: n(2) || 1 };
    else if (k === 'gear') a = { do: 'gear' };
    else if (k === 'goto') a = { do: 'goto', x: n(1), y: w.length > 3 && !isNaN(+w[3]) ? n(2) : undefined, z: w.length > 3 && !isNaN(+w[3]) ? n(3) : n(2), dim: w.find((x, i) => i > 1 && isNaN(+x)) };
    else if (k === 'place') a = { do: 'place', name: w.slice(1).join(' ') };
    else if (k === 'find') a = { do: 'find', who: w[1], x: n(2), z: n(3) };
    else if (k === 'give') a = { do: 'give', who: w[1], item: w[2], count: n(3) };
    else if (k === 'confirm') a = { do: 'confirm', who: w[1] };
    else if (k === 'home') a = { do: 'home' };
    else if (k === 'say') a = { do: 'say', who: w[1], text: w.slice(2).join(' ') };
    if (!a) throw new Error(`непонятный шаг «${raw.trim()}». Шаги: come, wait, gear, goto, place, find, give, confirm, home, say`);
    if (/^(come|find|give|confirm|say)$/.test(a.do) && !a.who) throw new Error(`в шаге «${raw.trim()}» нет ника`);
    if (a.do === 'goto' && (a.x === undefined || a.z === undefined)) throw new Error(`в шаге «${raw.trim()}» нужны x и z`);
    if ((a.do === 'wait' || a.do === 'give') && !a.item) throw new Error(`в шаге «${raw.trim()}» нет предмета`);
    a.title = TITLES[a.do](a);
    steps.push(a);
  }
  if (!steps.length) throw new Error('пустой план');
  if (steps.length > 20) throw new Error('слишком длинный план (больше 20 шагов) - разбей на поручения поменьше');
  return steps;
}

class Errands {
  /** Текущее поручение (из памяти: переживает перезапуск). */
  errand() { const m = this.memory && this.memory.bot(this.opts.name); return m ? m.errand || null : null; }
  saveErrand(e) { const m = this.memory && this.memory.bot(this.opts.name); if (!m) return; m.errand = e; this.memory.save(); }

  /** Начать поручение: план от нейросети (строка шагов), от кого и как звучала просьба. */
  startErrand(a) {
    const steps = parse(a.plan || a.steps || a.text);
    const p0 = this.bot && this.bot.entity ? this.bot.entity.position : null;
    const e = { text: String(a.task || a.label || '').slice(0, 200), from: a.from || (this.runFrom || ''), steps: steps.map((s) => ({ ...s, st: 'wait', tries: 0 })), cur: 0, state: 'run', at: Date.now(),
      start: p0 ? { x: Math.floor(p0.x), y: Math.floor(p0.y), z: Math.floor(p0.z), dim: this.dimName ? this.dimName() : '' } : null };
    this.saveErrand(e);
    this.log(`поручение: ${e.steps.map((s) => s.title).join(' → ')}`);
    this.ev('поручение', { steps: e.steps.map((s) => s.title) });
    setTimeout(() => this.errandLoop().catch((err) => this.log('поручение: ' + err.message)), 500);
    return `принято поручение из ${e.steps.length} шагов: ${e.steps.map((s, i) => `${i + 1}) ${s.title}`).join('; ')}. Делаю сама по шагам, тебе ничего вести не надо`;
  }

  /** Хозяин: «отбой» - бросить, «продолжай» - продолжить после неудачи или прерывания. */
  cancelErrand() { const e = this.errand(); if (!e) return 'поручений нет'; e.state = 'cancel'; this.saveErrand(e); this.cancel(); return 'поручение отменено: ' + (e.text || e.steps.map((s) => s.title).join(', ')); }
  resumeErrand() {
    const e = this.errand();
    if (!e || e.state === 'done' || e.state === 'cancel') return 'продолжать нечего';
    e.state = 'run'; const s = e.steps[e.cur]; if (s) { s.st = 'wait'; s.tries = 0; } this.saveErrand(e);
    setTimeout(() => this.errandLoop().catch(() => {}), 300);
    return 'продолжаю поручение с шага ' + (e.cur + 1) + (s ? ': ' + s.title : '');
  }

  /** Сводка для мозга и панели. */
  errandText() {
    const e = this.errand();
    if (!e || e.state === 'done' || e.state === 'cancel') return '';
    return `поручение (${{ run: 'выполняю', stuck: 'застряла, жду хозяина', pause: 'прервано' }[e.state] || e.state}): ` +
      e.steps.map((s, i) => `${i === e.cur ? '▶' : s.st === 'done' ? '✓' : ' '}${i + 1}) ${s.title}${s.note ? ' (' + s.note + ')' : ''}`).join('; ');
  }

  async errandLoop() {
    if (this._errandBusy) return;
    this._errandBusy = true;
    try {
      for (;;) {
        const e = this.errand();
        if (!e || e.state !== 'run') return;
        if (this.status !== 'online' || !this.bot || !this.bot.entity) return;   // вернётся после входа (spawn)
        if (this.paused) { await sleep(3000); continue; }
        if (this.bot.health <= 0) return;
        const s = e.steps[e.cur];
        if (!s) {
          e.state = 'done'; this.saveErrand(e);
          this.log('поручение выполнено');
          this.ev('поручение_готово', {});
          if (this.brainHook) this.brainHook(`[поручение выполнено] ${e.text || e.steps.map((x) => x.title).join(', ')}. Коротко скажи хозяину, что всё сделано.`);
          return;
        }
        s.st = 'run'; this.saveErrand(e);
        let ok = false, note = '';
        try {
          note = await this.errandStep(s, e);
          ok = true;
        } catch (err) { note = String(err.message || err).slice(0, 160); }
        const e2 = this.errand();
        if (!e2 || e2.state !== 'run') return;   // отменили или прервали, пока шёл шаг
        if (/задание отменено|занята делом/.test(note)) {
          // перебил хозяин своим приказом - поручение ждёт «продолжай»
          e2.state = 'pause'; e2.steps[e2.cur].st = 'wait'; e2.steps[e2.cur].note = 'прервано'; this.saveErrand(e2);
          this.log('поручение прервано другим делом - жду «продолжай»');
          return;
        }
        const cur = e2.steps[e2.cur];
        if (ok) { cur.st = 'done'; cur.note = note.slice(0, 120); e2.cur++; this.saveErrand(e2); this.log(`поручение, шаг ${e2.cur}: ${note}`); continue; }
        cur.tries = (cur.tries || 0) + 1; cur.note = note;
        if (cur.tries < 3) { cur.st = 'wait'; this.saveErrand(e2); this.log(`поручение, шаг «${cur.title}» не вышел (${note}) - ещё раз через 20 с`); await sleep(20000); continue; }
        cur.st = 'fail'; e2.state = 'stuck'; this.saveErrand(e2);
        const msg = `Поручение застряло на шаге «${cur.title}»: ${note}. Скажите «продолжай» или «отбой».`;
        this.log(msg);
        const boss = e2.from || (this.masters && this.masters[0]);
        if (boss) this.say(msg, 'whisper', boss);
        if (this.brainHook) this.brainHook(`[поручение застряло] ${msg} Можешь предложить хозяину, как быть.`);
        return;
      }
    } finally { this._errandBusy = false; }
  }

  /** Один шаг. Возвращает итог строкой или бросает ошибку. Шаги с ходьбой - через run (судья, сторожа, проверки). */
  async errandStep(s, e) {
    const run = async (acts) => {
      const r = await this.run(acts, 'поручение: ' + s.title, 'master');
      if (/не получилось|не бот|бот не на сервере|на паузе/.test(r)) throw new Error(r.replace(/^.*не получилось: /, ''));
      return r;
    };
    const b = this.bot;
    switch (s.do) {
      case 'come': {
        if (this.player(s.who)) return run([{ act: 'come', who: s.who }]);
        const pl = b.players[s.who];
        if (!pl) throw new Error(`${s.who} не в игре`);
        this.say('Не вижу вас - где вы? Напишите координаты.', 'whisper', s.who);
        throw new Error(`не вижу ${s.who} рядом`);
      }
      case 'wait': {
        const until = Date.now() + 15 * 60000, have = () => this.invCounts()[s.item] || 0;
        let asked = false;
        while (have() < s.count) {
          if (Date.now() > until) throw new Error(`за 15 минут не дождалась: есть ${have()} из ${s.count} ${s.item}`);
          const e2 = this.errand(); if (!e2 || e2.state !== 'run') return 'ожидание прервано';
          if (!asked && e.from) { this.say(`Жду ${s.count} ${s.item}, бросьте рядом со мной.`, 'whisper', e.from); asked = true; }
          await this.pickup({ radius: 6 }, this.token).catch(() => {});
          await sleep(3000);
        }
        return `получила ${have()} ${s.item}`;
      }
      case 'gear': return this.gearUp();
      case 'goto': return run([{ act: 'travel', x: s.x, y: s.y, z: s.z, dim: s.dim }]);
      case 'place': return run([{ act: 'goto_place', name: s.name }]);
      case 'home': {
        // дом: «мой дом» или кровать, где спала; не знает - вернуться туда, откуда ушла по поручению
        const h = require('./life').home(this) || (e.start && { ...e.start, back: true });
        if (!h) throw new Error('не знаю, где мой дом и откуда ушла');
        const r = await run([{ act: 'travel', x: h.x, y: h.y, z: h.z, dim: h.dim }]);
        return h.back ? 'дом не знаю - вернулась туда, откуда ушла по поручению; ' + r : r;
      }
      case 'find': {
        if (!this.player(s.who)) {
          // координат нет (или они на глаз - «на 10к»): спросить его самого в личку и взять координаты из ответа
          let at = null;
          if (b.players[s.who]) {
            this.say('Привет! Мне нужно к вам - напишите, пожалуйста, ваши координаты (x z).', 'whisper', s.who);
            const until = Date.now() + 180000;
            while (!at && Date.now() < until) {
              const reply = await this.waitReply(s.who, until - Date.now());
              if (!reply) break;
              const p = require('./chatpoints').parse('метка ' + reply);
              if (p) at = p; else this.say('Не поняла - напишите просто числа: x z или x y z.', 'whisper', s.who);
            }
          }
          if (!at && s.x !== undefined) at = { x: s.x, z: s.z };
          if (!at) throw new Error(`${s.who} не ответил, где он${b.players[s.who] ? '' : ' (не в игре)'}`);
          try { this.autoMark('у ' + s.who, { x: at.x, y: at.y ?? 64, z: at.z }, { kind: 'встреча ' + s.who, radius: 64, ttl: 86400000, dim: at.dim }); } catch {}
          await run([{ act: 'travel', x: at.x, y: at.y, z: at.z, dim: at.dim && at.dim !== 'обычный мир' ? at.dim : undefined }]);
        }
        for (let i = 0; i < 40 && !this.player(s.who); i++) {   // до 2 минут: подождать и спросить
          if (i === 0) this.say(`Я у ${Math.floor(b.entity.position.x)} ${Math.floor(b.entity.position.z)}, принесла вам вещи от хозяина. Где вы?`, 'whisper', s.who);
          await sleep(3000);
        }
        if (!this.player(s.who)) throw new Error(`${s.who} не видно рядом`);
        try { this.autoMark('встреча с ' + s.who, this.player(s.who).position, { kind: 'встреча ' + s.who, radius: 64, ttl: 7 * 86400000 }); } catch {}
        return run([{ act: 'come', who: s.who }]);
      }
      case 'give': {
        const r = await run([{ act: 'give', who: s.who, item: s.item, count: s.count }]);
        if (/инвентарь не изменился/.test(r)) throw new Error('вещи не ушли');
        return r;
      }
      case 'confirm': {
        this.say('Всё дошло? Нужно что-то ещё по этому делу?', 'whisper', s.who);
        const reply = await this.waitReply(s.who, 180000);
        if (!reply) return `${s.who} не ответил за 3 мин - считаю, что всё в порядке`;
        if (/\bнет\b|не то|мало|не дошл|не пришл|ещё нужно|еще нужно|не хватает/i.test(reply) && !/всё ок|все ок|норм|спасибо|отлично/i.test(reply)) throw new Error(`${s.who} ответил: «${reply.slice(0, 80)}»`);
        return `${s.who}: «${reply.slice(0, 80)}»`;
      }
      case 'say': this.say(s.text, 'whisper', s.who); return 'написала ' + s.who;
      default: throw new Error('неизвестный шаг ' + s.do);
    }
  }

  /** Ждать ответ игрока (личка или рядом) до ms. */
  waitReply(who, ms) {
    return new Promise((resolve) => {
      const on = (m) => { if (m.from === who) { done(m.text); } };
      const t = setTimeout(() => done(''), ms);
      const done = (v) => { clearTimeout(t); this.removeListener('player-chat', on); resolve(v); };
      this.on('player-chat', on);
    });
  }

  /**
   * Снарядиться в дорогу из своих сундуков: еда (до 16), блоки для мостков (до 32). Броню и тотем тело надевает само.
   * Сундуки - только свои (как в stash).
   */
  async gearUp() {
    const b = this.bot, tok = this.token;
    const foods = b.registry.foodsByName || {};
    const have = () => this.invCounts();
    const foodN = () => Object.entries(have()).filter(([n]) => foods[n] && !/rotten|spider_eye|poison|pufferfish/.test(n)).reduce((s, [, c]) => s + c, 0);
    const blockN = () => ['cobblestone', 'dirt', 'cobbled_deepslate', 'netherrack', 'stone'].reduce((s, n) => s + (have()[n] || 0), 0);
    const need = [];
    if (foodN() < 16) need.push('еда');
    if (blockN() < 32) need.push('блоки');
    const got = [];
    if (need.length) {
      const myHome = require('./life').home(this);
      const own = (v) => this.skills.mine(v) || (myHome && Math.hypot(myHome.x - v.x, myHome.z - v.z) <= 16 && Math.abs(myHome.y - v.y) <= 12);
      const chests = b.findBlocks({ matching: (bl) => /^(chest|trapped_chest|barrel)$/.test(bl.name), maxDistance: 16, count: 20 }).filter(own);
      for (const v of chests) {
        if (foodN() >= 16 && blockN() >= 32) break;
        let c;
        try { c = await this.openLocked(v.x, v.y, v.z, tok); } catch { continue; }
        try {
          for (const it of c.containerItems()) {
            if (foods[it.name] && foodN() < 16 && !/rotten|spider_eye|poison|pufferfish/.test(it.name)) { const n = Math.min(it.count, 16 - foodN()); await c.withdraw(it.type, null, n); got.push(`${n} ${it.name}`); await sleep(200); }
            else if (/^(cobblestone|dirt|cobbled_deepslate|netherrack)$/.test(it.name) && blockN() < 32) { const n = Math.min(it.count, 32 - blockN()); await c.withdraw(it.type, null, n); got.push(`${n} ${it.name}`); await sleep(200); }
          }
        } catch {} finally { c.close(); }
      }
    }
    if (this.guard) await this.guard.gear().catch(() => {});
    const lack = [foodN() < 4 && 'еды почти нет', blockN() < 8 && 'блоков для мостков нет'].filter(Boolean);
    return (got.length ? 'взяла ' + got.join(', ') : 'всё нужное уже с собой') + (lack.length ? ` (${lack.join(', ')} - иду так)` : '');
  }
}

module.exports = { Errands, parse };
