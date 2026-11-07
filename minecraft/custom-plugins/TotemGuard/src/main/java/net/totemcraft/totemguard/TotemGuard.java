package net.totemcraft.totemguard;

import me.frep.vulcan.api.VulcanAPI;
import me.frep.vulcan.api.check.Check;
import me.frep.vulcan.api.event.VulcanFlagEvent;
import me.frep.vulcan.api.event.VulcanPostFlagEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Наказывает по экспериментальным проверкам Vulcan, которые сам Vulcan не наказывает.
 * Срабатывает только при устойчиво высоком VL: редкие ложные срабатывания у честных
 * игроков до порога не доходят. Использует только API Paper и Vulcan.
 */
public final class TotemGuard extends JavaPlugin implements Listener {

    /** Правило: проверка "speed:e" -> порог VL и команда наказания. */
    private record Rule(int threshold, String command) {}

    private final Map<String, Rule> rules = new HashMap<>();
    /** Кого уже наказали с момента запуска: одно наказание на игрока. */
    private final Set<UUID> punished = ConcurrentHashMap.newKeySet();
    private String bypassPermission;
    /** Кого уже записали как «на половине порога» (по игроку и проверке, раз за запуск). */
    private final Set<String> warned = ConcurrentHashMap.newKeySet();
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadRules();
        getServer().getPluginManager().registerEvents(this, this);
    }

    private void loadRules() {
        reloadConfig();
        rules.clear();
        bypassPermission = getConfig().getString("bypass-permission", "totemguard.bypass");
        ConfigurationSection section = getConfig().getConfigurationSection("rules");
        if (section != null) {
            for (String key : section.getKeys(false)) {
                int threshold = section.getInt(key + ".vl");
                String command = section.getString(key + ".command", "");
                if (threshold > 0 && !command.isBlank()) {
                    rules.put(key.toLowerCase(Locale.ROOT), new Rule(threshold, command));
                }
            }
        }
        getLogger().info("Правил: " + rules.size() + " " + rules.keySet());
        journal("запуск | правила " + rules);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFlag(VulcanFlagEvent event) {
        handle(event.getPlayer(), event.getCheck());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPostFlag(VulcanPostFlagEvent event) {
        handle(event.getPlayer(), event.getCheck());
    }

    private void handle(Player player, Check check) {
        Rule rule = rules.get(key(check));
        if (rule == null) {
            return;
        }
        int vl = check.getVl();
        if (vl >= rule.threshold() / 2 && vl < rule.threshold()
                && warned.add(player.getUniqueId() + key(check))) {
            journal("половина порога | " + describe(player, check, vl, rule));
            String warnName = player.getName(); int ping = player.getPing();
            Bukkit.getScheduler().runTask(this, () -> notifyStaff(warnName, check, vl, rule, ping, false));
        }
        if (vl < rule.threshold()) {
            return;
        }
        if (player.hasPermission(bypassPermission) || !punished.add(player.getUniqueId())) {
            return;
        }
        String name = player.getName();
        String command = rule.command().replace("%player%", name);
        String details = describe(player, check, vl, rule);
        int ping = player.getPing();
        // Событие Vulcan приходит не из основного потока: команду выполняем в нём
        Bukkit.getScheduler().runTask(this, () -> {
            getLogger().warning(name + " наказан: " + key(check) + " VL " + vl + " -> " + command);
            journal("наказание | " + details + " | команда: " + command);
            notifyStaff(name, check, vl, rule, ping, true);
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
        });
    }

    /** Уведомление в игре тем же людям, кто получает уведомления Vulcan, в его стиле. */
    private void notifyStaff(String name, Check check, int vl, Rule rule, int ping, boolean punished) {
        LegacyComponentSerializer legacy = LegacyComponentSerializer.legacyAmpersand();
        String checkName = check.getName().substring(0, 1).toUpperCase(Locale.ROOT) + check.getName().substring(1)
                + " (Type " + Character.toUpperCase(check.getType()) + ")";
        String text = "&2&lTotemGuard &8» &f" + name + (punished ? " &7наказан за &f" : " &7на половине порога &f")
                + checkName + " &7[" + (punished ? "&4" : "&e") + vl + "&7/&4" + rule.threshold() + "&7]";
        String hover = "&7Пинг: &c" + ping + " &8| &7TPS: &c" + String.format(Locale.ROOT, "%.1f", Bukkit.getTPS()[0])
                + "\n&7" + (punished ? "Выполнено: &f" + rule.command().replace("%player%", name)
                : "Наказание при &4" + rule.threshold() + " VL") + "\n\n&7Нажмите, чтобы телепортироваться";
        Component message = legacy.deserialize(text)
                .hoverEvent(HoverEvent.showText(legacy.deserialize(hover)))
                .clickEvent(ClickEvent.runCommand("/vulcan clickalert " + name));
        VulcanAPI api = vulcanApi();
        for (Player staff : Bukkit.getOnlinePlayers()) {
            boolean receives = api != null ? api.hasAlertsEnabled(staff) : staff.hasPermission("vulcan.alerts");
            if (receives) {
                staff.sendMessage(message);
            }
        }
    }

    /** API Vulcan. Фабрика в jar Vulcan без признака вложенного класса, поэтому берём её по имени. */
    private VulcanAPI cachedApi;

    private VulcanAPI vulcanApi() {
        if (cachedApi == null) {
            try {
                cachedApi = (VulcanAPI) Class.forName("me.frep.vulcan.api.VulcanAPI$Factory")
                        .getMethod("getApi").invoke(null);
            } catch (ReflectiveOperationException | ClassCastException e) {
                return null;
            }
        }
        return cachedApi;
    }

    private static String describe(Player player, Check check, int vl, Rule rule) {
        return player.getName() + " (" + player.getUniqueId() + ") | " + key(check)
                + " VL " + vl + "/" + rule.threshold() + " | пинг " + player.getPing()
                + " | TPS " + String.format(Locale.ROOT, "%.1f", Bukkit.getTPS()[0]);
    }

    /** Журнал plugins/TotemGuard/journal.log: только редкие события, одна строка на событие. */
    private synchronized void journal(String line) {
        Path file = getDataFolder().toPath().resolve("journal.log");
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, LocalDateTime.now().format(TIME) + " | " + line + System.lineSeparator(),
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            getLogger().warning("Не удалось записать журнал: " + e.getMessage());
        }
    }

    private static String key(Check check) {
        return (check.getName() + ":" + check.getType()).toLowerCase(Locale.ROOT);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            loadRules();
            journal("правила перечитаны: " + sender.getName());
            sender.sendMessage("TotemGuard: правила перечитаны (" + rules.size() + ")");
            return true;
        }
        sender.sendMessage("TotemGuard: правила " + rules.keySet() + ", наказано с запуска: " + punished.size());
        return true;
    }
}
