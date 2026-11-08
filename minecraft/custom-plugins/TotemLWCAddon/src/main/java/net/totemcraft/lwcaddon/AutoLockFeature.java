package net.totemcraft.lwcaddon;

import com.griefcraft.cache.BlockCache;
import com.griefcraft.lwc.LWC;
import com.griefcraft.model.Protection;
import com.griefcraft.scripting.event.LWCProtectionRegisterEvent;
import com.griefcraft.scripting.event.LWCProtectionRegistrationPostEvent;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import static net.totemcraft.lwcaddon.TotemLWCAddon.color;

/**
 * /autolock: постоянный автоприват по выбору игрока. Пока режим включён, каждый блок из списка
 * (по умолчанию сундуки, сундуки-ловушки, все медные сундуки и бочки) сразу приватится
 * типом из настройки (по умолчанию donation, на сервере он называется «защищенный от кражи»).
 * <p>
 * Приват создаётся через то же событие LWC, что и его собственный автоприват, поэтому лимиты
 * приватов и прочие проверки LWC продолжают работать. Блок должен быть разрешён в core.yml LWC.
 */
final class AutoLockFeature implements Listener {

    private final JavaPlugin plugin;
    private final List<Pattern> blocks = new ArrayList<>();
    private final List<Pattern> exclude = new ArrayList<>();
    private final List<String> blockNames;
    private final List<String> excludeNames;
    private final Protection.Type type;
    private final Path storage;
    private final ConfigurationSection messages;
    private final Set<UUID> enabled = ConcurrentHashMap.newKeySet();

    AutoLockFeature(JavaPlugin plugin, ConfigurationSection config) {
        this.plugin = plugin;
        blockNames = config.getStringList("blocks");
        excludeNames = config.getStringList("exclude");
        for (String glob : blockNames) {
            blocks.add(glob(glob));
        }
        for (String glob : excludeNames) {
            exclude.add(glob(glob));
        }
        Protection.Type parsed;
        try {
            parsed = Protection.Type.valueOf(config.getString("protection-type", "donation").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            plugin.getLogger().warning("Неизвестный protection-type, беру donation");
            parsed = Protection.Type.DONATION;
        }
        type = parsed;
        messages = config.getConfigurationSection("messages");
        storage = plugin.getDataFolder().toPath().resolve(config.getString("players-file", "autolock-players.txt"));
        load();
    }

    String describe() {
        return "тип " + type + ", блоки " + blockNames + " кроме " + excludeNames + ", включён у " + enabled.size();
    }

    /** Шаблон вида "*COPPER_CHEST": звёздочка - любые символы, регистр не важен. */
    private static Pattern glob(String text) {
        return Pattern.compile(Pattern.quote(text.trim().toUpperCase(Locale.ROOT)).replace("*", "\\E.*\\Q"));
    }

    boolean autoLocks(Material material) {
        String name = material.name();
        return blocks.stream().anyMatch(p -> p.matcher(name).matches())
                && exclude.stream().noneMatch(p -> p.matcher(name).matches());
    }

    boolean onCommand(CommandSender sender) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage(message("only-players"));
            return true;
        }
        if (enabled.remove(player.getUniqueId())) {
            player.sendMessage(message("disabled"));
        } else {
            enabled.add(player.getUniqueId());
            player.sendMessage(message("enabled"));
        }
        save();
        return true;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        if (!enabled.contains(player.getUniqueId())) {
            return;
        }
        Block block = event.getBlockPlaced();
        if (!autoLocks(block.getType())) {
            return;
        }
        LWC lwc = LWC.getInstance();
        // Не приватим, если LWC такой блок не приватит или приват уже есть (вторая половина двойного сундука)
        if (lwc == null || !lwc.isProtectable(block) || lwc.findProtection(block) != null
                || joinsProtectedChest(lwc, block)) {
            return;
        }
        LWCProtectionRegisterEvent check = new LWCProtectionRegisterEvent(player, block);
        lwc.getModuleLoader().dispatchEvent(check);
        if (check.isCancelled()) {
            return;
        }
        int blockId = BlockCache.getInstance().getBlockId(block);
        if (blockId < 0) {
            blockId = BlockCache.getInstance().addBlock(block);
        }
        Protection protection = lwc.getPhysicalDatabase().registerProtection(blockId, type,
                block.getWorld().getName(), player.getUniqueId().toString(), "",
                block.getX(), block.getY(), block.getZ());
        if (protection == null) {
            plugin.getLogger().warning("LWC не создал приват для " + player.getName() + " в " + block.getLocation());
            return;
        }
        protection.saveNow();
        lwc.getModuleLoader().dispatchEvent(new LWCProtectionRegistrationPostEvent(protection));
        player.sendMessage(message("created"));
    }

    /**
     * Сундук, поставленный вплотную к такому же сундуку с приватом, станет его второй половиной.
     * В момент установки LWC этого ещё не видит, поэтому соседей проверяем сами.
     */
    private static boolean joinsProtectedChest(LWC lwc, Block block) {
        Material type = block.getType();
        for (BlockFace face : new BlockFace[] {BlockFace.NORTH, BlockFace.SOUTH, BlockFace.EAST, BlockFace.WEST}) {
            Block near = block.getRelative(face);
            if (near.getType() == type && lwc.findProtection(near) != null) {
                return true;
            }
        }
        return false;
    }

    private String message(String key) {
        return color(messages == null ? key : messages.getString(key, key));
    }

    private void load() {
        try {
            if (Files.exists(storage)) {
                for (String line : Files.readAllLines(storage, StandardCharsets.UTF_8)) {
                    if (!line.isBlank()) {
                        enabled.add(UUID.fromString(line.trim()));
                    }
                }
            }
        } catch (IOException | IllegalArgumentException e) {
            plugin.getLogger().warning("Не удалось прочитать список /autolock: " + e.getMessage());
        }
    }

    private synchronized void save() {
        try {
            Files.createDirectories(storage.getParent());
            Files.write(storage, enabled.stream().map(UUID::toString).toList(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            plugin.getLogger().warning("Не удалось сохранить список /autolock: " + e.getMessage());
        }
    }
}
