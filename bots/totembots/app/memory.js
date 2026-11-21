// Память ботов: общая на сервер (места, люди, факты) и своя у каждого бота (дневник).
// Бот пополняет её сам: Qwen присылает действие remember, тело само пишет смерти, порталы, встречи.
// Хранится текстом: основная копия - файлы проекта Qwen (см. qwen-project.js), резерв - %APPDATA%/totembots/memory/*.json
// (несколько килобайт). В каждое сообщение для Qwen подставляется короткая сводка, если память изменилась.
const fs = require('fs');
const path = require('path');

const LIMITS = { places: 80, people: 80, facts: 60, journal: 60 };
const now = () => Date.now();
const clean = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s) => clean(s, 40).toLowerCase();

class Memory {
  constructor(dir, world = 'totemcraft') {
    this.file = path.join(dir, 'memory', world + '.json');
    this.data = { places: {}, people: {}, facts: [], bots: {}, news: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch {}
    this.version = 0;
    this.listeners = [];
  }

  onChange(cb) { this.listeners.push(cb); }

  save() {
    this.version++;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
    for (const cb of this.listeners) { try { cb(); } catch {} }
  }

  bot(name) {
    if (!this.data.bots[name]) this.data.bots[name] = { journal: [] };
    return this.data.bots[name];
  }

  trim() {
    const cut = (obj, n) => {
      const ks = Object.keys(obj).sort((a, b) => (obj[b].at || 0) - (obj[a].at || 0));
      for (const k of ks.slice(n)) delete obj[k];
    };
    cut(this.data.places, LIMITS.places);
    cut(this.data.people, LIMITS.people);
    this.data.facts = this.data.facts.slice(-LIMITS.facts);
    for (const b of Object.values(this.data.bots)) b.journal = b.journal.slice(-LIMITS.journal);
  }

  /** Место: name, x y z, dim, note. by - кто запомнил. Возвращает текст для журнала. */
  place({ name, x, y, z, dim, note }, by) {
    const n = clean(name, 40);
    if (!n || [x, y, z].some((v) => !Number.isFinite(+v))) return 'не запомнил место: нужны название и координаты';
    const old = this.data.places[key(n)];
    this.data.places[key(n)] = { name: n, x: Math.round(+x), y: Math.round(+y), z: Math.round(+z), dim: dim || 'обычный мир',
      note: clean(note, 120), by, at: now() };
    this.trim(); this.save();
    return `${old ? 'обновил' : 'запомнил'} место «${n}»: ${Math.round(+x)} ${Math.round(+y)} ${Math.round(+z)} (${dim || 'обычный мир'})`;
  }

  person({ name, note }, by) {
    const n = clean(name, 16);
    if (!n || !note) return 'не запомнил человека: нужны ник и заметка';
    const old = this.data.people[key(n)];
    const text = old && old.note && !old.note.includes(clean(note, 120)) ? clean(old.note + '; ' + note, 300) : clean(note, 300);
    this.data.people[key(n)] = { name: n, note: text, by, at: now() };
    this.trim(); this.save();
    return `запомнил про ${n}`;
  }

  fact({ text }, by) {
    const t = clean(text, 200);
    if (!t) return 'нечего запоминать';
    if (this.data.facts.some((f) => f.text === t)) return 'это уже знаю';
    this.data.facts.push({ text: t, by, at: now() });
    this.trim(); this.save();
    return 'запомнил';
  }

  forget({ kind, name, text }) {
    if (kind === 'place' && this.data.places[key(name)]) { delete this.data.places[key(name)]; this.save(); return `забыл место «${name}»`; }
    if (kind === 'person' && this.data.people[key(name)]) { delete this.data.people[key(name)]; this.save(); return `забыл про ${name}`; }
    if (kind === 'fact') { const n = this.data.facts.length; this.data.facts = this.data.facts.filter((f) => !f.text.includes(clean(text || name, 200))); if (n !== this.data.facts.length) { this.save(); return 'забыл'; } }
    return 'такого не помню';
  }

  /** Новости из общего чата (сжатие фона служебным чатом): строки, последние 30. */
  news(lines) {
    this.data.news = this.data.news || [];
    for (const l of lines) { const t = clean(l, 220); if (t) this.data.news.push({ text: t, at: now() }); }
    this.data.news = this.data.news.slice(-30);
    this.save();
  }

  lesson(text, by) {
    const t = clean(text, 200);
    if (!t) return 'пустой урок';
    this.data.lessons = (this.data.lessons || []).filter((l) => l.text !== t).concat({ text: t, by, at: now() }).slice(-40);
    this.save();
    return 'запомнил урок';
  }

  /** Своё правило поведения (бот сам себе пишет инструкцию: чему научился, как поступать). До 25 штук. */
  rule(botName, text) {
    const t = clean(text, 220);
    if (!t) return 'пустое правило';
    const me = this.bot(botName);
    me.rules = (me.rules || []).filter((r) => r !== t).concat(t).slice(-25);
    this.save();
    return 'правило записал';
  }

  forgetRule(botName, text) {
    const me = this.bot(botName), q = clean(text, 120).toLowerCase(), n = (me.rules || []).length;
    me.rules = (me.rules || []).filter((r) => !r.toLowerCase().includes(q));
    this.save();
    return n === me.rules.length ? 'такого правила нет' : 'правило убрал';
  }

  journal(botName, text) {
    const j = this.bot(botName).journal;
    const t = clean(text, 200);
    if (j.length && j[j.length - 1].text === t) return;
    j.push({ text: t, at: now() });
    this.trim(); this.save();
  }

  findPlace(name) {
    const k = key(name);
    const pl = this.data.places[k] || Object.values(this.data.places).find((p) => key(p.name).includes(k) || k.includes(key(p.name)));
    if (pl || !k) return pl;
    // нет такого места - может, есть табличка с этим словом (атлас: «к капитану», «ферма слизней»)
    const s = Object.values(this.data.signs || {}).find((x) => key(x.text).includes(k));
    return s ? { name: 'табличка «' + s.text.slice(0, 40) + '»', x: s.x, y: s.y, z: s.z, dim: s.dim, sign: true } : null;
  }

  /** Ближайшее известное место (для «я у склада»). */
  nearestPlace(pos, dim, maxDist = 24) {
    let best = null, bd = maxDist;
    for (const p of Object.values(this.data.places)) {
      if (p.dim !== dim) continue;
      const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Короткая сводка для Qwen. */
  digest(botName) {
    const d = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const places = Object.values(this.data.places).sort((a, b) => b.at - a.at).slice(0, 40)
      .map((p) => `${p.name}: ${p.x} ${p.y} ${p.z} (${p.dim})${p.note ? ' - ' + p.note : ''}`);
    const people = Object.values(this.data.people).sort((a, b) => b.at - a.at).slice(0, 30).map((p) => `${p.name}: ${p.note}`);
    const facts = this.data.facts.slice(-20).map((f) => f.text);
    const journal = this.bot(botName).journal.slice(-10).map((j) => `${d(j.at)} ${j.text}`);
    return [
      '[память]',
      'Твои правила (ты сам их написал, соблюдай): ' + ((this.bot(botName).rules || []).join('; ') || 'пока нет'),
      'Места: ' + (places.join('; ') || 'пока нет'),
      'Люди: ' + (people.join('; ') || 'пока нет'),
      'Факты: ' + (facts.join('; ') || 'пока нет'),
      'Уроки из опыта: ' + ((this.data.lessons || []).slice(-15).map((l) => l.text).join('; ') || 'пока нет'),
      'Твои навыки (!skill): ' + (Object.keys(this.bot(botName).skills || {}).join(', ') || 'пока нет'),
      'Твой дневник (последнее): ' + (journal.join('; ') || 'пусто'),
      'Новости чата (сводка общего чата): ' + ((this.data.news || []).slice(-6).map((n) => `${d(n.at)} ${n.text}`).join('; ') || 'пока нет'),
    ].join('\n');
  }

  /** Полный текст для файла проекта Qwen. */
  markdown() {
    const d = (t) => new Date(t).toLocaleString('ru-RU');
    const out = ['# Память ботов TotemCraft', '', `Обновлено: ${d(now())}`, '', '## Места'];
    for (const p of Object.values(this.data.places).sort((a, b) => a.name.localeCompare(b.name))) out.push(`- ${p.name}: ${p.x} ${p.y} ${p.z}, ${p.dim}${p.note ? ' - ' + p.note : ''} (запомнил ${p.by}, ${d(p.at)})`);
    out.push('', '## Люди');
    for (const p of Object.values(this.data.people).sort((a, b) => a.name.localeCompare(b.name))) out.push(`- ${p.name}: ${p.note}`);
    out.push('', '## Факты');
    for (const f of this.data.facts) out.push(`- ${f.text} (${f.by})`);
    out.push('', '## Новости чата');
    for (const n of this.data.news || []) out.push(`- ${d(n.at)} ${n.text}`);
    for (const [name, b] of Object.entries(this.data.bots)) {
      out.push('', `## Дневник ${name}`);
      for (const j of b.journal) out.push(`- ${d(j.at)} ${j.text}`);
    }
    return out.join('\n') + '\n';
  }
}

module.exports = { Memory };
