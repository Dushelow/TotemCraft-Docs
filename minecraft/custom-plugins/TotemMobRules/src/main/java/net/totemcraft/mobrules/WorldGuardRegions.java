package net.totemcraft.mobrules;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.managers.RegionManager;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;

import java.util.Set;
import java.util.TreeSet;

/**
 * Всё обращение к WorldGuard в одном классе: без WorldGuard он не загружается, и плагин работает
 * дальше, правила с регионами просто не срабатывают (при запуске пишется предупреждение).
 */
final class WorldGuardRegions {

    private WorldGuardRegions() {
    }

    static boolean available() {
        return Bukkit.getPluginManager().isPluginEnabled("WorldGuard");
    }

    static boolean anyOf(Location location, Set<String> ids) {
        if (!available()) {
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

    /** Владеет ли игрок хотя бы одним регионом из списка (в любом мире). */
    static boolean ownsAny(org.bukkit.entity.Player player, Set<String> ids) {
        if (!available()) {
            return false;
        }
        com.sk89q.worldguard.LocalPlayer local = com.sk89q.worldguard.bukkit.WorldGuardPlugin.inst().wrapPlayer(player);
        for (World world : Bukkit.getWorlds()) {
            RegionManager manager = WorldGuard.getInstance().getPlatform().getRegionContainer()
                    .get(BukkitAdapter.adapt(world));
            if (manager == null) {
                continue;
            }
            for (String id : ids) {
                ProtectedRegion region = manager.getRegion(id);
                if (region != null && region.isOwner(local)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Каких регионов из списка нет ни в одном мире (опечатки в конфиге). */
    static Set<String> missing(Set<String> ids) {
        Set<String> missing = new TreeSet<>(ids);
        if (!available()) {
            return missing;
        }
        for (World world : Bukkit.getWorlds()) {
            RegionManager manager = WorldGuard.getInstance().getPlatform().getRegionContainer()
                    .get(BukkitAdapter.adapt(world));
            if (manager != null) {
                missing.removeIf(manager::hasRegion);
            }
        }
        return missing;
    }
}
