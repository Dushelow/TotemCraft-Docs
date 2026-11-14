package net.totemcraft.mobrules;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityCombustByEntityEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Правила урона (damage-rules): существа из victims не получают урон от мобов из from-mobs (удар, снаряд,
 * взрыв снаряда) или от причин из from-causes (thorns, fire, fire_tick, lava...) в месте where.
 * Достаточно одного совпадения: моб ИЛИ причина. От мобов из from-mobs victims ещё и не загораются.
 * Игроки в victims допустимы, но по умолчанию правила только для мобов.
 * <p>
 * Быстрый путь: если тип пострадавшего не встречается ни в одном правиле, событие отпускается сразу,
 * регионы WorldGuard проверяются последними.
 */
final class DamageRulesFeature implements Listener {

    private record Rule(String name, Set<EntityType> victims, Set<EntityType> fromMobs,
                        Set<EntityDamageEvent.DamageCause> fromCauses, Scope where, AtomicLong blocked) {
    }

    private final List<Rule> rules = new ArrayList<>();
    private final Set<EntityType> anyVictim = EnumSet.noneOf(EntityType.class);

    DamageRulesFeature(JavaPlugin plugin, ConfigurationSection section) {
        for (String name : section.getKeys(false)) {
            ConfigurationSection r = section.getConfigurationSection(name);
            if (r == null || !r.getBoolean("enabled", true)) {
                continue;
            }
            Set<EntityDamageEvent.DamageCause> causes = EnumSet.noneOf(EntityDamageEvent.DamageCause.class);
            for (String c : r.getStringList("from-causes")) {
                try {
                    causes.add(EntityDamageEvent.DamageCause.valueOf(c.trim().toUpperCase(Locale.ROOT)));
                } catch (IllegalArgumentException e) {
                    plugin.getLogger().warning("Неизвестная причина урона в damage-rules." + name + ": " + c);
                }
            }
            Rule rule = new Rule(name, Scope.mobs(r.getStringList("victims"), "damage-rules." + name + ".victims", plugin.getLogger()),
                    Scope.mobs(r.getStringList("from-mobs"), "damage-rules." + name + ".from-mobs", plugin.getLogger()),
                    causes, new Scope(r.getConfigurationSection("where")), new AtomicLong());
            if (rule.victims().isEmpty() || (rule.fromMobs().isEmpty() && causes.isEmpty())) {
                plugin.getLogger().warning("Правило damage-rules." + name + " пустое (нет victims или источников), пропущено");
                continue;
            }
            rules.add(rule);
            anyVictim.addAll(rule.victims());
        }
    }

    boolean isEmpty() {
        return rules.isEmpty();
    }

    List<Scope> scopes() {
        return rules.stream().map(Rule::where).toList();
    }

    String describe() {
        StringBuilder sb = new StringBuilder();
        for (Rule r : rules) {
            sb.append("\n  ").append(r.name()).append(": ").append(r.victims()).append(" от ")
                    .append(r.fromMobs().isEmpty() ? "" : r.fromMobs() + " ")
                    .append(r.fromCauses().isEmpty() ? "" : r.fromCauses() + " ").append(r.where())
                    .append(", отменено ").append(r.blocked().get());
        }
        return sb.toString();
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        Entity victim = event.getEntity();
        if (!anyVictim.contains(victim.getType())) {
            return;
        }
        EntityType attacker = event instanceof EntityDamageByEntityEvent byEntity
                ? Sources.culprit(byEntity.getDamager()).getType() : null;
        for (Rule rule : rules) {
            if (rule.victims().contains(victim.getType())
                    && ((attacker != null && rule.fromMobs().contains(attacker)) || rule.fromCauses().contains(event.getCause()))
                    && rule.where().contains(victim.getLocation())) {
                event.setCancelled(true);
                rule.blocked().incrementAndGet();
                if (event.getCause() == EntityDamageEvent.DamageCause.FIRE_TICK) {
                    victim.setFireTicks(0);
                }
                return;
            }
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onCombust(EntityCombustByEntityEvent event) {
        Entity victim = event.getEntity();
        if (!anyVictim.contains(victim.getType())) {
            return;
        }
        EntityType attacker = Sources.culprit(event.getCombuster()).getType();
        for (Rule rule : rules) {
            if (rule.victims().contains(victim.getType()) && rule.fromMobs().contains(attacker)
                    && rule.where().contains(victim.getLocation())) {
                event.setCancelled(true);
                return;
            }
        }
    }
}
