package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class FishStatsCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishStatsCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        // Можно смотреть статистику другого игрока: /fishstats [ник]
        String target = args.length >= 1 ? args[0] : player.getName();

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String encoded = URLEncoder.encode(target, StandardCharsets.UTF_8);
                URL url = new URL(plugin.getFishBotUrl() + "/fishstats?player=" + encoded);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int code = conn.getResponseCode();
                Scanner sc = new Scanner(
                    code == 200 ? conn.getInputStream() : conn.getErrorStream(),
                    StandardCharsets.UTF_8
                );
                String response = sc.useDelimiter("\\A").next();
                sc.close();

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (code == 404) {
                        player.sendMessage("§cИгрок §f" + target + " §cещё не поймал ни одной рыбы.");
                        return;
                    }
                    if (code != 200) {
                        player.sendMessage("§cОшибка: " + response);
                        return;
                    }

                    player.sendMessage("§8§m                                        ");
                    player.sendMessage("  §d§lСтатистика рыбака §f" + target);
                    player.sendMessage("§8§m                                        ");

                    String section = "";
                    for (String raw : response.split("\n")) {
                        // Первая строка — заголовок (Игрок: ... | Место: ... | Очки: ...)
                        if (raw.startsWith("Игрок:")) {
                            String[] parts = raw.split("\\|");
                            for (String part : parts) {
                                player.sendMessage("  §7" + part.trim()
                                    .replace("Место в топе:", "§fМесто в топе:§d")
                                    .replace("Очки:", "§fОчки:§d")
                                    .replace("Игрок:", "§fИгрок:§f"));
                            }
                            continue;
                        }

                        // Пустая строка — разделитель между секциями
                        if (raw.isEmpty()) {
                            continue;
                        }

                        // Заголовки секций (без отступа)
                        if (!raw.startsWith(" ")) {
                            section = raw.trim();
                            player.sendMessage("§8§m                                        ");
                            player.sendMessage("  §e" + section);
                            continue;
                        }

                        // Строки с данными (два пробела — обычная строка, четыре — вложенная)
                        String trimmed = raw.stripLeading();
                        boolean nested = raw.startsWith("    ");
                        String indent  = nested ? "    " : "  ";

                        // Разделяем по двоеточию на ключ и значение
                        int colon = trimmed.indexOf(':');
                        if (colon > 0) {
                            String key = trimmed.substring(0, colon).trim();
                            String val = trimmed.substring(colon + 1).trim();
                            player.sendMessage(indent + "§7" + key + ": §f" + val);
                        } else {
                            // Строки вроде "Отдавал:", "Получал:" — подзаголовки
                            player.sendMessage(indent + "§7" + trimmed);
                        }
                    }

                    player.sendMessage("§8§m                                        ");
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка /fishstats: " + e.getMessage());
            }
        });

        return true;
    }
}
