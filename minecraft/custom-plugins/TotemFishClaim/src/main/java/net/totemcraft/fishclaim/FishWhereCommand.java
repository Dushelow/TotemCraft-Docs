package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class FishWhereCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishWhereCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        if (args.length < 1) {
            player.sendMessage("§eИспользование: §f/fwhere <ID>");
            return true;
        }

        String fishId = args[0].toUpperCase();
        player.sendMessage("§7Ищем рыбу §f" + fishId + "§7...");

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                URL url = new URL(plugin.getFishBotUrl() + "/fwhere/" + fishId);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int code = conn.getResponseCode();
                Scanner scanner;
                if (code == 200) {
                    scanner = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
                } else {
                    scanner = new Scanner(conn.getErrorStream(), StandardCharsets.UTF_8);
                }
                String response = scanner.useDelimiter("\\A").next();
                scanner.close();

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (code == 404) {
                        player.sendMessage("§cРыба §f" + fishId + " §cне найдена.");
                        return;
                    }
                    if (code != 200) {
                        player.sendMessage("§cОшибка: " + response);
                        return;
                    }

                    try {
                        org.bukkit.util.io.BukkitObjectInputStream in = null;
                        // Парсим JSON вручную — не тащим зависимость
                        String status = extractJson(response, "status");
                        String owner = extractJson(response, "current_owner");
                        String weight = extractJson(response, "weight");

                        player.sendMessage("§8§m                                        ");
                        player.sendMessage("  §d§l" + fishId);
                        player.sendMessage("§8§m                                        ");
                        player.sendMessage("  §7Владелец: §f" + owner);
                        player.sendMessage("  §7Вес:      §f" + weight + " кг");

                        switch (status) {
                            case "released" ->
                                player.sendMessage("  §b🐟 Выпущена в мир");
                            case "claimed" ->
                                player.sendMessage("  §a✔ Заклеймлена (в инвентаре)");
                            default ->
                                player.sendMessage("  §e✖ Не заклеймлена");
                        }
                        player.sendMessage("§8§m                                        ");
                    } catch (Exception e) {
                        player.sendMessage("§cОшибка парсинга ответа.");
                    }
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом.")
                );
                plugin.getLogger().warning("Ошибка /fwhere: " + e.getMessage());
            }
        });

        return true;
    }

    private String extractJson(String json, String key) {
        String search = "\"" + key + "\":";
        int idx = json.indexOf(search);
        if (idx == -1) return "?";
        int start = idx + search.length();
        // Строка или число
        if (json.charAt(start) == '"') {
            int end = json.indexOf('"', start + 1);
            return json.substring(start + 1, end);
        } else {
            int end = json.indexOf(',', start);
            if (end == -1) end = json.indexOf('}', start);
            return json.substring(start, end).trim();
        }
    }
}
