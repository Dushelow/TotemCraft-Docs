package net.totemcraft.fishclaim;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
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
import java.util.Scanner;

public class FishTransferCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishTransferCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        if (args.length < 1) {
            player.sendMessage("§eИспользование: §f/" + label + " <ник> [ID]");
            player.sendMessage("§7Без ID — держи трофей в руке.");
            return true;
        }

        String recipient = args[0];

        String fishId;
        if (args.length >= 2) {
            fishId = args[1].toUpperCase();
        } else {
            fishId = getFishIdFromHand(player);
            if (fishId == null) {
                player.sendMessage("§cНе удалось определить рыбу.");
                player.sendMessage("§7Держи трофей в руке или укажи ID: §f/" + label + " <ник> <ID>");
                return true;
            }
        }

        if (recipient.equalsIgnoreCase(player.getName())) {
            player.sendMessage("§cНельзя передать рыбу самому себе.");
            return true;
        }

        final String finalFishId = fishId;

        // BUG FIX: Проверяем владение, Discord отправителя и Discord получателя
        // ПЕРЕД показом confirmation UI — всё асинхронно через бота.
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            // 1. Проверяем Discord отправителя
            boolean senderHasDiscord = checkDiscordLink(player.getName());
            if (!senderHasDiscord) {
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    player.sendMessage("§cНельзя передавать трофеи без привязанного Discord.");
                    player.sendMessage("§7Привяжи аккаунт: §f/discord link");
                });
                return;
            }

            // 2. Проверяем Discord получателя
            boolean recipientHasDiscord = checkDiscordLink(recipient);
            if (!recipientHasDiscord) {
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    player.sendMessage("§cИгрок §f" + recipient + " §cне привязал Discord.");
                    player.sendMessage("§7Получатель должен выполнить §f/discord link §7прежде чем принять трофей.");
                });
                return;
            }

            // 3. Проверяем что рыба принадлежит отправителю через API
            OwnershipResult ownership = checkFishOwnership(finalFishId, player.getName());
            if (ownership == null) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cРыба §f" + finalFishId + " §cне найдена.")
                );
                return;
            }
            if (!ownership.isOwner) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                    player.sendMessage("§cЭта рыба тебе не принадлежит.")
                );
                return;
            }
            if (!ownership.isClaimed) {
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    player.sendMessage("§cРыба §f" + finalFishId + " §cне заклеймлена.");
                    player.sendMessage("§7Сначала заклейми её командой §f/claim " + finalFishId);
                });
                return;
            }

            // Всё ок — показываем подтверждение на главном потоке
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                Player p = Bukkit.getPlayer(player.getUniqueId());
                if (p != null) {
                    sendSenderConfirmation(p, recipient, finalFishId, label);
                }
            });
        });

        return true;
    }

    private boolean checkDiscordLink(String playerName) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/check_discord?player=" + playerName);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    static class OwnershipResult {
        final boolean isOwner, isClaimed;
        OwnershipResult(boolean isOwner, boolean isClaimed) {
            this.isOwner = isOwner;
            this.isClaimed = isClaimed;
        }
    }

    private OwnershipResult checkFishOwnership(String fishId, String playerName) {
        try {
            URL url = new URL(plugin.getFishBotUrl() + "/fishcheck/" + fishId);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            if (conn.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8);
            String body = sc.useDelimiter("\\A").next();
            sc.close();

            String owner = null;
            boolean claimed = false;
            for (String line : body.split("\n")) {
                if (line.startsWith("Владелец:"))
                    owner = line.replace("Владелец:", "").trim();
                if (line.startsWith("Статус:") && line.contains("Заклеймлена") && !line.contains("Не"))
                    claimed = true;
            }
            if (owner == null) return null;
            return new OwnershipResult(owner.equalsIgnoreCase(playerName), claimed);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Показывает отправителю запрос подтверждения с кнопками.
     */
    private void sendSenderConfirmation(Player player, String recipient, String fishId, String label) {
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §e§lПередача трофея");
        player.sendMessage("  §7Рыба:       §f" + fishId);
        player.sendMessage("  §7Получатель: §f" + recipient);
        player.sendMessage("  §7Подтверди передачу:");
        player.sendMessage("§8§m                                        ");

        Component confirm = Component.text("  [ ✔ Отправить ] ", NamedTextColor.GREEN, TextDecoration.BOLD)
                .clickEvent(ClickEvent.runCommand("/ftconfirm " + fishId + " " + recipient));
        Component cancel = Component.text("[ ✖ Отмена ]  ", NamedTextColor.RED, TextDecoration.BOLD)
                .clickEvent(ClickEvent.runCommand("/ftcancel"));

        player.sendMessage(confirm.append(cancel));
        player.sendMessage("§8§m                                        ");
    }

    /**
     * Реальная отправка pending transfer — вызывается из FishTransferConfirmCommand.
     */
    static void executePending(FishClaimPlugin plugin, Player player, String recipient, String fishId) {
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String json = "{\"fish_id\":\"" + fishId + "\","
                        + "\"from\":\"" + player.getName() + "\","
                        + "\"to\":\"" + recipient + "\"}";

                URL url = new URL(plugin.getFishBotUrl() + "/ftpending");
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
                        player.sendMessage("§a✔ Предложение отправлено §f" + recipient + "§a.");
                        player.sendMessage("§7У получателя есть §f1 минута§7 чтобы принять.");

                        Player target = Bukkit.getPlayer(recipient);
                        if (target != null) {
                            sendTransferNotification(target, player.getName(), fishId);
                        }
                    } else if (response.contains("already pending")) {
                        player.sendMessage("§cДля рыбы §f" + fishId + " §cуже есть активное предложение.");
                    } else if (response.contains("not your fish")) {
                        player.sendMessage("§cЭто не твоя рыба.");
                    } else if (response.contains("fish not found")) {
                        player.sendMessage("§cРыба §f" + fishId + " §cне найдена.");
                    } else {
                        player.sendMessage("§cОшибка: " + response);
                    }
                });

            } catch (Exception e) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage("§cНе удалось связаться с ботом. Попробуй позже.")
                );
                plugin.getLogger().warning("Ошибка /fishtransfer: " + e.getMessage());
            }
        });
    }

    /** Уведомление получателю с кнопками. */
    static void sendTransferNotification(Player target, String fromPlayer, String fishId) {
        target.sendMessage("§8§m                                        ");
        target.sendMessage("  §d§l✦ Предложение о передаче трофея");
        target.sendMessage("  §7От: §f" + fromPlayer);
        target.sendMessage("  §7Рыба: §f" + fishId);
        target.sendMessage("  §7У тебя есть §f1 минута§7.");
        target.sendMessage("§8§m                                        ");

        Component accept = Component.text("  [ ✔ Принять ] ", NamedTextColor.GREEN, TextDecoration.BOLD)
                .clickEvent(ClickEvent.runCommand("/ftaccept " + fishId));
        Component decline = Component.text("[ ✖ Отклонить ]  ", NamedTextColor.RED, TextDecoration.BOLD)
                .clickEvent(ClickEvent.runCommand("/ftdecline " + fishId));

        target.sendMessage(accept.append(decline));
        target.sendMessage("§8§m                                        ");
    }

    /** Извлекает fish_id из первой строки lore предмета в главной руке. */
    static String getFishIdFromHand(Player player) {
        ItemStack held = player.getInventory().getItemInMainHand();
        if (held == null) return null;
        ItemMeta meta = held.getItemMeta();
        if (meta == null || !meta.hasLore()) return null;
        List<String> lore = meta.getLore();
        if (lore == null || lore.isEmpty()) return null;
        String first = ChatColor.stripColor(lore.get(0)).trim();
        return first.matches("[A-Z]{2,3}-[A-Z0-9]{6}") ? first : null;
    }
}
