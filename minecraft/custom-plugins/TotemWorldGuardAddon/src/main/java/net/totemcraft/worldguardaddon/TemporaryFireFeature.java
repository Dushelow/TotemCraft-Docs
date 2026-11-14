package net.totemcraft.worldguardaddon;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Fireball;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Огонь от огненных шаров выбранных мобов (всполохи, гасты) временный: горит как обычно (игрок в нём
 * горит и получает урон), но через burn-seconds гаснет сам, блоки не сжигает и дальше не ползёт.
 * Огонь от зажигалки, лавы, молнии и прочего не трогаем. Регионы пустые - на всей карте.
 */
final class TemporaryFireFeature implements Listener {

    private final JavaPlugin plugin;
    private final Regions regions;
    private final boolean everywhere;
    private final Set<EntityType> sources = EnumSet.noneOf(EntityType.class);
    private final long burnTicks;
    private final boolean burnBlocks;
    private final boolean spread;
    private final boolean debug;
    /** Наш огонь: блок -> момент, когда он должен погаснуть. */
    private final Map<Location, Long> fires = new ConcurrentHashMap<>();

    TemporaryFireFeature(JavaPlugin plugin, List<String> regionNames, List<String> sourceNames,
                         long burnSeconds, boolean burnBlocks, boolean spread, boolean debug) {
        this.plugin = plugin;
        this.debug = debug;
        this.regions = new Regions(regionNames);
        this.everywhere = regionNames.isEmpty();
        this.burnTicks = Math.max(1, burnSeconds) * 20L;
        this.burnBlocks = burnBlocks;
        this.spread = spread;
        for (String name : sourceNames) {
            try {
                sources.add(EntityType.valueOf(name.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                plugin.getLogger().warning("Неизвестный моб в temporary-fireball-fire.sources: " + name);
            }
        }
    }

    String describe() {
        return "от " + sources + ", гаснет через " + burnTicks / 20 + " с, " + (everywhere ? "везде" : "в " + regions);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent event) {
        Block block = event.getBlock();
        // Огонь от нашего огня не распространяется
        if (event.getCause() == BlockIgniteEvent.IgniteCause.SPREAD && !spread
                && event.getIgnitingBlock() != null && fires.containsKey(event.getIgnitingBlock().getLocation())) {
            event.setCancelled(true);
            return;
        }
        Entity source = event.getIgnitingEntity();
        if (debug) {
            plugin.getLogger().info("Поджог " + event.getCause() + " источник " + (source == null ? "нет" : source.getType())
                    + (source instanceof Fireball f ? " стрелок " + (f.getShooter() instanceof LivingEntity l ? l.getType() : String.valueOf(f.getShooter())) : "")
                    + " в " + block.getX() + " " + block.getY() + " " + block.getZ());
        }
        // В 26.x источником поджога приходит сам стрелок (всполох), в старых версиях - огненный шар
        Entity shooter = source instanceof Fireball fireball && fireball.getShooter() instanceof LivingEntity l ? l : source;
        boolean byFireball = event.getCause() == BlockIgniteEvent.IgniteCause.FIREBALL || source instanceof Fireball;
        if (!byFireball || shooter == null || !sources.contains(shooter.getType())) {
            return;
        }
        if (!everywhere && !regions.contains(block.getLocation())) {
            return;
        }
        Location at = block.getLocation();
        fires.put(at, System.currentTimeMillis() + burnTicks * 50);
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> extinguish(at), burnTicks);
    }

    /** Блок под нашим огнём не сгорает. Огонь у блока - соседний сверху или сбоку. */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBurn(BlockBurnEvent event) {
        if (burnBlocks) {
            return;
        }
        Block igniting = event.getIgnitingBlock();
        if (igniting != null && fires.containsKey(igniting.getLocation())) {
            event.setCancelled(true);
        }
    }

    private void extinguish(Location at) {
        fires.remove(at);
        Block block = at.getBlock();
        if (debug) {
            plugin.getLogger().info("Гашу огонь в " + at.getBlockX() + " " + at.getBlockY() + " " + at.getBlockZ() + ": там " + block.getType());
        }
        if (block.getType() == Material.FIRE || block.getType() == Material.SOUL_FIRE) {
            block.setType(Material.AIR);
        }
    }

    /** При выключении сервера гасим всё, что ещё горит: после перезапуска мы бы о нём не знали. */
    void extinguishAll() {
        for (Location at : List.copyOf(fires.keySet())) {
            extinguish(at);
        }
    }
}
