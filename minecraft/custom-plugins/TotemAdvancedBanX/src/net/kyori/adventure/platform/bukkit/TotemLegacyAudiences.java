package net.kyori.adventure.platform.bukkit;

import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.flattener.ComponentFlattener;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.util.UUID;
import java.util.function.Predicate;

/** TotemCraft: сообщения AdvancedBanX обычным текстом с цветами (§), работает на любой версии Paper. */
final class TotemLegacyAudiences implements BukkitAudiences {

    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.builder()
            .character('§').hexColors().useUnusualXRepeatedCharacterHexFormat().build();

    /** Получатель: одна команда/игрок/консоль. */
    private record Sender(CommandSender target) implements Audience {
        @Override
        public void sendMessage(Component message) {
            target.sendMessage(LEGACY.serialize(message));
        }
    }

    @Override public Audience sender(CommandSender sender) { return new Sender(sender); }
    @Override public Audience player(Player player) { return new Sender(player); }
    @Override public Audience filter(Predicate<CommandSender> filter) { return Audience.empty(); }
    @Override public Audience all() { return Audience.empty(); }
    @Override public Audience console() { return new Sender(Bukkit.getConsoleSender()); }
    @Override public Audience players() { return Audience.empty(); }
    @Override public Audience player(UUID uuid) {
        Player p = Bukkit.getPlayer(uuid);
        return p == null ? Audience.empty() : new Sender(p);
    }
    @Override public Audience permission(String permission) { return Audience.empty(); }
    @Override public Audience world(Key world) { return Audience.empty(); }
    @Override public Audience server(String serverName) { return Audience.empty(); }
    @Override public ComponentFlattener flattener() { return ComponentFlattener.basic(); }
    @Override public void close() { }
}
