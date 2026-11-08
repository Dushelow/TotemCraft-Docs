package net.totemcraft.essentialsaddon;

import net.ess3.api.events.LocalChatSpyEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Строка слежки за ближним чатом: Essentials собирает её через MiniMessage и вставляет после ника
 * «&lt;reset&gt;», а сразу за ником в формате стоит «&lt;/gray&gt;» от "&amp;7&gt;". Закрывать после сброса
 * нечего, и MiniMessage печатает «&lt;/gray&gt;» текстом. Убираем это закрытие.
 */
final class SpyFormatFix implements Listener {

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onSpy(LocalChatSpyEvent event) {
        String format = event.getFormat();
        String fixed = format.replace("%1$s</gray>", "%1$s").replace("%s</gray>", "%s");
        if (!fixed.equals(format)) {
            event.setFormat(fixed);
        }
    }
}
