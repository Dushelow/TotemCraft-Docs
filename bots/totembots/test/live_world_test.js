// Живые проверки на стенде 26.3 (tc-up, порт 25566, Vulcan как на боевом) - то, на чём бот сыпался в игре 22.11:
//   1) калитка у палатки торговца: прошёл - закрыл за собой, житель не сбежал;
//   2) висячие лианы над водой (позади воздух): из воды наверх к хозяину;
//   3) торговля с жителем-фермером: пшеница -> изумруд;
//   4) лодка: поставить свою, сесть, доплыть к точке у стены и встать, не въехав в стену;
//   5) подо льдом: воздух кончается - найти выход или пробить лёд, не утонуть;
//   6) трейдхолл: житель в ячейке за компостером, торговать через щель;
//   7) загон с жителем на прямом пути: обойти, калитки не открывать;
//   8) прогулка: шагом, не по прямой, с остановками, не дальше радиуса;
//   9) квест: пшеница -> хлеб -> хозяину -> поспать, если ночь; перед этим бот сидит на ступеньке;
//   (всё внутри границы мира стенда ±1500: за ней сервер возвращает игрока на спавн)
//   и отметки Vulcan за всё время. node test/live_world_test.js [номер проверки]
const { execSync } = require('child_process');
const { TotemBot } = require('../app/bot');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c.replace(/"/g, '\\"')}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2] ? +process.argv[2] : 0;
const res = []; const ok = (n, c, i) => { res.push([n, !!c]); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };
const until = async (fn, ms, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return Math.max(1, Date.now() - t0); } catch {} await sleep(step); } return 0; };
const tp = (who, x, y, z) => rcon(`execute in minecraft:overworld run minecraft:tp ${who} ${x} ${y} ${z}`);
// перенести и дождаться, что бот действительно там (сразу после входа сервер переносы иногда не делает)
const tpSure = async (bot, who, x, y, z) => { for (let i = 0; i < 12; i++) { const o = tp(who, x, y, z); if (i === 3) console.log('   перенос', who, ':', o); await sleep(1000); const p = bot.bot && bot.bot.entity && bot.bot.entity.position; if (p && Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2) return true; } console.log('   ПЕРЕНОС НЕ ВЫШЕЛ:', who, '- проверка ниже недостоверна'); return false; };

