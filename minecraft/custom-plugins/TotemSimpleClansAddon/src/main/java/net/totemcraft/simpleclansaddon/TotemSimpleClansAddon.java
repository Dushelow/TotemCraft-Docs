package net.totemcraft.simpleclansaddon;

import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к SimpleClans. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link ClanTagsFeature} - тег клана в чате видят только игроки в кланах и админы.</li>
 * </ul>
 */
public final class TotemSimpleClansAddon extends JavaPlugin {

    @Override
    public void onEnable() {
        saveDefaultConfig();
        if (getConfig().getBoolean("clan-tags.enabled", true)) {
            ClanTagsFeature tags = new ClanTagsFeature(getConfig().getConfigurationSection("clan-tags"));
            getServer().getPluginManager().registerEvents(tags, this);
            getLogger().info("Теги кланов только для клановых: " + tags.describe());
        }
    }
}
