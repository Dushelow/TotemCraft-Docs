package net.totemcraft.essentialsaddon;

import net.essentialsx.api.v2.events.chat.LocalChatEvent;
import org.bukkit.GameMode;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;

import static net.totemcraft.essentialsaddon.TotemEssentialsAddon.color;

/**
 * Узнаёт, какие сообщения Essentials отправил как ближние (любые: через "!", /l или режим «рядом»).
 * Нужен фильтру Discord и предупреждению «Рядом никого нет».
 */
final class LocalChatTracker implements Listener {

    private final JavaPlugin plugin;
    private final boolean warnNoOne;
    private final long cooldownMs;
    private final String noOneText;
    /** Сообщения, которые Essentials отправил как ближние: DiscordSRV получает их позже, в другом потоке. */
    private final Set<Object> localChats = Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<>()));
    /** Игрок, чьё сообщение Essentials только что сделал ближним (тот же поток, то же событие чата). */
    private final ThreadLocal<Player> localNow = new ThreadLocal<>();
    private final Map<UUID, Long> noOneShown = new ConcurrentHashMap<>();

    LocalChatTracker(JavaPlugin plugin, boolean warnNoOne, ConfigurationSection config) {
        this.plugin = plugin;
        this.warnNoOne = warnNoOne;
        this.cooldownMs = (config == null ? 30 : config.getLong("cooldown-seconds", 30)) * 1000L;
        this.noOneText = color(config == null ? "&7Рядом никого нет" : config.getString("message", "&7Рядом никого нет"));
    }

    /** Essentials разослал сообщение только игрокам рядом (событие внутри обработки чата, тот же поток). */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onLocalChat(LocalChatEvent event) {
        localNow.set(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void markLocal(AsyncPlayerChatEvent event) {
        Player local = localNow.get();
        localNow.remove();
        if (local == event.getPlayer()) {
            localChats.add(event);
            if (warnNoOne) {
                warnIfNoOneHeard(event);
            }
        }
    }

    boolean isLocalChat(Object chatEvent) {
        return chatEvent != null && localChats.contains(chatEvent);
    }

    /**
     * Ближнее сообщение никто не получил: пишем «Рядом никого нет», но не чаще раза в cooldown.
     * У Essentials этот текст (localNoOne) пустой, задержки он не умеет.
     */
    private void warnIfNoOneHeard(AsyncPlayerChatEvent event) {
        Player player = event.getPlayer();
        // Наблюдатели и невидимые админы сообщение получают, но «слушателями» не считаются
        if (event.isCancelled() || event.getRecipients().stream().anyMatch(p -> p != player
                && p.getGameMode() != GameMode.SPECTATOR && player.canSee(p))) {
            return;
        }
        long now = System.currentTimeMillis();
        Long last = noOneShown.get(player.getUniqueId());
        if (last != null && now - last < cooldownMs) {
            return;
        }
        noOneShown.put(player.getUniqueId(), now);
        // Через тик, чтобы строка пришла после самого сообщения
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            if (player.isOnline()) {
                player.sendMessage(noOneText);
            }
        });
    }
}
