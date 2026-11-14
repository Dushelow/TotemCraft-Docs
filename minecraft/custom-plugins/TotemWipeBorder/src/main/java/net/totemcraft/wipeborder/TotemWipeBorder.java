package net.totemcraft.wipeborder;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.event.HandlerList;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * TotemWipeBorder: сообщения на границе центра мира (зоны вайпа). Центр мира не сбрасывается, за его
 * границей территория обновляется с выходом новых версий игры. Игрок видит предупреждение, когда пересекает
 * границу пешком, на транспорте, телепортом или входит в игру за ней, и строку, когда возвращается.
 * /wipeborder reload - перечитать config.yml, /wipeborder status - какие миры и радиусы.
 */
public final class TotemWipeBorder extends JavaPlugin {

    private WipeBorderFeature border;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        load();
    }

    @Override
    public void onDisable() {
        unload();
    }

    private void load() {
        reloadConfig();
        ConfigurationSection worlds = getConfig().getConfigurationSection("worlds");
        if (!getConfig().getBoolean("enabled", true) || worlds == null) {
            getLogger().info("Граница зоны вайпа выключена");
            return;
        }
        WipeBorderFeature feature = new WipeBorderFeature(worlds);
        if (feature.isEmpty()) {
            getLogger().warning("В config.yml нет ни одного мира в worlds: сообщения не показываются");
            return;
        }
        for (String world : worlds.getKeys(false)) {
            if (getServer().getWorld(world) == null) {
                getLogger().warning("Мира " + world + " нет на сервере (опечатка в config.yml?)");
            }
        }
        border = feature;
        getServer().getPluginManager().registerEvents(border, this);
        getLogger().info("Граница зоны вайпа: " + border);
    }

    private void unload() {
        if (border != null) {
            HandlerList.unregisterAll(border);
            border = null;
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            unload();
            load();
            sender.sendMessage("TotemWipeBorder: config.yml перечитан, подробности в журнале сервера");
            return true;
        }
        sender.sendMessage("TotemWipeBorder " + getPluginMeta().getVersion() + ": "
                + (border == null ? "выключено" : border.toString()));
        return true;
    }

    static String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
