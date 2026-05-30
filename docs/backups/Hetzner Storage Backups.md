# Бэкапы Minecraft-сервера TotemCraft на Hetzner Storage Box (1 ТБ)

## 1. Схема бэкапа

Используем `rsync + hardlinks`.

**Как это работает:**

- Бэкапится весь сервер: мир, плагины, конфиги.
- Каждый день в 5:00 МСК создаётся папка `daily-YYYY-MM-DD`.
- Благодаря `--link-dest` почти все файлы **не копируются заново**, а ссылаются (hardlinks) на предыдущий бэкап. Ежедневный бэкап занимает **очень мало** дополнительного места (обычно 100–800 МБ вместо 22+ ГБ).
- Хранятся **3 последних ежедневных** бэкапа - старые удаляются автоматически.
- 1-го числа каждого месяца создаётся **вечный** `monthly-YYYY-MM`, который никогда не удаляется автоматически.

---

## 2. Пошаговая настройка

### Шаг 0: Подготовка Storage Box

1. Зайди в Hetzner Console → Storage Boxes → свой бокс.
2. Включи **SSH-Support** (порт 23).
3. Сбрось пароль (Reset password) и сохрани его.

---

### Шаг 1: Настройка SSH-ключа

Выполняй **все команды от пользователя `minecraft`**.

```bash
# Права на папку
sudo chown -R minecraft:minecraft /home/minecraft
sudo chmod 755 /home/minecraft

# Настройка .ssh
sudo mkdir -p /home/minecraft/.ssh
sudo chown -R minecraft:minecraft /home/minecraft/.ssh
sudo chmod 700 /home/minecraft/.ssh

# Переключись на пользователя minecraft
su - minecraft

# Генерация ключа
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# Отправь ключ на Storage Box (введи пароль от бокса один раз)
cat ~/.ssh/id_ed25519.pub | ssh -p 23 uВАШ_ЛОГИН@uВАШ_ЛОГИН.your-storagebox.de install-ssh-key
```

Проверь вход без пароля:

```bash
ssh -p 23 uВАШ_ЛОГИН@uВАШ_ЛОГИН.your-storagebox.de
exit
```

---

### Шаг 2: Создай скрипт бэкапа

```bash
nano /home/minecraft/backup.sh
```

Вставь весь этот код:

