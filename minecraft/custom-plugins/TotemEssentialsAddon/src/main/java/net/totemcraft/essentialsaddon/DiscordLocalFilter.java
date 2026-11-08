package net.totemcraft.essentialsaddon;

import github.scarsz.discordsrv.DiscordSRV;
import github.scarsz.discordsrv.api.Subscribe;
import github.scarsz.discordsrv.api.events.GameChatMessagePreProcessEvent;

/**
 * Сообщения ближнего чата не уходят в Discord: DiscordSRV не знает про ближний чат Essentials
 * и пересылал бы их в общий канал. Отдельный класс, чтобы без DiscordSRV плагин тоже запускался.
 */
final class DiscordLocalFilter {

    private final LocalChatTracker tracker;

    private DiscordLocalFilter(LocalChatTracker tracker) {
        this.tracker = tracker;
    }

    static Object register(LocalChatTracker tracker) {
        DiscordLocalFilter filter = new DiscordLocalFilter(tracker);
        DiscordSRV.api.subscribe(filter);
        return filter;
    }

    static void unregister(Object filter) {
        DiscordSRV.api.unsubscribe(filter);
    }

    @Subscribe
    public void onPreProcess(GameChatMessagePreProcessEvent event) {
        if (tracker.isLocalChat(event.getTriggeringBukkitEvent())) {
            event.setCancelled(true);
        }
    }
}
