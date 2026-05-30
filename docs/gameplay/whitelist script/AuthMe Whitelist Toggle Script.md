# Скрипт на автовключение реги AuthMe

# Авто-переключение регистрации AuthMe по расписанию

**Проект:** TotemCraft  
**Версия:** 2.4  
**Статус:** Production

---

# Текущий статус - отключен на сервере путем закомментирования строк в cron

## Что делает

Автоматически переключает два параметра в `plugins/AuthMe/config.yml` по расписанию через cron, после чего выполняет `/authme reload` в консоли сервера и отправляет уведомление сразу в **два канала Discord** через вебхуки.

**Что меняется при каждом переключении:**

|Параметр|Вайтлист ВЫКЛЮЧЕН (`on`)|Вайтлист АКТИВИРОВАН (`off`)|
|---|---|---|
|`registration.enabled`|`true`|`false`|
|`kickNonRegistered`|`false`|`true`|

**Расписание (МСК):**

|День|Открывается|Закрывается|
|---|---|---|
|Пн–Пт|08:00|22:00|
|Суббота|-|закрыто весь день|
|Воскресенье|10:00|00:00 (пн)|

---

## Пути к файлам

|Файл|Путь|
|---|---|
|Скрипт|`/home/minecraft/server/toggle-authme.sh`|
|Лог|`/home/minecraft/server/toggle-authme.log`|
|Конфиг AuthMe|`/home/minecraft/server/plugins/AuthMe/config.yml`|

---

## ШАГ 1 - Установка pytz

```bash
pip3 install pytz --break-system-packages

# Проверка
python3 -c "import pytz; print('OK')"
```

---

## ШАГ 2 - Скрипт

Зайди на сервер под пользователем `minecraft`:

```bash
su - minecraft
nano /home/minecraft/server/toggle-authme.sh
```

Вставь весь код ниже. Перед вставкой замени `WEBHOOK_MAIN` и `WEBHOOK_SECOND` на актуальные вебхуки нового сервера:

