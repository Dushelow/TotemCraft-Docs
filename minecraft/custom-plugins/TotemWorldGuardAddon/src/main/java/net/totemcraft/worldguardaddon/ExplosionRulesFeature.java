package net.totemcraft.worldguardaddon;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Взрывы мобов из mobs (сам моб или его снаряд: шар гаста, крипер, визер) не ломают блоки в месте where.
 * Урон существам и огонь от взрыва остаются (огонь - на правилах temporary-fire).
 */
final class ExplosionRulesFeature implements Listener {

    private final Set<EntityType> mobs;
    private final Scope where;
    final AtomicLong saved = new AtomicLong();

    ExplosionRulesFeature(JavaPlugin plugin, ConfigurationSection config) {
        this.mobs = Scope.mobs(config.getStringList("mobs"), "no-block-damage-explosions.mobs", plugin.getLogger());
        this.where = new Scope(config.getConfigurationSection("where"));
    }

    Scope where() {
        return where;
    }

    String describe() {
        return mobs + ", " + where + ", спасено блоков " + saved.get();
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onExplode(EntityExplodeEvent event) {
        Entity culprit = Sources.culprit(event.getEntity());
        if (event.blockList().isEmpty() || !mobs.contains(culprit.getType()) || !where.contains(event.getLocation())) {
            return;
        }
        saved.addAndGet(event.blockList().size());
        event.blockList().clear();
    }
}
