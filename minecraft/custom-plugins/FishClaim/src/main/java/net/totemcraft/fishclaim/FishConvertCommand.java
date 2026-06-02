package net.totemcraft.fishclaim;

import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Scanner;

public class FishConvertCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    private static final Map<Material, Material> FISH_TO_BUCKET = Map.of(
        Material.COD,           Material.COD_BUCKET,
        Material.SALMON,        Material.SALMON_BUCKET,
        Material.PUFFERFISH,    Material.PUFFERFISH_BUCKET,
        Material.TROPICAL_FISH, Material.TROPICAL_FISH_BUCKET
    );

    private static final Map<Material, Material> BUCKET_TO_FISH = Map.of(
        Material.COD_BUCKET,           Material.COD,
        Material.SALMON_BUCKET,        Material.SALMON,
        Material.PUFFERFISH_BUCKET,    Material.PUFFERFISH,
        Material.TROPICAL_FISH_BUCKET, Material.TROPICAL_FISH
    );

    public FishConvertCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    private String extractFishId(ItemMeta meta) {
        if (meta == null || !meta.hasLore()) return null;
        List<String> lore = meta.getLore();
        if (lore == null || lore.isEmpty()) return null;
        String first = ChatColor.stripColor(lore.get(0)).trim();
        return first.matches("[A-Z]{2,3}-[A-Z0-9]{6}") ? first : null;
    }

    private boolean callApi(String jsonBody, Player player) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fconvert");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code == 200) return true;
            Scanner sc = new Scanner(conn.getErrorStream(), StandardCharsets.UTF_8);
            String resp = sc.useDelimiter("\\A").next();
            sc.close();
            if (resp.contains("already released"))      player.sendMessage("§cЭта рыба уже выпущена.");
            else if (resp.contains("not released"))     player.sendMessage("§cЭта рыба не выпущена — нечего восстанавливать.");
            else if (resp.contains("not your fish"))    player.sendMessage("§cЭто не твоя рыба.");
            else                                        player.sendMessage("§cОшибка: " + resp);
            return false;
        } catch (Exception e) {
            player.sendMessage("§cНе удалось связаться с ботом.");
            plugin.getLogger().warning("fconvert API error: " + e.getMessage());
            return false;
        }
    }

    /** Возвращает [tier, weight] для рыбы по /fwhere. */
    private String[] fetchFishInfo(String fishId) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return new String[]{"mythic", "0"};
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            String tier   = body.contains("\"tier\":\"legendary\"") ? "legendary" : "mythic";
            String weight = extractJson(body, "weight");
            return new String[]{ tier, weight != null ? weight : "0" };
        } catch (Exception e) {
            return new String[]{"mythic", "0"};
        }
    }

    /** Ищет последнюю трофейную рыбу игрока данного типа у бота. */
    private String[] fetchLatestTrophy(String player, String fishType) {
        // Возвращает [fishId, tier] или null
        try {
            String urlStr = plugin.getFishBotUrl()
                + "/fish_lookup_latest?player=" + player + "&type=" + fishType;
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            if (conn.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            String fishId = extractJson(body, "fish_id");
            String tier   = extractJson(body, "tier");
            String weight = extractJson(body, "weight");
            if (fishId == null || fishId.isEmpty()) return null;
            return new String[]{ fishId, tier != null ? tier : "mythic", weight != null ? weight : "0" };
        } catch (Exception e) {
            plugin.getLogger().warning("fetchLatestTrophy error: " + e.getMessage());
            return null;
        }
    }

    private String extractJson(String json, String key) {
        String search = "\"" + key + "\":";
        int idx = json.indexOf(search);
        if (idx == -1) return null;
        int start = idx + search.length();
        if (json.charAt(start) == '"') {
            int end = json.indexOf('"', start + 1);
            return end == -1 ? null : json.substring(start + 1, end);
        } else {
            int end = start;
            while (end < json.length() && ",}]".indexOf(json.charAt(end)) == -1) end++;
            return json.substring(start, end).trim();
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        ItemStack held = player.getInventory().getItemInMainHand();
        if (held == null || held.getType() == Material.AIR) {
            player.sendMessage("§cВозьми трофей в руку.");
            return true;
        }

        ItemMeta heldMeta = held.getItemMeta();
        Material heldType = held.getType();

        // ── Рыба → Ведро ─────────────────────────────────────────
        if (FISH_TO_BUCKET.containsKey(heldType)) {
            String fishId = extractFishId(heldMeta);
            if (fishId == null) {
                player.sendMessage("§cЭто не трофей. Держи в руке заклеймленную рыбу.");
                return true;
            }

            // Проверяем место в инвентаре: нужно 1 слот под ведро с рыбой
            int freeSlots = 0;
            for (ItemStack item : player.getInventory().getStorageContents()) {
                if (item == null) freeSlots++;
            }
            if (freeSlots < 1 && held.getAmount() <= 1) {
                player.sendMessage("§cНедостаточно места в инвентаре. Освободи хотя бы 1 ячейку.");
                return true;
            }

            int waterBucketSlot = -1;
            for (int i = 0; i < player.getInventory().getSize(); i++) {
                ItemStack item = player.getInventory().getItem(i);
                if (item != null && item.getType() == Material.WATER_BUCKET) {
                    waterBucketSlot = i;
                    break;
                }
            }
            if (waterBucketSlot == -1) {
                player.sendMessage("§cНужно ведро с водой в инвентаре.");
                return true;
            }

            final String finalFishId         = fishId;
            final int    finalWaterBucketSlot = waterBucketSlot;
            final Material finalHeldType      = heldType;
            final String savedDisplayName     = (heldMeta != null && heldMeta.hasDisplayName()) ? heldMeta.getDisplayName() : null;
            final List<String> savedLore      = (heldMeta != null && heldMeta.hasLore()) ? heldMeta.getLore() : null;

            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                String json = "{\"fish_id\":\"" + finalFishId + "\","
                    + "\"player\":\"" + player.getName() + "\","
                    + "\"action\":\"release\"}";
                boolean ok = callApi(json, player);
                if (!ok) return;

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    Material bucketType = FISH_TO_BUCKET.get(finalHeldType);

                    ItemStack bucket = new ItemStack(bucketType, 1);
                    ItemMeta bucketMeta = bucket.getItemMeta();

                    // Название ведра: цвет тира + имя + "(в воде)" + тёмно-серый ID
                    // Тир определяем по §d (mythic) или §6 (legendary) из трофея
                    boolean isMythicBucket = savedDisplayName != null && savedDisplayName.startsWith("§d");
                    String tierColorBucket = isMythicBucket ? "§d" : "§6";
                    String bucketFishName = switch (finalHeldType) {
                        case COD           -> isMythicBucket ? "Мифическая трофейная треска"           : "Трофейная треска";
                        case SALMON        -> isMythicBucket ? "Мифический трофейный лосось"           : "Трофейный лосось";
                        case PUFFERFISH    -> isMythicBucket ? "Мифический трофейный иглобрюх"         : "Трофейный иглобрюх";
                        case TROPICAL_FISH -> isMythicBucket ? "Мифическая трофейная тропическая рыба" : "Трофейная тропическая рыба";
                        default            -> "Трофейная рыба";
                    };
                    bucketMeta.setDisplayName(tierColorBucket + bucketFishName + " §8[" + finalFishId + "]");

                    if (savedLore != null) bucketMeta.setLore(savedLore);
                    bucket.setItemMeta(bucketMeta);

                    held.setAmount(held.getAmount() - 1);
                    if (held.getAmount() <= 0)
                        player.getInventory().setItemInMainHand(null);

                    ItemStack wb = player.getInventory().getItem(finalWaterBucketSlot);
                    wb.setAmount(wb.getAmount() - 1);
                    if (wb.getAmount() <= 0)
                        player.getInventory().setItem(finalWaterBucketSlot, null);

                    Map<Integer, ItemStack> leftover = player.getInventory().addItem(bucket);
                    if (!leftover.isEmpty())
                        player.getWorld().dropItemNaturally(player.getLocation(), leftover.get(0));

                    player.sendMessage("§7Трофейная рыба помещена в ведро.");
                    player.sendMessage("§7Выпусти её наведясь на блок под водой и нажам §fПКМ§7.");
                    player.sendMessage("§7Для восстановления трофея поймай рыбу в ведро и повторно введи: §f/fconvert§7.");
                });
            });
            return true;
        }

        // ── Ведро → Рыба ─────────────────────────────────────────
        if (BUCKET_TO_FISH.containsKey(heldType)) {
            // Пробуем достать fishId из lore ведра
            String fishIdFromLore = extractFishId(heldMeta);

            // Если lore пустой (игрок поймал ведро заново) — ищем у бота по типу
            String fishTypeName = BUCKET_TO_FISH.get(heldType).name();

            if (fishIdFromLore == null) {
                // Пробуем найти через бота — может игрок поймал рыбу обратно
                player.sendMessage("§7Ищем трофей в базе данных...");
                final Material finalHeldType = heldType;

                plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                    String[] trophy = fetchLatestTrophy(player.getName(), fishTypeName);
                    if (trophy == null) {
                        plugin.getServer().getScheduler().runTask(plugin, () ->
                            player.sendMessage("§cЭто не трофейное ведро — трофей не найден в базе. "
                                + "Для конвертации нужно ведро с трофейной рыбой.")
                        );
                        return;
                    }
                    String fishId = trophy[0];
                    String tier   = trophy[1];
                    double weight = 0; try { weight = Double.parseDouble(trophy[2]); } catch (Exception ignored) {}
                    executeRestore(player, fishId, tier, weight, finalHeldType);
                });
                return true;
            }

            // lore есть — используем fishId из него
            final String finalFishId   = fishIdFromLore;
            final Material finalHeldType = heldType;

            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                String[] info = fetchFishInfo(finalFishId);
                String tier = info[0];
                double weight = 0; try { weight = Double.parseDouble(info[1]); } catch (Exception ignored) {}
                executeRestore(player, finalFishId, tier, weight, finalHeldType);
            });
            return true;
        }

        player.sendMessage("§cВозьми в руку трофейную рыбу или ведро с рыбой.");
        return true;
    }

    private void executeRestore(Player player, String fishId, String tier, double weight, Material heldType) {
        String json = "{\"fish_id\":\"" + fishId + "\","
            + "\"player\":\"" + player.getName() + "\","
            + "\"action\":\"restore\"}";
        boolean ok = callApi(json, player);
        if (!ok) return;

        plugin.getServer().getScheduler().runTask(plugin, () -> {
            // Проверяем место в инвентаре
            int freeSlots = 0;
            for (ItemStack item : player.getInventory().getStorageContents()) {
                if (item == null) freeSlots++;
            }
            // Нужно 2 слота: рыба + ведро с водой (если рука освобождается — 1 слот)
            ItemStack heldItem = player.getInventory().getItemInMainHand();
            int neededSlots = (heldItem != null && heldItem.getAmount() <= 1) ? 1 : 2;
            if (freeSlots < neededSlots) {
                player.sendMessage("§cНедостаточно места в инвентаре. Освободи " + neededSlots + " ячейки.");
                // Откатываем release через restore нет смысла — restore уже вызван,
                // поэтому просто дропаем рыбу рядом
            }

            Material fishType = BUCKET_TO_FISH.get(heldType);
            ItemStack fish = new ItemStack(fishType, 1);
            FishCatchListener.applyTrophyLore(fish, fishType.name(), tier, player.getName(), fishId, weight);

            ItemStack currentHeld = player.getInventory().getItemInMainHand();
            if (currentHeld != null && currentHeld.getType() == heldType) {
                currentHeld.setAmount(currentHeld.getAmount() - 1);
                if (currentHeld.getAmount() <= 0)
                    player.getInventory().setItemInMainHand(null);
            }

            ItemStack waterBucket = new ItemStack(Material.WATER_BUCKET, 1);
            Map<Integer, ItemStack> leftover = player.getInventory().addItem(fish, waterBucket);
            if (!leftover.isEmpty()) {
                for (ItemStack item : leftover.values())
                    player.getWorld().dropItemNaturally(player.getLocation(), item);
                player.sendMessage("§eИнвентарь полон — часть предметов выброшена рядом!");
            }

            player.sendMessage("§aТрофейная рыба §f" + fishId + " §aвосстановлена!");

            // Предмет создан заново — выставляем lore_applied=1.
            final String finalFishId2 = fishId;
            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () ->
                ClaimCommand.notifyLoreApplied(plugin, finalFishId2, player.getName())
            );
        });
    }
}