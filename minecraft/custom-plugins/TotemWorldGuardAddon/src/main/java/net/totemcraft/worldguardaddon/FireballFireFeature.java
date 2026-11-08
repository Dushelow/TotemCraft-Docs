package net.totemcraft.worldguardaddon;

import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Fireball;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Огненные шары (всполохи, гасты, огненные заряды из раздатчиков) не поджигают блоки в регионах.
 * Урон и поджог игроков и мобов остаются: отменяется только появление огня на блоках.
 * <p>
 * Флаг WorldGuard ghast-fireball для этого не подходит: кроме огня он отменяет и урон от шаров
 * по игрокам (WorldGuardEntityListener.onEntityDamageByProjectile).
 */
final class FireballFireFeature implements Listener {

    private final JavaPlugin plugin;
    private final Regions regions;
    private final boolean debug;

    FireballFireFeature(JavaPlugin plugin, Regions regions, boolean debug) {
        this.plugin = plugin;
        this.regions = regions;
        this.debug = debug;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent event) {
        Entity source = event.getIgnitingEntity();
        boolean fireball = event.getCause() == BlockIgniteEvent.IgniteCause.FIREBALL || source instanceof Fireball;
        if (fireball && regions.contains(event.getBlock().getLocation())) {
            event.setCancelled(true);
            if (debug) {
                Block b = event.getBlock();
                plugin.getLogger().info("Отменён поджог от " + (source == null ? "шара" : source.getType())
                        + " в " + b.getX() + " " + b.getY() + " " + b.getZ());
            }
        }
    }
}
