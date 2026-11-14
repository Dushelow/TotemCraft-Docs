package net.totemcraft.authmeaddon;

import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к AuthMe. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link KeepEnderPearlsFeature} - жемчуг Края (стазис-камеры) не пропадает при перезаходе.</li>
 * </ul>
 */
public final class TotemAuthMeAddon extends JavaPlugin {

    @Override
    public void onEnable() {
        saveDefaultConfig();
        if (getConfig().getBoolean("keep-ender-pearls-on-join.enabled", true)) {
            KeepEnderPearlsFeature feature = new KeepEnderPearlsFeature(this,
                    getConfig().getBoolean("keep-ender-pearls-on-join.log", true));
            getServer().getPluginManager().registerEvents(feature, this);
            getLogger().info("Жемчуг Края при входе не пропадает: включено");
        }
    }
}
