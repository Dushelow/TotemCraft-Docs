package net.totemcraft.clantagview;

import io.papermc.paper.chat.ChatRenderer;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.sacredlabyrinth.phaed.simpleclans.ClanPlayer;
import net.sacredlabyrinth.phaed.simpleclans.SimpleClans;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Тег клана перед ником в чате видят только игроки в кланах и админы (право clantagview.see).
 * Сообщение собирается без тега (в формате Essentials нет {clan}), а тег добавляется в начало
 * строки отдельно для каждого получателя штатным механизмом Paper (ChatRenderer). Пакеты не трогаем.
 */
public final class ClanTagView extends JavaPlugin implements Listener {

    private static final String SEE_PERMISSION = "clantagview.see";

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
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
            return seesTags(viewer) ? tag.append(line) : line;
        });
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
