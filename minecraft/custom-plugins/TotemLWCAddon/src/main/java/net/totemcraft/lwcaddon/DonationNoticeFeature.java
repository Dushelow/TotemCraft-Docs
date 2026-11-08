package net.totemcraft.lwcaddon;

import com.griefcraft.lwc.LWC;
import com.griefcraft.model.Protection;
import org.bukkit.Location;
import org.bukkit.block.BlockState;
import org.bukkit.block.DoubleChest;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.InventoryHolder;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * LWC молча не даёт брать вещи из чужого контейнера типа donation («защищенный от кражи»).
 * Тогда пишем игроку то же, что LWC пишет у обычного привата (ключ из его языкового файла),
 * не чаще раза в cooldown. Срабатывает только на клики, которые LWC уже отменил.
 */
final class DonationNoticeFeature implements Listener {

    private final long cooldownMs;
    private final String localeKey;
    private final Map<UUID, Long> told = new ConcurrentHashMap<>();

    DonationNoticeFeature(ConfigurationSection config) {
        cooldownMs = config.getLong("cooldown-seconds", 3) * 1000L;
        localeKey = config.getString("lwc-message", "protection.general.locked.private");
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onClick(InventoryClickEvent event) {
        if (!event.isCancelled() || !(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        InventoryHolder holder = event.getView().getTopInventory().getHolder(false);
        Location location = holder instanceof BlockState state ? state.getLocation()
                : holder instanceof DoubleChest chest ? chest.getLocation() : null;
        LWC lwc = LWC.getInstance();
        if (location == null || lwc == null) {
            return;
        }
        Protection protection = lwc.findProtection(location);
        if (protection == null || protection.getType() != Protection.Type.DONATION || protection.isOwner(player)) {
            return;
        }
        long now = System.currentTimeMillis();
        Long last = told.get(player.getUniqueId());
        if (last != null && now - last < cooldownMs) {
            return;
        }
        told.put(player.getUniqueId(), now);
        lwc.sendLocale(player, localeKey, "block", LWC.materialToString(protection.getBlock()));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        told.remove(event.getPlayer().getUniqueId());
    }
}
