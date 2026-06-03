# Бэкапы сервера на Hetzner Storage Box (1 ТБ)

## 1. Схема бэкапа

Используем `rsync + hardlinks`.

- Бэкапится весь сервер: мир, плагины, конфиги.
- Каждый день в 5:00 МСК создаётся папка `daily-YYYY-MM-DD`.
- Благодаря `--link-dest` почти все файлы **не копируются заново**, а ссылаются (hardlinks) на предыдущий бэкап. Ежедневный бэкап занимает **очень мало** дополнительного места (обычно 100–800 МБ вместо 22+ ГБ).
- Хранятся **3 последних ежедневных** бэкапа — старые удаляются автоматически.
- 1-го числа каждого месяца создаётся **вечный** `monthly-YYYY-MM`, который никогда не удаляется автоматически.
- Скрипт запускается от пользователя `minecraft` — он же владеет screen-сессией сервера.

---

## 2. Пошаговая настройка

### Шаг 0: Подготовка Storage Box

1. Зайди в Hetzner Console → Storage Boxes → свой бокс.
2. Включи **SSH-Support** (порт 23).
3. Сбрось пароль (Reset password) и сохрани его — понадобится один раз при настройке ключа.

---

### Шаг 1: Настройка SSH-ключа

Все команды выполняй **от пользователя `minecraft`**.

```bash
su - minecraft

# Генерация ключа (если ещё нет)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# Отправь публичный ключ на Storage Box (введи пароль от бокса один раз)
cat ~/.ssh/id_ed25519.pub | ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de install-ssh-key
```

Проверка — Storage Box использует ограниченный shell, поэтому вместо `echo OK` просто проверяем что подключение проходит без пароля:

```bash
ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de
# Должно подключиться без запроса пароля. Выйти: exit
```

---

### Шаг 2: Создай скрипт бэкапа

```bash
nano /home/minecraft/backup.sh
```

Вставь весь этот код:

```bash
#!/bin/bash
# Скрипт бэкапов
# Ежедневные бэкапы с hardlink-дедупликацией, ежемесячный снапшот 1-го числа.
# Зависимости: rsync, ssh, screen (сессия называется "minecraft")

set -uo pipefail

# Конфигурация
SERVER_DIR="/home/minecraft/server"
BACKUP_HOST="uXXXXXX@uXXXXXX.your-storagebox.de"
BACKUP_PORT=23
BACKUP_DIR="minecraft-backups"
LOG="/home/minecraft/backup.log"

DATE=$(date +%Y-%m-%d)
MONTHLY_DATE=$(date +%Y-%m)

RSYNC_BASE_OPTS=(-aAX --delete --stats --ignore-errors -e "ssh -p ${BACKUP_PORT}")

RSYNC_SOURCES=(
  "$SERVER_DIR/2025"
  "$SERVER_DIR/2025_nether"
  "$SERVER_DIR/2025_the_end"
  "$SERVER_DIR/plugins"
  "$SERVER_DIR"/*.yml
  "$SERVER_DIR"/*.properties
)

# Логирование
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# Управление автосохранением
mc_cmd() {
  screen -r minecraft -X stuff "$1$(printf '\r')" 2>/dev/null || true
}

save_off() {
  mc_cmd "save-off"
  sleep 4
  mc_cmd "save-all flush"
  sleep 10
}

save_on() {
  mc_cmd "save-on"
  sleep 2
}

# Флаг нужен: trap выставляется до save-off,
# чтобы не вызвать save-on если save-off ещё не отправлялся
SAVE_OFF_DONE=false

on_exit() {
  local exit_code=$?
  if $SAVE_OFF_DONE; then
    save_on
    log "save-on (cleanup)"
  fi
  if [ $exit_code -ne 0 ]; then
    log "=== БЭКАП ЗАВЕРШЁН С ОШИБКОЙ (код $exit_code) ==="
  fi
  echo "" >> "$LOG"
}

trap on_exit EXIT

# Утилита для rsync с разбором кода возврата
run_rsync() {
  local dest="$1"
  shift
  local extra_opts=("$@")

  rsync "${RSYNC_BASE_OPTS[@]}" "${extra_opts[@]}" \
    "${RSYNC_SOURCES[@]}" \
    "${BACKUP_HOST}:${BACKUP_DIR}/${dest}/" >> "$LOG" 2>&1
}

log "=== БЭКАП НАЧАТ ==="

# Находим предыдущий бэкап для --link-dest (hardlink-дедупликация)
PREV_BACKUP=$(ssh -p "$BACKUP_PORT" "$BACKUP_HOST" \
  "ls -1d ${BACKUP_DIR}/daily-* ${BACKUP_DIR}/monthly-* 2>/dev/null | sort -r | head -n 1" \
  2>/dev/null || true)

declare -a HARDLINK_OPT=()
if [ -n "$PREV_BACKUP" ]; then
  PREV_NAME=$(basename "$PREV_BACKUP")
  HARDLINK_OPT=(--link-dest="../${PREV_NAME}")
  log "Hardlink от: $PREV_NAME"
else
  log "Первый бэкап — полный"
fi

# Временно отключаем автосохранение
log "Отключаем автосохранение (save-off / save-all flush)..."
save_off
SAVE_OFF_DONE=true

# Ежедневный бэкап
log "Создаём daily-${DATE}..."
rsync_exit=0
run_rsync "daily-${DATE}" "${HARDLINK_OPT[@]}" || rsync_exit=$?

if [ $rsync_exit -eq 0 ]; then
  log "daily-${DATE} успешно создан"
elif [ $rsync_exit -eq 23 ]; then
  # Код 23 — часть файлов не передана (обычно из-за блокировки JVM). Не фатально.
  log "daily-${DATE} создан (rsync код 23: часть файлов заблокирована — ожидаемо)"
else
  log "ОШИБКА: rsync завершился с кодом $rsync_exit"
  exit $rsync_exit
fi

# Ежемесячный бэкап (только 1-го числа)
if [ "$(date +%d)" -eq 1 ]; then
  log "Создаём monthly-${MONTHLY_DATE} (hardlink от daily-${DATE})..."
  monthly_exit=0
  run_rsync "monthly-${MONTHLY_DATE}" --link-dest="../daily-${DATE}" || monthly_exit=$?

  if [ $monthly_exit -eq 0 ] || [ $monthly_exit -eq 23 ]; then
    log "monthly-${MONTHLY_DATE} успешно создан"
  else
    log "ПРЕДУПРЕЖДЕНИЕ: monthly rsync завершился с кодом $monthly_exit"
  fi
fi

# Включаем автосохранение обратно
log "Включаем автосохранение..."
save_on
SAVE_OFF_DONE=false

# Удаляем старые daily, оставляем 3 последних
log "Удаляем старые daily-бэкапы (оставляем 3)..."
ssh -p "$BACKUP_PORT" "$BACKUP_HOST" \
  "ls -1d ${BACKUP_DIR}/daily-* 2>/dev/null | sort -r | tail -n +4 | xargs -r rm -rf" \
  >> "$LOG" 2>&1 || true

log "=== БЭКАП ЗАВЕРШЁН УСПЕШНО ==="
```

