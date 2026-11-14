# Ценные предметы TotemCraft. Правит построчно, комментарии и остальное не трогает:
#  - Paper config/paper-world-defaults.yml, entities.spawning.alt-item-despawn-rate.items: ценное лежит на земле 1 час
#    (таймер идёт при загруженном чанке). Прежние записи 1 час / 24 часа не из списка удаляются (ванильные 5 минут),
#    остальные записи (например булыжник 300) не трогаются;
#  - Purpur purpur.yml, world-settings.default.gameplay-mechanics.item.immune: ценное не уничтожается взрывом и
#    молнией. Огонь, лава и кактус уничтожают как в ванилле (несгораемость игрокам не понравилась).
# Решение владельца 14.11.2026. Запуск: python valuable_items.py <папка сервера>
import re, sys

SERVER = sys.argv[1]
TICKS = 72000  # 1 час
IMMUNE = {'explosion': True, 'lightning': True, 'fire': False, 'cactus': False}

SHULKERS = ['shulker_box'] + [c + '_shulker_box' for c in ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime',
            'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']]
TRIMS = [t + '_armor_trim_smithing_template' for t in ['sentry', 'vex', 'wild', 'coast', 'dune', 'wayfinder', 'raiser',
         'shaper', 'host', 'ward', 'silence', 'tide', 'snout', 'rib', 'eye', 'spire', 'flow', 'bolt']]
RESOURCES = ['diamond', 'diamond_block', 'netherite_ingot', 'netherite_scrap', 'netherite_block', 'ancient_debris',
             'emerald', 'emerald_block', 'enchanted_book', 'totem_of_undying', 'nether_star', 'beacon',
             'heart_of_the_sea', 'conduit', 'heavy_core', 'enchanted_golden_apple', 'golden_apple', 'dragon_egg',
             'dragon_head', 'wither_skeleton_skull', 'echo_shard', 'recovery_compass',
             'netherite_upgrade_smithing_template'] + SHULKERS + TRIMS
# Экипировка: только алмазная и незеритовая. Медная, железная, золотая, кожаная, кольчужная, деревянная, каменная,
# луки, арбалеты, удочки - ванильные 5 минут.
EQUIPMENT = [m + '_' + p for m in ['diamond', 'netherite']
             for p in ['helmet', 'chestplate', 'leggings', 'boots', 'sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'spear',
                       'horse_armor', 'nautilus_armor']]
EQUIPMENT += ['elytra', 'trident', 'mace', 'shield', 'turtle_helmet', 'wolf_armor', 'saddle', 'lead']
ITEMS = RESOURCES + EQUIPMENT

# --- Paper
p = SERVER + '/config/paper-world-defaults.yml'
s = open(p, encoding='utf-8').read()
m = re.search(r'(\n( +)alt-item-despawn-rate:\n +enabled: )\w+(\n( +)items:\n)((?:\4  .*\n)*)', s)
assert m, 'alt-item-despawn-rate не найден'
ind = m.group(4) + '  '
old = dict(re.findall(r'^ +([a-z0-9_:]+): (-?\d+)$', m.group(5), re.M))
items = {k: v for k, v in old.items() if k in ITEMS or v not in ('72000', '1728000')}
items.update({i: str(TICKS) for i in ITEMS})
s = s[:m.start()] + m.group(1) + 'true' + m.group(3) + ''.join(f'{ind}{k}: {v}\n' for k, v in items.items()) + s[m.end():]
open(p, 'w', encoding='utf-8', newline='\n').write(s)

# --- Purpur
p = SERVER + '/purpur.yml'
lines = open(p, encoding='utf-8').read().split('\n')
i = next(n for n, l in enumerate(lines) if l.strip() == 'immune:' and lines[n - 1].strip() == 'item:')
base = len(lines[i]) - len(lines[i].lstrip()) + 2
n = i + 1
while n < len(lines) and len(lines[n]) - len(lines[n].lstrip()) >= base and lines[n].strip():
    l = lines[n]
    kind = l.strip().split(':')[0]
    assert len(l) - len(l.lstrip()) == base and kind in IMMUNE, 'неожиданная строка в immune: ' + l
    e = n + 1
    while e < len(lines) and lines[e].startswith(' ' * (base + 2) + '- '):
        e += 1
    new = [' ' * base + kind + ':'] + [' ' * (base + 2) + '- minecraft:' + it for it in ITEMS] if IMMUNE[kind] \
        else [' ' * base + kind + ': []']
    lines[n:e] = new
    n += len(new)
open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('ценных предметов (1 час, защита от взрыва и молнии):', len(ITEMS))
