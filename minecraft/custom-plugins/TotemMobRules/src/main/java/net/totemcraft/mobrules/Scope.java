package net.totemcraft.mobrules;

import org.bukkit.Location;
import org.bukkit.configuration.ConfigurationSection;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Где действует правило (раздел where в config.yml): миры и регионы WorldGuard.
 * Пустые списки - без ограничения. Регионы проверяются, только если указаны (WorldGuard необязателен).
 */
final class Scope {

    private final Set<String> worlds = new HashSet<>();
    private final Set<String> regions = new HashSet<>();

    Scope(ConfigurationSection where) {
        if (where == null) {
            return;
        }
        for (String w : where.getStringList("worlds")) {
            worlds.add(w.trim());
        }
        for (String r : where.getStringList("regions")) {
            regions.add(r.trim().toLowerCase(Locale.ROOT));
        }
    }

    Set<String> regions() {
        return regions;
    }

    boolean contains(Location location) {
        if (location == null || location.getWorld() == null) {
            return false;
        }
        if (!worlds.isEmpty() && !worlds.contains(location.getWorld().getName())) {
            return false;
        }
        // Класс с WorldGuard трогаем, только если WorldGuard включён: иначе он не загружается вовсе
        return regions.isEmpty()
                || (org.bukkit.Bukkit.getPluginManager().isPluginEnabled("WorldGuard")
                    && WorldGuardRegions.anyOf(location, regions));
    }

    @Override
    public String toString() {
        if (worlds.isEmpty() && regions.isEmpty()) {
            return "везде";
        }
        return (worlds.isEmpty() ? "" : "миры " + worlds + " ") + (regions.isEmpty() ? "" : "регионы " + regions);
    }

    /** Названия мобов из конфига; неизвестные - в журнал. */
    static Set<org.bukkit.entity.EntityType> mobs(List<String> names, String key, java.util.logging.Logger log) {
        Set<org.bukkit.entity.EntityType> out = java.util.EnumSet.noneOf(org.bukkit.entity.EntityType.class);
        for (String name : names) {
            try {
                out.add(org.bukkit.entity.EntityType.valueOf(name.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                log.warning("Неизвестный моб в " + key + ": " + name);
            }
        }
        return out;
    }
}
