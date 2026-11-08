package net.totemcraft.fireballguard;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Fireball;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Огненные шары (всполохов, гастов, огненные заряды из раздатчиков) не поджигают блоки
 * в регионах WorldGuard из config.yml. Урон и поджог игроков и мобов не трогаем:
 * отменяется только появление огня на блоках.
 *
 * Флаг WorldGuard ghast-fireball для этого не подходит: кроме огня он отменяет и урон
 * от огненных шаров по игрокам (WorldGuardEntityListener.onEntityDamageByProjectile).
 */
public final class FireballGuard extends JavaPlugin implements Listener {

    private final Set<String> regions = new HashSet<>();
    private boolean debug;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        for (String id : getConfig().getStringList("regions")) {
            regions.add(id.toLowerCase(Locale.ROOT));
        }
        debug = getConfig().getBoolean("debug", false);
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Регионы без огня от огненных шаров: " + regions);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent event) {
        Entity source = event.getIgnitingEntity();
        boolean fireball = event.getCause() == BlockIgniteEvent.IgniteCause.FIREBALL || source instanceof Fireball;
        if (debug) {
            Block b = event.getBlock();
            getLogger().info("Поджог " + b.getWorld().getName() + " " + b.getX() + " " + b.getY() + " " + b.getZ()
                    + ": причина " + event.getCause() + ", источник " + (source == null ? "нет" : source.getType())
                    + ", в регионе " + inProtectedRegion(event.getBlock()));
        }
        if (fireball && inProtectedRegion(event.getBlock())) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onIgniteResult(BlockIgniteEvent event) {
        if (debug) {
            getLogger().info("Итог поджога: отменён " + event.isCancelled());
        }
    }

    private boolean inProtectedRegion(Block block) {
        ApplicableRegionSet set = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery()
                .getApplicableRegions(BukkitAdapter.adapt(block.getLocation()));
        for (ProtectedRegion region : set) {
            if (regions.contains(region.getId())) {
                return true;
            }
        }
        return false;
    }
}
