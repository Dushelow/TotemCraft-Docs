# Telegram-бот для вайтлиста Minecraft-сервера: приём заявок, тикеты, Discord-уведомления

Telegram-бота берёт на себя весь процесс: приём заявки, хранение данных, уведомление в Discord, диалог с игроком и выдачу доступа одной кнопкой.

---

## Что умеет бот

**Со стороны игрока:**
- Подать заявку на вступление (ник, пароль для authme, комментарий)
- Получить уведомление об одобрении или отклонении
- Написать в поддержку - открыть тикет и общаться с администратором в чате бота

**Со стороны администратора:**
- Видеть все входящие заявки прямо в Telegram
- Одобрить или отклонить заявку в один клик с опциональным комментарием
- При одобрении - автоматически выполнить `authme register <ник> <пароль>` через Discord-вебхук консоли сервера
- Вести диалог с игроком через тикет-систему
- Блокировать пользователей
- Ставить регистрацию на паузу
- Искать игрока по нику
- Смотреть статистику заявок

**Автоматически:**
- Уведомления о новых заявках, решениях и блокировках летят в Discord
- Каждое утро в 08:00 по Москве - напоминание если есть необработанные заявки
- Защита от спама: не более 5 сообщений за 5 секунд, затем кулдаун

---

## Стек и зависимости

- **Python 3.10+**
- `pyTelegramBotAPI` - работа с Telegram Bot API
- `requests` - отправка вебхуков в Discord
- `pytz` + `schedule` - планировщик ежедневных напоминаний
- `python-dotenv` - загрузка секретов из `.env` файла

Хранилище - обычные JSON-файлы и один CSV. Никаких баз данных, всё просто и прозрачно.

---

## Архитектура за одну минуту

```
Игрок
  │ пишет в Telegram-бот
  ▼
bot.py (polling)
  ├── сохраняет заявку в pending.json
  ├── отправляет карточку администратору
  └── шлёт embed в Discord (webhook)

Администратор
  │ нажимает «Одобрить» / «Отклонить»
  ▼
bot.py
  ├── пишет результат в approved_applications.csv
  ├── отправляет authme-команду в консоль сервера (Discord webhook)
  ├── уведомляет игрока в Telegram
  └── шлёт статус в Discord
```

---

## Подготовка: получить токены и ID

### 1. Токен Telegram-бота