```bash
#!/bin/bash
# =============================================================================
# toggle-authme.sh - TotemCraft v2.4
# Включает/выключает registration.enabled и kickNonRegistered в AuthMe config.yml
# Использование: ./toggle-authme.sh on|off
#
#   on  → registration.enabled: true   + kickNonRegistered: false  (вайтлист ВЫКЛЮЧЕН)
#   off → registration.enabled: false  + kickNonRegistered: true   (вайтлист АКТИВИРОВАН)
# =============================================================================

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONFIG="/home/minecraft/server/plugins/AuthMe/config.yml"
SCREEN_NAME="minecraft"
LOG="/home/minecraft/server/toggle-authme.log"
WEBHOOK_MAIN="https://discord.com/api/webhooks/ЗАМЕНИ_ЭТО"
WEBHOOK_SECOND="https://discord.com/api/webhooks/ЗАМЕНИ_ЭТО"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

next_event() {
    python3 - <<'PYEOF'
from datetime import datetime, timedelta
import pytz

tz = pytz.timezone("Europe/Moscow")
now = datetime.now(tz)
days_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

events = []
for delta in range(15):
    d = now.date() + timedelta(days=delta)
    wd = d.weekday()
    if wd < 5:
        slots = [(8, 0, "on"), (22, 0, "off")]
    elif wd == 6:
        slots = [(10, 0, "on"), (0, 0, "off")]
    else:
        slots = []
    for h, m, action in slots:
        actual_d = d
        if wd == 6 and h == 0 and action == "off":
            actual_d = d + timedelta(days=1)
        dt = tz.localize(datetime(actual_d.year, actual_d.month, actual_d.day, h, m))
        if dt > now:
            events.append((dt, action))

events.sort()
if events:
    next_dt, next_action = events[0]
    label = "открытие" if next_action == "on" else "закрытие"
    day_name = days_ru[next_dt.weekday()]
    print(f"{label}|{day_name} {next_dt.strftime('%d.%m %H:%M')} МСК")
else:
    print("неизвестно|-")
PYEOF
}

send_webhook() {
    local URL="$1"
    local PAYLOAD="$2"
    curl -s -o /dev/null -X POST "$URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD"
    return $?
}

find_screen_session() {
    local name="$1"
    screen -list 2>/dev/null | grep -oP '\d+\.'"$name"'(?=\s)' | head -1
}

send_to_screen() {
    local SESSION="$1"
    local CMD="$2"
    screen -S "$SESSION" -p 0 -X stuff "${CMD}"$'\r'
}

# -----------------------------------------------------------------------------
if [ "$1" = "on" ]; then
    REG_STATE="true"
    KICK_STATE="false"
    LABEL="ВЫКЛЮЧЕН"
    EMOJI="🟢"
    DESCRIPTION="Свободный вход на сервер **разрешен**. Новые игроки могут подключиться и самостоятельно зарегистрировать аккаунт непосредственно на сервере."
elif [ "$1" = "off" ]; then
    REG_STATE="false"
    KICK_STATE="true"
    LABEL="АКТИВИРОВАН"
    EMOJI="🔴"
    DESCRIPTION="Свободный вход на сервер **закрыт**. Новые игроки не могут подключиться. Доступ к серверу осуществляется через заявку в Телеграм-боте @TotemCraft_playbot"
else
    echo "Использование: $0 on|off"
    exit 1
fi

log "=== Переключаем регистрацию → Вайтлист $LABEL ==="
log "    registration.enabled  → $REG_STATE"
log "    kickNonRegistered      → $KICK_STATE"

# --- 1. Проверяем конфиг ---
if [ ! -f "$CONFIG" ]; then
    log "ОШИБКА: config.yml не найден по пути $CONFIG"
    exit 1
fi
log "✅ config.yml найден"

# --- 2. Бэкап ---
cp "$CONFIG" "${CONFIG}.bak"
log "✅ Бэкап создан: ${CONFIG}.bak"

# --- 3. Замена через python3 ---
PY_RESULT=$(python3 - "$CONFIG" "$REG_STATE" "$KICK_STATE" <<'PYEOF'
import sys, re

config_path = sys.argv[1]
reg_want    = sys.argv[2]
kick_want   = sys.argv[3]

with open(config_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

reg_line_idx        = None
kick_line_idx       = None
in_reg_block        = False
registration_indent = None
enabled_done        = False

for i, line in enumerate(lines):
    stripped = line.lstrip()

    if re.match(r'[ \t]*kickNonRegistered\s*:', line):
        kick_line_idx = i
        continue

    if re.match(r'[ \t]*registration\s*:', line) and not in_reg_block:
        in_reg_block        = True
        registration_indent = len(line) - len(stripped)
        enabled_done        = False
        continue

    if in_reg_block:
        current_indent = len(line) - len(line.lstrip())
        if stripped and current_indent <= registration_indent:
            in_reg_block = False
        elif not enabled_done and re.match(r'[ \t]*enabled\s*:', line):
            reg_line_idx = i
            enabled_done = True

if reg_line_idx is None:
    print("ERROR: registration.enabled не найден в config.yml", file=sys.stderr)
    sys.exit(2)
if kick_line_idx is None:
    print("ERROR: kickNonRegistered не найден в config.yml", file=sys.stderr)
    sys.exit(2)

m_reg  = re.search(r'enabled\s*:\s*(true|false)',           lines[reg_line_idx])
m_kick = re.search(r'kickNonRegistered\s*:\s*(true|false)', lines[kick_line_idx])

if not m_reg:
    print("ERROR: не удалось прочитать значение enabled:", file=sys.stderr)
    sys.exit(2)
if not m_kick:
    print("ERROR: не удалось прочитать значение kickNonRegistered:", file=sys.stderr)
    sys.exit(2)

reg_current  = m_reg.group(1)
kick_current = m_kick.group(1)

changed = False

if reg_current != reg_want:
    lines[reg_line_idx] = re.sub(
        r'([ \t]*enabled\s*:\s*)(?:true|false)',
        r'\g<1>' + reg_want,
        lines[reg_line_idx]
    )
    changed = True

if kick_current != kick_want:
    lines[kick_line_idx] = re.sub(
        r'([ \t]*kickNonRegistered\s*:\s*)(?:true|false)',
        r'\g<1>' + kick_want,
        lines[kick_line_idx]
    )
    changed = True

if changed:
    with open(config_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("OK")
else:
    print("ALREADY_OK")
PYEOF
)

PY_EXIT=$?

if [ $PY_EXIT -ne 0 ]; then
    log "ОШИБКА: python3 не смог обновить config.yml. Восстанавливаем бэкап..."
    cp "${CONFIG}.bak" "$CONFIG"
    exit 1
fi

if [ "$PY_RESULT" = "ALREADY_OK" ]; then
    log "ℹ️  Оба параметра уже стоят в нужном значении - файл не изменялся"
elif [ "$PY_RESULT" = "OK" ]; then
    log "✅ config.yml обновлён"
else
    log "ОШИБКА: неожиданный ответ от python3: $PY_RESULT. Восстанавливаем бэкап..."
    cp "${CONFIG}.bak" "$CONFIG"
    exit 1
fi

# --- 4. Независимая проверка ---
VERIFY_REG=$(grep -A 20 "registration:" "$CONFIG" | grep -m1 "^\s*enabled:")
VERIFY_KICK=$(grep -m1 "kickNonRegistered:" "$CONFIG")

log "Проверка registration.enabled:  $VERIFY_REG"
log "Проверка kickNonRegistered:      $VERIFY_KICK"

REG_OK=0
KICK_OK=0
echo "$VERIFY_REG"  | grep -q "enabled: $REG_STATE"           && REG_OK=1
echo "$VERIFY_KICK" | grep -q "kickNonRegistered: $KICK_STATE" && KICK_OK=1

if [ $REG_OK -eq 1 ] && [ $KICK_OK -eq 1 ]; then
    log "✅ Проверка пройдена - оба параметра выставлены корректно"
else
    [ $REG_OK -eq 0 ]  && log "ОШИБКА: registration.enabled не соответствует ожидаемому '$REG_STATE'!"
    [ $KICK_OK -eq 0 ] && log "ОШИБКА: kickNonRegistered не соответствует ожидаемому '$KICK_STATE'!"
    log "Восстанавливаем бэкап..."
    cp "${CONFIG}.bak" "$CONFIG"
    exit 1
fi

# --- 5. authme reload в screen ---
log "Ищем screen-сессию с именем '$SCREEN_NAME'..."
log "Список сессий: $(screen -list 2>/dev/null | tr '\n' ' ')"

SCREEN_SESSION=$(find_screen_session "$SCREEN_NAME")

if [ -n "$SCREEN_SESSION" ]; then
    log "✅ Найдена screen-сессия: $SCREEN_SESSION"
    send_to_screen "$SCREEN_SESSION" "authme reload"
    SEND_EXIT=$?
    if [ $SEND_EXIT -eq 0 ]; then
        log "✅ Команда 'authme reload' отправлена в screen '$SCREEN_SESSION'"
    else
        log "ПРЕДУПРЕЖДЕНИЕ: screen вернул код $SEND_EXIT при отправке команды"
    fi
else
    log "ПРЕДУПРЕЖДЕНИЕ: сессия '$SCREEN_NAME' не найдена. Пробуем fallback..."
    FALLBACK=$(screen -list 2>/dev/null | grep "$SCREEN_NAME" | awk '{print $1}' | head -1)
    if [ -n "$FALLBACK" ]; then
        log "Найдена сессия через fallback: $FALLBACK"
        send_to_screen "$FALLBACK" "authme reload"
        log "✅ Команда 'authme reload' отправлена в screen '$FALLBACK'"
    else
        log "ПРЕДУПРЕЖДЕНИЕ: screen-сессия '$SCREEN_NAME' не найдена. Перезагрузи вручную: /authme reload"
    fi
fi

# --- 6. Discord ---
NOW_MSK=$(TZ="Europe/Moscow" date '+%d.%m.%Y %H:%M')
NEXT_RAW=$(next_event)
NEXT_LABEL=$(echo "$NEXT_RAW" | cut -d'|' -f1)
NEXT_TIME=$(echo "$NEXT_RAW" | cut -d'|' -f2)

PAYLOAD="{
    \"embeds\": [{
      \"title\": \"$EMOJI Вайтлист $LABEL\",
      \"description\": \"$DESCRIPTION\",
      \"color\": 16777215,
      \"fields\": [
        {\"name\": \"🕐 Текущее время (МСК)\", \"value\": \"$NOW_MSK\", \"inline\": true},
        {\"name\": \"⏭ Следующее $NEXT_LABEL\", \"value\": \"$NEXT_TIME\", \"inline\": true}
      ],
      \"footer\": {\"text\": \"TotemCraft • play.totemcraft.net\"}
    }]
  }"

send_webhook "$WEBHOOK_MAIN" "$PAYLOAD"
if [ $? -eq 0 ]; then
    log "✅ Discord уведомление отправлено (основной канал)"
else
    log "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить уведомление в основной канал"
fi

send_webhook "$WEBHOOK_SECOND" "$PAYLOAD"
if [ $? -eq 0 ]; then
    log "✅ Discord уведомление отправлено (второй канал)"
else
    log "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить уведомление во второй канал"
fi

log "=== Готово. Вайтлист: $LABEL ==="
```

