// Отклик на зов и дела без самоотмены (22.11): «пойдём за мной» - сразу телу; та же цепочка от мозга - не заново.
const { quickOrder } = require('../app/brain');
const { TotemBot } = require('../app/bot');
const res = []; const ok = (n, c, i) => res.push([n, !!c, i]);
const f = (t) => (quickOrder(t, 'V') || []).map((a) => a.act).join(',');
for (const t of ['пойдем за мной алекс', 'идём за мной', 'ну давай за мной', 'Алекс, пошли со мной пожалуйста', 'погнали']) ok(`«${t}» - идти следом сразу`, f(t) === 'follow', f(t));
ok('«иди сюда ко мне» - подойти', f('иди сюда ко мне') === 'come', f('иди сюда ко мне'));
ok('«отдавай» и «иди копай» - не приказ', !f('отдавай') && !f('иди копай'));
// тело: идёт harvest → trades → trade; мозг снова прислал trades, trade - «уже делаю», не отмена
const tb = Object.create(TotemBot.prototype);
let cancels = 0;
Object.assign(tb, { bot: { entity: {} }, status: 'online', opts: {}, mode: 'task', runActs: ['harvest', 'trades', 'trade'], runAt: 0, taskOwner: { rank: 3, at: Date.now() }, token: 5, claim: () => '', cancel() { cancels++; }, log() {} });
tb.run([{ act: 'trades' }, { act: 'trade' }], 'x', 'master').then((r) => {
  ok('та же цепочка от мозга - не начинать заново', /^уже делаю/.test(r) && cancels === 0, r);
  let bad = 0; for (const [n, c, i] of res) { console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); if (!c) bad++; }
  console.log(`--- зов и дела: ${res.length - bad} из ${res.length}`);
  process.exitCode = bad ? 1 : 0;
});
