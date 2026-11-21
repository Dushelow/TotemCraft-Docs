// Здоровье частей тела (как изоляция сбоев и телеметрия в больших играх и сервисах):
//  - каждая часть (навигация, чувства, метки, факелы, кэш мира...) работает через tick(): её ошибка не роняет
//    остальное, но и не прячется - считается, пишется в журнал (первая и потом раз в 5 минут), видна в панели;
//  - бюджет времени: часть дольше 40 мс за раз - отмечается как «медленная» (бот не должен подтормаживать);
//  - выключатель: часть можно выключить в настройках, не трогая код (features.<имя> = false), - если что-то
//    ведёт себя странно в игре, хозяин выключает его, пока чиним.
// Раньше было «catch {}» - ошибка в навигации 22.11 молча ломала ходьбу, и бот стоял на поле.
const BUDGET_MS = 40;

class Health {
  /** Включена ли часть (по умолчанию - да). */
  on(name) { return !(this.opts && this.opts.features && this.opts.features[name] === false); }

  /** Записать сбой части: счёт, последняя ошибка, в журнал - первая и потом не чаще раза в 5 мин. */
  fault(name, err) {
    const H = (this.health = this.health || {});
    const h = (H[name] = H[name] || { n: 0, slow: 0, last: '', at: 0, said: 0 });
    h.n++; h.last = String(err && err.message || err).slice(0, 160); h.at = Date.now();
    if (h.n === 1 || Date.now() - h.said > 300000) { h.said = Date.now(); this.log(`сбой части «${name}» (${h.n} раз): ${h.last}`); }
    if (this.ev) this.ev('сбой', { part: name, err: h.last });
  }

  /** Выполнить часть тела: выключатель, изоляция сбоя, бюджет времени. fn может быть асинхронной. */
  tick(name, fn) {
    if (!this.on(name)) return undefined;
    const t0 = Date.now();
    const done = () => {
      const ms = Date.now() - t0;
      if (ms > BUDGET_MS) { const H = (this.health = this.health || {}); const h = (H[name] = H[name] || { n: 0, slow: 0, last: '', at: 0, said: 0 }); h.slow++; h.slowMs = ms; }
    };
    try {
      const r = fn();
      if (r && typeof r.then === 'function') return r.then((v) => { done(); return v; }, (e) => { if (!(e && e.constructor && e.constructor.name === 'Cancelled')) this.fault(name, e); });
      done();
      return r;
    } catch (e) { this.fault(name, e); return undefined; }
  }

  /** Для панели: части со сбоями и медленные. */
  healthState() {
    const out = [];
    for (const [k, h] of Object.entries(this.health || {})) if (h.n || h.slow > 5) out.push({ part: k, n: h.n, slow: h.slow, last: h.last, at: h.at });
    return out;
  }
}

module.exports = { Health, BUDGET_MS };