```bash
#!/bin/bash
# =============================================
# Скрипт бэкапов TotemCraft v2.1
# =============================================

SERVER_DIR="/home/minecraft/server"
BACKUP_HOST="uВАШ_ЛОГИН@uВАШ_ЛОГИН.your-storagebox.de"
BACKUP_PORT=23
BACKUP_DIR="totemcraft-backups"
LOG="/home/minecraft/backup.log"
DATE=$(date +%Y-%m-%d)
MONTHLY_DATE=$(date +%Y-%m)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

log "=== БЭКАП НАЧАТ ==="

# Гарантируем save-on даже при ошибке
trap 'screen -r minecraft -X stuff "save-on\n" 2>/dev/null || true; log "-> save-on (trap)"; log "=== БЭКАП ЗАВЕРШЁН С ОШИБКОЙ ==="; echo "" >> "$LOG"' ERR EXIT

# Останавливаем автосохранение
log "-> Останавливаем автосохранение..."
screen -r minecraft -X stuff "save-off\n" 2>/dev/null \
  || log "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить save-off"
sleep 3
screen -r minecraft -X stuff "save-all flush\n" 2>/dev/null \
  || log "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить save-all"
sleep 8

# Находим самый свежий предыдущий бэкап для hardlink
PREV_BACKUP=$(ssh -p "$BACKUP_PORT" "$BACKUP_HOST" \
  "ls -1d ${BACKUP_DIR}/daily-* ${BACKUP_DIR}/monthly-* 2>/dev/null | sort -r | head -n 1" \
  2>/dev/null || echo "")

RSYNC_OPTS=(-aAX --delete --stats -e "ssh -p ${BACKUP_PORT}")

if [ -n "$PREV_BACKUP" ]; then
  PREV_NAME=$(basename "$PREV_BACKUP")
  RSYNC_OPTS+=(--link-dest="../${PREV_NAME}")
  log "-> Используем hardlink от: $PREV_NAME"
else
  log "-> Первый бэкап - полный"
fi

RSYNC_SOURCES=(
  "$SERVER_DIR/2025"
  "$SERVER_DIR/2025_nether"
  "$SERVER_DIR/2025_the_end"
  "$SERVER_DIR/plugins"
  "$SERVER_DIR"/*.yml
  "$SERVER_DIR"/*.properties
)

# Ежедневный бэкап
log "-> Создаём daily-${DATE}..."
if rsync "${RSYNC_OPTS[@]}" "${RSYNC_SOURCES[@]}" \
    "${BACKUP_HOST}:${BACKUP_DIR}/daily-${DATE}/" >> "$LOG" 2>&1; then
  log "-> daily-${DATE} успешно создан"
else
  log "ОШИБКА: rsync (daily) завершился с кодом $?"
  exit 1
fi

# Ежемесячный вечный бэкап (1-го числа)
if [ "$(date +%d)" -eq 1 ]; then
  log "-> Создаём monthly-${MONTHLY_DATE}..."
  if rsync -aAX --delete --stats \
      -e "ssh -p ${BACKUP_PORT}" \
      --link-dest="../daily-${DATE}" \
      "${RSYNC_SOURCES[@]}" \
      "${BACKUP_HOST}:${BACKUP_DIR}/monthly-${MONTHLY_DATE}/" >> "$LOG" 2>&1; then
    log "-> monthly-${MONTHLY_DATE} создан"
  else
    log "ПРЕДУПРЕЖДЕНИЕ: rsync (monthly) завершился с ошибкой - продолжаем"
  fi
fi

# Включаем автосохранение
screen -r minecraft -X stuff "save-on\n" 2>/dev/null \
  || log "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить save-on"
log "-> Автосохранение включено"

# Чистим старые daily - оставляем 3 последних
log "-> Чистим старые daily (оставляем 3 последних)..."
ssh -p "$BACKUP_PORT" "$BACKUP_HOST" \
  "ls -1d ${BACKUP_DIR}/daily-* 2>/dev/null | sort -r | tail -n +4 | xargs -r rm -rf" \
  >> "$LOG" 2>&1 \
  && log "-> Очистка завершена" \
  || log "ПРЕДУПРЕЖДЕНИЕ: очистка завершилась с ошибкой"

trap - ERR EXIT

log "=== БЭКАП ЗАВЕРШЁН УСПЕШНО ==="
echo "" >> "$LOG"
```

Сохрани (Ctrl+O, Enter, Ctrl+X) и сделай исполняемым:

```bash
chmod +x /home/minecraft/backup.sh
```

---

### Шаг 3: Добавь в cron

```bash
crontab -e
```

Добавь одну строку:

```
0 5 * * * /home/minecraft/backup.sh
```

Скрипт сам определяет 1-е число и создаёт monthly. Вторая cron-запись не нужна.

---

### Шаг 4: Первый запуск

```bash
su - minecraft
screen -S backup
/home/minecraft/backup.sh & tail -f /home/minecraft/backup.log
```

Первый бэкап - полный (~22 ГБ), займёт 10–20 минут. Можно отсоединиться от screen: Ctrl+A → D.

---

## 3. Восстановление из бэкапа

```bash
mkdir -p /home/minecraft/restore-test

rsync -aAXv --info=progress2 \
  -e "ssh -p 23" \
  uВАШ_ЛОГИН@uВАШ_ЛОГИН.your-storagebox.de:totemcraft-backups/daily-2026-05-14/ \
  /home/minecraft/restore-test/
```

Затем вручную замени нужные папки в `/home/minecraft/server/`.

---

## 4. Полезные команды

```bash
# Размер всех бэкапов
ssh -p 23 uВАШ_ЛОГИН@uВАШ_ЛОГИН.your-storagebox.de "du -sh totemcraft-backups/* | sort -hr"

# Последние строки лога
tail -n 50 /home/minecraft/backup.log

# Лог в реальном времени
tail -f /home/minecraft/backup.log

# Посмотреть cron
crontab -l

# Запустить бэкап вручную
/home/minecraft/backup.sh
```
