package net.totemcraft.packeteventsaddon;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.event.PacketListenerCommon;
import com.github.retrooper.packetevents.event.PacketListenerPriority;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Аддон TotemCraft к PacketEvents. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link OnePositionPerTickFeature} - лишний пакет с координатами за тик клиента превращается
 *   в пакет поворота, иначе ядро 26.x кикает (принтер Litematica и похожие моды).</li>
 * </ul>
 */
public final class TotemPacketEventsAddon extends JavaPlugin {

    private PacketListenerCommon movementListener;
    private OnePositionPerTickFeature movement;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        ConfigurationSection config = getConfig().getConfigurationSection("one-position-per-tick");
        if (config != null && config.getBoolean("enabled", true)) {
            movement = new OnePositionPerTickFeature(this, config);
            // LOWEST: раньше всех остальных слушателей (Vulcan видит уже исправленный поток пакетов)
            movementListener = PacketEvents.getAPI().getEventManager()
                    .registerListener(movement, PacketListenerPriority.LOWEST);
            movement.startSummary();
            getLogger().info("Один пакет с координатами за тик клиента: включено");
        }
    }

    @Override
    public void onDisable() {
        if (movementListener != null) {
            PacketEvents.getAPI().getEventManager().unregisterListener(movementListener);
        }
        if (movement != null) {
            movement.logSummary();
        }
    }
}
