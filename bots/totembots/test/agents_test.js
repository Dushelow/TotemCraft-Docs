// Пункты из AGENTS.md на стенде: план крафта, рефлексы (огонь, вещи рядом), команды через мозг. node test/agents_test.js
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TotemBot } = require('../app/bot');
const { Memory } = require('../app/memory');
const { Brain } = require('../app/brain');
const rcon = (c) => execSync(`docker exec tc-up rcon-cli "${c}"`).toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, w) => { console.log((c ? 'OK   ' : 'FAIL ') + w); if (!c) fails++; };
const X = 1200, Y = 150, Z = 1000;
(async () => {
  rcon(`forceload add ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`);
  rcon(`fill ${X - 10} ${Y - 1} ${Z - 10} ${X + 10} ${Y - 1} ${Z + 10} stone`);
  rcon(`fill ${X - 10} ${Y} ${Z - 10} ${X + 10} ${Y + 5} ${Z + 10} air`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbag-'));
  const tb = new TotemBot({ name: 'TbAlex', password: 'Tb12345x', host: '127.0.0.1', port: 25566, combat: 'off' });
  tb.memory = new Memory(dir);
  const logs = []; tb.on('log', (t) => logs.push(t));
  tb.start(); await new Promise((r) => tb.once('event', r)); await sleep(1500);
  rcon('clear TbAlex'); rcon('give TbAlex oak_log 2');
  rcon(`execute in minecraft:overworld run minecraft:tp TbAlex ${X} ${Y} ${Z}`); await sleep(3000);
  const p = await tb.run([{ act: 'plan', item: 'stone_pickaxe' }], 'p');
  console.log(p);
  ok(/oak_planks/.test(p) && /cobblestone/.test(p) && /crafting_table/.test(p), 'план каменной кирки: доски, булыжник, верстак');
  const c = await tb.run([{ act: 'craftable' }], 'c'); console.log(c.slice(0, 160));
  ok(/oak_planks/.test(c), 'craftable видит доски');
  // огонь под ногами - уйти
  rcon(`setblock ${X} ${Y} ${Z} fire`); await sleep(5000);
  const f = tb.bot.blockAt(tb.bot.entity.position);
  ok(f && f.name !== 'fire', 'из огня ушёл сам: ' + logs.filter((l) => /горю/.test(l)).slice(-1));
  // вещи рядом - подобрать
  rcon(`summon item ${X + 3} ${Y} ${Z + 2} {Item:{id:\\"minecraft:apple\\",count:3}}`); await sleep(14000);
  ok(tb.bot.inventory.items().some((i) => i.name === 'apple'), 'вещи рядом подобрал сам');
  // мозг: !plan через нейросеть-заглушку, ответ - в [итог]
  const sent = []; let answers = ['ок', 'надо понять как !plan(wooden_pickaxe)'];
  const brain = new Brain({ body: tb, bridge: { ask: async (id, m) => { sent.push(m); return { answer: answers.shift() || 'ок', chatId: 'x' }; } }, cfg: () => ({ masters: ['Valghard'], qwen: {} }), botCfg: { name: 'TbAlex', chatId: '' }, save: () => {}, log: () => {} });
  brain.memory = tb.memory;
  brain.push('[приказ хозяина Valghard из панели] сделай деревянную кирку', true, 'Valghard');
  for (let i = 0; i < 40 && !sent.some((m) => /\[итог\] план/.test(m)); i++) await sleep(500);
  ok(sent.some((m) => /\[итог\] план для wooden_pickaxe/.test(m)), 'мозг получил план в [итог] и продолжает');
  ok(/КАК ТЫ УСТРОЕН/.test(sent[0]) && /!plan/.test(sent[0]), 'вводная с руководством и командами');
  brain.stop(); tb.stop(); rcon(`forceload remove ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`);
  console.log(fails ? `НЕ ПРОШЛО: ${fails}` : 'всё прошло'); setTimeout(() => process.exit(fails ? 1 : 0), 400);
})().catch((e) => { console.error(e); process.exit(1); });
