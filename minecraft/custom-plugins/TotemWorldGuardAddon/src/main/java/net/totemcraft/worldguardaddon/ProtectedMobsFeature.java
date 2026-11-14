package net.totemcraft.worldguardaddon;

import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityCombustByEntityEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Выбранные мобы (victims, например жители) в регионах не получают урон от выбранных мобов (attackers,
 * например всполохи): ни ударом, ни снарядом (огненный шар), и не загораются от них. По желанию ещё
 * не горят в огне внутри региона (fire-damage). Регионы пустые - на всей карте. Игроков не касается.
 */
final class ProtectedMobsFeature implements Listener {

    private final Regions regions;
    private final boolean everywhere;
    private final Set<EntityType> victims = EnumSet.noneOf(EntityType.class);
    private final Set<EntityType> attackers = EnumSet.noneOf(EntityType.class);
    private final boolean fireDamage;

    ProtectedMobsFeature(JavaPlugin plugin, List<String> regionNames, List<String> victimNames,
                         List<String> attackerNames, boolean fireDamage) {
        this.regions = new Regions(regionNames);
        this.everywhere = regionNames.isEmpty();
        this.fireDamage = fireDamage;
        read(plugin, victimNames, victims, "victims");
        read(plugin, attackerNames, attackers, "attackers");
    }

    private static void read(JavaPlugin plugin, List<String> names, Set<EntityType> to, String key) {
        for (String name : names) {
            try {
                to.add(EntityType.valueOf(name.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                plugin.getLogger().warning("Неизвестный моб в protected-mobs." + key + ": " + name);
            }
        }
    }

    String describe() {
        return victims + " от " + attackers + (fireDamage ? " и огня" : "") + ", " + (everywhere ? "везде" : "в " + regions);
    }

    private boolean protectedHere(Entity victim) {
        return victims.contains(victim.getType()) && (everywhere || regions.contains(victim.getLocation()));
    }

    /** Кто на самом деле напал: моб сам или хозяин снаряда. */
    private boolean fromAttacker(Entity damager) {
        Entity source = damager;
        if (damager instanceof Projectile projectile && projectile.getShooter() instanceof LivingEntity shooter) {
            source = shooter;
        }
        return attackers.contains(source.getType());
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (fromAttacker(event.getDamager()) && protectedHere(event.getEntity())) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onCombust(EntityCombustByEntityEvent event) {
        if (fromAttacker(event.getCombuster()) && protectedHere(event.getEntity())) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onFire(EntityDamageEvent event) {
        if (!fireDamage || event instanceof EntityDamageByEntityEvent) {
            return;
        }
        EntityDamageEvent.DamageCause cause = event.getCause();
        if ((cause == EntityDamageEvent.DamageCause.FIRE || cause == EntityDamageEvent.DamageCause.FIRE_TICK)
                && protectedHere(event.getEntity())) {
            event.setCancelled(true);
            event.getEntity().setFireTicks(0);
        }
    }
}
