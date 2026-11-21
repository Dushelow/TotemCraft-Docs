// Поручения на модели тела (без сервера): шаги по порядку, повтор при неудаче, застревание с вопросом хозяину,
// прерывание приказом хозяина и «продолжай», сохранение в памяти (переживает перезапуск). node test/errand_test.js
const path = require('path');
const EventEmitter = require('events');
const { Errands } = require(path.resolve(__dirname, '../app/errand.js'));

function body(script) {
  const tb = new EventEmitter();
  for (const k of Object.getOwnPropertyNames(Errands.prototype)) if (k !== 'constructor') tb[k] = Errands.prototype[k];
  const mem = { bots: {} };
  Object.assign(tb, {
    opts: { name: 'Alex' }, status: 'online', token: 1, said: [], ran: [], logs: [], inv: {},
    bot: { entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, players: { Valghard: {}, CaptianRage: {} }, registry: { foodsByName: {} } },
    memory: { data: { places: {} }, bot: (n) => (mem.bots[n] = mem.bots[n] || {}), save() { mem.saved = (mem.saved || 0) + 1; } },
    log(t) { this.logs.push(t); }, ev() {}, dimName: () => 'обычный мир', say(t, ch, to) { this.said.push(`${to}: ${t}`); }, cancel() {},
    player: (n) => ({ position: { x: 1, y: 64, z: 1 } }), invCounts() { return this.inv; },
    async pickup() {}, async gearUp() { return 'всё нужное уже с собой'; },
    async run(acts, label) { this.ran.push(acts[0].act); return script(acts[0], this); },
  });
  return { tb, mem };
}
const sleep0 = global.setTimeout;
const results = [];
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'да ' : 'НЕТ'} ${name}${extra ? ' - ' + extra : ''}`); };
const run = async (tb) => { await tb.errandLoop(); };

(async () => {
  // ускорить паузы поручения: 20 с повтора -> мгновенно
  global.setTimeout = (f, ms, ...a) => sleep0(f, Math.min(ms, 5), ...a);

  // 1. Полное поручение: всё идёт
  {
    const { tb, mem } = body((a, t) => { if (a.act === 'give') t.inv = {}; return 'готово; задание выполнено'; });
    tb.inv = { white_wool: 128 };
    tb.on('player-chat-dummy', () => {});
    setImmediate(() => tb.emit('player-chat', { from: 'CaptianRage', text: 'спасибо, всё ок' }));
    tb.startErrand({ plan: 'come Valghard; wait white_wool 128; gear; find CaptianRage 10000 200; give CaptianRage white_wool 128; confirm CaptianRage; home', from: 'Valghard' });
    global.setTimeout = (f, ms, ...a) => sleep0(f, Math.min(ms, 5), ...a);
    await new Promise((r) => sleep0(r, 30));
    const confirmWait = sleep0(() => tb.emit('player-chat', { from: 'CaptianRage', text: 'спасибо, всё ок' }), 10);
    await new Promise((r) => sleep0(r, 300));
    const e = tb.errand();
    tb.homeKnown = true;
    ok('все шаги по порядку; дом не знает - вернулась туда, откуда ушла', e && e.state === 'done' && /откуда ушла/.test(e.steps[6].note), `шаг ${e && e.cur}, ${e && e.steps[6].note}, тело: ${tb.ran.join(',')}`);
    ok('сохранено в памяти', mem.bots.Alex && mem.bots.Alex.errand && mem.saved > 3);
  }
  // 2. Шаг не выходит 3 раза - застряла, пишет хозяину и ждёт
  {
    const { tb } = body((a) => (a.act === 'travel' ? 'не получилось: отсюда не подойти' : 'готово'));
    tb.startErrand({ plan: 'goto 100 64 100; home', from: 'Valghard' });
    await new Promise((r) => sleep0(r, 200));
    const e = tb.errand();
    ok('после 3 неудач - застряла и спросила хозяина', e.state === 'stuck' && e.steps[0].tries === 3 && tb.said.some((s) => /^Valghard: Поручение застряло/.test(s)), tb.said.join(' | '));
    // «продолжай» - снова тот же шаг
    let n = 0;
    tb.run = async (acts) => { n++; return 'дошёл; задание выполнено'; };
    tb.resumeErrand();
    await new Promise((r) => sleep0(r, 200));
    ok('«продолжай» - шаг снова и дальше по плану', tb.errand().cur >= 1 && n >= 1, `шаг ${tb.errand().cur}, состояние ${tb.errand().state}`);
  }
  // 3. Хозяин перебил своим приказом - поручение на паузе, «отбой» - отменено
  {
    const { tb } = body(() => 'задание отменено');
    tb.startErrand({ plan: 'goto 100 64 100; home', from: 'Valghard' });
    await new Promise((r) => sleep0(r, 100));
    ok('перебили - пауза, ждёт «продолжай»', tb.errand().state === 'pause');
    tb.cancelErrand();
    ok('«отбой» - отменено', tb.errand().state === 'cancel' && !tb.errandText());
  }
  // 4. Неверный план - понятная ошибка мозгу, поручение не начато
  {
    const { tb } = body(() => 'готово');
    let msg = '';
    try { tb.startErrand({ plan: 'летай 1 2 3' }); } catch (e) { msg = e.message; }
    ok('неверный шаг - ошибка с подсказкой', /непонятный шаг/.test(msg) && !tb.errand(), msg);
  }
  global.setTimeout = sleep0;
  console.log(`--- поручения: ${results.filter(Boolean).length} из ${results.length}`);
  if (results.some((x) => !x)) process.exitCode = 1;
})();
