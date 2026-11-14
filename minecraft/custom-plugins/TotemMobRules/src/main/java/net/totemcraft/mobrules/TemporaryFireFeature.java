package net.totemcraft.mobrules;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Огонь, который поставили мобы из sources (шаром или взрывом своего шара), временный: горит как обычно
 * (игрок в нём горит и получает урон), но через burn-seconds гаснет сам, блоки под ним не сгорают
 * (burn-blocks: false) и дальше не ползёт (spread: false). Огонь от игроков, лавы, молнии не трогаем.
 * В 26.x источником поджога приходит сам стрелок, в старых версиях - снаряд: учитываем оба.
 */
final class TemporaryFireFeature implements Listener {

    private final JavaPlugin plugin;
    private final Set<EntityType> sources;
    private final Scope where;
    private final long burnTicks;
    private final boolean burnBlocks;
    private final boolean spread;
    private final boolean debug;
    /** Наш огонь: блок -> когда погаснет. */
    private final Map<Location, Long> fires = new ConcurrentHashMap<>();
    final AtomicLong lit = new AtomicLong();
    final AtomicLong extinguished = new AtomicLong();
    final AtomicLong savedBlocks = new AtomicLong();

    TemporaryFireFeature(JavaPlugin plugin, ConfigurationSection config, boolean debug) {
        this.plugin = plugin;
        this.debug = debug;
        this.sources = Scope.mobs(config.getStringList("sources"), "temporary-fire.sources", plugin.getLogger());
        this.where = new Scope(config.getConfigurationSection("where"));
        this.burnTicks = Math.max(1, config.getLong("burn-seconds", 60)) * 20L;
        this.burnBlocks = config.getBoolean("burn-blocks", false);
        this.spread = config.getBoolean("spread", false);
    }

    Scope where() {
        return where;
    }

    String describe() {
        return "от " + sources + ", гаснет через " + burnTicks / 20 + " с, " + where
                + ", поставлено " + lit.get() + ", погашено " + extinguished.get() + ", спасено блоков " + savedBlocks.get();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent event) {
        Block block = event.getBlock();
        BlockIgniteEvent.IgniteCause cause = event.getCause();
        if (cause == BlockIgniteEvent.IgniteCause.SPREAD) {
            if (!spread && event.getIgnitingBlock() != null && fires.containsKey(event.getIgnitingBlock().getLocation())) {
                event.setCancelled(true);
            }
            return;
        }
        if (cause != BlockIgniteEvent.IgniteCause.FIREBALL && cause != BlockIgniteEvent.IgniteCause.EXPLOSION) {
            return;
        }
        Entity source = event.getIgnitingEntity();
        Entity culprit = source == null ? null : Sources.culprit(source);
        if (debug) {
            plugin.getLogger().info("Поджог " + cause + " от " + (culprit == null ? "нет" : culprit.getType())
                    + " в " + block.getX() + " " + block.getY() + " " + block.getZ());
        }
        if (culprit == null || !sources.contains(culprit.getType()) || !where.contains(block.getLocation())) {
            return;
        }
        Location at = block.getLocation();
        fires.put(at, System.currentTimeMillis() + burnTicks * 50);
        lit.incrementAndGet();
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> extinguish(at), burnTicks);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBurn(BlockBurnEvent event) {
        Block igniting = event.getIgnitingBlock();
        if (!burnBlocks && igniting != null && fires.containsKey(igniting.getLocation())) {
            event.setCancelled(true);
            savedBlocks.incrementAndGet();
        }
    }

    private void extinguish(Location at) {
        if (fires.remove(at) == null) {
            return;
        }
        Block block = at.getBlock();
        if (block.getType() == Material.FIRE || block.getType() == Material.SOUL_FIRE) {
            block.setType(Material.AIR);
            extinguished.incrementAndGet();
        }
    }

    /** При выключении и перечитывании гасим всё, что ещё горит: иначе огонь остался бы без таймера. */
    void extinguishAll() {
        for (Location at : List.copyOf(fires.keySet())) {
            extinguish(at);
        }
    }
}
