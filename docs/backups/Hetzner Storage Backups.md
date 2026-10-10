# Бэкапы сервера на Hetzner Storage Box (1 ТБ)

## 1. Схема бэкапа

Используем **borg** (BorgBackup 1.2). С октября 2026 вместо `rsync + hardlinks`.

- Бэкапится: миры `2025`, `2025_nether`, `2025_the_end`, `plugins`, а также `*.yml`, `*.properties`, `*.json` из корня сервера.
- Каждый день в 5:00 МСК создаётся архив `daily-YYYY-MM-DD_HHMM` в репозитории `borg-totemcraft` на Storage Box.
- Borg режет файлы на куски и хранит только новые куски. Поэтому даже 15 ГБ база CoreProtect, которая меняется каждый день, не копируется каждый раз заново. Первая копия: 50 ГБ превратились в 25 ГБ (сжатие lz4).
- Хранится: 7 ежедневных, 4 еженедельных, 6 ежемесячных архивов. Старые удаляет `borg prune` в конце того же скрипта.
- Шифрования нет (`-e none`): хранилище приватное, зато нет риска потерять пароль.
- Скрипт запускается от пользователя `minecraft` — он же владеет screen-сессией сервера. Скрипт: `/home/minecraft/backup.sh`, пример в `system/scripts/backup.sh.example`.

### Почему перешли с rsync

Старый скрипт был сломан двумя способами (из-за этого хранилище заполнилось на 100%, и бэкапы падали с «Disk quota exceeded»):

1. Оболочка Storage Box **не понимает конвейер `|`**. Команды `ls | sort | head` и `ls | tail | xargs rm` там не работали: удаление старых копий не удаляло ничего (накопилось 72 папки), а «предыдущая копия» определялась неверно, и каждая папка сравнивалась с `monthly-2026-07`, храня все изменения с июля.
2. Файл CoreProtect меняется целиком каждый день, hardlink-дедупликация по файлам для него бесполезна.

Из этого правило: **на Storage Box не использовать `|`, `;`, `xargs` в ssh-командах**. Считать на стороне сервера.

### Защита от зависания

- Перед копией выполняется `save-off` + `save-all flush`, после копии `save-on`.
- `borg create` ограничен `timeout 3h`, а `save-on` отправляется и по сигналу выхода скрипта. Раньше зависший rsync оставлял сохранение мира выключенным на сутки: память заполнялась несохранёнными чанками, и сервер падал (случай 9–10 октября 2026).
- Одновременно работает только один бэкап (`flock`).
- Если сервер не запущен, сохранение не трогается.

---

## 2. Первичная настройка

### Шаг 0: Подготовка Storage Box

1. Hetzner Console → Storage Boxes → свой бокс.
2. Включи **SSH-Support** (порт 23).
3. Сбрось пароль (Reset password) и сохрани его — понадобится один раз для ключа.

### Шаг 1: SSH-ключ (от пользователя `minecraft`)

```bash
su - minecraft
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub | ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de install-ssh-key
```

### Шаг 2: Установка borg и репозиторий

На сервере от root:

```bash
apt-get install -y borgbackup
su -s /bin/bash minecraft -c "borg init -e none --remote-path=borg-1.2 ssh://uXXXXXX@uXXXXXX.your-storagebox.de:23/./borg-totemcraft"
```

`--remote-path=borg-1.2` обязателен: на Storage Box borg лежит под этим именем.

### Шаг 3: Скрипт и cron

Скопируй `system/scripts/backup.sh.example` в `/home/minecraft/backup.sh`, замени `uXXXXXX`, затем:

```bash
chmod +x /home/minecraft/backup.sh
su - minecraft -c "crontab -e"
# добавить строку:
0 5 * * * /home/minecraft/backup.sh
```

### Шаг 4: Первый запуск

```bash
su - minecraft -c "/home/minecraft/backup.sh"
tail -f /home/minecraft/backup.log
```

---

## 3. Восстановление из бэкапа

Все команды от пользователя `minecraft`. Задай переменные:

```bash
export BORG_REPO="ssh://uXXXXXX@uXXXXXX.your-storagebox.de:23/./borg-totemcraft"
export BORG_REMOTE_PATH=borg-1.2
```

Список архивов:

```bash
borg list
```

Восстановить в отдельную папку (рабочий сервер не трогается):

```bash
mkdir -p /home/minecraft/restore-test && cd /home/minecraft/restore-test
borg extract --progress ::daily-2026-10-10_0928
# только один мир:
borg extract --progress ::daily-2026-10-10_0928 2025_nether
```

Затем вручную замени нужные папки в `/home/minecraft/server/` при **остановленном** сервере.

---

## 4. Полезные команды

```bash
# Размер репозитория и дедупликация (от minecraft, с переменными выше)
borg info

# Последние строки лога
tail -n 50 /home/minecraft/backup.log

# Лог в реальном времени
tail -f /home/minecraft/backup.log

# Свободное место на Storage Box
su - minecraft -c "ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de df -h"

# Запустить бэкап вручную
su - minecraft -c "/home/minecraft/backup.sh"

# Проверить целостность репозитория (долго, не во время бэкапа)
borg check
```

---

## 5. Частые проблемы

**«Disk quota exceeded»** — Storage Box заполнен. Проверь `df -h` выше. `borg prune`/`borg compact` в скрипте освобождают место, но если уже 100%, сначала освободи место вручную и запусти бэкап заново.

**`Repository ... is already locked`** — предыдущий borg был прерван. Если других borg-процессов нет (`pgrep -a borg`), снять замок: `borg break-lock`.

**borg код возврата 1** — предупреждение (файл менялся, пока читался). Для живого мира нормально, скрипт это учитывает.

**borg код 2** — ошибка. Смотри конец `backup.log`. Скрипт всё равно включит `save-on`.

**«No screen session found» в логе** — скрипт запущен не от пользователя `minecraft` (screen-сессия сервера принадлежит ему).

**Старые rsync-копии** — `monthly-2026-06`, `monthly-2026-07` и `daily-2026-10-08` в `totemcraft-backups/` оставлены как резерв. Когда borg накопит несколько недель архивов, их можно удалить с хранилища.
