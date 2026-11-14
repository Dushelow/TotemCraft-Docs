package net.totemcraft.worldguardaddon;

import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;

/** Кто на самом деле виноват: сам моб, хозяин снаряда (шар всполоха, стрела) или поджигатель динамита. */
final class Sources {

    private Sources() {
    }

    static Entity culprit(Entity entity) {
        if (entity instanceof Projectile projectile && projectile.getShooter() instanceof LivingEntity shooter) {
            return shooter;
        }
        if (entity instanceof TNTPrimed tnt && tnt.getSource() != null) {
            return tnt.getSource();
        }
        return entity;
    }
}
