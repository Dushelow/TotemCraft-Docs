package net.totemcraft.worldguardaddon;

import org.bukkit.entity.EntityType;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Выбранные мобы в регионах не получают урон от шипов на броне игроков. */
final class ThornsFeature implements Listener {

    private final JavaPlugin plugin;
    private final Regions regions;
    private final Set<EntityType> mobs = EnumSet.noneOf(EntityType.class);
    private final boolean debug;

    ThornsFeature(JavaPlugin plugin, Regions regions, List<String> mobNames, boolean debug) {
        this.plugin = plugin;
        this.regions = regions;
        this.debug = debug;
        for (String name : mobNames) {
            try {
                mobs.add(EntityType.valueOf(name.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                plugin.getLogger().warning("Неизвестный моб в no-thorns-damage.mobs: " + name);
            }
        }
    }

    String describe() {
        return mobs + " в " + regions;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        boolean thorns = event.getCause() == EntityDamageEvent.DamageCause.THORNS;
        // Без debug регион ищем только для урона от шипов: фермы всполохов не нагружаем
        if (!mobs.contains(event.getEntityType()) || (!thorns && !debug)
                || !regions.contains(event.getEntity().getLocation())) {
            return;
        }
        if (debug) {
            plugin.getLogger().info("Урон по " + event.getEntityType() + " в регионе: причина " + event.getCause()
                    + ", " + event.getDamage() + (thorns ? " - отменён" : ""));
        }
        if (thorns) {
            event.setCancelled(true);
        }
    }
}
