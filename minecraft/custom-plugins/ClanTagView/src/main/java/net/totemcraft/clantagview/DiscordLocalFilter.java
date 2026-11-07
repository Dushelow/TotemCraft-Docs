package net.totemcraft.clantagview;

import github.scarsz.discordsrv.DiscordSRV;
import github.scarsz.discordsrv.api.Subscribe;
import github.scarsz.discordsrv.api.events.GameChatMessagePreProcessEvent;

/**
 * Сообщения ближнего чата не уходят в Discord: DiscordSRV не знает про ближний чат Essentials
 * и пересылал бы их в общий канал. Отдельный класс, чтобы без DiscordSRV плагин тоже запускался.
 */
public final class DiscordLocalFilter {

    private final ClanTagView plugin;

    private DiscordLocalFilter(ClanTagView plugin) {
        this.plugin = plugin;
    }

    static Object register(ClanTagView plugin) {
        DiscordLocalFilter filter = new DiscordLocalFilter(plugin);
        DiscordSRV.api.subscribe(filter);
        return filter;
    }

    static void unregister(Object filter) {
        DiscordSRV.api.unsubscribe(filter);
    }

    @Subscribe
    public void onPreProcess(GameChatMessagePreProcessEvent event) {
        if (plugin.isLocalChat(event.getTriggeringBukkitEvent())) {
            event.setCancelled(true);
        }
    }
}