Сохрани: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## ШАГ 3 - Права и тест

```bash
chmod +x /home/minecraft/server/toggle-authme.sh

cd /home/minecraft/server

# Тест - включить вайтлист
./toggle-authme.sh off

# Тест - выключить вайтлист
./toggle-authme.sh on

# Смотрим лог
tail -30 /home/minecraft/server/toggle-authme.log
```

В логе должно быть:

```
✅ config.yml найден
✅ Бэкап создан
✅ config.yml обновлён
✅ Проверка пройдена - оба параметра выставлены корректно
✅ Команда 'authme reload' отправлена
✅ Discord уведомление отправлено (основной канал)
✅ Discord уведомление отправлено (второй канал)
```

Строк `ОШИБКА` быть не должно.

Проверь конфиг вручную:

```bash
grep "kickNonRegistered:" /home/minecraft/server/plugins/AuthMe/config.yml
grep -A 20 "registration:" /home/minecraft/server/plugins/AuthMe/config.yml | grep -m1 "enabled:"
```

---

## ШАГ 4 - Cron

```bash
crontab -e
```

Добавь в конец:

```cron
# === TotemCraft - авто-режим регистрации AuthMe ===
# Пн–Пт: открыто 08:00–22:00
0  8 * * 1-5 /home/minecraft/server/toggle-authme.sh on
0 22 * * 1-5 /home/minecraft/server/toggle-authme.sh off
# Воскресенье: открыто 10:00–00:00
0 10 * * 0   /home/minecraft/server/toggle-authme.sh on
0  0 * * 1   /home/minecraft/server/toggle-authme.sh off
```

