package net.totemcraft.worldguardaddon;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import org.bukkit.Location;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Список регионов WorldGuard по названию (в любом мире) и проверка, стоит ли точка в одном из них. */
final class Regions {

    private final Set<String> ids = new HashSet<>();

    Regions(List<String> names) {
        for (String name : names) {
            ids.add(name.trim().toLowerCase(Locale.ROOT));
        }
    }

    boolean contains(Location location) {
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

    @Override
    public String toString() {
        return ids.toString();
    }
}
