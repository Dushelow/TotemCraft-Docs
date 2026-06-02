package net.totemcraft.fishclaim;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Fish;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Scanner;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class FishCatchListener implements Listener {

    private final FishClaimPlugin plugin;

    private static final long LOOKUP_DELAY_TICKS  = 40L;
    private static final long LOOKUP_RETRY_TICKS  = 40L;
    private static final int  LOOKUP_MAX_ATTEMPTS = 5;

    private static final String[] FISH_TYPES = {
        "COD", "SALMON", "PUFFERFISH", "TROPICAL_FISH"
    };

    // UUID игрока → fish_id, ожидающий спавна Entity после выпуска ведра
    // Значение: "fishId|tier" (tier = mythic или legendary)
    private static final Map<UUID, String> pendingReleaseMap = new ConcurrentHashMap<>();

    // Entity UUID рыбы → fish_id (проставлен в CustomName после спавна)
    // Нужен чтобы при поимке удочкой знать какой ID у этой рыбы
    private static final Map<UUID, String> entityFishIdMap = new ConcurrentHashMap<>();

    public FishCatchListener(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    // ── Шаг 1: Игрок выпускает ведро ────────────────────────────
    // Запоминаем fish_id и ждём EntitySpawnEvent чтобы проставить CustomName

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBucketEmpty(PlayerBucketEmptyEvent event) {
        Player player = event.getPlayer();
        ItemStack bucket = event.getItemStack();
        if (bucket == null) return;

        ItemMeta meta = bucket.getItemMeta();
        String fishId = extractFishIdFromMeta(meta);
        if (fishId == null) return;

        // Определяем тир из display name ведра (§d = mythic, §6 = legendary)
        String bucketDisplayName = (meta != null && meta.hasDisplayName()) ? meta.getDisplayName() : "";
        String pendingTier = bucketDisplayName.startsWith("§d") ? "mythic" : "legendary";

        // Запоминаем: следующий заспавненный Fish entity от этого игрока = этот ID
        pendingReleaseMap.put(player.getUniqueId(), fishId + "|" + pendingTier);
        plugin.getLogger().info("[FishClaim] " + player.getName()
            + " выпускает ведро с " + fishId + " — ждём Entity спавн");

        // Чистим через 5 сек если EntitySpawn не сработал
        plugin.getServer().getScheduler().runTaskLaterAsynchronously(plugin, () ->
            pendingReleaseMap.remove(player.getUniqueId()), 100L
        );
    }

    // ── Шаг 2: Entity рыбы заспавнился — проставляем CustomName ─
    // PlayerBucketEmptyEvent → ванила спавнит Fish entity в том же тике или следующем

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntitySpawn(EntitySpawnEvent event) {
        Entity entity = event.getEntity();
        if (!(entity instanceof Fish fishEntity)) return;

        // Ищем кто только что выпустил ведро рядом (< 5 блоков)
        for (Map.Entry<UUID, String> entry : pendingReleaseMap.entrySet()) {
            Player player = Bukkit.getPlayer(entry.getKey());
            if (player == null) continue;
            if (!fishEntity.getWorld().equals(player.getWorld())) continue;
            if (fishEntity.getLocation().distanceSquared(player.getLocation()) > 25) continue;

            String pendingValue = entry.getValue();
            pendingReleaseMap.remove(entry.getKey());

            // Разбираем "fishId|tier"
            String[] parts = pendingValue.split("\\|", 2);
            String fishId   = parts[0];
            String fishTier = parts.length > 1 ? parts[1] : "mythic";
            boolean isMythicEntity = "mythic".equals(fishTier);

            // Проставляем CustomName — видна над рыбой при наведении
            // Формат: <цвет тира><название> §8[ID]
            String fishTypeName = fishEntity.getType().name(); // COD, SALMON и т.д.
            String entityFishName = switch (fishTypeName) {
                case "COD"           -> isMythicEntity ? "Мифическая трофейная треска"           : "Трофейная треска";
                case "SALMON"        -> isMythicEntity ? "Мифический трофейный лосось"           : "Трофейный лосось";
                case "PUFFERFISH"    -> isMythicEntity ? "Мифический трофейный иглобрюх"         : "Трофейный иглобрюх";
                case "TROPICAL_FISH" -> isMythicEntity ? "Мифическая трофейная тропическая рыба" : "Трофейная тропическая рыба";
                default              -> "Трофейная рыба";
            };
            String tierColorEntity = isMythicEntity ? "§d" : "§6";
            fishEntity.setCustomName(tierColorEntity + entityFishName + " §8[" + fishId + "]");
            fishEntity.setCustomNameVisible(true);

            // Запоминаем Entity UUID → "fish_id|fish_type"
            entityFishIdMap.put(fishEntity.getUniqueId(), fishId + "|" + fishTypeName);

            plugin.getLogger().info("[FishClaim] Entity " + fishEntity.getUniqueId()
                + " (" + fishTypeName + ") помечен как " + fishId);

            // Чистим через 10 минут (рыба всё равно умрёт или будет поймана)
            UUID entityId = fishEntity.getUniqueId();
            plugin.getServer().getScheduler().runTaskLaterAsynchronously(plugin, () ->
                entityFishIdMap.remove(entityId), 12000L
            );
            break;
        }
    }

    // ── Шаг 3: Поимка рыбы удочкой ──────────────────────────────

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        if (event.getState() != PlayerFishEvent.State.CAUGHT_FISH) return;
        if (!(event.getCaught() instanceof Item caughtItem)) return;

        ItemStack stack = caughtItem.getItemStack();
        String typeName = stack.getType().name();

        boolean isFish = false;
        for (String t : FISH_TYPES) {
            if (typeName.equals(t)) { isFish = true; break; }
        }
        if (!isFish) return;

        Player player   = event.getPlayer();
        UUID   playerId = player.getUniqueId();

        plugin.getLogger().info("[FishClaim] PlayerFishEvent hash=" + event.hashCode()
            + " type=" + typeName + " player=" + player.getName());

        // ── Путь 1: Restore — ловим именованную рыбу-Entity ─────
        // Проверяем есть ли рядом Fish entity с нашим ID (только что была поймана).
        // event.getCaught() — это Item entity (дроп), но сам Fish entity уже исчез.
        // Используем entityFishIdMap: ищем по типу рыбы и близости к игроку.
        String restoredFishId = findAndConsumeNearbyFishId(player, typeName);

        if (restoredFishId != null) {
            plugin.getLogger().info("[FishClaim] Restore поимка: " + player.getName()
                + " поймал обратно " + restoredFishId);
            final String fishId = restoredFishId;
            plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                String tier = fetchFishTier(fishId);
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    callRestoreApi(fishId, player.getName(), player);
                    LookupResult result = new LookupResult(fishId, tier, 0);
                    applyLoreToInventory(player, player.getName(), typeName, result);
                    // Предмет восстановлен из entity — выставляем lore_applied=1.
                    // Без этого isLoreAlreadyApplied() не заблокирует повторное применение
                    // если игрок сразу поймает ещё одну рыбу того же вида удочкой.
                    plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () ->
                        notifyLoreApplied(fishId, player.getName())
                    );
                });
            });
            return;
        }

        // ── Путь 2: Новая трофейная рыба ─────────────────────────
        scheduleLookupsAsync(playerId, player.getName(), typeName, LOOKUP_MAX_ATTEMPTS, LOOKUP_DELAY_TICKS);
    }

    /**
     * Ищем в entityFishIdMap рыбу подходящего типа рядом с игроком.
     * Когда игрок ловит удочкой Fish entity — тот исчезает из мира,
     * поэтому ищем по последним известным позициям через world.getEntities().
     * На самом деле у нас есть UUID в map, и entity ещё может быть живой
     * в момент MONITOR приоритета — проверяем живых сначала, потом по типу.
     */
    private String findAndConsumeNearbyFishId(Player player, String fishType) {
        // Сначала ищем живых Fish entities рядом с игроком в entityFishIdMap
        for (Map.Entry<UUID, String> entry : entityFishIdMap.entrySet()) {
            Entity entity = Bukkit.getEntity(entry.getKey());
            if (entity == null) {
                // Entity мертва/не существует — могла быть поймана только что.
                // Но мы не можем точно знать что именно эту рыбу поймал этот игрок.
                // Продолжаем поиск живых.
                continue;
            }
            if (!entity.getWorld().equals(player.getWorld())) continue;
            if (entity.getLocation().distanceSquared(player.getLocation()) > 100) continue; // 10 блоков
            if (!(entity instanceof Fish fishEntity)) continue;
            if (!fishEntity.getType().name().equals(fishType)) continue;

            // Нашли — забираем ID
            String[] valueParts = entityFishIdMap.remove(entry.getKey()).split("\\|", 2);
            String fishId = valueParts[0];
            plugin.getLogger().info("[FishClaim] Найдена именованная рыба " + fishId
                + " (entity " + entry.getKey() + ")");
            return fishId;
        }

        // Fallback: entity уже мертва в момент обработки события (умерла в том же тике).
        // Ищем в map мёртвую запись подходящего типа — тип теперь хранится в значении.
        // Это безопасно: без проверки типа раньше можно было получить чужой трофей.
        for (Map.Entry<UUID, String> entry : new java.util.HashMap<>(entityFishIdMap).entrySet()) {
            Entity entity = Bukkit.getEntity(entry.getKey());
            if (entity != null) continue; // живая — уже проверили выше
            String[] valueParts = entry.getValue().split("\\|", 2);
            String candidateFishId   = valueParts[0];
            String candidateFishType = valueParts.length > 1 ? valueParts[1] : "";
            if (!candidateFishType.equals(fishType)) continue; // не тот тип — пропускаем
            entityFishIdMap.remove(entry.getKey());
            plugin.getLogger().info("[FishClaim] Restore по мёртвой entity (тип совпал): "
                + candidateFishId + " → " + player.getName());
            return candidateFishId;
        }

        return null;
    }

    private void scheduleLookupsAsync(UUID playerId, String playerName,
                                       String fishType, int attemptsLeft, long delayTicks) {
        if (attemptsLeft <= 0) return;

        plugin.getServer().getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            LookupResult result = lookupFish(playerName, fishType);

            if (result == null) {
                scheduleLookupsAsync(playerId, playerName, fishType, attemptsLeft - 1, LOOKUP_RETRY_TICKS);
                return;
            }

            plugin.getLogger().info("[FishClaim] Найден трофей: " + result.fishId
                + " tier=" + result.tier + " player=" + playerName);

            // Главная защита от дублирования: проверяем флаг lore_applied в БД.
            // Если флаг = 1 — предмет уже существует в игре (в инвентаре, сундуке,
            // или выброшен в мир). Повторно применять lore к другому предмету нельзя.
            // Флаг сбрасывается только при release (→ ведро) и при transfer.
            if (isLoreAlreadyApplied(result.fishId)) {
                plugin.getLogger().info("[FishClaim] lore_applied=1 для " + result.fishId
                    + " — пропускаем повторное применение lore для " + playerName);
                return;
            }

            boolean hasDiscord = checkDiscordLink(playerName);

            plugin.getServer().getScheduler().runTask(plugin, () -> {
                Player p = Bukkit.getPlayer(playerId);
                if (p == null) return;

                if (isFishIdInInventory(p, result.fishId)) {
                    plugin.getLogger().info("[FishClaim] " + result.fishId
                        + " уже в инвентаре " + playerName + " — пропуск дубликата");
                    return;
                }

                // Lore применяется ВСЕГДА — иначе чистая рыба остаётся в инвентаре
                // и при следующем улове applyLoreToInventory может применить к ней
                // lore нового трофея, создав дубликат с тем же fish_id.
                applyLoreToInventory(p, playerName, fishType, result);

                // Сообщаем боту что lore применён — выставляет lore_applied=1 в БД.
                // Делаем асинхронно чтобы не блокировать main thread.
                plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () ->
                    notifyLoreApplied(result.fishId, playerName)
                );

                if (!hasDiscord) {
                    boolean isMythic = "mythic".equals(result.tier);
                    String tierColor = isMythic ? "§d" : "§6";
                    String tierName  = isMythic ? "Мифический трофей" : "Легендарный трофей";
                    p.sendMessage("§8§m                                        ");
                    p.sendMessage("  " + tierColor + tierName + " §7 зарегистрирован!");
                    p.sendMessage("§8§m                                        ");
                    p.sendMessage("  §c⚠ Без привязки Discord:");
                    p.sendMessage("  §c• Очки не начисляются");
                    p.sendMessage("  §c• Передача трофеев недоступна");
                    p.sendMessage("  §c• Трофей не сохраняется в коллекции");
                    p.sendMessage("  ");
                    p.sendMessage("  §eПривяжи Discord: §f/discord link");
                    p.sendMessage("  §eЗатем: §f/claim " + result.fishId);
                    p.sendMessage("§8§m                                        ");
                    plugin.getLogger().info("[FishClaim] " + playerName
                        + " поймал без Discord — lore применён, клейм пропущен");
                }
            });

        }, delayTicks);
    }

    private boolean isFishIdInInventory(Player p, String fishId) {
        for (ItemStack item : p.getInventory().getContents()) {
            if (item == null) continue;
            String id = extractFishIdFromItem(item);
            if (fishId.equals(id)) return true;
        }
        return false;
    }

    private LookupResult lookupFish(String player, String fishType) {
        try {
            String urlStr = plugin.getFishBotUrl()
                + "/fish_lookup_latest?player=" + player + "&type=" + fishType + "&recent=1";
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            String fishId = extractJsonStr(body, "fish_id");
            String tier   = extractJsonStr(body, "tier");
            String wStr   = extractJsonStr(body, "weight");
            if (fishId == null || fishId.isEmpty()) return null;
            double weight = 0;
            try { weight = Double.parseDouble(wStr != null ? wStr : "0"); } catch (Exception ignored) {}
            return new LookupResult(fishId, tier != null ? tier : "mythic", weight);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Возвращает статус трофея через /fwhere: "unclaimed", "claimed", "released", или null при ошибке.
     * Используется перед повторным применением lore — чтобы не дублировать трофей
     * если рыба уже была заклеймлена или выпущена (например, игрок выбросил её из инвентаря
     * до привязки Discord, а потом поймал рыбу того же вида снова).
     */
    /**
     * Сообщает боту что lore успешно применён к предмету в инвентаре игрока.
     * После этого вызова флаг lore_applied=1 в БД — повторное применение lore
     * к другому предмету будет заблокировано даже если рыба была выброшена из инвентаря.
     */
    private void notifyLoreApplied(String fishId, String playerName) {
        try {
            String json = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + playerName + "\"}";
            URL url = new URL(plugin.getFishBotUrl() + "/set_lore_applied");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setDoOutput(true);
            conn.getOutputStream().write(json.getBytes(StandardCharsets.UTF_8));
            int code = conn.getResponseCode();
            if (code != 200) {
                plugin.getLogger().warning("[FishClaim] set_lore_applied вернул " + code + " для " + fishId);
            }
        } catch (Exception e) {
            plugin.getLogger().warning("[FishClaim] Ошибка set_lore_applied для " + fishId + ": " + e.getMessage());
        }
    }

    /**
     * Проверяет флаг lore_applied через /fwhere.
     * Возвращает true если lore уже применён — предмет существует в игре,
     * повторно накладывать lore нельзя.
     */
    private boolean isLoreAlreadyApplied(String fishId) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return false;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            // lore_applied=1 возвращается в /fwhere ответе
            return body.contains("\"lore_applied\":1");
        } catch (Exception e) {
            return false;
        }
    }

    private String fetchFishStatus(String fishId) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            String search = "\"status\":\"";
            int idx = body.indexOf(search);
            if (idx == -1) return null;
            int start = idx + search.length();
            int end = body.indexOf('"', start);
            return end == -1 ? null : body.substring(start, end);
        } catch (Exception e) {
            return null;
        }
    }

    private String fetchFishTier(String fishId) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            if (conn.getResponseCode() != 200) return "mythic";
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();
            return body.contains("\"tier\":\"legendary\"") ? "legendary" : "mythic";
        } catch (Exception e) {
            return "mythic";
        }
    }

    private void callRestoreApi(String fishId, String playerName, Player player) {
        try {
            String json = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + playerName + "\",\"action\":\"restore\"}";
            URL url = new URL(plugin.getFishBotUrl() + "/fconvert");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setDoOutput(true);
            conn.getOutputStream().write(json.getBytes(StandardCharsets.UTF_8));
            conn.getResponseCode();
        } catch (Exception ignored) {}
    }

    private boolean checkDiscordLink(String playerName) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/check_discord?player=" + playerName);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private void applyLoreToInventory(Player p, String playerName, String fishType, LookupResult result) {
        org.bukkit.Material mat;
        try { mat = org.bukkit.Material.valueOf(fishType); }
        catch (Exception e) { return; }

        for (int i = 0; i < p.getInventory().getSize(); i++) {
            ItemStack item = p.getInventory().getItem(i);
            if (item == null || item.getType() != mat) continue;
            ItemMeta meta = item.getItemMeta();
            if (meta == null) continue;

            // Пропускаем все предметы у которых уже есть lore-ID — защита от дубликатов
            if (meta.hasLore()) {
                List<String> lore = meta.getLore();
                if (lore != null && !lore.isEmpty()) {
                    String first = ChatColor.stripColor(lore.get(0)).trim();
                    if (first.matches("[A-Z]{2,3}-[A-Z0-9]{6}")) continue;
                }
            }

            if (item.getAmount() > 1) {
                int free = 0;
                for (ItemStack s : p.getInventory().getStorageContents())
                    if (s == null) free++;
                if (free < 1) {
                    p.sendMessage("§cНет места в инвентаре. Используй §f/claim " + result.fishId);
                    return;
                }
            }

            ItemStack trophy = item.clone();
            trophy.setAmount(1);
            applyTrophyLore(trophy, fishType, result.tier, playerName, result.fishId, result.weight);

            if (item.getAmount() > 1) {
                item.setAmount(item.getAmount() - 1);
                p.getInventory().setItem(i, item);
                var leftover = p.getInventory().addItem(trophy);
                if (!leftover.isEmpty()) {
                    p.getWorld().dropItemNaturally(p.getLocation(), leftover.get(0));
                    p.sendMessage("§eИнвентарь полон — трофей выброшен рядом.");
                }
            } else {
                p.getInventory().setItem(i, trophy);
            }

            boolean isMythic = "mythic".equals(result.tier);
            String tierColor = isMythic ? "§d" : "§6";
            String tierName  = isMythic ? "Мифический трофей" : "Легендарный трофей";
            p.sendMessage("§8§m                                        ");
            p.sendMessage("  " + tierColor + tierName + "§7 пойман!");
            p.sendMessage("  §7Вес: §f" + result.weight + " кг  §8·  §f/fc §7открыть карточку");
            p.sendMessage("§8§m                                        ");
            plugin.getLogger().info("[FishClaim] Lore применён: " + result.fishId + " → " + playerName);
            return;
        }

        p.sendMessage("§7Трофей зарегистрирован [" + result.fishId + "] но рыба не найдена в инвентаре.");
        p.sendMessage("§7Используй §f/claim " + result.fishId + " §7чтобы получить трофей.");
    }

    // ── public helpers ────────────────────────────────────────────

    public static String extractFishIdFromItem(ItemStack item) {
        if (item == null) return null;
        return extractFishIdFromMeta(item.getItemMeta());
    }

    public static String extractFishIdFromMeta(ItemMeta meta) {
        if (meta == null) return null;
        // Сначала из lore (трофейная рыба-айтем)
        if (meta.hasLore()) {
            List<String> lore = meta.getLore();
            if (lore != null && !lore.isEmpty()) {
                String first = ChatColor.stripColor(lore.get(0)).trim();
                if (first.matches("[A-Z]{2,3}-[A-Z0-9]{6}")) return first;
            }
        }
        // Затем из display name (ведро хранит ID как §8[COD-XXXXXX]§r ...)
        if (meta.hasDisplayName()) {
            String name = ChatColor.stripColor(meta.getDisplayName()).trim();
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\\[([A-Z]{2,3}-[A-Z0-9]{6})]").matcher(name);
            if (m.find()) return m.group(1);
        }
        return null;
    }

    private String extractJsonStr(String json, String key) {
        String search = "\"" + key + "\":";
        int idx = json.indexOf(search);
        if (idx == -1) return null;
        int start = idx + search.length();
        char c = json.charAt(start);
        if (c == '"') {
            int end = json.indexOf('"', start + 1);
            return end == -1 ? null : json.substring(start + 1, end);
        } else {
            int end = start;
            while (end < json.length() && ",}]".indexOf(json.charAt(end)) == -1) end++;
            return json.substring(start, end).trim();
        }
    }

    static class LookupResult {
        final String fishId, tier;
        final double weight;
        LookupResult(String f, String t, double w) { fishId=f; tier=t; weight=w; }
    }

    public static void applyTrophyLore(ItemStack stack, String fishType, String tier,
                                        String playerName, String fishId, double weight) {
        ItemMeta meta = stack.getItemMeta();
        if (meta == null) return;
        boolean isMythic = "mythic".equals(tier);

        String fishName = switch (fishType) {
            case "COD"           -> isMythic ? "Мифическая трофейная треска"           : "Трофейная треска";
            case "SALMON"        -> isMythic ? "Мифический трофейный лосось"           : "Трофейный лосось";
            case "PUFFERFISH"    -> isMythic ? "Мифический трофейный иглобрюх"         : "Трофейный иглобрюх";
            case "TROPICAL_FISH" -> isMythic ? "Мифическая трофейная тропическая рыба" : "Трофейная тропическая рыба";
            default -> fishType;
        };

        meta.setDisplayName(isMythic ? "§d" + fishName : "§6" + fishName);

        List<String> lore = new ArrayList<>();
        lore.add("§8" + (fishId != null ? fishId : "[регистрируется...]"));
        lore.add("§7Поймал: §f" + playerName);
        if (weight > 0) lore.add("§7Вес: §f" + weight + " кг");
        lore.add("");
        lore.add("§8Подробнее: §7/fc §8держа в руке");
        meta.setLore(lore);

        if (isMythic) {
            meta.addEnchant(Enchantment.LUCK_OF_THE_SEA, 1, true);
            meta.addItemFlags(ItemFlag.HIDE_ENCHANTS);
        } else {
            meta.removeEnchant(Enchantment.LUCK_OF_THE_SEA);
        }
        stack.setItemMeta(meta);
    }

    public static void applyTrophyLore(ItemStack stack, String fishType, String tier,
                                        String playerName, String fishId) {
        applyTrophyLore(stack, fishType, tier, playerName, fishId, 0);
    }
}