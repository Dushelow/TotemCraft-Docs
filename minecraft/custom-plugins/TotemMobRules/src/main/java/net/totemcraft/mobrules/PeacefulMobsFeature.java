package net.totemcraft.mobrules;

import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityCombustByEntityEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Мирные мобы для выбранных игроков (peaceful-mobs): мобы из mobs в месте where не выбирают целью игроков
 * из списка правила, то есть специально в них не стреляют и не нападают. Случайное попадание (шар летел в
 * другого) ранит как обычно; с block-damage: true урон и поджог от этих мобов отменяются полностью.
 * Список игроков хранится в peaceful-players.yml и меняется командой /mobrules peace.
 */
final class PeacefulMobsFeature implements Listener {

    record Rule(String name, Set<EntityType> mobs, Scope where, boolean ownersCanEdit, boolean blockDamage,
                Map<UUID, String> players, AtomicLong blocked) {
    }

    private final JavaPlugin plugin;
    private final File file;
    private final Map<String, Rule> rules = new LinkedHashMap<>();

    PeacefulMobsFeature(JavaPlugin plugin, ConfigurationSection section) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "peaceful-players.yml");
        YamlConfiguration data = YamlConfiguration.loadConfiguration(file);
        for (String name : section.getKeys(false)) {
            ConfigurationSection r = section.getConfigurationSection(name);
            if (r == null || !r.getBoolean("enabled", true)) {
                continue;
            }
            Set<EntityType> mobs = Scope.mobs(r.getStringList("mobs"), "peaceful-mobs." + name + ".mobs", plugin.getLogger());
            if (mobs.isEmpty()) {
                plugin.getLogger().warning("Правило peaceful-mobs." + name + " без mobs, пропущено");
                continue;
            }
            Map<UUID, String> players = new ConcurrentHashMap<>();
            ConfigurationSection saved = data.getConfigurationSection(name);
            if (saved != null) {
                for (String id : saved.getKeys(false)) {
                    try {
                        players.put(UUID.fromString(id), saved.getString(id, "?"));
                    } catch (IllegalArgumentException e) {
                        plugin.getLogger().warning("Неверный UUID в peaceful-players.yml: " + id);
                    }
                }
            }
            rules.put(name.toLowerCase(java.util.Locale.ROOT), new Rule(name, mobs, new Scope(r.getConfigurationSection("where")),
                    r.getBoolean("region-owners-can-edit", true), r.getBoolean("block-damage", false), players, new AtomicLong()));
        }
    }

    boolean isEmpty() {
        return rules.isEmpty();
    }

    Map<String, Rule> rules() {
        return rules;
    }

    java.util.List<Scope> scopes() {
        return rules.values().stream().map(Rule::where).toList();
    }

    String describe() {
        StringBuilder sb = new StringBuilder();
        for (Rule r : rules.values()) {
            sb.append("\n  ").append(r.name()).append(": ").append(r.mobs()).append(" не трогают ")
                    .append(r.players().values()).append(", ").append(r.where()).append(", отменено ").append(r.blocked().get());
        }
        return sb.toString();
    }

    /** damageToo: проверка урона и поджога - действует только в правилах с block-damage: true. */
    private boolean spares(Entity mob, Player player, boolean damageToo) {
        EntityType type = mob.getType();
        for (Rule rule : rules.values()) {
            if ((!damageToo || rule.blockDamage()) && rule.mobs().contains(type) && rule.players().containsKey(player.getUniqueId())
                    && rule.where().contains(player.getLocation())) {
                rule.blocked().incrementAndGet();
                return true;
            }
        }
        return false;
    }

    boolean debug;

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onTarget(EntityTargetLivingEntityEvent event) {
        if (debug && event.getTarget() instanceof Player p) {
            for (Rule r : rules.values()) {
                plugin.getLogger().info("Цель " + event.getEntity().getType() + " -> " + p.getName() + " " + p.getUniqueId()
                        + ": моб в правиле " + r.mobs().contains(event.getEntity().getType()) + ", игрок в списке "
                        + r.players().containsKey(p.getUniqueId()) + " " + r.players() + ", место " + r.where().contains(p.getLocation()));
            }
        }
        if (event.getTarget() instanceof Player player && spares(event.getEntity(), player, false)) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player player && spares(Sources.culprit(event.getDamager()), player, true)) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onCombust(EntityCombustByEntityEvent event) {
        if (event.getEntity() instanceof Player player && spares(Sources.culprit(event.getCombuster()), player, true)) {
            event.setCancelled(true);
        }
    }

    /** Может ли sender менять список правила: админ или (если разрешено) владелец региона правила. */
    boolean canEdit(org.bukkit.command.CommandSender sender, Rule rule) {
        if (sender.hasPermission("totemrules.admin")) {
            return true;
        }
        return rule.ownersCanEdit() && sender instanceof Player player && !rule.where().regions().isEmpty()
                && Bukkit.getPluginManager().isPluginEnabled("WorldGuard")
                && WorldGuardRegions.ownsAny(player, rule.where().regions());
    }

    /** Добавить или убрать игрока; true - список изменился. */
    boolean edit(Rule rule, String name, boolean add) {
        @SuppressWarnings("deprecation")
        OfflinePlayer target = Bukkit.getOfflinePlayer(name);
        boolean changed = add ? rule.players().put(target.getUniqueId(), target.getName() == null ? name : target.getName()) == null
                : rule.players().remove(target.getUniqueId()) != null;
        if (changed) {
            save();
        }
        return changed;
    }

    private synchronized void save() {
        YamlConfiguration data = new YamlConfiguration();
        data.options().setHeader(java.util.List.of(
                "Игроки, которых не трогают мобы по правилам peaceful-mobs (config.yml).",
                "Меняется командой /mobrules peace add|remove <правило> <ник>, руками править не нужно."));
        for (Rule rule : rules.values()) {
            rule.players().forEach((id, n) -> data.set(rule.name() + "." + id, n));
        }
        try {
            plugin.getDataFolder().mkdirs();
            data.save(file);
        } catch (IOException e) {
            plugin.getLogger().warning("Не удалось сохранить peaceful-players.yml: " + e.getMessage());
        }
    }
}
