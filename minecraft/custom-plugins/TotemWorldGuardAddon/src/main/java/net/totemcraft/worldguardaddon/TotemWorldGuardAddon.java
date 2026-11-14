package net.totemcraft.worldguardaddon;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Аддон TotemCraft: правила мира, которых нет в ванилле и среди флагов WorldGuard. WorldGuard необязателен:
 * он нужен только правилам, где в where указаны регионы. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link TemporaryFireFeature} - огонь от выбранных мобов гаснет сам и не сжигает блоки;</li>
 *   <li>{@link ExplosionRulesFeature} - взрывы выбранных мобов не ломают блоки;</li>
 *   <li>{@link DamageRulesFeature} - список правил «кто не получает урон, от кого или от чего, где»;</li>
 *   <li>{@link WipeBorderFeature} - сообщения на границе центра мира (зоны вайпа).</li>
 * </ul>
 * /totemrules reload - перечитать config.yml без перезапуска, /totemrules status - что включено и сколько сработало.
 */
public final class TotemWorldGuardAddon extends JavaPlugin {

    private final List<Listener> active = new ArrayList<>();
    private TemporaryFireFeature temporaryFire;
    private ExplosionRulesFeature explosions;
    private DamageRulesFeature damageRules;
    private WipeBorderFeature wipeBorder;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        load();
    }

    @Override
    public void onDisable() {
        unload();
    }

    private void load() {
        reloadConfig();
        ConfigurationSection config = getConfig();
        boolean debug = config.getBoolean("debug", false);
        List<Scope> scopes = new ArrayList<>();

        ConfigurationSection fire = config.getConfigurationSection("temporary-fire");
        if (fire != null && fire.getBoolean("enabled", true)) {
            temporaryFire = register(new TemporaryFireFeature(this, fire, debug));
            scopes.add(temporaryFire.where());
            getLogger().info("Временный огонь: " + temporaryFire.describe());
        }
        ConfigurationSection boom = config.getConfigurationSection("no-block-damage-explosions");
        if (boom != null && boom.getBoolean("enabled", true)) {
            explosions = register(new ExplosionRulesFeature(this, boom));
            scopes.add(explosions.where());
            getLogger().info("Взрывы без разрушения блоков: " + explosions.describe());
        }
        ConfigurationSection damage = config.getConfigurationSection("damage-rules");
        if (damage != null) {
            DamageRulesFeature rules = new DamageRulesFeature(this, damage);
            if (!rules.isEmpty()) {
                damageRules = register(rules);
                scopes.addAll(rules.scopes());
                getLogger().info("Правила урона:" + rules.describe());
            }
        }
        ConfigurationSection border = config.getConfigurationSection("wipe-border");
        if (border != null && border.getBoolean("enabled", true)) {
            WipeBorderFeature feature = new WipeBorderFeature(border.getConfigurationSection("worlds"));
            if (!feature.isEmpty()) {
                wipeBorder = register(feature);
                getLogger().info("Граница зоны вайпа: " + feature);
            }
        }
        checkRegions(scopes);
    }

    /** Опечатка в названии региона молча выключила бы правило: предупреждаем при запуске и перечитывании. */
    private void checkRegions(List<Scope> scopes) {
        Set<String> names = new HashSet<>();
        scopes.forEach(s -> names.addAll(s.regions()));
        if (names.isEmpty()) {
            return;
        }
        if (!getServer().getPluginManager().isPluginEnabled("WorldGuard")) {
            getLogger().warning("В правилах указаны регионы " + names + ", но WorldGuard не включён: эти правила не сработают");
            return;
        }
        Set<String> missing = WorldGuardRegions.missing(names);
        if (!missing.isEmpty()) {
            getLogger().warning("Регионов нет ни в одном мире (опечатка?): " + missing);
        }
    }

    private <T extends Listener> T register(T listener) {
        getServer().getPluginManager().registerEvents(listener, this);
        active.add(listener);
        return listener;
    }

    private void unload() {
        if (temporaryFire != null) {
            temporaryFire.extinguishAll();
        }
        active.forEach(HandlerList::unregisterAll);
        active.clear();
        temporaryFire = null;
        explosions = null;
        damageRules = null;
        wipeBorder = null;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            unload();
            load();
            sender.sendMessage("TotemWorldGuardAddon: config.yml перечитан, подробности в журнале сервера");
            return true;
        }
        sender.sendMessage("TotemWorldGuardAddon " + getPluginMeta().getVersion() + ":");
        sender.sendMessage(" Временный огонь: " + (temporaryFire == null ? "выключен" : temporaryFire.describe()));
        sender.sendMessage(" Взрывы без разрушения: " + (explosions == null ? "выключено" : explosions.describe()));
        sender.sendMessage(" Правила урона:" + (damageRules == null ? " нет" : damageRules.describe()));
        sender.sendMessage(" Граница вайпа: " + (wipeBorder == null ? "выключена" : wipeBorder.toString()));
        return true;
    }

    static String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
