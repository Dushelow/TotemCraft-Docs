package net.totemcraft.lwcaddon;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к LWC. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link AutoLockFeature} - /autolock, постоянный автоприват сундуков и бочек;</li>
 *   <li>{@link DonationNoticeFeature} - сообщение, когда из чужого «защищенного от кражи» пытаются взять вещь.</li>
 * </ul>
 */
public final class TotemLWCAddon extends JavaPlugin {

    private AutoLockFeature autoLock;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        if (getConfig().getBoolean("autolock.enabled", true)) {
            autoLock = new AutoLockFeature(this, getConfig().getConfigurationSection("autolock"));
            getServer().getPluginManager().registerEvents(autoLock, this);
            getLogger().info("Автоприват /autolock: " + autoLock.describe());
        }
        if (getConfig().getBoolean("donation-notice.enabled", true)) {
            getServer().getPluginManager().registerEvents(
                    new DonationNoticeFeature(getConfig().getConfigurationSection("donation-notice")), this);
            getLogger().info("Сообщение у чужого «защищенного от кражи»: включено");
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (autoLock == null) {
            sender.sendMessage(color(getConfig().getString("messages.feature-disabled", "&cЭта функция выключена.")));
            return true;
        }
        return autoLock.onCommand(sender);
    }

    static String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
