#!/usr/bin/env python3
# Добавить регион world_core (вечный центр мира ±10000) в regions.yml обычного мира.
# Запускать при ОСТАНОВЛЕННОМ сервере. Остальные регионы не трогает.
import subprocess, sys
P = '/home/minecraft/server/plugins/WorldGuard/worlds/2025/regions.yml'
if subprocess.run(['systemctl', 'is-active', '--quiet', 'minecraft']).returncode == 0:
    sys.exit('СТОП: сервер запущен')
t = open(P, encoding='utf8').read()
if 'world_core:' in t:
    sys.exit('регион world_core уже есть, ничего не меняю')
if t.count('regions:\n') != 1:
    sys.exit('СТОП: неожиданный формат файла')
reg = '''    world_core:
        min: {x: -10000, y: -64, z: -10000}
        max: {x: 10000, y: 319, z: 10000}
        members: {}
        flags:
            passthrough: allow
            greeting: "&7Основной мир без вайпов (до 10.000 блоков)"
            farewell: "&e⚠ Вы покидаете центр мира. &7Дальше 10.000 блоков территория обновляется с выходом новых версий: постройки будут удалены."
            farewell-title: "&c⚠ Внимание! Зона вайпа"
        owners: {}
        type: cuboid
        priority: 0
'''
open(P, 'w', encoding='utf8').write(t.replace('regions:\n', 'regions:\n' + reg, 1))
print('регион world_core добавлен')
