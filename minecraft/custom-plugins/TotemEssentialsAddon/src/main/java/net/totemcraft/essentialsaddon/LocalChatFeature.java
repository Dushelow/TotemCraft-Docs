package net.totemcraft.essentialsaddon;

import com.earth2me.essentials.IEssentials;
import com.earth2me.essentials.User;
import fr.xephi.authme.api.v3.AuthMeApi;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static net.totemcraft.essentialsaddon.TotemEssentialsAddon.color;

/**
 * Ближний чат: "!текст" и "/l текст" уходят только игрокам рядом (радиус Essentials), "/g текст" всем;
 * "/l" и "/g" без текста включают режим «рядом» или общий (как /toggleshout).
 * По умолчанию все пишут в общий (shout-default: true в Essentials). Плагин только на одно сообщение
 * переводит игрока из общего режима в ближний, остальное делает Essentials.
 * <p>
 * Essentials выбирает тип чата на LOWEST по режиму игрока и запоминает его; наш обработчик стоит
 * раньше благодаря loadbefore: [EssentialsChat] в plugin.yml.
 */
final class LocalChatFeature implements Listener {

    private final JavaPlugin plugin;
    private final IEssentials essentials;
    private final char prefix;
    private final ConfigurationSection messages;
    /** Игроки, которых перевели в ближний режим на одно сообщение: вернуть в общий после Essentials. */
    private final Set<UUID> localOnce = ConcurrentHashMap.newKeySet();
    /** Игроки, чьё сообщение сейчас отправляется через /g: приставка не делает его ближним. */
    private final Set<UUID> globalOnce = ConcurrentHashMap.newKeySet();

    LocalChatFeature(JavaPlugin plugin, IEssentials essentials, ConfigurationSection config) {
        this.plugin = plugin;
        this.essentials = essentials;
        String p = config.getString("prefix", "!");
        this.prefix = p.isEmpty() ? '!' : p.charAt(0);
        this.messages = config.getConfigurationSection("messages");
    }

    char prefix() {
        return prefix;
    }

    /** "!текст": одно сообщение в ближний чат. */
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onLocalPrefix(AsyncPlayerChatEvent event) {
        String message = event.getMessage();
        if (message.length() < 2 || message.charAt(0) != prefix
                || globalOnce.contains(event.getPlayer().getUniqueId())) {
            return;
        }
        String text = message.substring(1).trim();
        User user = essentials == null ? null : essentials.getUser(event.getPlayer());
        if (text.isEmpty() || user == null) {
            return;
        }
        event.setMessage(text);
        if (user.isToggleShout()) {
            user.setToggleShout(false);
            localOnce.add(event.getPlayer().getUniqueId());
        }
    }

    /** Essentials уже выбрал тип чата: возвращаем игроку общий режим, даже если сообщение отменено. */
    @EventHandler(priority = EventPriority.LOW)
    public void restoreShout(AsyncPlayerChatEvent event) {
        if (localOnce.remove(event.getPlayer().getUniqueId())) {
            User user = essentials.getUser(event.getPlayer());
            if (user != null) {
                user.setToggleShout(true);
            }
        }
    }

    /**
     * /l текст: одно сообщение рядом, /l: режим «рядом». /g текст: одно сообщение всем, /g: общий режим.
     * /l занята в AuthMe как /login: до входа /l передаётся в AuthMe, а после входа слово,
     * совпадающее с паролем игрока, в чат не уходит (вход по привычке через /l).
     */
    boolean onCommand(CommandSender sender, boolean local, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage(message("only-players"));
            return true;
        }
        AuthMeApi authMe = authMe();
        if (local && authMe != null && !authMe.isAuthenticated(player)) {
            player.performCommand("authme:login " + String.join(" ", args));
            return true;
        }
        User user = essentials == null ? null : essentials.getUser(player);
        if (user == null) {
            return true;
        }
        if (args.length == 0) {
            setMode(player, user, local);
            return true;
        }
        String text = String.join(" ", args);
        if (!local) {
            sendGlobal(player, user, text);
        } else if (authMe != null && args.length == 1) {
            // BCrypt медленный: сверяем в фоне, отправляем в основном потоке
            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                boolean isPassword = authMe.checkPassword(player.getName(), text);
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (!player.isOnline()) {
                        return;
                    }
                    if (isPassword) {
                        player.sendMessage(message("password-not-sent"));
                    } else {
                        player.chat(prefix + text);
                    }
                });
            });
        } else {
            // Через ту же приставку: весь путь сообщения (мут, AuthMe, формат) как у обычного чата
            player.chat(prefix + text);
        }
        return true;
    }

    private void setMode(Player player, User user, boolean local) {
        if (local) {
            if (!user.isToggleShout()) {
                player.sendMessage(message("already-local"));
                return;
            }
            user.setToggleShout(false);
            player.sendMessage(message("mode-local")
                    .replace("{radius}", String.valueOf(essentials.getSettings().getChatRadius())));
        } else {
            if (user.isToggleShout()) {
                player.sendMessage(message("already-global"));
                return;
            }
            user.setToggleShout(true);
            player.sendMessage(message("mode-global"));
        }
    }

    /** Одно сообщение всем, даже из режима «рядом»; приставка в начале здесь не делает его ближним. */
    private void sendGlobal(Player player, User user, String text) {
        if (text.startsWith("/")) {
            player.sendMessage(message("no-slash"));
            return;
        }
        UUID id = player.getUniqueId();
        boolean wasLocal = !user.isToggleShout();
        user.setToggleShout(true);
        globalOnce.add(id);
        try {
            player.chat(text);
        } finally {
            globalOnce.remove(id);
            if (wasLocal) {
                user.setToggleShout(false);
            }
        }
    }

    private AuthMeApi authMe() {
        return plugin.getServer().getPluginManager().isPluginEnabled("AuthMe") ? AuthMeApi.getInstance() : null;
    }

    private String message(String key) {
        return color(messages == null ? key : messages.getString(key, key));
    }
}
