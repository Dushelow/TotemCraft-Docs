// Наборы к бою (23.11, владелец: «чтобы продумывал свой класс, скиллы, стратегию, наборы - по желанию и по уместности»).
// Класс - что взять и как драться; противник подсказывает класс (против стрелков - щит и лук, против игроков - всё).
// Тело собирает набор из своих сундуков (как gearUp), надевает броню, щит или тотем во вторую руку и честно говорит,
// чего не хватает и как это добыть (скрафтить, сварить, выменять). Сам бой - guard.js: оценка сил, укрытие,
// лук издалека, зигзаг со щитом к стрелку, зелья при малом здоровье.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// предмет: [regexp, сколько, зачем]
const BASE = [[/_helmet$/, 1, 'броня'], [/_chestplate$/, 1, 'броня'], [/_leggings$/, 1, 'броня'], [/_boots$/, 1, 'броня'],
  [/^(cooked_beef|cooked_porkchop|cooked_mutton|bread|baked_potato|cooked_chicken|golden_carrot)$/, 16, 'еда']];
const KITS = {
  'мечник': { why: 'ближний бой: меч и щит, шаг назад после удара', items: [[/_sword$/, 1, 'меч'], [/^shield$/, 1, 'щит'], [/^golden_apple$/, 2, 'золотые яблоки']] },
  'лучник': { why: 'издалека: лук и стрелы, меч на случай ближнего', items: [[/^(bow|crossbow)$/, 1, 'лук'], [/arrow$/, 32, 'стрелы'], [/_sword$/, 1, 'меч запасной']] },
  'топорщик': { why: 'топор бьёт сильнее и выбивает щит, меч добивает', items: [[/_axe$/, 1, 'топор'], [/_sword$/, 1, 'меч'], [/^shield$/, 1, 'щит']] },
  'универсал': { why: 'на всё: меч, щит, лук, яблоки, зелья', items: [[/_sword$/, 1, 'меч'], [/^shield$/, 1, 'щит'], [/^(bow|crossbow)$/, 1, 'лук'], [/arrow$/, 32, 'стрелы'], [/^golden_apple$/, 3, 'золотые яблоки'], [/potion$/, 3, 'зелья (лечение, сила, скорость)']] },
  'война': { why: 'против игроков: всё лучшее, яблоки, зелья, жемчуг, ведро воды, блоки', items: [[/_sword$/, 1, 'меч'], [/_axe$/, 1, 'топор (выбить щит)'], [/^shield$/, 1, 'щит'], [/^(bow|crossbow)$/, 1, 'лук'], [/arrow$/, 64, 'стрелы'], [/^(golden_apple|enchanted_golden_apple)$/, 6, 'золотые яблоки'], [/potion$/, 6, 'зелья: лечение, сила, скорость, огнестойкость'], [/^ender_pearl$/, 8, 'жемчуг (уйти, догнать)'], [/^water_bucket$/, 1, 'ведро воды (падение, огонь)'], [/^(cobblestone|cobbled_deepslate|dirt|oak_planks)$/, 64, 'блоки (стена, столб)'], [/^totem_of_undying$/, 1, 'тотем']] },
  'разведчик': { why: 'налегке: скорость, еда, жемчуг, уходить, а не драться', items: [[/_sword$/, 1, 'меч'], [/^ender_pearl$/, 4, 'жемчуг'], [/potion$/, 2, 'зелья скорости']] },
};
// противник -> класс
const FOR = [[/скелет|стрел|лучник|stray|skeleton|pillager|разбойник|ведьм|блейз/i, 'мечник'], [/игрок|пвп|pvp|война|рейд|клан/i, 'война'],
  [/крипер|creeper|фантом|гаст/i, 'лучник'], [/зомби|паук|нежить|орда/i, 'топорщик'], [/разведк|налегке|бежать/i, 'разведчик']];
const HOW = { 'щит': 'скрафтить: 6 досок + 1 железо', 'лук': 'скрафтить: 3 палки + 3 нити (нити - с пауков)', 'стрелы': 'скрафтить: кремень + палка + перо; или купить у лучника-жителя',
  'золотые яблоки': 'скрафтить: яблоко + 8 золотых слитков', 'еда': 'нажарить мяса или испечь хлеб', 'броня': 'железо из шахты или купить у бронника',
  'жемчуг (уйти, догнать)': 'эндермены или священник-житель', 'ведро воды (падение, огонь)': 'ведро: 3 железа', 'тотем': 'только с призывателей при рейде',
  'зелья: лечение, сила, скорость, огнестойкость': 'варочная стойка, огненный порошок, адская бородавка', 'зелья (лечение, сила, скорость)': 'варочная стойка, огненный порошок, адская бородавка',
  'топор (выбить щит)': 'скрафтить', 'меч': 'скрафтить', 'меч запасной': 'скрафтить', 'топор': 'скрафтить' };

class Loadout {
  /** a.kit - класс или противник («скелеты», «война», «лучник»); без него - универсал. */
  async loadout(a, tok) {
    const b = this.bot, want = String(a.kit || a.vs || '').toLowerCase();
    const name = KITS[want] ? want : ((FOR.find(([re]) => re.test(want)) || [])[1] || 'универсал');
    const kit = KITS[name], need = BASE.concat(kit.items);
    const count = (re) => b.inventory.items().filter((i) => re.test(i.name)).reduce((s, i) => s + i.count, 0)
      + [5, 6, 7, 8, 45].reduce((s, sl) => s + (b.inventory.slots[sl] && re.test(b.inventory.slots[sl].name) ? 1 : 0), 0);
    // из своих сундуков у дома (только свои, как stash/gearUp)
    const got = [];
    const myHome = require('./life').home(this);
    const own = (v) => (this.skills && this.skills.mine(v)) || (myHome && Math.hypot(myHome.x - v.x, myHome.z - v.z) <= 16 && Math.abs(myHome.y - v.y) <= 12);
    const chests = b.findBlocks({ matching: (bl) => /^(chest|trapped_chest|barrel)$/.test(bl.name), maxDistance: 16, count: 20 }).filter(own);
    for (const v of chests) {
      if (need.every(([re, n]) => count(re) >= n)) break;
      let c; try { c = await this.openLocked(v.x, v.y, v.z, tok); } catch { continue; }
      try {
        for (const it of c.containerItems()) {
          const r = need.find(([re, n]) => re.test(it.name) && count(re) < n);
          if (!r) continue;
          const k = Math.min(it.count, r[1] - count(r[0]));
          if (k > 0) { await c.withdraw(it.type, null, k); got.push(`${k} ${it.name}`); await sleep(200); }
        }
      } catch {} finally { c.close(); }
    }
    if (this.guard) { await this.guard.gear().catch(() => {}); await this.guard.equipWeapon().catch(() => {}); }
    const lack = need.filter(([re, n]) => count(re) < n).map(([, n, why]) => why).filter((x, i, arr) => arr.indexOf(x) === i);
    this.kitName = name;
    return `набор «${name}» (${kit.why}): ${got.length ? 'взял ' + got.join(', ') : 'из сундуков ничего не понадобилось'}` +
      (lack.length ? `; не хватает: ${lack.map((w) => w + (HOW[w] ? ' (' + HOW[w] + ')' : '')).join('; ')}` : '; всё есть') +
      `; броня ${this.guard ? this.guard.armorPts() : '?'}/20`;
  }
}

module.exports = { Loadout, KITS };
