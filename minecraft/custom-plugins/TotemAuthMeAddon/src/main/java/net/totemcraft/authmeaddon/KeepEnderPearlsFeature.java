package net.totemcraft.authmeaddon;

import fr.xephi.authme.api.v3.AuthMeApi;
import org.bukkit.entity.EnderPearl;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Жемчуг Края в стазис-камерах не пропадает при перезаходе.
 * <p>
 * С 1.21.2 игра при выходе игрока убирает его брошенный жемчуг в сохранение игрока, а при входе
 * возвращает в мир. Paper считает это возвращение запуском снаряда (ProjectileLaunchEvent). В этот момент
 * игрок ещё не ввёл пароль, и AuthMe (EntityListener.onProjectileLaunch, LOWEST) отменяет запуск: жемчуг
 * не появляется, в журнале «Failed to spawn player ender pearl ... skipping». После входа AuthMe пытается
 * воссоздать его по своему снимку при выходе и делает это неточно (жемчуг может сразу сработать).
 * <p>
 * Здесь, после AuthMe (HIGHEST), разрешаем обратно только такой запуск: жемчуг, «хозяин» которого ещё
 * не вошёл по паролю, и жемчуг не новый (getTicksLived больше 0: возвращённый из сохранения хранит свой
 * возраст, только что брошенный - 0). Бросить жемчуг до ввода пароля всё равно нельзя: AuthMe запрещает
 * использование предметов. Когда игрок войдёт, AuthMe найдёт жемчуг на месте по UUID и просто снова
 * привяжет его к игроку, ничего не пересоздавая.
 */
final class KeepEnderPearlsFeature implements Listener {

    private final JavaPlugin plugin;
    private final boolean log;

    KeepEnderPearlsFeature(JavaPlugin plugin, boolean log) {
        this.plugin = plugin;
        this.log = log;
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onLaunch(ProjectileLaunchEvent event) {
        if (!event.isCancelled() || !(event.getEntity() instanceof EnderPearl pearl)
                || !(pearl.getShooter() instanceof Player player) || pearl.getTicksLived() <= 0) {
            return;
        }
        AuthMeApi authMe = AuthMeApi.getInstance();
        if (authMe == null || authMe.isAuthenticated(player)) {
            return;
        }
        event.setCancelled(false);
        if (log) {
            plugin.getLogger().info("Жемчуг " + player.getName() + " возвращён в мир при входе: "
                    + pearl.getWorld().getName() + " " + pearl.getLocation().getBlockX() + " "
                    + pearl.getLocation().getBlockY() + " " + pearl.getLocation().getBlockZ());
        }
    }
}
