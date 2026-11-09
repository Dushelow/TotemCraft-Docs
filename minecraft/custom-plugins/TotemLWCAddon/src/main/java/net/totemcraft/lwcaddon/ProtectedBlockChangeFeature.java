package net.totemcraft.lwcaddon;

import com.griefcraft.lwc.LWC;
import com.griefcraft.model.Protection;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Чужой игрок не может менять запривачённый блок: снять воск топором или нанести сотами
 * на медный сундук и тому подобное.
 * <p>
 * LWC при смене блока игроком проверяет только право пользоваться приватом. В «защищенный от кражи»
 * (donation) класть вещи может любой, поэтому LWC пропускал чужого с топором или сотами, тип блока
 * менялся, и приват пропадал (проверено на стенде 09.11.2026). Менять блок может только тот,
 * кто управляет приватом в LWC: владелец и админы LWC.
 */
final class ProtectedBlockChangeFeature implements Listener {

    private final boolean notify;
    private final long cooldownMs;
    private final String localeKey;
    private final Map<UUID, Long> told = new ConcurrentHashMap<>();

    ProtectedBlockChangeFeature(ConfigurationSection config) {
        notify = config.getBoolean("notify", true);
        cooldownMs = config.getLong("cooldown-seconds", 3) * 1000L;
        localeKey = config.getString("lwc-message", "protection.general.locked.private");
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onChange(EntityChangeBlockEvent event) {
        if (!(event.getEntity() instanceof Player player)) {
            return;
        }
        LWC lwc = LWC.getInstance();
        if (lwc == null) {
            return;
        }
        Protection protection = lwc.findProtection(event.getBlock());
        if (protection == null || lwc.canAdminProtection(player, protection)) {
            return;
        }
        event.setCancelled(true);
        if (!notify) {
            return;
        }
        long now = System.currentTimeMillis();
        Long last = told.get(player.getUniqueId());
        if (last != null && now - last < cooldownMs) {
            return;
        }
        told.put(player.getUniqueId(), now);
        lwc.sendLocale(player, localeKey, "block", LWC.materialToString(event.getBlock()));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        told.remove(event.getPlayer().getUniqueId());
    }
}
