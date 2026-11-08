package net.totemcraft.fishclaim;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class FishTransferAcceptCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishTransferAcceptCommand(FishClaimPlugin plugin) {
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
            fishId = FishTransferCommand.getFishIdFromHand(player);
            if (fishId == null) {
                player.sendMessage("§eИспользование: §f/" + label + " <ID>");
                return true;
            }
        } else {
            fishId = args[0].toUpperCase();
        }

        executeAccept(player, fishId);
        return true;
    }

    private void executeAccept(Player player, String fishId) {
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String json = "{\"fish_id\":\"" + fishId + "\",\"player\":\"" + player.getName() + "\"}";

                URL url = new URL(plugin.getFishBotUrl() + "/ftaccept");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                Scanner sc = (code == 200)
                        ? new Scanner(conn.getInputStream(), StandardCharsets.UTF_8)
                        : new Scanner(conn.getErrorStream(), StandardCharsets.UTF_8);
                String response = sc.useDelimiter("\\A").next();
                sc.close();

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (code == 200) {
                        String from = extractJson(response, "from");

                        // Уведомляем получателя
                        player.sendMessage("§a✔ Трофей §f" + fishId + " §aтеперь твой!");
                        if (!from.equals("?"))
                            player.sendMessage("§7Передан от §f" + from + "§7.");

                        // Уведомляем отправителя если онлайн
                        if (!from.equals("?")) {
                            Player sender2 = Bukkit.getPlayer(from);
                            if (sender2 != null) {
                                sender2.sendMessage("§a✔ Игрок §f" + player.getName()
                                        + " §aпринял трофей §f" + fishId + "§a.");
                            }
                        }
                    } else if (response.contains("no pending transfer")) {
                        player.sendMessage("§cНет активного предложения для §f" + fishId + "§c.");
                        player.sendMessage("§7Возможно, оно истекло (1 минута) или уже принято.");
                    } else if (response.contains("not your transfer")) {
                        player.sendMessage("§cЭто предложение предназначено не тебе.");
                    } else {
                        player.sendMessage("§cОшибка: " + response);
                    }
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage("§cНе удалось связаться с ботом.")
                );
                plugin.getLogger().warning("Ошибка /ftaccept: " + e.getMessage());
            }
        });
    }

    private String extractJson(String json, String key) {
        String search = "\"" + key + "\":";
        int idx = json.indexOf(search);
        if (idx == -1) return "?";
        int start = idx + search.length();
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
