// Сундуки: открыть (и под замком), взять, положить, отдать.
// Вынесено из bot.js (разбивка большого файла, 21.11.2026): методы подмешиваются в TotemBot, this - тело бота.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { BUILT } = require('./skills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const isCancel = (e) => e && e.constructor && e.constructor.name === 'Cancelled';

class Containers {
  matchItems(list, want) {
    const w = String(want || '').toLowerCase().replace(/^minecraft:/, '').trim();
    if (!w || w === 'all' || w === 'все' || w === 'всё') return list;
    return list.filter((i) => i.name === w || i.name.endsWith('_' + w) || i.name.startsWith(w + '_') || i.name.includes(w));
  }

  /** Луч из глаз к середине сундука первым упирается в сам сундук (или его вторую половину) и не дальше 4,5 бл. */
  chestVisible(block) {
    const b = this.bot, eye = b.entity.position.offset(0, b.entity.height ? b.entity.height * 0.9 : 1.62, 0), to = block.position.offset(0.5, 0.5, 0.5);
    const d = to.minus(eye), len = d.norm();
    if (len > 4.5) return false;
    let hit = null;
    try { hit = b.world.raycast(eye, d.normalize(), len + 0.5); } catch { return true; }
    if (!hit) return false;
    if (hit.position.equals(block.position)) return true;
    return hit.name === block.name && hit.position.distanceTo(block.position) <= 1;   // вторая половина двойного сундука
  }

  async openAt(x, y, z, tok) {
    const b = this.bot;
    const block = b.blockAt(new Vec3(x, y, z));
    if (!block) throw new Error(`блок ${x} ${y} ${z} не загружен (далеко)`);
    await this.goto(new goals.GoalLookAtBlock(block.position, b.world, { reach: 4 }), tok);   // видеть сундук, а не открывать сквозь стену (16.11)
    // проверить своими глазами: модуль пути считает «видно» от клетки, а тело встаёт чуть иначе - и открывало сквозь
    // стену или стекло (22.11). Не видно - подойти вплотную; всё равно не видно - не открывать.
    if (!this.chestVisible(block)) {
      try { await this.goto(new goals.GoalNear(x, y, z, 1), tok, 20000); } catch (e) { if (isCancel(e)) throw e; }
      if (!this.chestVisible(block)) throw new Error(`сундук ${x} ${y} ${z} за препятствием - не открываю сквозь стену`);
    }
    this.busyLook = true;
    try {
      await b.lookAt(block.position.offset(0.5, 0.5, 0.5));
      return await b.openContainer(block);
    } finally { this.busyLook = false; }
  }

  /**
   * Открыть сундук; под замком LWC сервер пишет «принадлежит другому игроку» и окно не открывается (ждали 20 с, а бот
   * думал, что сундуки «переполнены», 21.11). Такой сундук запоминается чужим и больше не выбирается.
   */
  async openLocked(x, y, z, tok) {
    const before = (this.lastSystem || []).length;
    try { return await this.openAt(x, y, z, tok); }
    catch (e) {
      const said = (this.lastSystem || []).slice(before).join(' ');
      if (/принадлежит другому|protected|locked|заблокирован/i.test(said) || /windowOpen did not fire/.test(e.message)) {
        (this.lockedChests = this.lockedChests || new Set()).add(`${x},${y},${z}`);
        throw new Error(`сундук ${x} ${y} ${z} чужой, под замком - класть туда нельзя, нужен свой сундук`);
      }
      throw e;
    }
  }

  // сундук не назван - ближайший (6 блоков)
  nearestChest(a) {
    if (!a.nearest && a.x !== undefined) return a;
    const lk = this.lockedChests || new Set();
    let k = this.bot.findBlocks({ matching: (bl) => /^(chest|trapped_chest|barrel)$|shulker_box$/.test(bl.name), maxDistance: 6, count: 20 }).map((p) => this.bot.blockAt(p)).find((x) => !lk.has(`${x.position.x},${x.position.y},${x.position.z}`));
    // в доме - и на другом этаже (16.11: «на втором этаже сундуки, подойди» - бот искал только в 6 блоках)
    if (!k && this.house()) { const h = this.house(); const free = h.chests.find((v) => !lk.has(`${v.x},${v.y},${v.z}`)); if (free) k = this.bot.blockAt(free); }
    if (!k) throw new Error('рядом нет сундука - нужны координаты: !takeFromChest(x, y, z, предмет, сколько)');
    return { ...a, x: k.position.x, y: k.position.y, z: k.position.z };
  }

