package net.totemcraft.worldguardaddon;

import org.bukkit.ChatColor;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к WorldGuard: правила регионов, которых нет среди флагов WorldGuard.
 * Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link FireballFireFeature} - огненные шары не поджигают блоки в регионах;</li>
 *   <li>{@link ThornsFeature} - выбранные мобы в регионах не получают урон от шипов;</li>
 *   <li>{@link WipeBorderFeature} - сообщения на границе центра мира (зоны вайпа).</li>
 * </ul>
 */
public final class TotemWorldGuardAddon extends JavaPlugin {

    @Override
    public void onEnable() {
        saveDefaultConfig();
        ConfigurationSection config = getConfig();
        boolean debug = config.getBoolean("debug", false);

        if (config.getBoolean("no-fireball-fire.enabled", true)) {
            Regions regions = new Regions(config.getStringList("no-fireball-fire.regions"));
            getServer().getPluginManager().registerEvents(new FireballFireFeature(this, regions, debug), this);
            getLogger().info("Без огня от огненных шаров: " + regions);
        }
        if (config.getBoolean("no-thorns-damage.enabled", true)) {
            ThornsFeature thorns = new ThornsFeature(this, new Regions(config.getStringList("no-thorns-damage.regions")),
                    config.getStringList("no-thorns-damage.mobs"), debug);
            getServer().getPluginManager().registerEvents(thorns, this);
            getLogger().info("Без урона от шипов: " + thorns.describe());
        }
        if (config.getBoolean("wipe-border.enabled", true)) {
            WipeBorderFeature border = new WipeBorderFeature(config.getConfigurationSection("wipe-border.worlds"));
            if (!border.isEmpty()) {
                getServer().getPluginManager().registerEvents(border, this);
                getLogger().info("Граница зоны вайпа: " + border);
            }
        }
    }

    static String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