> **Про полночь воскресенья:** закрытие в 00:00 воскресенья - это уже начало понедельника, поэтому строка стоит на `* * 1`.

Сохрани: `Ctrl+O` → `Enter` → `Ctrl+X`

Проверь что cron от правильного пользователя:

```bash
# Должен быть залогинен minecraft, не root
whoami

# Проверить что cron записан
crontab -l
```

> **Важно:** cron работает по системному времени сервера. Убедись что стоит МСК:
> 
> ```bash
> timedatectl
> # Должно быть: Time zone: Europe/Moscow
> # Если нет:
> sudo timedatectl set-timezone Europe/Moscow
> ```

---

## ШАГ 5 - Финальная проверка

```bash
# Расписание cron
crontab -l

# Лог последних запусков
tail -30 /home/minecraft/server/toggle-authme.log

# Текущие значения в конфиге
grep -A 20 "registration:" /home/minecraft/server/plugins/AuthMe/config.yml | grep -m1 "enabled:"
grep "kickNonRegistered:" /home/minecraft/server/plugins/AuthMe/config.yml

# Screen-сессии (убедись что имя совпадает с SCREEN_NAME в скрипте)
screen -list
```

---

## Переменные для нового сервера

При установке на новый сервер замени в начале скрипта:

```bash
CONFIG="/home/minecraft/server/plugins/AuthMe/config.yml"  # путь к конфигу AuthMe
SCREEN_NAME="minecraft"                                      # имя screen-сессии (screen -list)
LOG="/home/minecraft/server/toggle-authme.log"              # путь к лог-файлу
WEBHOOK_MAIN="https://discord.com/api/webhooks/..."         # основной Discord-канал
WEBHOOK_SECOND="https://discord.com/api/webhooks/..."       # второй Discord-канал
```

---

## Ручное управление

