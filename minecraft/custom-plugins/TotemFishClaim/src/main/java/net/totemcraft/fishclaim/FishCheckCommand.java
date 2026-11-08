package net.totemcraft.fishclaim;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Scanner;

public class FishCheckCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishCheckCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        String fishId;

        if (args.length < 1) {
            ItemStack held = player.getInventory().getItemInMainHand();
            if (held != null && held.hasItemMeta() && held.getItemMeta().hasLore()) {
                List<String> lore = held.getItemMeta().getLore();
                if (!lore.isEmpty()) {
                    String firstLine = ChatColor.stripColor(lore.get(0)).trim();
                    if (firstLine.matches("[A-Z]{2,3}-[A-Z0-9]{6}")) {
                        fishId = firstLine;
                    } else {
                        player.sendMessage("§eИспользование: §f/" + label + " <ID>");
                        player.sendMessage("§7Или держи трофей в руке и пиши без ID.");
                        return true;
                    }
                } else {
                    player.sendMessage("§eИспользование: §f/" + label + " <ID>");
                    return true;
                }
            } else {
                player.sendMessage("§eИспользование: §f/" + label + " <ID>");
                player.sendMessage("§7Или держи трофей в руке и пиши без ID.");
                return true;
            }
        } else {
            fishId = args[0].toUpperCase();
        }

        final String finalFishId = fishId;

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                URL url = new URL(plugin.getFishBotUrl() + "/fishcheck/" + finalFishId);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int responseCode = conn.getResponseCode();
                Scanner scanner;
                if (responseCode == 200) {
                    scanner = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
                } else {
                    scanner = new Scanner(conn.getErrorStream(), StandardCharsets.UTF_8);
                }
                String response = scanner.useDelimiter("\\A").next();
                scanner.close();

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (responseCode == 404) {
                        player.sendMessage("§cРыба §f" + finalFishId + " §cне найдена.");
                        return;
                    }
                    if (responseCode != 200) {
                        player.sendMessage("§cОшибка: " + response);
                        return;
                    }

                    String fishType   = "—";
                    String tierLabel  = "Мифический";
                    String weight     = "—";
                    String caughtBy   = "—";
                    String caughtAt   = "—";
                    String biome      = null;
                    String weather    = null;
                    String time       = null;
                    String owner      = "—";
                    String score      = "—";
                    String status     = "—";
                    String attributes = null;
                    int transfers     = 0;
                    String attrAppearance = null;
                    String attrAura       = null;
                    String attrOrigin     = null;

                    for (String line : response.split("\n")) {
                        line = line.trim();
                        if (line.startsWith("Тип:")) {
                            String[] parts = line.replace("Тип:", "").trim().split("•");
                            String typeFull = parts[0].trim();
                            if (parts.length > 1)
                                weight = parts[1].replace("Вес:", "").replace("кг", "").trim();
                            if (typeFull.contains("Треска"))           fishType = "- треска";
                            else if (typeFull.contains("Лосось"))      fishType = "- лосось";
                            else if (typeFull.contains("Иглобрюх"))    fishType = "- иглобрюх";
                            else if (typeFull.contains("Тропическая")) fishType = "- тропическая рыба";
                            if (typeFull.contains("Мифическ"))         tierLabel = "Мифический трофей";
                            else                                         tierLabel = "Легендарный трофей";
                        } else if (line.startsWith("Поймал:")) {
                            String[] parts = line.replace("Поймал:", "").trim().split("•");
                            caughtBy = parts[0].trim();
                            if (parts.length > 1) caughtAt = parts[1].trim();
                        } else if (line.startsWith("Биом:")) {
                            biome = line.replace("Биом:", "").trim();
                        } else if (line.startsWith("Погода:")) {
                            weather = line.replace("Погода:", "").trim();
                        } else if (line.startsWith("Время:")) {
                            time = line.replace("Время:", "").trim();
                        } else if (line.startsWith("Атрибуты:")) {
                            attributes = line.replace("Атрибуты:", "").trim();
                        } else if (line.startsWith("Владелец:")) {
                            owner = line.replace("Владелец:", "").trim();
                        } else if (line.startsWith("Очки:")) {
                            score = line.replace("Очки:", "").trim();
                        } else if (line.startsWith("Статус:")) {
                            status = line.replace("Статус:", "").trim();
                        } else if (line.startsWith("Передач:")) {
                            try { transfers = Integer.parseInt(line.replace("Передач:", "").trim()); }
                            catch (Exception ignored) {}
                        } else if (line.startsWith("Внешность:")) {
                            attrAppearance = line.replace("Внешность:", "").trim();
                        } else if (line.startsWith("Аура:")) {
                            attrAura = line.replace("Аура:", "").trim();
                        } else if (line.startsWith("Воды:")) {
                            attrOrigin = line.replace("Воды:", "").trim();
                        }
                    }

                    boolean claimed  = status.contains("Заклеймлена") && !status.contains("Не");
                    boolean isMythic = "Мифический".equals(tierLabel);
                    String tierColor = isMythic ? "§d" : "§6";

                    player.sendMessage("§8§m                                        ");
                    player.sendMessage("  " + tierColor + tierLabel + " " + fishType);
                    player.sendMessage("§8§m                                        ");
                    player.sendMessage("  §7Поймал:   §f" + caughtBy + "  §8·  §7" + caughtAt);
                    player.sendMessage("  §7Вес:      §f" + weight + " кг");

                    // Условия поимки
                    if (biome != null)
                        player.sendMessage("  §7Локация:  §f" + biome);

                    player.sendMessage("  §7Очки:     §d" + score);
                    player.sendMessage("");
                    player.sendMessage("  §7Владелец: §f" + owner);
                    if (transfers > 0)
                        player.sendMessage("  §7Передач:  §f" + transfers);

                    // Атрибуты — внешность, аура, воды
                    boolean hasAttrs = attrAppearance != null || attrAura != null || attrOrigin != null;
                    if (hasAttrs) {
                        player.sendMessage("");
                        if (attrAppearance != null)
                            player.sendMessage("  §7Внешность: §f" + attrAppearance);
                        if (attrAura != null)
                            player.sendMessage("  §7Аура:      §f" + attrAura);
                        if (attrOrigin != null)
                            player.sendMessage("  §7Воды:      §f" + attrOrigin);
                    }

                    player.sendMessage("§8§m                                        ");
                    if (claimed) {
                        player.sendMessage("  §8ID: §8" + finalFishId);
                    } else {
                        player.sendMessage("  §e✖ Не заклеймлена  §8│  §7/claim " + finalFishId);
                    }
                    player.sendMessage("§8§m                                        ");
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка /fishcheck: " + e.getMessage());
            }
        });

        return true;
    }
}