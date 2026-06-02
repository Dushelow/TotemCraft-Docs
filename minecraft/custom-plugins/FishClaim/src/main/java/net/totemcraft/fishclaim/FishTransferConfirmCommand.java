package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * /ftconfirm <ID> <ник> — внутренняя команда, вызывается кнопкой у отправителя.
 */
public class FishTransferConfirmCommand implements CommandExecutor {

    private final FishClaimPlugin plugin;

    public FishTransferConfirmCommand(FishClaimPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) return true;
        if (args.length < 2) {
            player.sendMessage("§cОшибка команды подтверждения.");
            return true;
        }

        String fishId    = args[0].toUpperCase();
        String recipient = args[1];

        FishTransferCommand.executePending(plugin, player, recipient, fishId);
        return true;
    }
}
