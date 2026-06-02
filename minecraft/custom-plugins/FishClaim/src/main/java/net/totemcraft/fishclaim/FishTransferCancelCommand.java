package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * /ftcancel — отмена со стороны отправителя (нажал «Отмена» на кнопке).
 */
public class FishTransferCancelCommand implements CommandExecutor {

    public FishTransferCancelCommand(FishClaimPlugin plugin) {}

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player player) {
            player.sendMessage("§c✖ Передача отменена.");
        }
        return true;
    }
}
