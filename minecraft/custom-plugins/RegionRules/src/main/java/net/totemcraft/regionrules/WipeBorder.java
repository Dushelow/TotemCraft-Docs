package net.totemcraft.regionrules;

import org.bukkit.Location;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.vehicle.VehicleMoveEvent;

import java.util.HashMap;
import java.util.Map;

/**
 * Граница зоны вайпа (config.yml, wipe-border): сообщения при пересечении квадрата ±radius
 * внутри одного мира, пешком, на транспорте или телепортом.
 *
 * Раньше это были greeting/farewell региона world_core в WorldGuard, но WorldGuard считает
 * выходом из региона и переход в другой мир: «Вы покидаете центр мира» показывалось после
 * каждого портала в Незер и Энд. Здесь переход между мирами сообщения не даёт, кроме случая,
 * когда игрок попал сразу за границу (например, через портал из дальнего Незера).
 */
final class WipeBorder implements Listener {

    private record Zone(int radius, String leaveTitle, String leaveMessage, String enterMessage) {
        boolean inside(Location l) {
            return Math.abs(l.getBlockX()) <= radius && Math.abs(l.getBlockZ()) <= radius;
        }
    }

    private final Map<String, Zone> zones = new HashMap<>();

    WipeBorder(ConfigurationSection section) {
        if (section == null) {
            return;
        }
        for (String world : section.getKeys(false)) {
            ConfigurationSection z = section.getConfigurationSection(world);
            if (z != null) {
                zones.put(world, new Zone(z.getInt("radius", 10000), z.getString("leave-title", ""),
                        z.getString("leave-message", ""), z.getString("enter-message", "")));
            }
        }
    }

    boolean isEmpty() {
        return zones.isEmpty();
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        zones.forEach((w, z) -> sb.append(w).append(" ±").append(z.radius).append(' '));
        return sb.toString().trim();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        Location from = event.getFrom(), to = event.getTo();
        // Дёшево: дальше идём, только если сменился блок по X или Z
        if (from.getBlockX() != to.getBlockX() || from.getBlockZ() != to.getBlockZ()) {
            cross(event.getPlayer(), from, to);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTeleport(PlayerTeleportEvent event) {
        cross(event.getPlayer(), event.getFrom(), event.getTo());
    }

    /** На лодке, лошади и прочем PlayerMoveEvent не приходит. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onVehicle(VehicleMoveEvent event) {
        Location from = event.getFrom(), to = event.getTo();
        if (from.getBlockX() == to.getBlockX() && from.getBlockZ() == to.getBlockZ()) {
            return;
        }
        for (Entity passenger : event.getVehicle().getPassengers()) {
            if (passenger instanceof Player player) {
                cross(player, from, to);
            }
        }
    }

    /** Через портал сразу за границу: предупредить, раз шагом её не пересекали. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onWorldChange(PlayerChangedWorldEvent event) {
        Player player = event.getPlayer();
        Zone zone = zones.get(player.getWorld().getName());
        if (zone != null && !zone.inside(player.getLocation())) {
            leave(player, zone);
        }
    }

    private void cross(Player player, Location from, Location to) {
        if (to == null || from.getWorld() != to.getWorld()) {
            return;
        }
        Zone zone = zones.get(to.getWorld().getName());
        if (zone == null) {
            return;
        }
        boolean was = zone.inside(from), now = zone.inside(to);
        if (was && !now) {
            leave(player, zone);
        } else if (!was && now && !zone.enterMessage.isEmpty()) {
            player.sendMessage(zone.enterMessage);
        }
    }

    private static void leave(Player player, Zone zone) {
        if (!zone.leaveTitle.isEmpty()) {
            player.sendTitle(zone.leaveTitle, "", 10, 70, 20);
        }
        if (!zone.leaveMessage.isEmpty()) {
            player.sendMessage(zone.leaveMessage);
        }
    }
}
