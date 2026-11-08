package net.totemcraft.simpleclansaddon;

import io.papermc.paper.chat.ChatRenderer;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import net.sacredlabyrinth.phaed.simpleclans.ClanPlayer;
import net.sacredlabyrinth.phaed.simpleclans.SimpleClans;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

import java.util.List;

/**
 * Тег клана перед ником в чате видят только игроки в кланах и админы (право из настройки).
 * Сообщение собирается без тега (в формате Essentials нет {clan}), а тег добавляется в начало
 * строки отдельно для каждого получателя штатным механизмом Paper (ChatRenderer). Пакеты не трогаем.
 */
final class ClanTagsFeature implements Listener {

    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacySection();

    /** Приставки типа чата ("[Рядом] "): тег ставится после них, а не перед. */
    private final List<String> prefixes;
    private final String seePermission;

    ClanTagsFeature(ConfigurationSection config) {
        prefixes = List.copyOf(config.getStringList("tag-after-prefixes"));
        seePermission = config.getString("see-permission", "clantagview.see");
    }

    String describe() {
        return "право " + seePermission + ", тег после " + prefixes;
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
        return LEGACY.deserialize(label.replace('&', '§'));
    }

    /** Теги видят админы и игроки в кланах; консоль и журнал сервера видят всегда. */
    private boolean seesTags(Audience viewer) {
        if (!(viewer instanceof Player player)) {
            return true;
        }
        if (player.hasPermission(seePermission)) {
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
