package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class FishTopCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishTopCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                URL url = new URL(plugin.getFishBotUrl() + "/fishtop");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int responseCode = conn.getResponseCode();
                Scanner scanner = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
                String response = scanner.useDelimiter("\\A").next();
                scanner.close();

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (responseCode == 200) {
                        player.sendMessage("§8§m                                        ");
                        player.sendMessage("  §6§l🏆 Топ рыбаков ТотемКрафта");
                        player.sendMessage("§8§m                                        ");
                        String[] lines = response.split("\n");
                        for (String line : lines) {
                            if (line.trim().isEmpty()) {
                                player.sendMessage("  ");
                            } else {
                                player.sendMessage("  " + line.trim());
                            }
                        }
                        player.sendMessage("§8§m                                        ");
                    } else {
                        player.sendMessage("§cНе удалось загрузить топ.");
                    }
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом.")
                );
                plugin.getLogger().warning("Ошибка /fishtop: " + e.getMessage());
            }
        });

        return true;
    }
}