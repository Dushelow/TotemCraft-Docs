#!/usr/bin/env python3
# Снять флаг голема (GOLEM, id 8) со всех приватов LWC перед включением denyGolems: false.
# После смены настройки смысл флага переворачивается: на этих сундуках он стал бы ЗАПРЕЩАТЬ големов.
#
# Запуск на сервере, только при остановленном Minecraft:
#   python3 lwc_golem_reset.py --dry-run     # только посчитать, ничего не менять
#   python3 lwc_golem_reset.py               # копия базы рядом, затем правка
# Для проверки на копии базы на своём компьютере: python lwc_golem_reset.py <путь к копии> --no-service-check
import datetime
import json
import shutil
import sqlite3
import subprocess
import sys

GOLEM = 8
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DB = args[0] if args else '/home/minecraft/server/plugins/LWC/lwc.db'
DRY = '--dry-run' in sys.argv

if '--no-service-check' not in sys.argv and not DRY:
    if subprocess.run(['systemctl', 'is-active', '--quiet', 'minecraft']).returncode == 0:
        sys.exit('СТОП: сервер Minecraft запущен. Сначала systemctl stop minecraft.')

con = sqlite3.connect(DB)
total = con.execute('select count(*) from lwc_protections').fetchone()[0]
rows = con.execute("select id, data from lwc_protections where data like '%\"id\":8%'").fetchall()

todo = []
for pid, data in rows:
    d = json.loads(data)
    flags = d.get('flags', [])
    kept = [f for f in flags if f.get('id') != GOLEM]
    if len(kept) != len(flags):
        d['flags'] = kept
        todo.append((json.dumps(d, ensure_ascii=False, separators=(',', ':')), pid, data))

print(f'всего приватов: {total}')
print(f'с флагом голема, будет снят: {len(todo)}')
if DRY or not todo:
    print('ничего не меняю' + (' (--dry-run)' if DRY else ''))
    sys.exit(0)

backup = f'{DB}.before-golem-reset-{datetime.datetime.now():%Y%m%d-%H%M%S}'
con.close()
shutil.copy2(DB, backup)
print(f'копия базы: {backup}')

con = sqlite3.connect(DB)
changed = 0
with con:
    for new, pid, old in todo:
        # Предохранитель: меняем, только если запись не изменилась с момента чтения.
        changed += con.execute('update lwc_protections set data=? where id=? and data=?', (new, pid, old)).rowcount
left = sum(1 for (data,) in con.execute("select data from lwc_protections where data like '%\"id\":8%'")
           if any(f.get('id') == GOLEM for f in json.loads(data).get('flags', [])))
after_total = con.execute('select count(*) from lwc_protections').fetchone()[0]
print(f'изменено строк: {changed} (ожидалось {len(todo)})')
print(f'флаг голема остался у: {left} (должно быть 0)')
print(f'всего приватов после: {after_total} (должно быть {total})')
if changed != len(todo) or left or after_total != total:
    sys.exit(f'ВНИМАНИЕ: результат не сходится. Вернуть базу: cp {backup} {DB}')
print('готово')
