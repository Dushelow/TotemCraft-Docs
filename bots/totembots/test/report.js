// Разбор последней игры бота по журналу (без сервера, секунды): где застревал, что не вышло, сколько думал мозг,
// какие фразы повторял, как работали голос и уши. node test/report.js [ник] [сколько последних входов]
const fs = require('fs');
const path = require('path');
const name = process.argv[2] || 'Alex', sessions = +process.argv[3] || 1;
const lines = fs.readFileSync(path.join(__dirname, '..', 'local', 'logs', name + '.log'), 'utf8').split('\n');
let start = 0, seen = 0;
for (let i = lines.length - 1; i >= 0; i--) if (/ захожу на /.test(lines[i]) && ++seen === sessions) { start = i; break; }
const L = lines.slice(start).filter(Boolean);
const t = (l) => l.slice(11, 19);
const count = (re) => L.filter((l) => re.test(l)).length;
const top = (re, pick, n = 8) => { const m = new Map(); for (const l of L) { const x = re.exec(l); if (x) { const k = pick(x).replace(/-?\d+/g, '#').slice(0, 90); m.set(k, (m.get(k) || 0) + 1); } } return [...m].sort((a, b) => b[1] - a[1]).slice(0, n); };
console.log(`Игра ${name}: ${t(L[0])}-${t(L[L.length - 1])} UTC, строк ${L.length}`);
console.log(`\nТело: застревал ${count(/застрял, пробую/)}, путь пустой ${count(/путь пустой/)}, «ближе пути нет» ${count(/ближе пути нет/)}, сходила с кровати/люка ${count(/сошла с кровати/)}, умирал ${count(/ умер на /)}`);
console.log(`Сама (жизнь тела): ${count(/ сама: /)} дел, не смогла ${count(/сама не смогла/)}`);
console.log('\nЧаще всего не выходило:'); for (const [k, v] of top(/ итог: .*?не получилось: ([^;(]+)/, (x) => x[1])) console.log(`  ${v} × ${k}`);
const think = []; let ask = null;
for (const l of L) { if (/ → /.test(l)) ask = Date.parse(l.slice(0, 24)); else if (/ ← /.test(l) && ask) { think.push((Date.parse(l.slice(0, 24)) - ask) / 1000); ask = null; } }
think.sort((a, b) => a - b);
const q = (p) => (think.length ? think[Math.min(think.length - 1, Math.floor(think.length * p))].toFixed(1) : '-');
console.log(`\nМозг: решений ${think.length}, думал обычно ${q(0.5)} с, каждый десятый дольше ${q(0.9)} с; ошибок сайтов ${count(/не начал отвечать|пустой ответ|Qwen: .*(ошибк|failed)/)}, отказано «нужен хозяин» ${count(/отклонено \(нужен хозяин\)/)}`);
console.log('Мозги:'); for (const [k, v] of top(/мозг сейчас: (.+)/, (x) => x[1], 5)) console.log(`  ${v} × ${k}`);
console.log(`\nЧат: сказала ${count(/\[чат\] (\[рядом\] |\[я -> )?Alex:|\[я -> /)}, промолчала «рядом никого» ${count(/вслух не сказал/)}, отсеяно повторов ${count(/уже говорил это/)}`);
console.log('Повторяла:'); for (const [k, v] of top(/\[чат\] (?:\[рядом\] )?Alex: (.+)/, (x) => x[1].toLowerCase(), 5).filter((x) => x[1] > 1)) console.log(`  ${v} × ${k}`);
console.log(`\nГолос: Qwen ${count(/голос \(qwen\)/)}, Silero ${count(/голос \(silero\)/)}, Piper ${count(/голос \(piper\)/)}, сбоев ${count(/голос \w+ не сработал/)}`);
console.log(`Уши: услышала фраз ${count(/слышу голос/)}, распознала ${count(/\[голос\] /)}, отброшено не по-русски ${count(/не по-русски/)}`);
for (const [k, v] of top(/слышу голос (\S+)/, (x) => x[1], 5)) console.log(`  ${v} × ${k}`);
