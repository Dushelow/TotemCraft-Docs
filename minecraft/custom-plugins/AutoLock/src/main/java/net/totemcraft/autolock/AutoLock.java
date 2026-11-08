package net.totemcraft.autolock;

import com.griefcraft.cache.BlockCache;
import com.griefcraft.lwc.LWC;
import com.griefcraft.model.Protection;
import com.griefcraft.scripting.event.LWCProtectionRegisterEvent;
import com.griefcraft.scripting.event.LWCProtectionRegistrationPostEvent;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.block.DoubleChest;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * /autolock: постоянный автоприват по выбору игрока. Пока режим включён, каждый сундук, который
 * игрок ставит (обычный, ловушка, любой медный), сразу приватится как «защищенный от кражи»
 * (тип donation в LWC). Как в старом автопривате LWC до 26.3, ещё бочки. Печи, воронки, двери
 * и прочее не трогаем: их игрок приватит сам, если LWC разрешает (core.yml).
 *
 * Ещё: LWC молча не даёт брать вещи из чужого контейнера «защищенный от кражи». Тогда пишем
 * то же, что LWC пишет у обычного привата (protection.general.locked.private), не чаще раза в 3 с.
 * Создание идёт через то же событие LWC, что и его собственный автоприват, поэтому
 * лимиты приватов и прочие проверки LWC продолжают работать.
 */
public final class AutoLock extends JavaPlugin implements Listener {

    private final Set<UUID> enabled = ConcurrentHashMap.newKeySet();
    private final Map<UUID, Long> donationTold = new ConcurrentHashMap<>();
    private Path storage;

    @Override
    public void onEnable() {
        storage = getDataFolder().toPath().resolve("players.txt");
        load();
        getServer().getPluginManager().registerEvents(this, this);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Команда только для игроков");
            return true;
        }
        if (enabled.remove(player.getUniqueId())) {
            player.sendMessage("§7Автоприват §cвыключен§7: новые сундуки и бочки ставятся открытыми.");
        } else {
            enabled.add(player.getUniqueId());
            player.sendMessage("§7Автоприват §aвключён§7: сундуки и бочки, которые вы ставите, сразу защищены от кражи."
                    + " Выключить: §f/autolock");
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
        Protection protection = lwc.getPhysicalDatabase().registerProtection(blockId, Protection.Type.DONATION,
                block.getWorld().getName(), player.getUniqueId().toString(), "",
                block.getX(), block.getY(), block.getZ());
        if (protection == null) {
            getLogger().warning("LWC не создал приват для " + player.getName() + " в " + block.getLocation());
            return;
        }
        protection.saveNow();
        lwc.getModuleLoader().dispatchEvent(new LWCProtectionRegistrationPostEvent(protection));
        // Название типа как в lwc_ru.properties сервера (donation=защищенный от кражи)
        player.sendMessage("§7Создан приват: §fзащищенный от кражи");
    }

    /** Сундук, сундук-ловушка, все медные сундуки (обычные, окисленные, вощёные) и бочка. Не эндер-сундук. */
    static boolean autoLocks(Material type) {
        return type == Material.BARREL || (type != Material.ENDER_CHEST && type.name().endsWith("CHEST"));
    }

    /** LWC уже отменил клик (взять из чужого «защищенного от кражи»): сказать почему. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onDonationClick(InventoryClickEvent event) {
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
        Long last = donationTold.get(player.getUniqueId());
        if (last != null && now - last < 3000) {
            return;
        }
        donationTold.put(player.getUniqueId(), now);
        lwc.sendLocale(player, "protection.general.locked.private", "block", LWC.materialToString(protection.getBlock()));
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

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        donationTold.remove(event.getPlayer().getUniqueId());
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
            getLogger().warning("Не удалось прочитать список: " + e.getMessage());
        }
    }

    private synchronized void save() {
        try {
            Files.createDirectories(storage.getParent());
            Files.write(storage, enabled.stream().map(UUID::toString).toList(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            getLogger().warning("Не удалось сохранить список: " + e.getMessage());
        }
    }
}