  async take(a, tok) {
    a = this.nearestChest(a);
    const c = await this.openAt(+a.x, +a.y, +a.z, tok);
    let left = a.count ? +a.count : Infinity, got = 0;
    try {
      for (const it of this.matchItems(c.containerItems(), a.item)) {
        if (left <= 0) break;
        const n = Math.min(left, it.count);
        await c.withdraw(it.type, null, n);
        left -= n; got += n;
        await sleep(rnd(150, 400));
      }
      if (this.noteChest && this.ownChest && this.ownChest({ x: +a.x, y: +a.y, z: +a.z })) this.noteChest(+a.x, +a.y, +a.z, c.containerItems());
    } finally { c.close(); }
    if (!got) throw new Error(`в сундуке ${a.x} ${a.y} ${a.z} нет ${a.item}`);
    return `взял ${got} ${a.item} из ${a.x} ${a.y} ${a.z}`;
  }

  async put(a, tok) {
    a = this.nearestChest(a);
    const c = await this.openLocked(+a.x, +a.y, +a.z, tok);
    let left = a.count ? +a.count : Infinity, put = 0;
    try {
      for (const it of this.matchItems(this.bot.inventory.items(), a.item)) {
        if (left <= 0) break;
        const n = Math.min(left, it.count);
        await c.deposit(it.type, null, n);
        this.noteDeposit(a, it.name, n);
        left -= n; put += n;
        await sleep(rnd(150, 400));
      }
      if (put && this.noteChest) this.noteChest(+a.x, +a.y, +a.z, c.containerItems());   // что теперь лежит в своём сундуке (obtain.js)
    } finally { c.close(); }
    if (!put) throw new Error(`нет у меня ${a.item}`);
    try { const h = require('./life').home(this); if (!h || Math.hypot(h.x - a.x, h.z - a.z) > 24) this.autoMark('мои вещи в сундуке', { x: +a.x, y: +a.y, z: +a.z }, { kind: 'мои вещи', radius: 8, ttl: 7 * 86400000, note: `${put} ${a.item}` }); } catch {}
    return `положил ${put} ${a.item} в ${a.x} ${a.y} ${a.z}`;
  }

  /** Запомнить, что и куда положила (для «верни обратно»): последняя раскладка, 10 мин. */
  noteDeposit(v, name, n) {
    const now = Date.now();
    if (!this.lastDeposit || now - this.lastDeposit.at > 60000) this.lastDeposit = { at: now, list: [] };
    this.lastDeposit.at = now;
    const k = `${v.x},${v.y},${v.z}`;
    let e = this.lastDeposit.list.find((x) => x.k === k);
    if (!e) this.lastDeposit.list.push(e = { k, x: +v.x, y: +v.y, z: +v.z, items: {} });
    e.items[name] = (e.items[name] || 0) + n;
  }

  /** «Верни обратно»: забрать из сундуков то, что сама положила последней раскладкой (не старше 10 мин). */
  async undoPut(a, tok) {
    const d = this.lastDeposit;
    if (!d || Date.now() - d.at > 600000) throw new Error('нечего возвращать: в последние 10 минут я ничего не клала в сундуки');
    let got = 0;
    for (const e of d.list) {
      this.check(tok);
      const c = await this.openAt(e.x, e.y, e.z, tok);
      try {
        for (const [name, want] of Object.entries(e.items)) {
          let left = want;
          for (const it of c.containerItems().filter((i) => i.name === name)) {
            if (left <= 0) break;
            const n = Math.min(left, it.count);
            try { await c.withdraw(it.type, null, n); } catch { break; }   // инвентарь полон
            left -= n; got += n; e.items[name] -= n;
            await sleep(rnd(150, 350));
          }
        }
      } finally { c.close(); }
    }
    d.list = d.list.filter((e) => Object.values(e.items).some((n) => n > 0));
    if (!d.list.length) this.lastDeposit = null;
    if (!got) throw new Error('не вышло забрать: вещей уже нет в сундуках или инвентарь полон');
    return `забрала обратно ${got} шт.` + (this.lastDeposit ? ' (не всё поместилось)' : '');
  }

  async give(a, tok) {
    const b = this.bot;
    const e = this.player(a.who);
    if (!e) throw new Error(`не вижу ${a.who} (далеко или в другом измерении)`);
    await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), tok);
    const e2 = this.player(a.who);
    if (e2) await b.lookAt(e2.position.offset(0, 1.2, 0));
    let left = a.count ? +a.count : Infinity, gave = 0;
    for (const it of this.matchItems(b.inventory.items(), a.item)) {
      if (left <= 0) break;
      const n = Math.min(left, it.count);
      await b.toss(it.type, null, n);
      left -= n; gave += n;
      await sleep(rnd(200, 500));
    }
    if (!gave) throw new Error(`нет у меня ${a.item}`);
    return `отдал ${a.who} ${gave} ${a.item}`;
  }

}

module.exports = { Containers };
