package net.totemcraft.worldguardaddon;

import org.bukkit.ChatColor;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к WorldGuard: правила регионов, которых нет среди флагов WorldGuard.
 * Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link TemporaryFireFeature} - огонь от огненных шаров гаснет сам, блоки не сжигает;</li>
 *   <li>{@link ProtectedMobsFeature} - выбранные мобы в регионах не получают урон от выбранных мобов;</li>
 *   <li>{@link ThornsFeature} - выбранные мобы в регионах не получают урон от шипов;</li>
 *   <li>{@link WipeBorderFeature} - сообщения на границе центра мира (зоны вайпа).</li>
 * </ul>
 */
public final class TotemWorldGuardAddon extends JavaPlugin {

    private TemporaryFireFeature temporaryFire;

    @Override
    public void onDisable() {
        if (temporaryFire != null) {
            temporaryFire.extinguishAll();
        }
    }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        ConfigurationSection config = getConfig();
        boolean debug = config.getBoolean("debug", false);

        if (config.getBoolean("temporary-fireball-fire.enabled", false)) {
            temporaryFire = new TemporaryFireFeature(this, config.getStringList("temporary-fireball-fire.regions"),
                    config.getStringList("temporary-fireball-fire.sources"),
                    config.getLong("temporary-fireball-fire.burn-seconds", 60),
                    config.getBoolean("temporary-fireball-fire.burn-blocks", false),
                    config.getBoolean("temporary-fireball-fire.spread", false), debug);
            getServer().getPluginManager().registerEvents(temporaryFire, this);
            getLogger().info("Временный огонь от огненных шаров: " + temporaryFire.describe());
        }
        if (config.getBoolean("protected-mobs.enabled", false)) {
            ProtectedMobsFeature mobs = new ProtectedMobsFeature(this, config.getStringList("protected-mobs.regions"),
                    config.getStringList("protected-mobs.victims"), config.getStringList("protected-mobs.attackers"),
                    config.getBoolean("protected-mobs.fire-damage", true));
            getServer().getPluginManager().registerEvents(mobs, this);
            getLogger().info("Защищённые мобы: " + mobs.describe());
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
