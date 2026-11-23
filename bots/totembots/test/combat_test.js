// Боевые приёмы (guard.js combatTick) на модели: тики вручную, физику прыжка изображаем сами.
//  1) удар в прыжке: прыжок перед готовностью меча, удар только в падении (крит);
//  2) щит между ударами против зомби: поднят, пока меч не готов, опущен перед ударом;
//  3) против крипера - без прыжков и щита.
// node test/combat_test.js
const { Vec3 } = require('vec3');
const { Guard } = require('../app/guard');
const res = []; const ok = (n, c, i) => { res.push(!!c); console.log(`${c ? 'да ' : 'НЕТ'} ${n}${i !== undefined ? ' - ' + i : ''}`); };

function setup(mob) {
  const ctl = {}, hits = [], log = [];
  const ent = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, height: 1.8, yaw: 0, pitch: 0 };
  const b = {
    entity: ent, health: 20, heldItem: { name: 'iron_sword' },
    inventory: { slots: { 45: { name: 'shield' } }, items: () => [{ name: 'iron_sword' }] },
    setControlState: (k, v) => { ctl[k] = v; log.push(`${k}=${v}`); }, getControlState: (k) => !!ctl[k],
    look: () => {}, attack: () => hits.push({ ground: ent.onGround, vy: ent.velocity.y }),
    activateItem: (o) => log.push('shield-up'), deactivateItem: () => log.push('shield-down'),
  };
  const g = Object.create(Guard.prototype);
  g.tb = { bot: b, eating: false, log: () => {} };
  Object.defineProperty(g, 'bot', { get: () => b });
  g.fighting = true; g.lastHit = -100; g.tick = 0; g.aimed = true;
  g.target = { isValid: true, name: mob, position: new Vec3(0, 64, -2), height: 1.9 };
  return { g, b, ent, ctl, hits, log };
}

// 1-2: зомби
{
  const { g, ent, ctl, hits, log } = setup('zombie');
  let air = 0;
  for (let i = 0; i < 120; i++) {
    g.tick++;
    // физика прыжка: жмём прыжок на земле - 6 тиков вверх, потом 6 вниз
    if (ctl.jump && ent.onGround && !air) { air = 12; ent.onGround = false; }
    if (air) { air--; ent.velocity.y = air > 6 ? 0.3 : -0.3; if (!air) { ent.onGround = true; ent.velocity.y = 0; } }
    g.combatTick();
  }
  ok('удары были', hits.length >= 3, `${hits.length} ударов за 6 с`);
  ok('удары в падении (криты): не меньше 70% после первого', hits.length && hits.filter((h) => !h.ground && h.vy < 0).length >= (hits.length - 1) * 0.7, hits.map((h) => (h.ground ? 'земля' : 'падение')).join(', '));
  ok('щит поднимался между ударами и опускался перед ударом', log.includes('shield-up') && log.includes('shield-down'));
}
// 3: крипер
{
  const { g, ent, hits, log, ctl } = setup('creeper');
  for (let i = 0; i < 60; i++) { g.tick++; g.combatTick(); }
  ok('против крипера: без прыжков и без щита', !log.includes('jump=true') && !log.includes('shield-up') && hits.length >= 1, `${hits.length} ударов`);
}
console.log(`--- боевые приёмы: ${res.filter(Boolean).length} из ${res.length}`);
