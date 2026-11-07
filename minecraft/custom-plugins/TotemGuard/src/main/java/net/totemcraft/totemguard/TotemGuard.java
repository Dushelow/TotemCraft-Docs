package net.totemcraft.totemguard;

import me.frep.vulcan.api.check.Check;
import me.frep.vulcan.api.event.VulcanFlagEvent;
import me.frep.vulcan.api.event.VulcanPostFlagEvent;
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
    /** Проверки, о которых уже написали в журнал (по одной строке на проверку). */
    private final Set<String> described = ConcurrentHashMap.newKeySet();
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
        if (described.add(key(check))) {
            getLogger().info("Проверка " + key(check) + ": экспериментальная=" + check.isExperimental()
                    + ", наказывает=" + check.isPunishable() + ", порог Vulcan=" + check.getMaxVl());
        }
        Rule rule = rules.get(key(check));
        if (rule == null) {
            return;
        }
        int vl = check.getVl();
        if (vl >= rule.threshold() / 2 && vl < rule.threshold()
                && warned.add(player.getUniqueId() + key(check))) {
            journal("половина порога | " + describe(player, check, vl, rule));
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
        // Событие Vulcan приходит не из основного потока: команду выполняем в нём
        Bukkit.getScheduler().runTask(this, () -> {
            getLogger().warning(name + " наказан: " + key(check) + " VL " + vl + " -> " + command);
            journal("наказание | " + details + " | команда: " + command);
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
        });
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
