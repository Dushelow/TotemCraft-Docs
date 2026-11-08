package net.totemcraft.regionrules;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Fireball;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Свои правила для регионов WorldGuard, которых нет среди флагов WorldGuard (config.yml):
 * - no-fireball-fire: огненные шары (всполохи, гасты, заряды из раздатчиков) не поджигают блоки.
 *   Урон и поджог игроков и мобов остаются. Флаг ghast-fireball не подходит: он отменяет
 *   и урон от шаров по игрокам (WorldGuardEntityListener.onEntityDamageByProjectile).
 * - no-thorns-damage: выбранные мобы не получают урон от шипов на броне игроков.
 */
public final class RegionRules extends JavaPlugin implements Listener {

    private final Set<String> fireRegions = new HashSet<>();
    private final Set<String> thornsRegions = new HashSet<>();
    private final Set<EntityType> thornsMobs = EnumSet.noneOf(EntityType.class);
    private boolean debug;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        readIds(getConfig().getStringList("no-fireball-fire"), fireRegions);
        readIds(getConfig().getStringList("no-thorns-damage.regions"), thornsRegions);
        for (String name : getConfig().getStringList("no-thorns-damage.mobs")) {
            try {
                thornsMobs.add(EntityType.valueOf(name.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                getLogger().warning("Неизвестный моб в no-thorns-damage.mobs: " + name);
            }
        }
        debug = getConfig().getBoolean("debug", false);
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Без огня от огненных шаров: " + fireRegions);
        getLogger().info("Без урона от шипов " + thornsMobs + ": " + thornsRegions);
    }

    private static void readIds(List<String> from, Set<String> to) {
        for (String id : from) {
            to.add(id.trim().toLowerCase(Locale.ROOT));
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent event) {
        Entity source = event.getIgnitingEntity();
        boolean fireball = event.getCause() == BlockIgniteEvent.IgniteCause.FIREBALL || source instanceof Fireball;
        if (fireball && inRegion(event.getBlock().getLocation(), fireRegions)) {
            event.setCancelled(true);
            if (debug) {
                Block b = event.getBlock();
                getLogger().info("Отменён поджог от " + (source == null ? "шара" : source.getType())
                        + " в " + b.getX() + " " + b.getY() + " " + b.getZ());
            }
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onThorns(EntityDamageEvent event) {
        boolean thorns = event.getCause() == EntityDamageEvent.DamageCause.THORNS;
        // Без debug регион ищем только для урона от шипов: фермы всполохов не нагружаем
        if (!thornsMobs.contains(event.getEntityType()) || (!thorns && !debug)
                || !inRegion(event.getEntity().getLocation(), thornsRegions)) {
            return;
        }
        if (debug) {
            getLogger().info("Урон по " + event.getEntityType() + " в регионе: причина " + event.getCause()
                    + ", " + event.getDamage() + (thorns ? " - отменён" : ""));
        }
        if (thorns) {
            event.setCancelled(true);
        }
    }

    private boolean inRegion(Location location, Set<String> ids) {
        if (ids.isEmpty()) {
            return false;
        }
        ApplicableRegionSet set = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery()
                .getApplicableRegions(BukkitAdapter.adapt(location));
        for (ProtectedRegion region : set) {
            if (ids.contains(region.getId())) {
                return true;
            }
        }
        return false;
    }
}
