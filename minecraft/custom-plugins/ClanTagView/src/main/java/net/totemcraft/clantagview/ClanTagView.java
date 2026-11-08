package net.totemcraft.clantagview;

import com.earth2me.essentials.IEssentials;
import com.earth2me.essentials.User;
import fr.xephi.authme.api.v3.AuthMeApi;
import io.papermc.paper.chat.ChatRenderer;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.essentialsx.api.v2.events.chat.LocalChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.sacredlabyrinth.phaed.simpleclans.ClanPlayer;
import net.sacredlabyrinth.phaed.simpleclans.SimpleClans;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Тег клана перед ником в чате видят только игроки в кланах и админы (право clantagview.see).
 * Сообщение собирается без тега (в формате Essentials нет {clan}), а тег добавляется в начало
 * строки отдельно для каждого получателя штатным механизмом Paper (ChatRenderer). Пакеты не трогаем.
 * <p>
 * Ещё здесь ближний чат: "!текст" и "/l текст" уходят только игрокам рядом (радиус Essentials),
 * "/g текст" всем; "/l" и "/g" без текста включают режим «рядом» или общий (как /toggleshout).
 * По умолчанию все пишут в общий (shout-default: true в Essentials). Сам ближний чат делает Essentials,
 * плагин только на одно сообщение переводит игрока из общего режима в ближний.
 */
public final class ClanTagView extends JavaPlugin implements Listener {

    private static final String SEE_PERMISSION = "clantagview.see";

    /** Приставки типа чата ("[Рядом] "): тег ставится после них, а не перед. */
    private volatile List<String> prefixes = List.of();