Сохрани и сделай исполняемым:

```bash
chmod +x /home/minecraft/backup.sh
```

---

### Шаг 3: Добавь в cron

Cron должен быть настроен от пользователя `minecraft` — он же владеет screen-сессией сервера. Root не видит чужие screen-сессии.

```bash
su - minecraft
crontab -e
```

Добавь строку:

```
0 5 * * * /home/minecraft/backup.sh
```

Скрипт сам определяет 1-е число и создаёт monthly. Вторая cron-запись не нужна.

---

### Шаг 4: Первый запуск

Первый бэкап полный (~22 ГБ), займёт 10–20 минут:

```bash
su - minecraft
/home/minecraft/backup.sh & tail -f /home/minecraft/backup.log
```

---

## 3. Восстановление из бэкапа

```bash
mkdir -p /home/minecraft/restore-test

rsync -aAXv --info=progress2 \
  -e "ssh -p 23" \
  uXXXXXX@uXXXXXX.your-storagebox.de:minecraft-backups/daily-2026-05-14/ \
  /home/minecraft/restore-test/
```

Затем вручную замени нужные папки в `/home/minecraft/server/`.

---

## 4. Полезные команды

```bash
# Размер всех бэкапов
ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de "du -sh minecraft-backups/*"

# Последние строки лога
tail -n 50 /home/minecraft/backup.log

# Лог в реальном времени
tail -f /home/minecraft/backup.log

# Посмотреть cron текущего пользователя
crontab -l

# Screen-сессии (от кого запущен сервер)
ps aux | grep '[Ss]creen'

# Запустить бэкап вручную
su - minecraft -c "/home/minecraft/backup.sh"
```

---

## 5. Частые проблемы

**"No screen session found"** — скрипт запущен не от того пользователя. Screen-сессия сервера принадлежит `minecraft`, поэтому скрипт всегда должен выполняться от него. Проверить: `ps aux | grep screen`.

**rsync код 23** — часть файлов заблокирована JVM во время бэкапа. Это нормально, скрипт это учитывает и не считает ошибкой.

**Storage Box не принимает обычные команды по SSH** — Storage Box использует ограниченный shell. `echo`, `ls` и другие стандартные команды там не работают напрямую. Это нормально; rsync и `install-ssh-key` работают корректно.
