package net.totemcraft.mobrules;

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
 * TotemMobRules: правила поведения мобов на TotemCraft. WorldGuard необязателен: он нужен только правилам,
 * где в where указаны регионы. Механики включаются по отдельности в config.yml:
 * <ul>
 *   <li>{@link TemporaryFireFeature} - огонь от выбранных мобов гаснет сам и не сжигает блоки;</li>
 *   <li>{@link ExplosionRulesFeature} - взрывы выбранных мобов не ломают блоки;</li>
 *   <li>{@link DamageRulesFeature} - список правил «кто не получает урон, от кого или от чего, где».</li>
 * </ul>
 * /mobrules reload - перечитать config.yml без перезапуска, /mobrules status - что включено и сколько сработало.
 */
public final class TotemMobRules extends JavaPlugin {

    private final List<Listener> active = new ArrayList<>();
    private TemporaryFireFeature temporaryFire;
    private ExplosionRulesFeature explosions;
    private DamageRulesFeature damageRules;
    private PeacefulMobsFeature peaceful;

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
        ConfigurationSection peace = config.getConfigurationSection("peaceful-mobs");
        if (peace != null) {
            PeacefulMobsFeature feature = new PeacefulMobsFeature(this, peace);
            feature.debug = debug;
            if (!feature.isEmpty()) {
                peaceful = register(feature);
                scopes.addAll(feature.scopes());
                getLogger().info("Мирные мобы:" + feature.describe());
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
        peaceful = null;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length >= 1 && args[0].equalsIgnoreCase("peace")) {
            return peaceCommand(sender, label, args);
        }
        if (!sender.hasPermission("totemrules.admin")) {
            sender.sendMessage("Нет прав. Список игроков мирных мобов: /" + label + " peace list");
            return true;
        }
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            unload();
            load();
            sender.sendMessage("TotemMobRules: config.yml перечитан, подробности в журнале сервера");
            return true;
        }
        sender.sendMessage("TotemMobRules " + getPluginMeta().getVersion() + ":");
        sender.sendMessage(" Временный огонь: " + (temporaryFire == null ? "выключен" : temporaryFire.describe()));
        sender.sendMessage(" Взрывы без разрушения: " + (explosions == null ? "выключено" : explosions.describe()));
        sender.sendMessage(" Правила урона:" + (damageRules == null ? " нет" : damageRules.describe()));
        sender.sendMessage(" Мирные мобы:" + (peaceful == null ? " нет" : peaceful.describe()));
        return true;
    }

    /** /mobrules peace list [правило] | add <правило> <ник> | remove <правило> <ник> */
    private boolean peaceCommand(CommandSender sender, String label, String[] args) {
        if (peaceful == null) {
            sender.sendMessage("Мирные мобы не настроены (раздел peaceful-mobs в config.yml)");
            return true;
        }
        if (args.length < 2 || args[1].equalsIgnoreCase("list")) {
            for (PeacefulMobsFeature.Rule rule : peaceful.rules().values()) {
                if (args.length >= 3 && !rule.name().equalsIgnoreCase(args[2])) {
                    continue;
                }
                sender.sendMessage(rule.name() + ": " + rule.mobs() + " не трогают " + rule.players().values() + ", " + rule.where());
            }
            sender.sendMessage("Добавить: /" + label + " peace add <правило> <ник>, убрать: /" + label + " peace remove <правило> <ник>");
            return true;
        }
        boolean add = args[1].equalsIgnoreCase("add");
        if ((!add && !args[1].equalsIgnoreCase("remove")) || args.length != 4) {
            sender.sendMessage("Использование: /" + label + " peace list | add <правило> <ник> | remove <правило> <ник>");
            return true;
        }
        PeacefulMobsFeature.Rule rule = peaceful.rules().get(args[2].toLowerCase(java.util.Locale.ROOT));
        if (rule == null) {
            sender.sendMessage("Нет правила " + args[2] + ". Есть: " + peaceful.rules().keySet());
            return true;
        }
        if (!peaceful.canEdit(sender, rule)) {
            sender.sendMessage("Менять этот список могут админы и владельцы региона правила");
            return true;
        }
        boolean changed = peaceful.edit(rule, args[3], add);
        sender.sendMessage(changed ? (add ? args[3] + " добавлен: " : args[3] + " убран: ") + rule.mobs() + ", " + rule.where()
                : args[3] + (add ? " уже в списке" : " не было в списке"));
        if (changed) {
            getLogger().info(sender.getName() + (add ? " добавил " : " убрал ") + args[3] + " в мирных мобах " + rule.name());
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return List.of("status", "reload", "peace");
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("peace")) {
            return List.of("list", "add", "remove");
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("peace") && peaceful != null) {
            return new ArrayList<>(peaceful.rules().keySet());
        }
        return null;
    }

}
