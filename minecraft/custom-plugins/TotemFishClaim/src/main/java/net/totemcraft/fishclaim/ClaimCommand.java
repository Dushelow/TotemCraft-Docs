package net.totemcraft.fishclaim;

import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Scanner;

public class ClaimCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    private static final Map<String, Material> FISH_MATERIALS = Map.of(
        "COD",           Material.COD,
        "SALMON",        Material.SALMON,
        "PUFFERFISH",    Material.PUFFERFISH,
        "TROPICAL_FISH", Material.TROPICAL_FISH
    );

    private static final Map<String, String> FISH_DISPLAY_NAMES_LEGENDARY = Map.of(
        "COD",           "§6Трофейная треска",
        "SALMON",        "§6Трофейный лосось",
        "PUFFERFISH",    "§6Трофейный иглобрюх",
        "TROPICAL_FISH", "§6Трофейная тропическая рыба"
    );

    private static final Map<String, String> FISH_DISPLAY_NAMES_MYTHIC = Map.of(
        "COD",           "§5Мифическая трофейная треска",
        "SALMON",        "§5Мифический трофейный лосось",
        "PUFFERFISH",    "§5Мифический трофейный иглобрюх",
        "TROPICAL_FISH", "§5Мифическая трофейная тропическая рыба"
    );

    public ClaimCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        if (args.length < 1) {
            player.sendMessage("§eИспользование: §f/claim <ID>");
            return true;
        }

        String fishId = args[0].toUpperCase();
        String playerName = player.getName();

        player.sendMessage("§7Проверяем рыбу §f" + fishId + "§7...");

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                URL checkUrl = new URL(plugin.getFishBotUrl() + "/fishcheck/" + fishId);
                HttpURLConnection checkConn = (HttpURLConnection) checkUrl.openConnection();
                checkConn.setRequestMethod("GET");
                checkConn.setConnectTimeout(5000);
                checkConn.setReadTimeout(5000);

                int checkCode = checkConn.getResponseCode();
                if (checkCode == 404) {
                    plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage("§cРыба §f" + fishId + " §cне найдена.")
                    );
                    return;
                }

                Scanner checkScanner = new Scanner(checkConn.getInputStream(), StandardCharsets.UTF_8);
                String checkResponse = checkScanner.useDelimiter("\\A").next();
                checkScanner.close();

                String fishType = null;
                String fishTier = "mythic";
                boolean alreadyClaimed = false;
                String fishWeight = null;
                String caughtBy = null;
                String caughtAt = null;
                String biome = null;
                int rarityScore = 0;

                for (String line : checkResponse.split("\n")) {
                    if (line.startsWith("Тип:")) {
                        String typePart = line.replace("Тип:", "").trim();
                        String[] parts = typePart.split("•");
                        String typeName = parts[0].trim();
                        if (parts.length > 1)
                            fishWeight = parts[1].replace("Вес:", "").replace("кг", "").trim();
                        if (typeName.contains("Треска")) fishType = "COD";
                        else if (typeName.contains("Лосось")) fishType = "SALMON";
                        else if (typeName.contains("Иглобрюх")) fishType = "PUFFERFISH";
                        else if (typeName.contains("Тропическая")) fishType = "TROPICAL_FISH";
                        if (typeName.contains("Мифическ")) fishTier = "mythic";
                        else fishTier = "legendary";
                    }
                    if (line.startsWith("Поймал:")) {
                        String[] parts = line.replace("Поймал:", "").trim().split("•");
                        caughtBy = parts[0].trim();
                        if (parts.length > 1) caughtAt = parts[1].trim();
                    }
                    if (line.startsWith("Биом:"))
                        biome = line.replace("Биом:", "").trim();
                    if (line.startsWith("Очки:")) {
                        try { rarityScore = Integer.parseInt(line.replace("Очки:", "").trim()); }
                        catch (Exception ignored) {}
                    }
                    if (line.startsWith("Статус:") && line.contains("Заклеймлена") && !line.contains("Не"))
                        alreadyClaimed = true;
                }

                // Заклеймлена, но трофея в игре нет: FishBot клеймит сам при поимке
                // (если Discord привязан), а рыбу могла перехватить воронка до инвентаря.
                // Тогда выдаём трофей владельцу без повторного клейма в боте.
                // Выпущенную (status=released) не выдаём: она живёт в мире или в ведре.
                FishWhere where = fetchWhere(plugin, fishId);
                boolean reissue = alreadyClaimed && where != null && "claimed".equals(where.status())
                    && !where.loreApplied() && where.ownedBy(playerName);
                // Предмет с этим ID уже есть в игре (например, у прошлого владельца после
                // передачи). Клеймим без создания второго предмета — иначе копия трофея.
                boolean itemElsewhere = !alreadyClaimed && where != null && where.loreApplied();
                if (alreadyClaimed && !reissue) {
                    plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage("§cЭта рыба уже заклеймлена.")
                    );
                    return;
                }

                if (fishType == null) {
                    plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage("§cНе удалось определить тип рыбы.")
                    );
                    return;
                }

                final String finalFishType = fishType;
                final String finalFishTier = fishTier;
                final String finalFishWeight = fishWeight;
                final String finalCaughtBy = caughtBy;
                final String finalCaughtAt = caughtAt;
                final String finalBiome = biome;
                final int finalRarityScore = rarityScore;

                // Проверяем место в инвентаре ДО клейма
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    Material material = FISH_MATERIALS.get(finalFishType);
                    if (itemElsewhere && !hasTrophyInInventory(player, fishId)) {
                        doClaimWithoutItem(player, fishId, playerName);
                        return;
                    }
                    if (material == null) {
                        doClaimOnly(player, fishId, playerName, finalFishType, finalFishTier,
                            finalFishWeight, finalCaughtBy, finalCaughtAt, finalBiome, finalRarityScore);
                        return;
                    }

                    // Проверяем есть ли рыба в инвентаре
                    boolean hasFish = false;
                    boolean alreadyHasTrophy = false;
                    for (ItemStack item : player.getInventory().getContents()) {
                        if (item != null && item.getType() == material) {
                            ItemMeta m = item.getItemMeta();
                            // Обычная (непереименованная) рыба — можно конвертировать в трофей
                            if (m == null || !m.hasDisplayName()) {
                                hasFish = true;
                                break;
                            }
                            // Этот конкретный трофей уже лежит в инвентаре
                            // (мог быть применён авто-механизмом FishCatchListener)
                            if (fishId.equals(FishCatchListener.extractFishIdFromItem(item))) {
                                hasFish = true;
                                alreadyHasTrophy = true;
                                break;
                            }
                        }
                    }

                    if (!hasFish) {
                        String fishName = material.name().toLowerCase().replace("_", " ");
                        player.sendMessage("§cДля клейма нужна рыба в инвентаре.");
                        player.sendMessage("§7Принеси §f" + fishName + " §7(обычную, без переименования) и повтори §f/claim " + fishId + "§7.");
                        return;
                    }

                    // Проверяем место только если нужно создавать новый трофей
                    if (!alreadyHasTrophy) {
                        int freeSlots = 0;
                        for (ItemStack item : player.getInventory().getStorageContents()) {
                            if (item == null) freeSlots++;
                        }
                        if (freeSlots < 1) {
                            player.sendMessage("§cНедостаточно места в инвентаре. Освободи хотя бы 1 ячейку.");
                            return;
                        }
                    }

                    if (reissue) {
                        plugin.getLogger().info("[FishClaim] Повторная выдача " + fishId + " → " + playerName
                            + " (заклеймлена, lore_applied=0)");
                        if (giveTrophy(player, fishId, finalFishType, finalFishTier, finalFishWeight,
                                finalCaughtBy, finalCaughtAt, finalBiome, finalRarityScore)) {
                            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () ->
                                notifyLoreApplied(plugin, fishId, player.getName())
                            );
                        }
                        return;
                    }

                    doClaimOnly(player, fishId, playerName, finalFishType, finalFishTier,
                        finalFishWeight, finalCaughtBy, finalCaughtAt, finalBiome, finalRarityScore);
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка /claim: " + e.getMessage());
            }
        });

        return true;
    }

    private static boolean hasTrophyInInventory(Player player, String fishId) {
        for (ItemStack item : player.getInventory().getContents())
            if (item != null && fishId.equals(FishCatchListener.extractFishIdFromItem(item))) return true;
        return false;
    }

    /** Клейм в боте без выдачи предмета: предмет уже существует у кого-то в игре. */
    private void doClaimWithoutItem(Player player, String fishId, String playerName) {
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String jsonBody = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + playerName + "\"}";
                URL claimUrl = new URL(plugin.getFishBotUrl() + "/claim");
                HttpURLConnection claimConn = (HttpURLConnection) claimUrl.openConnection();
                claimConn.setRequestMethod("POST");
                claimConn.setRequestProperty("Content-Type", "application/json");
                claimConn.setConnectTimeout(5000);
                claimConn.setReadTimeout(5000);
                claimConn.setDoOutput(true);
                try (OutputStream os = claimConn.getOutputStream()) {
                    os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                }
                int code = claimConn.getResponseCode();
                Scanner sc = new Scanner(code == 200 ? claimConn.getInputStream() : claimConn.getErrorStream(),
                    StandardCharsets.UTF_8);
                String resp = sc.useDelimiter("\\A").next();
                sc.close();
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (code == 200) {
                        player.sendMessage("§a✔ Трофей §f" + fishId + " §aзаклеймлен на тебя.");
                        player.sendMessage("§7Сам предмет у прошлого владельца: попроси передать его тебе.");
                    } else if (code == 403 && resp.contains("no_discord_link")) {
                        player.sendMessage("§cНет привязки Discord. Напиши §f/discord link §cв чате.");
                    } else if (code == 403) {
                        player.sendMessage("§cЭта рыба не твоя.");
                    } else {
                        player.sendMessage("§cОшибка: " + resp);
                    }
                });
            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка claim без предмета: " + e.getMessage());
            }
        });
    }

    private void doClaimOnly(Player player, String fishId, String playerName,
                              String fishType, String fishTier,
                              String fishWeight, String caughtBy, String caughtAt,
                              String biome, int rarityScore) {
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String jsonBody = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + playerName + "\"}";
                URL claimUrl = new URL(plugin.getFishBotUrl() + "/claim");
                HttpURLConnection claimConn = (HttpURLConnection) claimUrl.openConnection();
                claimConn.setRequestMethod("POST");
                claimConn.setRequestProperty("Content-Type", "application/json");
                claimConn.setConnectTimeout(5000);
                claimConn.setReadTimeout(5000);
                claimConn.setDoOutput(true);

                try (OutputStream os = claimConn.getOutputStream()) {
                    os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                }

                int claimCode = claimConn.getResponseCode();
                Scanner claimScanner;
                if (claimCode == 200) {
                    claimScanner = new Scanner(claimConn.getInputStream(), StandardCharsets.UTF_8);
                } else {
                    claimScanner = new Scanner(claimConn.getErrorStream(), StandardCharsets.UTF_8);
                }
                String claimResponse = claimScanner.useDelimiter("\\A").next();
                claimScanner.close();

                if (claimCode != 200) {
                    String finalResp = claimResponse;
                    plugin.getServer().getScheduler().runTask(plugin, () -> {
                        if (claimCode == 403 && finalResp.contains("no_discord_link"))
                            player.sendMessage("§cНет привязки Discord. Напиши §f/discord link §cв чате.");
                        else if (claimCode == 403)
                            player.sendMessage("§cЭта рыба не твоя.");
                        else
                            player.sendMessage("§cОшибка: " + finalResp);
                    });
                    return;
                }

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    // Выставляем lore_applied=1 — предмет создан, дублирование заблокировано.
                    // Только если создан: иначе обещанный «/claim позже» упрётся в lore_applied=1.
                    if (giveTrophy(player, fishId, fishType, fishTier, fishWeight,
                            caughtBy, caughtAt, biome, rarityScore)) {
                        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () ->
                            notifyLoreApplied(plugin, fishId, player.getName())
                        );
                    }
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка claim запроса: " + e.getMessage());
            }
        });
    }

    /** @return true, если трофей с этим ID теперь есть у игрока (создан, выброшен рядом или уже был). */
    static boolean giveTrophy(Player player, String fishId, String fishType, String fishTier,
                            String fishWeight, String caughtBy, String caughtAt,
                            String biome, int rarityScore) {
        Material material = FISH_MATERIALS.get(fishType);
        if (material == null) {
            player.sendMessage("§a✔ Рыба заклеймлена в Discord!");
            return false;
        }

        // ── Защита от дубликатов ─────────────────────────────────────────────
        // FishCatchListener мог уже применить lore к рыбе в инвентаре
        // (авто-механизм после поимки). Если трофей с этим ID уже есть —
        // не создаём вторую копию, просто подтверждаем клейм.
        for (ItemStack item : player.getInventory().getContents()) {
            if (item != null && fishId.equals(FishCatchListener.extractFishIdFromItem(item))) {
                boolean isMythicDup = "mythic".equals(fishTier);
                String tierLabelDup = isMythicDup ? "§d§lМифический трофей" : "§6§lЛегендарный трофей";
                player.sendMessage("§a✔ " + tierLabelDup + " §aзаклеймлен!");
                player.sendMessage("§7ID: §f" + fishId + "  §8│  §7/fc §8для карточки");
                return true;
            }
        }
        ItemStack fishItem = null;
        int fishSlot = -1;
        for (int i = 0; i < player.getInventory().getSize(); i++) {
            ItemStack item = player.getInventory().getItem(i);
            if (item != null && item.getType() == material) {
                ItemMeta meta = item.getItemMeta();
                if (meta == null || !meta.hasDisplayName()) {
                    fishItem = item;
                    fishSlot = i;
                    break;
                }
            }
        }

        if (fishItem == null) {
            player.sendMessage("§a✔ Рыба заклеймлена в Discord!");
            player.sendMessage("§7Трофей не создан: рыба не найдена в инвентаре.");
            return false;
        }

        // Проверяем место под трофей
        int freeSlots = 0;
        for (ItemStack item : player.getInventory().getStorageContents()) {
            if (item == null) freeSlots++;
        }
        if (freeSlots < 1 && fishItem.getAmount() <= 1) {
            player.sendMessage("§cНедостаточно места в инвентаре для трофея. Освободи 1 ячейку.");
            player.sendMessage("§7Рыба заклеймлена в Discord, трофей можно получить позже через /claim " + fishId);
            return false;
        }

        double weight = 0;
        try { weight = Double.parseDouble(fishWeight != null ? fishWeight : "0"); } catch (Exception ignored) {}

        ItemStack trophy = fishItem.clone();
        trophy.setAmount(1);
        fishItem.setAmount(fishItem.getAmount() - 1);
        if (fishItem.getAmount() <= 0)
            player.getInventory().setItem(fishSlot, null);
        else
            player.getInventory().setItem(fishSlot, fishItem);

        // Используем единый applyTrophyLore из FishCatchListener
        FishCatchListener.applyTrophyLore(trophy, fishType, fishTier, caughtBy != null ? caughtBy : player.getName(), fishId, weight);

        Map<Integer, ItemStack> leftover = player.getInventory().addItem(trophy);
        if (!leftover.isEmpty()) {
            player.getWorld().dropItemNaturally(player.getLocation(), leftover.get(0));
            player.sendMessage("§eИнвентарь полон — трофей выброшен рядом с тобой!");
        }

        boolean isMythic = "mythic".equals(fishTier);
        String tierLabel = isMythic ? "§d§lМифический трофей" : "§6§lЛегендарный трофей";
        player.sendMessage("§a✔ " + tierLabel + " §aзаклеймлен!");
        player.sendMessage("§7ID: §f" + fishId + "  §8│  §7/fc §8для карточки");
        return true;
    }

    // Повторяем до 3 раз: если бот не узнал о выдаче, lore_applied останется 0,
    // и /claim сочтёт трофей невыданным — это единственный путь к копии предмета.
    static void notifyLoreApplied(FishClaimPlugin plugin, String fishId, String playerName) {
        String json = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + playerName + "\"}";
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                java.net.URL url = new java.net.URL(plugin.getFishBotUrl() + "/set_lore_applied");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(3000);
                conn.setDoOutput(true);
                conn.getOutputStream().write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                int code = conn.getResponseCode();
                if (code == 200) return;
                plugin.getLogger().warning("[FishClaim] set_lore_applied вернул " + code + " для " + fishId
                    + " (попытка " + attempt + "/3)");
            } catch (Exception e) {
                plugin.getLogger().warning("[FishClaim] Ошибка set_lore_applied для " + fishId
                    + " (попытка " + attempt + "/3): " + e.getMessage());
            }
            try { Thread.sleep(2000L); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); return; }
        }
        plugin.getLogger().severe("[FishClaim] Бот так и не получил lore_applied для " + fishId + " (" + playerName
            + "). Трофей у игрока ЕСТЬ: /claim может выдать копию. Выставить lore_applied=1 вручную.");
    }

    /** Ответ /fwhere. null из fetchWhere — бот не ответил или рыбы нет. */
    record FishWhere(String status, String owner, boolean loreApplied) {
        boolean ownedBy(String player) { return owner != null && owner.equalsIgnoreCase(player); }
    }

    /** Вызывать не из main thread — делает HTTP-запрос. */
    static FishWhere fetchWhere(FishClaimPlugin plugin, String fishId) {
        try {
            java.net.URL url = new java.net.URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            String compact = body.replaceAll("\\s", "");
            return new FishWhere(jsonStr(compact, "status"), jsonStr(compact, "current_owner"),
                compact.contains("\"lore_applied\":1"));
        } catch (Exception e) {
            plugin.getLogger().warning("[FishClaim] Ошибка /fwhere для " + fishId + ": " + e.getMessage());
            return null;
        }
    }

    private static String jsonStr(String json, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("\"" + key + "\":\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    static List<String> buildLore(String fishId, String caughtBy, String fishWeight,
                                   String caughtAt, String biome, int rarityScore) {
        List<String> lore = new ArrayList<>();
        lore.add("§8" + fishId);
        if (caughtBy != null) lore.add("§7Поймал: §f" + caughtBy);
        if (fishWeight != null) lore.add("§7Вес: §f" + fishWeight + " кг");
        if (caughtAt != null) lore.add("§7Дата: §f" + caughtAt);
        if (biome != null) lore.add("§7Биом: §f" + biome);
        lore.add("§7Очки: §d" + rarityScore);
        lore.add("");
        lore.add("§7Подробнее: §f/fc §7держа в руке");
        lore.add("");
        lore.add("§8NFT • totemcraft.net");
        return lore;
    }
}
