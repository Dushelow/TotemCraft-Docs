#!/bin/bash
# Разовая очистка: удаляет старые rsync-копии daily-* на Storage Box.
# Запускать на сервере от root:  bash cleanup_old_backups.sh
#
# Удаляет ТОЛЬКО эти папки (имена перечислены явно, масок нет):
#   daily-2026-05-15 ... daily-2026-07-23   (старые копии, 70 штук)
#   daily-2026-10-09                         (недокачанная, от зависшего rsync)
# НЕ трогает: daily-2026-10-08, monthly-2026-06, monthly-2026-07.
#
# Сначала печатает, что собирается удалить, и ждёт, пока вы введёте yes.

SB="u570805@u570805.your-storagebox.de"
LOG=/root/cleanup_old_backups.log

DIRS=(daily-2026-05-{15..31} daily-2026-06-{01..30} daily-2026-07-{01..23} daily-2026-10-09)

echo "Будет удалено папок на хранилище: ${#DIRS[@]}"
echo "Первая: ${DIRS[0]}   Последняя: ${DIRS[-1]}"
echo "Остаются: daily-2026-10-08, monthly-2026-06, monthly-2026-07"
read -r -p "Продолжить? Введите yes: " ANSWER
[ "$ANSWER" = "yes" ] || { echo "Отмена, ничего не удалено."; exit 1; }

: > "$LOG"
for d in "${DIRS[@]}"; do
  echo "$(date +%T) rm $d" | tee -a "$LOG"
  su -s /bin/bash minecraft -c "ssh -p 23 -o BatchMode=yes $SB 'rm -rf totemcraft-backups/$d'" >> "$LOG" 2>&1
done

echo "$(date +%T) ГОТОВО" | tee -a "$LOG"
su -s /bin/bash minecraft -c "ssh -p 23 -o BatchMode=yes $SB 'df -h'" | tee -a "$LOG"
