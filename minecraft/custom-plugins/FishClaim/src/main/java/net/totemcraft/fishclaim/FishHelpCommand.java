package net.totemcraft.fishclaim;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class FishHelpCommand implements CommandExecutor {

    public FishHelpCommand(FishClaimPlugin plugin) {}

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cЭта команда только для игроков.");
            return true;
        }

        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §d§lTotemCraft Fish NFT");
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §7При поимке легендарной или мифической рыбы");
        player.sendMessage("  §7система генерирует уникальный трофей с атрибутами.");
        player.sendMessage("  §7Трофеи хранятся в базе, привязываются к Discord-аккаунту,");
        player.sendMessage("  §7передаются другим игрокам и выпускаются живыми в мир.");
        player.sendMessage("  §7Очки начисляются за все уловы и за владение трофеями.");
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §eОсновные команды");
        player.sendMessage("  §f/claim §8<ID>         §7Заклеймить пойманный трофей на свой аккаунт");
        player.sendMessage("  §f/fc §8[ID]            §7Карточка рыбы — держи трофей в руке или укажи ID");
        player.sendMessage("  §f/fwhere §8<ID>        §7Где сейчас находится рыба и у кого");
        player.sendMessage("  §f/fishstats §8[ник]    §7Полная статистика рыбака");
        player.sendMessage("  §f/fishtop              §7Таблица лидеров по очкам");
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §eПередача трофеев");
        player.sendMessage("  §f/ft §8<ник> [ID]      §7Предложить трофей другому игроку");
        player.sendMessage("  §f/ftaccept §8[ID]      §7Принять входящее предложение");
        player.sendMessage("  §f/ftdecline §8[ID]     §7Отклонить входящее предложение");
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §eВыпуск в мир");
        player.sendMessage("  §f/fconvert             §7Трофей в руке — превратить в ведро с рыбой,");
        player.sendMessage("  §7                      ведро с рыбой — вернуть обратно в трофей");
        player.sendMessage("  §7Для выпуска нужно ведро с водой в инвентаре.");
        player.sendMessage("  §7Чтобы вернуть: поймай рыбу ведром (ПКМ), затем §f/fconvert§7.");
        player.sendMessage("§8§m                                        ");
        player.sendMessage("  §7Привязка Discord: §f/discord link");
        player.sendMessage("  §7Без привязки клейм и передача недоступны.");
        player.sendMessage("§8§m                                        ");

        return true;
    }
}
