package net.kyori.adventure.platform.bukkit;

import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.platform.AudienceProvider;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.function.Predicate;

/**
 * TotemCraft: замена BukkitAudiences внутри jar AdvancedBanX 3.1.0.
 * Встроенная в AdvancedBanX библиотека adventure-platform-bukkit на Paper 26.x молча не доставляет
 * сообщения (ни игрокам, ни в консоль). AdvancedBanX вызывает только create(), sender() и close(),
 * поэтому подменяем их реализацией, которая шлёт обычный текст через CommandSender.sendMessage(String).
 */
public interface BukkitAudiences extends AudienceProvider {

    static BukkitAudiences create(Plugin plugin) {
        return new TotemLegacyAudiences();
    }

    Audience sender(CommandSender sender);

    Audience player(Player player);

    Audience filter(Predicate<CommandSender> filter);
}