```bash
# Открыть регистрацию (выключить вайтлист)
/home/minecraft/server/toggle-authme.sh on

# Закрыть регистрацию (включить вайтлист)
/home/minecraft/server/toggle-authme.sh off
```

Скрипт идемпотентен - можно запускать сколько угодно раз подряд с одним и тем же аргументом, ничего не сломается. Если значения уже правильные - просто напишет `ℹ️ Оба параметра уже стоят в нужном значении` и продолжит.

Также не важно менял ли ты конфиг вручную перед запуском скрипта - скрипт всегда читает **текущие** значения из файла и приводит их к нужным.

---

## Диагностика

Если что-то пошло не так - смотри лог:

```bash
tail -50 /home/minecraft/server/toggle-authme.log
```

**`ОШИБКА: registration.enabled не найден в config.yml`**

Скрипт не нашёл блок `registration:` или внутри него нет `enabled:`. Проверь структуру конфига:

```bash
grep -n "registration:" /home/minecraft/server/plugins/AuthMe/config.yml
grep -n "enabled:" /home/minecraft/server/plugins/AuthMe/config.yml
```

**`ОШИБКА: kickNonRegistered не найден в config.yml`**

```bash
grep -n "kickNonRegistered" /home/minecraft/server/plugins/AuthMe/config.yml
```

**`ПРЕДУПРЕЖДЕНИЕ: screen-сессия не найдена`**

Конфиг изменён корректно, но команда `authme reload` не отправлена. Зайди в консоль сервера и выполни вручную:

```
authme reload
```

Чтобы починить постоянно: проверь имя сессии и обнови `SCREEN_NAME` в скрипте:

```bash
screen -list
# Пример вывода: 12345.minecraft
# SCREEN_NAME должен быть "minecraft"
```

**`cron` не срабатывает:**

Убедись что cron прописан от пользователя `minecraft`, а не от `root`:

```bash
su - minecraft
crontab -l
```

---

## Как работает скрипт

1. Создаёт бэкап `config.yml.bak` перед любым изменением
2. Python построчно читает конфиг, находит точные позиции `registration.enabled` (по входу в блок `registration:` с отслеживанием отступов) и `kickNonRegistered` (по уникальному ключу)
3. Читает текущие значения обоих параметров
4. Меняет только те параметры, которые отличаются от нужных - если оба уже правильные, файл не трогается
5. После записи независимо проверяет результат через grep - если значения не совпадают, откатывает бэкап
6. Отправляет `authme reload` в screen-сессию через carriage return (`\r`) - именно так Minecraft-консоль воспринимает Enter
7. Отправляет embed-уведомление в два канала Discord с текущим временем МСК и временем следующего события по расписанию

---

# Шпаргалка по командам терминала скрипта

# TotemCraft - управление вайтлистом

## Открыть сервер (выключить вайтлист)

> Новые игроки могут заходить и регистрироваться

```bash
/home/minecraft/server/toggle-authme.sh on
```

---

## Закрыть сервер (включить вайтлист)

> Новые игроки не могут зайти

```bash
/home/minecraft/server/toggle-authme.sh off
```

---

## Посмотреть что сейчас стоит в конфиге

```bash
grep "kickNonRegistered:" /home/minecraft/server/plugins/AuthMe/config.yml
grep -A 20 "registration:" /home/minecraft/server/plugins/AuthMe/config.yml | grep -m1 "enabled:"
```

---

## Посмотреть лог последних запусков

```bash
tail -30 /home/minecraft/server/toggle-authme.log
```

---

## Что означают строки в логе

|Строка|Что значит|
|---|---|
|`✅ config.yml обновлён`|Файл изменён, всё ок|
|`ℹ️ Оба параметра уже стоят в нужном значении`|Значения уже были правильными, файл не трогался|
|`✅ Проверка пройдена`|Проверка после записи прошла успешно|
|`✅ Команда 'authme reload' отправлена`|Сервер перезагрузил конфиг AuthMe|
|`ОШИБКА: ...`|Что-то пошло не так, бэкап восстановлен автоматически|
|`ПРЕДУПРЕЖДЕНИЕ: screen-сессия не найдена`|Конфиг изменён, но `/authme reload` не отправлен - сделай вручную|

---

## Если authme reload не отправился - сделай вручную

Зайди в консоль сервера и введи:

```
authme reload
```

