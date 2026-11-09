package net.totemcraft.packeteventsaddon;

import com.github.retrooper.packetevents.event.PacketListener;
import com.github.retrooper.packetevents.event.PacketReceiveEvent;
import com.github.retrooper.packetevents.event.UserDisconnectEvent;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.github.retrooper.packetevents.protocol.packettype.PacketTypeCommon;
import com.github.retrooper.packetevents.protocol.player.User;
import com.github.retrooper.packetevents.wrapper.play.client.WrapperPlayClientPlayerPositionAndRotation;
import com.github.retrooper.packetevents.wrapper.play.client.WrapperPlayClientPlayerRotation;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * С 26.x ядро принимает от клиента не больше одного пакета движения с координатами за один тик клиента:
 * флаг receivedPositionThisTick в ServerGamePacketListenerImpl сбрасывается только пакетом
 * «конец тика клиента» (ServerboundClientTickEndPacket), второй пакет с координатами до него -
 * кик «Invalid move player packet received». Принтер Litematica, поворачивая игрока к блоку,
 * шлёт несколько полных пакетов (координаты + поворот) за тик, и игрока выкидывает.
 * <p>
 * Здесь повторяем ту же логику на входе: второй и следующие пакеты с координатами в одном тике
 * клиента превращаем в пакет «только поворот» (поворот нужен принтеру, чтобы блок встал правильной
 * стороной), а пакет «только координаты» отбрасываем: актуальные координаты придут в следующем тике.
 * Пакеты одного игрока обрабатываются по порядку в его сетевом потоке, поэтому счётчик точный.
 */
final class OnePositionPerTickFeature implements PacketListener {

    private final JavaPlugin plugin;
    private final long summaryMinutes;
    /** Игроки, у которых в текущем тике клиента уже был пакет с координатами. */
    private final Set<User> hadPosition = ConcurrentHashMap.newKeySet();
    /** Сколько пакетов исправлено с прошлой сводки, по нику. */
    private final Map<String, AtomicLong> fixed = new ConcurrentHashMap<>();

    OnePositionPerTickFeature(JavaPlugin plugin, ConfigurationSection config) {
        this.plugin = plugin;
        this.summaryMinutes = config.getLong("log-summary-minutes", 10);
    }

    @Override
    public void onPacketReceive(PacketReceiveEvent event) {
        PacketTypeCommon type = event.getPacketType();
        User user = event.getUser();
        if (type == PacketType.Play.Client.CLIENT_TICK_END) {
            hadPosition.remove(user);
            return;
        }
        boolean full = type == PacketType.Play.Client.PLAYER_POSITION_AND_ROTATION;
        if (!full && type != PacketType.Play.Client.PLAYER_POSITION) {
            return;
        }
        if (hadPosition.add(user)) {
            return; // первый пакет с координатами в этом тике - как обычно
        }
        event.setCancelled(true);
        if (full) {
            WrapperPlayClientPlayerPositionAndRotation packet = new WrapperPlayClientPlayerPositionAndRotation(event);
            WrapperPlayClientPlayerRotation rotation =
                    new WrapperPlayClientPlayerRotation(packet.getYaw(), packet.getPitch(), packet.isOnGround());
            rotation.setHorizontalCollision(packet.isHorizontalCollision());
            // Не «silently»: Vulcan и другие слушатели должны увидеть поворот, как его увидит сервер
            user.receivePacket(rotation);
        }
        String name = user.getName() == null ? String.valueOf(user.getUUID()) : user.getName();
        fixed.computeIfAbsent(name, k -> new AtomicLong()).incrementAndGet();
    }

    @Override
    public void onUserDisconnect(UserDisconnectEvent event) {
        hadPosition.remove(event.getUser());
    }

    void startSummary() {
        if (summaryMinutes <= 0) {
            return;
        }
        long ticks = summaryMinutes * 60 * 20;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::logSummary, ticks, ticks);
    }

    /** Одна строка в журнал раз в N минут, только если что-то исправляли. */
    void logSummary() {
        if (fixed.isEmpty()) {
            return;
        }
        StringBuilder line = new StringBuilder("Лишние пакеты с координатами превращены в поворот: ");
        fixed.forEach((name, count) -> line.append(name).append(' ').append(count.getAndSet(0)).append(", "));
        fixed.values().removeIf(c -> c.get() == 0);
        plugin.getLogger().info(line.substring(0, line.length() - 2));
    }
}