    private static final char LOCAL_PREFIX = '!';
    private IEssentials essentials;
    /** Игроки, которых перевели в ближний режим на одно сообщение: вернуть в общий после Essentials. */
    private final Set<UUID> localOnce = ConcurrentHashMap.newKeySet();
    /** Игроки, чьё сообщение сейчас отправляется через /g: приставка "!" не делает его ближним. */
    private final Set<UUID> globalOnce = ConcurrentHashMap.newKeySet();
    /** Сообщения, которые Essentials отправил как ближние: их не пересылаем в Discord. */
    private final Set<Object> localChats = Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<>()));
    /** Игрок, чьё сообщение Essentials только что сделал ближним (тот же поток, то же событие чата). */
    private final ThreadLocal<Player> localNow = new ThreadLocal<>();
    private Object discordFilter;
    /** «Рядом никого нет» не чаще раза в столько миллисекунд на игрока, чтобы не спамить. */
    private long noOneCooldownMs;
    private final java.util.Map<UUID, Long> noOneShown = new ConcurrentHashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        prefixes = List.copyOf(getConfig().getStringList("tag-after-prefixes"));
        noOneCooldownMs = getConfig().getLong("local-no-one-cooldown-seconds", 30) * 1000L;
        essentials = (IEssentials) getServer().getPluginManager().getPlugin("Essentials");
        getServer().getPluginManager().registerEvents(this, this);
        if (getServer().getPluginManager().isPluginEnabled("DiscordSRV")) {
            discordFilter = DiscordLocalFilter.register(this);
        }
    }

    @Override
    public void onDisable() {
        if (discordFilter != null) {
            DiscordLocalFilter.unregister(discordFilter);
        }
    }

    /** Essentials разослал сообщение только игрокам рядом (событие внутри обработки чата, тот же поток). */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onLocalChat(LocalChatEvent event) {
        localNow.set(event.getPlayer());
    }

    /** Запоминаем само событие чата как ближнее: DiscordSRV получает его позже, в другом потоке. */
    @EventHandler(priority = EventPriority.HIGHEST)
    public void markLocal(AsyncPlayerChatEvent event) {
        Player local = localNow.get();
        localNow.remove();
        if (local == event.getPlayer()) {
            localChats.add(event);
            warnIfNoOneHeard(event);
        }
    }

    /**
     * Ближнее сообщение никто не получил: пишем «Рядом никого нет», но не чаще раза в noOneCooldownMs.
     * У Essentials этот текст (localNoOne) пустой, задержки он не умеет.
     */
    private void warnIfNoOneHeard(AsyncPlayerChatEvent event) {
        Player player = event.getPlayer();
        // Наблюдатели и невидимые админы сообщение получают, но «слушателями» не считаются
        if (event.isCancelled() || event.getRecipients().stream().anyMatch(p -> p != player
                && p.getGameMode() != org.bukkit.GameMode.SPECTATOR && player.canSee(p))) {
            return;
        }
        long now = System.currentTimeMillis();
        Long last = noOneShown.get(player.getUniqueId());
        if (last != null && now - last < noOneCooldownMs) {
            return;
        }
        noOneShown.put(player.getUniqueId(), now);
        // Через тик, чтобы строка пришла после самого сообщения
        getServer().getScheduler().runTask(this, () -> {
            if (player.isOnline()) {
                player.sendMessage("§7Рядом никого нет");
            }
        });
    }

    /**
     * Строка слежки: Essentials собирает её через MiniMessage и вставляет после ника «<reset>»,
     * а сразу за ником в формате стоит «</gray>» от "&7>". Закрывать после сброса нечего,
     * и MiniMessage печатает «</gray>» текстом. Убираем это закрытие.
     */
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onSpy(net.ess3.api.events.LocalChatSpyEvent event) {
        String format = event.getFormat();
        String fixed = format.replace("%1$s</gray>", "%1$s").replace("%s</gray>", "%s");
        if (!fixed.equals(format)) {
            event.setFormat(fixed);
        }
    }

    boolean isLocalChat(Object chatEvent) {
        return chatEvent != null && localChats.contains(chatEvent);
    }

    /**
     * "!текст": одно сообщение в ближний чат. Essentials выбирает тип чата на LOWEST по режиму игрока
     * (общий или ближний) и запоминает его; наш обработчик стоит раньше (loadbefore EssentialsChat).
     */
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onLocalPrefix(AsyncPlayerChatEvent event) {
        String message = event.getMessage();
        if (message.length() < 2 || message.charAt(0) != LOCAL_PREFIX
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
    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Команда только для игроков");
            return true;
        }
        boolean local = command.getName().equalsIgnoreCase("l");
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
            getServer().getScheduler().runTaskAsynchronously(this, () -> {
                boolean isPassword = authMe.checkPassword(player.getName(), text);
                getServer().getScheduler().runTask(this, () -> {
                    if (!player.isOnline()) {
                        return;
                    }
                    if (isPassword) {
                        player.sendMessage("§cВы уже вошли на сервер. Сообщение не отправлено: это ваш пароль.");
                    } else {
                        player.chat(LOCAL_PREFIX + text);
                    }
                });
            });
        } else {
            // Через ту же приставку: весь путь сообщения (мут, AuthMe, формат) как у обычного чата
            player.chat(LOCAL_PREFIX + text);
        }
        return true;
    }

    private void setMode(Player player, User user, boolean local) {
        long radius = essentials.getSettings().getChatRadius();
        if (local) {
            if (!user.isToggleShout()) {
                player.sendMessage("§7Вы уже пишете рядом. Вернуть общий чат: §f/g");
                return;
            }
            user.setToggleShout(false);
            player.sendMessage("§7Чат: §fрядом§7, сообщения видят игроки в " + radius
                    + " блоках. Одно сообщение всем: §f/g текст§7, вернуть общий чат: §f/g");
        } else {
            if (user.isToggleShout()) {
                player.sendMessage("§7Вы уже пишете всем. Сообщение рядом: §f!текст§7 или §f/l текст");
                return;
            }
            user.setToggleShout(true);
            player.sendMessage("§7Чат: §fобщий§7. Сообщение рядом: §f!текст§7 или §f/l текст");
        }
    }

    /** Одно сообщение всем, даже из режима «рядом»; "!" в начале здесь не делает его ближним. */
    private void sendGlobal(Player player, User user, String text) {
        if (text.startsWith("/")) {
            player.sendMessage("§cСообщение не может начинаться с /");
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
        return getServer().getPluginManager().isPluginEnabled("AuthMe") ? AuthMeApi.getInstance() : null;
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Component tag = tagOf(event.getPlayer());
        if (tag == null) {
            return;
        }
        ChatRenderer original = event.renderer();
        event.renderer((source, displayName, message, viewer) -> {
            Component line = original.render(source, displayName, message, viewer);
            return seesTags(viewer) ? withTag(line, tag) : line;
        });
    }

    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacySection();

    /** Тег в начало строки или сразу после приставки типа чата, если строка с неё начинается. */
    private Component withTag(Component line, Component tag) {
        String plain = PlainTextComponentSerializer.plainText().serialize(line);
        for (String prefix : prefixes) {
            if (prefix.isEmpty() || !plain.startsWith(prefix)) {
                continue;
            }
            // Строка чата от Paper устроена вложенно, замена текста внутрь не проходит.
            // Вставляем тег в текстовом виде с кодами цвета и сразу возвращаем цвет строки.
            String text = LEGACY.serialize(line);
            int at = text.indexOf(prefix);
            if (at < 0) {
                break;
            }
            int after = at + prefix.length();
            return LEGACY.deserialize(text.substring(0, after) + LEGACY.serialize(tag)
                    + activeCodes(text.substring(0, after)) + text.substring(after));
        }
        return tag.append(line);
    }

    /** Коды цвета и оформления, действующие в конце куска текста (чтобы продолжить тем же цветом). */
    private static String activeCodes(String text) {
        StringBuilder codes = new StringBuilder();
        for (int i = 0; i + 1 < text.length(); i++) {
            if (text.charAt(i) != '§') {
                continue;
            }
            char code = Character.toLowerCase(text.charAt(i + 1));
            if ("0123456789abcdefr".indexOf(code) >= 0) {
                codes.setLength(0);
            }
            if (code != 'r') {
                codes.append('§').append(code);
            }
            i++;
        }
        return codes.length() == 0 ? "§r" : codes.toString();
    }

    /** Готовый тег из SimpleClans (тот же, что раньше подставлялся вместо {clan}), или null. */
    private static Component tagOf(Player player) {
        ClanPlayer clanPlayer = clanPlayer(player);
        if (clanPlayer == null || clanPlayer.getClan() == null || !clanPlayer.isTagEnabled()) {
            return null;
        }
        String label = clanPlayer.getTagLabel();
        if (label == null || label.isBlank()) {
            return null;
        }
        return LegacyComponentSerializer.legacySection().deserialize(label.replace('&', '§'));
    }

    /** Теги видят админы и игроки в кланах; консоль и журнал сервера видят всегда. */
    private static boolean seesTags(net.kyori.adventure.audience.Audience viewer) {
        if (!(viewer instanceof Player player)) {
            return true;
        }
        if (player.hasPermission(SEE_PERMISSION)) {
            return true;
        }
        ClanPlayer clanPlayer = clanPlayer(player);
        return clanPlayer != null && clanPlayer.getClan() != null;
    }

    private static ClanPlayer clanPlayer(Player player) {
        SimpleClans simpleClans = SimpleClans.getInstance();
        return simpleClans == null ? null : simpleClans.getClanManager().getClanPlayer(player);
    }
}
