# Ценные предметы TotemCraft: дольше лежат на земле (Paper alt-item-despawn-rate) и не горят/не рассыпаются
# (Purpur gameplay-mechanics.item.immune). Правит paper-world-defaults.yml и purpur.yml построчно,
# комментарии и остальное не трогает. Запуск: python valuable_items.py <папка сервера> [тики]
import re, sys

SERVER = sys.argv[1]
TICKS = int(sys.argv[2]) if len(sys.argv) > 2 else 72000  # 1 час при загруженном чанке

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
ITEMS = RESOURCES + EQUIPMENT

# --- Paper: config/paper-world-defaults.yml, entities.spawning.alt-item-despawn-rate.items
p = SERVER + '/config/paper-world-defaults.yml'
s = open(p, encoding='utf-8').read()
m = re.search(r'(\n(\s+)alt-item-despawn-rate:\n\s+enabled: )\w+(\n(\s+)items:\n)((?:\4  .*\n)*)', s)
assert m, 'alt-item-despawn-rate не найден'
ind = m.group(4) + '  '
old_items = dict(re.findall(r'^\s+([a-z0-9_:]+): (-?\d+)$', m.group(5), re.M))
old_items.update({i: str(TICKS) for i in ITEMS})
block = ''.join(f'{ind}{k}: {v}\n' for k, v in old_items.items())
s = s[:m.start()] + m.group(1) + 'true' + m.group(3) + block + s[m.end():]
open(p, 'w', encoding='utf-8', newline='\n').write(s)

# --- Purpur: purpur.yml, world-settings.default.gameplay-mechanics.item.immune.{cactus,explosion,fire}
p = SERVER + '/purpur.yml'
s = open(p, encoding='utf-8').read()
for kind in ['cactus', 'explosion', 'fire']:
    m = re.search(r'(\n(\s+)immune:\n(?:\2  .*\n)*?\2  ' + kind + r':) \[\]\n', s)
    assert m, 'purpur immune.' + kind + ' не найден или уже не пустой'
    ind = m.group(2) + '    '
    s = s[:m.start()] + m.group(1) + '\n' + ''.join(f'{ind}- minecraft:{i}\n' for i in ITEMS) + s[m.end():]
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ценных предметов:', len(ITEMS), '| время на земле:', TICKS, 'тиков')
