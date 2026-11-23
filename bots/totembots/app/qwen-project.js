// Проект Qwen «TotemCraft · боты»: основное хранилище памяти в интернете. Чаты ботов создаются внутри проекта,
// память (memory.js) лежит в проекте файлом и обновляется сама. Память проекта - «Project-only», чтобы не мешалась
// с личной памятью владельца в Qwen. Всё делается так же, как руками: окно «Edit Project», «Add Files», «Save».
// Выбор файла перехватывается отладчиком Electron (Page.setInterceptFileChooserDialog), щелчки - настоящие (Input).
const fs = require('fs');
const path = require('path');

// у тестов свой проект, чтобы тестовая память не попала в настоящую
const NAME = process.env.TOTEMBOTS_PROJECT_NAME || 'TotemBots';
const INSTRUCTIONS = 'Здесь живут боты-игроки Minecraft. Каждый чат - один бот. Правила и вводная ' +
  'приходят в первом сообщении чата. Файл totemcraft-memory.md - память ботов разделами «ПАМЯТЬ БОТА ник»: читай только раздел со своим ником, чужие разделы - не твои воспоминания; ' +
  'опирайся на него, когда нужно вспомнить место или человека. Свежая часть памяти приходит в сообщениях блоком [память].';
const FILE = 'totemcraft-memory.md';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QwenProject {
  /** bridge - QwenBridge (вкладка и очередь), cfg()/save() - настройки, dir - папка для файла, log(text) */
  constructor({ bridge, cfg, save, dir, log }) {
    Object.assign(this, { bridge, cfg, save, dir, log });
    this.wc = bridge.wc;
  }

  get id() { return (this.cfg().qwenProject || {}).id || ''; }

  // в общей очереди моста: вкладка Qwen одна
  // дело с проектом зависло (окно не открылось) - через 90 с отпустить очередь моста, иначе мозг ботов стоит (22.11)
  run(fn) { return this.bridge.exclusive(() => Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('дело с проектом Qwen зависло - пропущено')), 90000))])); }

  dbg() { this.bridge.attachDebugger(); return this.wc.debugger; }
  ev(expr) { return this.wc.executeJavaScript(expr).catch((e) => { throw new Error('скрипт на странице упал: ' + expr.replace(/s+/g, ' ').slice(0, 120)); }); }

  async click(expr) {
    const b = await this.ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!b) return false;
    await this.bridge.passThrough(true);
    try {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await this.dbg().sendCommand('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
      }
    } finally { await this.bridge.passThrough(false); }
    return true;
  }

  async hover(expr) {
    const b = await this.ev(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (b) {
      await this.bridge.passThrough(true);
      try { await this.dbg().sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y }); } finally { await this.bridge.passThrough(false); }
    }
    return !!b;
  }

  async api(pathname) {
    return this.ev(`fetch(${JSON.stringify(pathname)}, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then((r) => r.json()).catch(() => null)`);
  }

  async files() {
    const j = await this.api(`/api/v2/projects/${this.id}/files`);
    return j && j.success ? j.data.files.map((f) => f.name || f.file_name) : null;
  }

  async exists() {
    if (!this.id) return false;
    const j = await this.api(`/api/v2/projects/${this.id}`);
    return !!(j && j.success);
  }

  async waitFor(expr, ms, error) {
    for (let t = 0; t < ms; t += 250) { if (await this.ev(expr)) return true; await sleep(250); }
    throw new Error(error);
  }

  /** Создать проект, если его нет. Возвращает id. */
  ensure() { return this.run(() => this._ensure()); }

  /** То же без очереди: для вызова изнутри запроса моста (перед новым чатом). */
  async _ensure() {
    {
      if (!this.wc.getURL().startsWith('https://chat.qwen.ai')) await this.wc.loadURL('https://chat.qwen.ai/');
      if (await this.exists()) return this.id;
      // может, уже есть проект с таким именем
      const list = await this.api('/api/v2/projects/');
      const found = list && list.success && (list.data.projects || list.data || []).find && (list.data.projects || list.data).find((p) => p.name === NAME);
      if (found) { this.remember(found.id); return found.id; }
      await this.wc.loadURL('https://chat.qwen.ai/');
      await sleep(1500);
      const leaf = (re) => `[...document.querySelectorAll('*')].find((n) => n.childElementCount === 0 && ${re}.test(n.textContent.trim()) && n.getBoundingClientRect().width > 0)`;
      await this.waitFor(leaf('/^New Project$/i') + ' != null', 15000, 'нет кнопки «New Project» (Qwen не загрузился?)');
      if (!await this.click(leaf('/^New Project$/i'))) throw new Error('нет кнопки «New Project»');
      await this.waitFor(`!!document.querySelector('[role=dialog] input[placeholder="Project Name"]')`, 5000, 'окно проекта не открылось');
      await this.ev(`(() => { const d = document.querySelector('[role=dialog] input[placeholder="Project Name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, ${JSON.stringify(NAME)}); d.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await this.click(leaf('/^Advanced Settings$/i'));
      await sleep(600);
      await this.click(leaf('/^Default$/'));
      await sleep(500);
      await this.click(leaf('/^Project-only$/'));
      await sleep(400);
      await this.ev(`(() => { const t = document.querySelector('[role=dialog] textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(INSTRUCTIONS)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await this.click(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^Create project$/i.test(b.textContent.trim()))`);
      for (let i = 0; i < 40 && !/\/p\//.test(this.wc.getURL()); i++) await sleep(250);
      const m = /\/p\/([0-9a-f-]{36})/.exec(this.wc.getURL());
      if (!m) throw new Error('проект не создался');
      this.remember(m[1]);
      this.log(`создан проект Qwen «${NAME}»`);
      return m[1];
    }
  }

  remember(id) {
    const c = this.cfg();
    c.qwenProject = { ...(c.qwenProject || {}), id, name: NAME };
    this.save();
  }

  /** Положить свежий файл памяти в проект (старую версию убрать). */
  syncMemory(markdown) {
    return this.run(async () => {
      if (!this.id) throw new Error('проекта ещё нет');
      const file = path.join(this.dir, FILE);
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, markdown);
      await this.wc.loadURL(`https://chat.qwen.ai/p/${this.id}`);
      await sleep(1800);
      // меню проекта в боковой панели → Edit Project
      // пункт проекта в боковой панели появляется после загрузки списка; «...» видно только при наведении
      await this.waitFor(`!!document.querySelector('.project-item-selected')`, 15000, 'проект не выбран в боковой панели');
      await this.hover(`document.querySelector('.project-item-selected')`);
      await sleep(400);
      if (!await this.click(`document.querySelector('.project-item-selected .project-item-more-trigger')`)) throw new Error('нет меню проекта');
      await sleep(600);
      await this.click(`[...document.querySelectorAll('.qwen-chat-v2-dropdown-menu-item')].find((n) => /Edit Project/i.test(n.textContent) && n.getBoundingClientRect().width > 0)`);
      await this.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((d) => /Edit project/i.test(d.innerText))`, 5000, 'окно «Edit Project» не открылось');
      // убрать прежнюю версию файла (крестик на карточке с тем же именем)
      for (let i = 0; i < 5; i++) {
        const removed = await this.click(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => /Edit project/i.test(x.innerText));
          const card = [...d.querySelectorAll('*')].find((n) => n.childElementCount === 0 && n.textContent.trim() === ${JSON.stringify(FILE)});
          let c = card; while (c && c !== d && !c.querySelector('.pfc__action')) c = c.parentElement;
          return c && c !== d ? c.querySelector('.pfc__action') : null; })()`);
        if (!removed) break;
        await sleep(700);
      }
      // «Add Files» → перехваченное окно выбора файла → наш файл
      const d = this.dbg();
      await d.sendCommand('Page.enable');
      await d.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      let chooser = null;
      const on = (_e, method, params) => { if (method === 'Page.fileChooserOpened') chooser = params; };
      d.on('message', on);
      try {
        await this.click(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /Add Files/i.test(b.textContent))`);
        for (let i = 0; i < 20 && !chooser; i++) await sleep(150);
        if (!chooser) throw new Error('окно выбора файла не открылось');
        await d.sendCommand('DOM.setFileInputFiles', { files: [file], backendNodeId: chooser.backendNodeId });
      } finally {
        d.removeListener('message', on);
        await d.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
      await this.waitFor(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => /Edit project/i.test(x.innerText)); return d && d.innerText.includes(${JSON.stringify(FILE)}); })()`, 20000, 'файл не загрузился');
      await sleep(2500);   // Qwen разбирает файл
      // инструкция проекта - всегда актуальная (могла поменяться с обновлением программы)
      await this.ev(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => /Edit project/i.test(x.innerText));
        const t = d && d.querySelector('textarea'); if (!t || t.value === ${JSON.stringify(INSTRUCTIONS)}) return;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(INSTRUCTIONS)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      // «Save», пока Qwen разбирает файл, не срабатывает: жмём, ждём закрытия окна, при необходимости ещё раз
      const open = `[...document.querySelectorAll('[role=dialog]')].some((x) => /Edit project/i.test(x.innerText) && x.getBoundingClientRect().width > 0)`;
      for (let i = 0; i < 6 && await this.ev(open); i++) {
        await this.click(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => /Edit project/i.test(x.innerText));
          return d ? [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save') : null; })()`);
        for (let t = 0; t < 12 && await this.ev(open); t++) await sleep(250);
      }
      if (await this.ev(open)) throw new Error('Qwen не сохранил проект (окно не закрылось)');
      let names = null;
      for (let i = 0; i < 10 && !(names && names.includes(FILE)); i++) { await sleep(800); names = await this.files(); }
      if (!names || !names.includes(FILE)) throw new Error('после сохранения файла в проекте нет');
      return `память в проекте Qwen обновлена (${names.filter((n) => n === FILE).length} файл)`;
    });
  }
}

module.exports = { QwenProject, PROJECT_NAME: NAME };