Открой [@BotFather](https://t.me/BotFather) в Telegram:

```
/newbot
```

Введи имя и username бота. BotFather выдаст токен вида:

```
1234567890:AABBCCDDEEFFaabbccddeeff1234567890
```

Сохрани его - это `BOT_TOKEN`.

### 2. Свой Telegram ID (ADMIN_ID)

Напиши [@userinfobot](https://t.me/userinfobot) - он ответит твоим числовым ID. Запиши его.

### 3. Discord Webhook для уведомлений о заявках

В нужном канале Discord: **Настройки канала → Интеграции → Вебхуки → Создать вебхук**.  
Скопируй URL вебхука.

### 4. Discord Webhook для консоли сервера

Если используешь authme и хочешь автоматической регистрации - создай второй вебхук в канале, который читает консоль сервера (например, через плагин DiscordSRV или аналог). Если не используешь authme - этот вебхук можно оставить пустым.

---

## Шаг 1 - Подготовка сервера

Подойдёт любой VPS с Ubuntu 22.04 или 24.04. Минимальные требования: 1 vCPU, 512 MB RAM.

Подключись по SSH от `root` и выполни:

```bash
# Обновить систему, установить Python
apt update && apt install -y python3 python3-venv python3-pip

# Создать отдельного пользователя для бота (хорошая практика)
adduser --disabled-password --gecos "" totembot

# Переключиться на него
su - totembot

# Создать рабочую папку и виртуальное окружение
mkdir -p ~/totemcraft_bot && cd ~/totemcraft_bot
python3 -m venv venv
source venv/bin/activate

# Установить зависимости
pip install pyTelegramBotAPI requests pytz schedule python-dotenv
```

---

## Шаг 2 - Загрузить код бота

Положи `bot.py` в папку `/home/totembot/totemcraft_bot/`.

Можно через `nano`:
```bash
nano bot.py
# вставить код, Ctrl+O → Enter → Ctrl+X
```

Или загрузить с локальной машины через `scp`:
```bash
# выполнять на локальной машине
scp bot.py totembot@<IP_СЕРВЕРА>:/home/totembot/totemcraft_bot/bot.py
```

---

## Шаг 3 - Создать файл `.env`

Все секреты хранятся отдельно от кода. Это позволяет безопасно публиковать `bot.py` и хранить его в репозитории.

```bash
nano /home/totembot/totemcraft_bot/.env
```

Вставить и заполнить своими значениями:

```env
BOT_TOKEN=сюда_токен_от_BotFather
ADMIN_ID=сюда_свой_числовой_telegram_id
DISCORD_WEBHOOK_URL=сюда_вебхук_для_уведомлений_о_заявках
CONSOLE_WEBHOOK_URL=сюда_вебхук_для_консоли_сервера
```

Закрыть доступ к файлу для посторонних:

```bash
chmod 600 /home/totembot/totemcraft_bot/.env
```

---

## Шаг 4 - Автозапуск через systemd

Выйди из пользователя `totembot` (или открой новую SSH-сессию от root):

```bash
exit
```

Создай файл сервиса:

```bash
nano /etc/systemd/system/totemcraftbot.service
```

Вставить:

```ini
[Unit]
Description=TotemCraft Telegram Bot
After=network.target

[Service]
User=totembot
WorkingDirectory=/home/totembot/totemcraft_bot
EnvironmentFile=/home/totembot/totemcraft_bot/.env
ExecStart=/home/totembot/totemcraft_bot/venv/bin/python /home/totembot/totemcraft_bot/bot.py
Restart=always
RestartSec=5
Nice=10

[Install]
WantedBy=multi-user.target
```

Строка `EnvironmentFile` говорит systemd передать содержимое `.env` в окружение процесса - бот читает их через `os.environ`. Токены в код не попадают.

Применить и запустить:

```bash
systemctl daemon-reload
systemctl enable --now totemcraftbot
systemctl status totemcraftbot
```

Если видишь `active (running)` и в логах `✅ TotemCraftBot запущен` - всё работает.

---

## Файлы, которые создаёт бот

Все файлы появляются автоматически при первом запуске в папке `/home/totembot/totemcraft_bot/`:

| Файл | Что хранится |
|---|---|
| `approved_applications.csv` | Все обработанные заявки - открывается в Excel и Google Таблицах |
| `pending.json` | Текущие необработанные заявки |
| `bot_config.json` | Конфиг (например, статус паузы регистрации) |
| `chat_history.json` | История диалогов (последние 20 сообщений на пользователя) |
| `tickets.json` | Тикеты поддержки |
| `blocked_users.json` | Заблокированные Telegram ID |
| `bot_errors.log` | Лог ошибок |

---

## Полезные команды

```bash
# Логи в реальном времени
journalctl -u totemcraftbot -f

# Перезапуск (после обновления кода или .env)
systemctl restart totemcraftbot

# Остановить
systemctl stop totemcraftbot

# Статус
systemctl status totemcraftbot
```

---

## Перенос на другой сервер

1. Выполни Шаги 1–4 на новом сервере.
2. Скопируй данные и `.env` со старого:

```bash
# Выполнять на старом сервере
scp /home/totembot/totemcraft_bot/.env \
    /home/totembot/totemcraft_bot/*.json \
    /home/totembot/totemcraft_bot/*.csv \
    totembot@<НОВЫЙ_IP>:/home/totembot/totemcraft_bot/
```

3. Перезапустить сервис на новом сервере:

```bash
systemctl restart totemcraftbot
```

---

## Если что-то пошло не так

```bash
# Последние 50 строк лога
journalctl -u totemcraftbot -n 50 --no-pager

# Лог ошибок самого бота
cat /home/totembot/totemcraft_bot/bot_errors.log
```

| Ошибка | Причина и решение |
|---|---|
| `Переменная окружения 'BOT_TOKEN' не задана` | Нет файла `.env` или нет строки `EnvironmentFile` в сервисе |
| `ModuleNotFoundError` | Не установлены зависимости - повтори `pip install ...` |
| `Conflict: terminated by other getUpdates` | Запущена вторая копия бота - `pkill -f bot.py`, затем restart |
| Бот не отвечает, нет ошибок | Проверь токен: `ping api.telegram.org` с сервера |

---

## Итого

Бот решает реальную задачу: избавляет от ручного приёма заявок, хранит всю историю, интегрируется с Discord и не требует базы данных. Запускается за 10–15 минут на любом Ubuntu VPS.

Код бота намеренно написан без излишних абстракций - его легко читать и адаптировать под свой сервер: поменять IP, текст приветствия, логику одобрения или структуру заявки.

Примечание:
***Если используешь WinSCP:** файлы начинающиеся с точки (`.env`) скрыты по умолчанию. Включи отображение через **Параметры → Настройки → Панели → Показывать скрытые файлы** или нажми **Ctrl+Alt+H**.*