(async () => {
  const log0 = +execSync('docker exec tc-up sh -c "wc -l < /data/logs/latest.log"').toString().trim();
  for (const n of ['TbOwner', 'TbAlex']) { try { rcon(`authme register ${n} Tb12345x`); } catch {} }
  const owner = new TotemBot({ name: 'TbOwner', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  // своя память во временной папке (квест хранится в памяти бота, как в программе)
  { const { Memory } = require('../app/memory'); const d = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tbmem-')); tb.memory = new Memory(d); }
  const logs = []; tb.on('log', (t) => { logs.push(new Date().toISOString().slice(11, 19) + ' ' + t); if (/закрыла|торговля|лодк|сел|пробив|воздух|лиан|застрял|не сел|упёрлась|доплыл/.test(t)) console.log('   бот:', t); });
  // сервер пускает с одного адреса не чаще раза в 4 с («Connection throttled») - входить по очереди и ждать, что бот в мире
  const online = async (x) => { x.start(); for (let i = 0; i < 120 && !(x.bot && x.bot.entity && x.bot.player); i++) await sleep(250); await sleep(1500); };
  await online(owner); await sleep(3000); await online(tb);
  owner.bot.physicsEnabled = false;   // «хозяин» - неподвижная цель
  rcon('gamemode creative TbOwner'); rcon('gamemode survival TbAlex');
  // участок подгрузить и подождать: fill по незагруженным чанкам молча не строит (23.11: загона не было - бот плыл по морю)
  const area = async (x, z, r = 30) => { rcon(`forceload add ${x - r} ${z - r} ${x + r} ${z + r}`); for (let i = 0; i < 20; i++) { await sleep(500); if (/passed/i.test(rcon(`execute in minecraft:overworld if loaded ${x - r} 64 ${z - r} if loaded ${x + r} 64 ${z + r}`))) break; } await sleep(500); };

  // 1. калитка у палатки торговца
  if (!only || only === 1) {
    const X = 1400, Y = 64, Z = 1200; await area(X, Z);
    rcon(`fill ${X - 12} ${Y - 1} ${Z - 12} ${X + 12} ${Y + 6} ${Z + 12} air`); rcon(`fill ${X - 14} ${Y - 6} ${Z - 14} ${X + 14} ${Y - 2} ${Z + 14} stone`);   // толстый пол: под ним море, бот проплывал под загоном
    rcon(`fill ${X - 12} ${Y - 1} ${Z - 12} ${X + 12} ${Y - 1} ${Z + 12} grass_block`);
    rcon(`fill ${X - 4} ${Y} ${Z - 4} ${X + 4} ${Y} ${Z + 4} oak_fence`); rcon(`fill ${X - 3} ${Y} ${Z - 3} ${X + 3} ${Y} ${Z + 3} air`);
    rcon(`setblock ${X + 4} ${Y} ${Z} oak_fence_gate[facing=east]`);
    rcon(`minecraft:kill @e[type=villager,distance=..20,x=${X},y=${Y},z=${Z}]`);
    rcon(`summon villager ${X + 2} ${Y} ${Z - 2} {NoAI:0b,PersistenceRequired:1b}`);
    // хозяин в середине загона: снаружи через забор не дотянуться - войти можно только калиткой (житель внутри, поэтому
    // калитку бот открывает, только когда иначе никак, и закрывает за собой)
    await tpSure(owner, 'TbOwner', X, Y, Z);
    await tpSure(tb, 'TbAlex', X + 10, Y, Z);
    await sleep(1500); tb.follow('TbOwner');
    const gateAt = () => tb.bot.blockAt(new (tb.bot.entity.position.constructor)(X + 4, Y, Z));
    let wasOpen = false, track = []; const spy = setInterval(() => { const g = gateAt(); if (g && String(g.getProperties().open) === 'true') wasOpen = true; const q = tb.bot.entity.position; if (track.length < 40) track.push(`${(q.x - X).toFixed(1)},${(q.z - Z).toFixed(1)}${wasOpen ? 'o' : ''}`); }, 100);
    const inside = await until(() => { const q = tb.bot.entity.position; return Math.abs(q.x - X) < 3.7 && Math.abs(q.z - Z) < 3.7 && q.y > Y - 0.5; }, 25000);   // за забором, внутри, на полу
    await sleep(4000); clearInterval(spy); if (process.env.TRACK) console.log('   путь (x,z от центра):', track.join(' '));
    const gate = gateAt();
    const open = gate && (gate.getProperties().open === true || gate.getProperties().open === 'true');
    ok('прошёл через калитку к хозяину', !!inside, inside ? (inside / 1000).toFixed(1) + ' с' : 'не дошёл');
    ok('калитку открыл, прошёл и закрыл за собой', wasOpen && gate && !open, gate ? gate.name + (wasOpen ? ' была открыта, ' : ' не открывалась, ') + (open ? 'сейчас открыта' : 'сейчас закрыта') : '?');
    tb.cancel && tb.cancel();
  }

  // 7. загон с жителем на прямом пути: обойти, калитки не открывать (житель выйдет); без жителя - всё равно
  if (!only || only === 7) {
    const X = 1300, Y = 64, Z = 1000; await area(X, Z);
    rcon(`fill ${X - 16} ${Y - 5} ${Z - 14} ${X + 16} ${Y - 2} ${Z + 14} stone`); rcon(`fill ${X - 16} ${Y - 1} ${Z - 14} ${X + 16} ${Y - 1} ${Z + 14} grass_block`);
    rcon(`fill ${X - 16} ${Y} ${Z - 14} ${X + 16} ${Y + 5} ${Z + 14} air`);
    // загон длинный поперёк пути: в обход ~31 бл., напрямик через две калитки ~20
    rcon(`fill ${X - 4} ${Y} ${Z - 9} ${X + 4} ${Y} ${Z + 9} oak_fence`); rcon(`fill ${X - 3} ${Y} ${Z - 8} ${X + 3} ${Y} ${Z + 8} air`);
    rcon(`setblock ${X + 4} ${Y} ${Z} oak_fence_gate[facing=east]`); rcon(`setblock ${X - 4} ${Y} ${Z} oak_fence_gate[facing=west]`);
    rcon(`minecraft:kill @e[type=!minecraft:player,x=${X},y=${Y},z=${Z},distance=..20]`);
    if (!process.env.NOVIL) rcon(`summon villager ${X} ${Y} ${Z - 2} {NoAI:1b,PersistenceRequired:1b}`);   // NOVIL=1 - проверка без жителя (должен идти напрямик)
    await tpSure(owner, 'TbOwner', X - 10, Y, Z); await tpSure(tb, 'TbAlex', X + 10, Y, Z);
    await sleep(1500);
    const gAt = (x) => tb.bot.blockAt(new (tb.bot.entity.position.constructor)(x, Y, Z));
    let opened = false; const spy = setInterval(() => { for (const x of [X + 4, X - 4]) { const g = gAt(x); if (g && String(g.getProperties().open) === 'true') opened = true; } }, 50);
    tb.follow('TbOwner');
    const t = await until(() => tb.bot.entity.position.distanceTo(owner.bot.entity.position) < 3.5, 30000);
    clearInterval(spy); tb.cancel && tb.cancel();
    ok('загон с жителем обошёл, калитки не открывал', t && !opened, t ? `${(t / 1000).toFixed(1)} с, калитки ${opened ? 'открывались' : 'не открывались'}` : 'не дошёл за 30 с');
  }

  // 8. прогулка: шагом, не по прямой, с остановками, не дальше радиуса
  if (!only || only === 8) {
    const X = 1300, Y = 64, Z = 1060; await area(X, Z);
    rcon(`fill ${X - 18} ${Y - 5} ${Z - 18} ${X + 18} ${Y - 2} ${Z + 18} stone`); rcon(`fill ${X - 18} ${Y - 1} ${Z - 18} ${X + 18} ${Y - 1} ${Z + 18} grass_block`);
    rcon(`fill ${X - 18} ${Y} ${Z - 18} ${X + 18} ${Y + 5} ${Z + 18} air`);
    rcon(`minecraft:kill @e[type=!minecraft:player,x=${X},y=${Y},z=${Z},distance=..25]`);
    rcon(`summon sheep ${X + 5} ${Y} ${Z + 3}`); rcon(`setblock ${X - 4} ${Y} ${Z - 4} campfire`);
    await tpSure(tb, 'TbAlex', X, Y, Z); await sleep(1000);
    let sprintT = 0, far = 0, stopT = 0, n = 0; const pts = []; let last = null;
    const spy = setInterval(() => { const b = tb.bot; if (!b || !b.entity) return; n++; const p = b.entity.position; if (b.getControlState('sprint')) sprintT++; far = Math.max(far, Math.hypot(p.x - X, p.z - Z)); if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.02) stopT++; last = p.clone(); if (n % 10 === 0) pts.push(p.clone()); }, 100);
    const who = {}; if (process.env.SPRINTDBG) { const o = tb.bot.setControlState.bind(tb.bot); tb.bot.setControlState = (k, v) => { if (k === 'sprint' && v) { const st = new Error().stack.split(/\r?\n/).slice(2, 4).map((l) => l.trim().split(/[\\/]/).pop()).join(' < '); who[st] = (who[st] || 0) + 1; } return o(k, v); }; }
    const r = await tb.run([{ act: 'stroll', radius: 10, ms: 35000 }], 'прогулка', 'master').catch((e) => 'ошибка: ' + e.message);
    clearInterval(spy); if (process.env.SPRINTDBG) console.log('   бег включали:', JSON.stringify(who));
    // повороты: направление между соседними отрезками по 1 с меняется больше чем на 40° - сколько раз
    let turns = 0; for (let i = 2; i < pts.length; i++) { const a1 = Math.atan2(pts[i - 1].z - pts[i - 2].z, pts[i - 1].x - pts[i - 2].x), a2 = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; if (pts[i].distanceTo(pts[i - 1]) > 0.5 && pts[i - 1].distanceTo(pts[i - 2]) > 0.5 && d > 0.7) turns++; }
    ok('прогулка шагом, с остановками и поворотами, в радиусе', sprintT < 5 && far < 12.5 && stopT > 60 && turns >= 3, `${r}; бег ${(sprintT / 10).toFixed(1)} с, дальше всего ${far.toFixed(1)} бл., стоял ${(stopT / 10).toFixed(0)} с из ${(n / 10).toFixed(0)}, поворотов ${turns}`);
  }

  // 9. квест из 4 шагов одной командой: собрать пшеницу, испечь хлеб, отдать хозяину, поспать если ночь (днём - пропуск);
  //    перед ним бот сидит на ступеньке (GSit) - встать сам
  if (!only || only === 9) {
    const X = 1340, Y = 64, Z = 1100; await area(X, Z);
    rcon(`fill ${X - 12} ${Y - 5} ${Z - 12} ${X + 12} ${Y - 2} ${Z + 12} stone`); rcon(`fill ${X - 12} ${Y - 1} ${Z - 12} ${X + 12} ${Y - 1} ${Z + 12} grass_block`);
    rcon(`fill ${X - 12} ${Y} ${Z - 12} ${X + 12} ${Y + 5} ${Z + 12} air`);
    rcon(`fill ${X + 2} ${Y - 1} ${Z - 3} ${X + 6} ${Y - 1} ${Z + 3} farmland[moisture=7]`); rcon(`setblock ${X + 4} ${Y - 1} ${Z} water`);
    rcon(`fill ${X + 2} ${Y} ${Z - 3} ${X + 6} ${Y} ${Z + 3} wheat[age=7]`); rcon(`setblock ${X + 4} ${Y} ${Z} air`);
    rcon(`setblock ${X - 3} ${Y} ${Z + 2} crafting_table`); rcon(`setblock ${X - 3} ${Y} ${Z - 2} oak_stairs[facing=east]`);
    rcon('time set day'); rcon('clear TbAlex');
    await tpSure(owner, 'TbOwner', X - 5, Y, Z); await tpSure(tb, 'TbAlex', X - 2, Y, Z - 2);
    rcon('clear TbOwner');
    await sleep(1500);
    await tb.run([{ act: 'sit' }], 'сесть', 'master').catch(() => {});
    const sat = !!(await until(() => !!tb.bot.vehicle, 8000));
    const t0 = Date.now();
    const r = await tb.run([{ act: 'errand', plan: '!harvest(wheat); !craft(bread, 2); give TbOwner bread 2; night', task: 'хлеб хозяину' }], 'квест', 'master').catch((e) => 'ошибка: ' + e.message);
    const fin = await until(() => { const e = tb.errand(); return e && /done|stuck/.test(e.state); }, 150000, 1000);
    await sleep(3500);   // брошенное игрок подбирает через 2 с
    const e = tb.errand(), bread = owner.bot.inventory.items().filter((i) => i.name === 'bread').reduce((s2, i) => s2 + i.count, 0);
    ok('квест из 4 шагов: пшеница -> хлеб -> хозяину (сидел - встал сам)', sat && e && e.state === 'done' && bread >= 2, `сидел перед квестом: ${sat ? 'да' : 'нет'}; ${r.slice(0, 120)}; итог: ${e ? e.state : '?'} (${tb.errandText ? tb.errandText().slice(0, 200) : ''}); у хозяина хлеба ${bread}; ${((Date.now() - t0) / 1000).toFixed(0)} с`);
    if (e && e.state !== 'done') tb.cancelErrand();
  }

  // 2. висячие лианы над водой
  if (!only || only === 2) {
    const X = 1100, Y = 62, Z = 1100; await area(X, Z);
    rcon(`fill ${X - 14} ${Y - 6} ${Z - 10} ${X + 14} ${Y + 10} ${Z + 10} air`);
    rcon(`fill ${X - 14} ${Y - 6} ${Z - 10} ${X + 14} ${Y - 6} ${Z + 10} sand`);
    rcon(`fill ${X - 14} ${Y - 5} ${Z - 10} ${X + 14} ${Y} ${Z + 10} water`);
    rcon(`fill ${X - 10} ${Y + 7} ${Z - 4} ${X - 4} ${Y + 7} ${Z + 4} oak_planks`);             // палуба над водой, под ней воздух
    rcon(`fill ${X - 3} ${Y + 1} ${Z} ${X - 3} ${Y + 7} ${Z} minecraft:vine[west=true]`);      // лианы от самой воды: прицеплены только вверху, ниже - висят в воздухе
    rcon(`fill ${X - 4} ${Y + 1} ${Z - 4} ${X - 4} ${Y + 6} ${Z + 4} oak_planks`);              // борт от воды до палубы, лианы на нём
    // (за лианой пусто у самой воды - так из воды не залезть и живому игроку: толчок вверх даёт только упор в стену)
    await tpSure(owner, 'TbOwner', X - 7, Y + 8, Z); await tpSure(tb, 'TbAlex', X + 4, Y + 0.3, Z);
    await sleep(1500); tb.follow('TbOwner');
    const up = await until(() => tb.bot.entity.position.y > Y + 7.5, 45000);
    ok('по висячим лианам из воды на палубу', !!up, up ? (up / 1000).toFixed(1) + ' с' : 'не залез за 45 с');
    tb.cancel && tb.cancel();
  }

  // 3. торговля (торгует второй бот: он переносится надёжно; житель - фермер с одной сделкой)
  if (!only || only === 3) {
    const X = 1000, Y = 64, Z = 1300; await area(X, Z);
    rcon(`fill ${X - 9} ${Y - 5} ${Z - 9} ${X + 9} ${Y - 2} ${Z + 9} stone`);
    rcon(`fill ${X - 8} ${Y - 1} ${Z - 8} ${X + 8} ${Y + 5} ${Z + 8} air`); rcon(`fill ${X - 8} ${Y - 1} ${Z - 8} ${X + 8} ${Y - 1} ${Z + 8} grass_block`);
    rcon(`minecraft:kill @e[type=villager,x=${X},y=${Y},z=${Z},distance=..20]`);
    console.log('   житель:', rcon(`summon villager ${X} ${Y} ${Z} {NoAI:1b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:wheat",count:20},sell:{id:"minecraft:emerald",count:1},maxUses:16,rewardExp:1b}]}}`));
    owner.bot.physicsEnabled = true; rcon('gamemode survival TbOwner');
    console.log('   перенос:', await tpSure(owner, 'TbOwner', X + 3, Y, Z));
    rcon('clear TbOwner'); rcon('give TbOwner minecraft:wheat 64');
    await sleep(2500);
    console.log('   жители видны:', Object.values(owner.bot.entities).filter((e) => e.name === 'villager').length);
    const r = await owner.run([{ act: 'trade', want: 'emerald', times: 2 }], 'торговля', 'master').catch((e) => 'ошибка: ' + e.message);
    const em = owner.bot.inventory.items().filter((i) => i.name === 'emerald').reduce((s, i) => s + i.count, 0);
    ok('поторговался с фермером: пшеница -> изумруд', em > 0, `${r}; изумрудов ${em}`);
    owner.bot.physicsEnabled = false; rcon('gamemode creative TbOwner');
  }

  // 6. трейдхолл: житель в ячейке 1x1 за компостером, сверху стекло - торговать через щель над рабочим блоком
  if (!only || only === 6) {
    const X = 1000, Y = 64, Z = 1250; await area(X, Z);
    rcon(`fill ${X - 6} ${Y - 5} ${Z - 6} ${X + 6} ${Y - 1} ${Z + 6} stone`); rcon(`fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 4} ${Z + 6} air`);
    rcon(`minecraft:kill @e[type=!minecraft:player,x=${X},y=${Y},z=${Z},distance=..20]`);
    rcon(`fill ${X - 1} ${Y} ${Z - 1} ${X + 1} ${Y + 2} ${Z + 1} glass`); rcon(`setblock ${X} ${Y} ${Z} air`); rcon(`setblock ${X} ${Y + 1} ${Z} air`);
    rcon(`setblock ${X} ${Y} ${Z + 1} composter`); rcon(`setblock ${X} ${Y + 1} ${Z + 1} air`);   // спереди: компостер, над ним щель
    console.log('   житель в ячейке:', rcon(`summon villager ${X} ${Y} ${Z} {NoAI:0b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:wheat",count:20},sell:{id:"minecraft:emerald",count:1},maxUses:16,rewardExp:1b}]}}`));
    owner.bot.physicsEnabled = true; rcon('gamemode survival TbOwner');
    await tpSure(owner, 'TbOwner', X + 3, Y, Z + 4);
    rcon('clear TbOwner'); rcon('give TbOwner minecraft:wheat 64');
    await sleep(2000);
    const r = await owner.run([{ act: 'trade', want: 'emerald', times: 1 }], 'торговля', 'master').catch((e) => 'ошибка: ' + e.message);
    const em = owner.bot.inventory.items().filter((i) => i.name === 'emerald').reduce((s, i) => s + i.count, 0);
    ok('поторговался с жителем в ячейке трейдхолла', em > 0, `${r}; изумрудов ${em}`);
    owner.bot.physicsEnabled = false; rcon('gamemode creative TbOwner');
  }

  // 4. лодка
  if (!only || only === 4) {
    const X = 900, Y = 62, Z = 1300; await area(X, Z, 40);
    rcon(`fill ${X - 30} ${Y - 3} ${Z - 6} ${X + 30} ${Y + 6} ${Z + 6} air`);
    rcon(`fill ${X - 30} ${Y - 3} ${Z - 6} ${X + 30} ${Y - 3} ${Z + 6} sand`);
    rcon(`fill ${X - 30} ${Y - 2} ${Z - 6} ${X + 20} ${Y} ${Z + 6} water`);
    rcon(`fill ${X + 21} ${Y - 2} ${Z - 6} ${X + 21} ${Y + 5} ${Z + 6} stone`);                 // стена (борт корабля)
    rcon(`fill ${X - 40} ${Y - 2} ${Z - 6} ${X - 31} ${Y} ${Z + 6} grass_block`);               // берег (за ним на стенде море)
    rcon(`minecraft:kill @e[type=!minecraft:player,distance=..60,x=${X},y=${Y},z=${Z}]`);   // старые лодки (#boat на 26.3 не ловит)
    await tpSure(tb, 'TbAlex', X - 31, Y + 1, Z); rcon('clear TbAlex'); rcon('give TbAlex minecraft:oak_boat 1');
    await sleep(2000);
    const m = await tb.run([{ act: 'mount', what: 'boat' }], 'лодка', 'master').catch((e) => 'ошибка: ' + e.message);
    ok('поставил свою лодку и сел за руль', tb.bot.vehicle && /boat/.test(tb.bot.vehicle.name), m);
    if (tb.bot.vehicle) {
      const t0 = Date.now();
      const d = await tb.run([{ act: 'drive', x: X + 19, z: Z }], 'плыть', 'master').catch((e) => 'ошибка: ' + e.message);
      const p = tb.bot.vehicle ? tb.bot.vehicle.position : tb.bot.entity.position;
      ok('доплыл к стене и встал, не въехав в неё', p.x < X + 21 - 0.6 && p.x > X + 12, `${d}; лодка на x=${p.x.toFixed(2)} (стена ${X + 21}), ${((Date.now() - t0) / 1000).toFixed(1)} с`);
      const off = await tb.run([{ act: 'dismount' }], 'слезть', 'master').catch((e) => 'ошибка: ' + e.message);
      await sleep(500);
      ok('слез с лодки (и сам это знает)', !tb.bot.vehicle && !(tb.bot.entity && tb.bot.entity.vehicle), off);
    }
  }

  // 5. подо льдом
  if (!only || only === 5) {
    const X = 800, Y = 62, Z = 1100; await area(X, Z);
    rcon(`fill ${X - 20} ${Y - 7} ${Z - 20} ${X + 20} ${Y + 4} ${Z + 20} air`);
    rcon(`fill ${X - 20} ${Y - 7} ${Z - 20} ${X + 20} ${Y - 7} ${Z + 20} sand`);
    rcon(`fill ${X - 20} ${Y - 6} ${Z - 20} ${X + 20} ${Y - 1} ${Z + 20} water`);
    rcon(`fill ${X - 20} ${Y} ${Z - 20} ${X + 20} ${Y} ${Z + 20} packed_ice`);                 // сплошной лёд сверху
    await tpSure(tb, 'TbAlex', X, Y - 4, Z); rcon('effect clear TbAlex'); rcon('effect give TbAlex minecraft:instant_health 1 5');
    await sleep(1000);
    let died = false; tb.bot.once('death', () => { died = true; });
    const outT = await until(() => { const h = tb.bot.blockAt(tb.bot.entity.position.offset(0, 1.6, 0)); return h && !/water/.test(h.name); }, 40000);
    ok('подо льдом не утонул: выбрался к воздуху', outT && !died, outT ? `${(outT / 1000).toFixed(1)} с` : died ? 'утонул' : 'не выбрался за 40 с');
  }

  await sleep(1500);
  const fl = execSync(`docker exec tc-up sh -c "tail -n +${log0} /data/logs/latest.log | grep 'Vulcan\\] TbAlex' || true"`).toString().trim();
  ok('отметок Vulcan нет', !fl, fl ? fl.split('\n').length + ': ' + fl.split('\n').slice(0, 6).join(' | ') : '');
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'local', 'logs', 'live_world_test.log'), logs.join('\n'));
  console.log(`--- мир на стенде: ${res.filter((r) => r[1]).length} из ${res.length}`);
  tb.stop(); owner.stop();
  setTimeout(() => process.exit(0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
