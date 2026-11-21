// Метки из чата (как «добавить точку» из координат в чате у Xaero и JourneyMap): хозяин пишет название и координаты -
// бот сам запоминает место. «наш портал 250 64 -300», «база в незере 120 -40», «запомни склад 1200 70 -560».
// Приказ идти («иди на 100 200») - не метка. Чужие игроки метки не ставят (их координаты - только в разговор).

const FILLER = /^(на|в|во|у|около|возле|это|тут|там|вот|координаты|корды|коорды|кор|xyz|x|y|z|по|запомни|запиши|отметь|метка|точка|место|и)$/i;
const ORDER = /^(иди|идём|идем|пошли|пойдём|пойдем|беги|дойди|сходи|приходи|двигай|го|телепорт|тп|tp|давай|дай|кинь|брось|принеси|отнеси|положи|возьми|купи|продай|скинь|стак|стака|стаков|штук|шт)$/i;

/** Найти метку в тексте: { name, x, y?, z, dim } или null. */
function parse(text) {
  const t = String(text || '').trim();
  const nums = [...t.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => ({ v: Math.round(+m[0].replace(',', '.')), i: m.index, len: m[0].length }));
  if (nums.length < 2 || nums.length > 3) return null;
  let x, y, z;
  if (nums.length === 3) { [x, y, z] = nums.map((n) => n.v); if (y < -64 || y > 320) return null; }
  else { [x, z] = nums.map((n) => n.v); if (Math.min(Math.abs(x), Math.abs(z)) < 10 || Math.max(Math.abs(x), Math.abs(z)) < 50) return null; }   // «2 64» - не координаты
  if ([x, z].some((v) => Math.abs(v) > 30000000)) return null;
  const words = t.replace(/-?\d+(?:[.,]\d+)?/g, ' ').replace(/[^а-яёa-z0-9_ -]/gi, ' ').split(/\s+/).filter(Boolean);
  const explicit = words.some((w) => /^(запомни|запиши|отметь|метка)$/i.test(w));
  if (!explicit && words.some((w) => ORDER.test(w))) return null;
  const dim = words.some((w) => /^(незер|незере|незера|ад|аду|nether)$/i.test(w)) ? 'Незер' : words.some((w) => /^(энд|энде|край|end)$/i.test(w)) ? 'Энд' : 'обычный мир';
  const name = words.filter((w) => !FILLER.test(w) && !/^(незер|незере|незера|ад|аду|nether|энд|энде|край|end)$/i.test(w)).join(' ').slice(0, 40).trim();
  if (!name && !explicit) return null;
  return { name: name || 'метка', x, y, z, dim };
}

module.exports = { parse };
