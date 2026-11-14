# Ценные предметы TotemCraft: дольше лежат на земле (Paper alt-item-despawn-rate). Правит paper-world-defaults.yml
# построчно, комментарии и остальное не трогает. Запуск: python valuable_items.py <папка сервера>
# С 14.11.2026 (вечер): ценное 1 час, дешёвое с ферм (JUNK) убирается из списка и пропадает за ванильные 5 минут.
# Несгораемость Purpur не ставится (игрокам не понравилась).
import re, sys

SERVER = sys.argv[1]
TICKS = 72000  # 1 час при загруженном чанке
# дешёвое, массово падает с мобов на фермах и с рыбалки: ванильные 5 минут
JUNK = (['bow', 'crossbow', 'golden_sword', 'fishing_rod']
        + [m + '_' + p for m in ['leather', 'chainmail'] for p in ['helmet', 'chestplate', 'leggings', 'boots']]
        + [m + '_' + p for m in ['wooden', 'stone'] for p in ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'spear']])

RESOURCES = ['diamond', 'diamond_block', 'netherite_ingot', 'netherite_scrap', 'netherite_block', 'ancient_debris',
             'emerald', 'emerald_block', 'enchanted_book', 'totem_of_undying', 'nether_star', 'beacon',
             'heart_of_the_sea', 'conduit', 'heavy_core', 'enchanted_golden_apple', 'golden_apple', 'dragon_egg',
             'dragon_head', 'wither_skeleton_skull', 'echo_shard', 'recovery_compass', 'netherite_upgrade_smithing_template',
             'shulker_box'] + [c + '_shulker_box' for c in ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink',
             'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']]
TRIMS = ['sentry', 'vex', 'wild', 'coast', 'dune', 'wayfinder', 'raiser', 'shaper', 'host', 'ward', 'silence', 'tide',
         'snout', 'rib', 'eye', 'spire', 'flow', 'bolt']
RESOURCES += [t + '_armor_trim_smithing_template' for t in TRIMS]
EQUIPMENT = []
for m in ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite', 'copper']:
    for p in ['helmet', 'chestplate', 'leggings', 'boots']:
        EQUIPMENT.append(m + '_' + p)
for m in ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite', 'copper']:
    for p in ['sword', 'axe', 'pickaxe', 'shovel', 'hoe']:
        EQUIPMENT.append(m + '_' + p)
for m in ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite', 'copper']:
    EQUIPMENT.append(m + '_spear')
EQUIPMENT += ['elytra', 'trident', 'mace', 'bow', 'crossbow', 'shield', 'turtle_helmet', 'wolf_armor', 'fishing_rod']
ITEMS = [i for i in RESOURCES + EQUIPMENT if i not in JUNK]

# --- Paper: config/paper-world-defaults.yml, entities.spawning.alt-item-despawn-rate.items
p = SERVER + '/config/paper-world-defaults.yml'
s = open(p, encoding='utf-8').read()
m = re.search(r'(\n(\s+)alt-item-despawn-rate:\n\s+enabled: )\w+(\n(\s+)items:\n)((?:\4  .*\n)*)', s)
assert m, 'alt-item-despawn-rate не найден'
ind = m.group(4) + '  '
old_items = dict(re.findall(r'^\s+([a-z0-9_:]+): (-?\d+)$', m.group(5), re.M))
old_items = {k: v for k, v in old_items.items() if k not in JUNK}
old_items.update({i: str(TICKS) for i in ITEMS})
block = ''.join(f'{ind}{k}: {v}\n' for k, v in old_items.items())
s = s[:m.start()] + m.group(1) + 'true' + m.group(3) + block + s[m.end():]
open(p, 'w', encoding='utf-8', newline='\n').write(s)

print('ценных предметов (1 час):', len(ITEMS), '| убрано из списка (5 минут):', len(JUNK))
