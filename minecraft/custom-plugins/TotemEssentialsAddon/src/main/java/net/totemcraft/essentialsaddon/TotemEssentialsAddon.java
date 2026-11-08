package net.totemcraft.essentialsaddon;

import com.earth2me.essentials.IEssentials;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к EssentialsChat. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link LocalChatFeature} - ближний чат: "!текст", "/l", "/g";</li>
 *   <li>{@link LocalChatTracker} - «Рядом никого нет» и пометка ближних сообщений;</li>
 *   <li>{@link DiscordLocalFilter} - ближние сообщения не уходят в Discord (DiscordSRV);</li>
 *   <li>{@link SpyFormatFix} - строка слежки за ближним чатом без лишнего «&lt;/gray&gt;».</li>
 * </ul>
 * Сам ближний чат (радиус, формат) делает Essentials, аддон только управляет режимом игрока.
 */
public final class TotemEssentialsAddon extends JavaPlugin {

    private LocalChatFeature localChat;
    private Object discordFilter;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        IEssentials essentials = (IEssentials) getServer().getPluginManager().getPlugin("Essentials");
        ConfigurationSection config = getConfig();

        if (config.getBoolean("local-chat.enabled", true)) {
            localChat = new LocalChatFeature(this, essentials, config.getConfigurationSection("local-chat"));
            getServer().getPluginManager().registerEvents(localChat, this);
            getLogger().info("Ближний чат: приставка '" + localChat.prefix() + "', /l, /g");
        }
        boolean noOne = config.getBoolean("no-one-nearby.enabled", true);
        boolean discord = config.getBoolean("discord-filter.enabled", true)
                && getServer().getPluginManager().isPluginEnabled("DiscordSRV");
        if (noOne || discord) {
            LocalChatTracker tracker = new LocalChatTracker(this, noOne, config.getConfigurationSection("no-one-nearby"));
            getServer().getPluginManager().registerEvents(tracker, this);
            if (discord) {
                discordFilter = DiscordLocalFilter.register(tracker);
                getLogger().info("Ближние сообщения в Discord не уходят");
            }
        }
        if (config.getBoolean("spy-format-fix.enabled", true)) {
            getServer().getPluginManager().registerEvents(new SpyFormatFix(), this);
        }
    }

    @Override
    public void onDisable() {
        if (discordFilter != null) {
            DiscordLocalFilter.unregister(discordFilter);
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (localChat == null) {
            sender.sendMessage(color(getConfig().getString("messages.feature-disabled", "&cЭта функция выключена.")));
            return true;
        }
        return localChat.onCommand(sender, command.getName().equalsIgnoreCase("l"), args);
    }

    static String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
