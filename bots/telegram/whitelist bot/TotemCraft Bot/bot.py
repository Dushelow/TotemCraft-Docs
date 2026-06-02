import telebot
from telebot import types
import json, csv, os, re, time, requests, traceback, threading, schedule, pytz, html as _html
from datetime import datetime, date, timezone, timedelta
from collections import defaultdict, deque

# Загрузка переменных окружения из .env файла (если установлен python-dotenv)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # На сервере переменные берутся из systemd EnvironmentFile

def _require_env(name):
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Переменная окружения {name!r} не задана. Проверьте файл .env или EnvironmentFile в systemd.")
    return val

TOKEN              = _require_env('BOT_TOKEN')
ADMIN_ID           = int(_require_env('ADMIN_ID'))
DISCORD_WEBHOOK_URL = _require_env('DISCORD_WEBHOOK_URL')
CONSOLE_WEBHOOK_URL = _require_env('CONSOLE_WEBHOOK_URL')
MOSCOW_TZ = pytz.timezone('Europe/Moscow')

bot = telebot.TeleBot(TOKEN)

PENDING_FILE = 'pending.json'
APPROVED_CSV = 'approved_applications.csv'
CONFIG_FILE = 'bot_config.json'
BLOCKED_FILE = 'blocked_users.json'
CHAT_HISTORY_FILE = 'chat_history.json'
MESSAGE_QUEUE_FILE = 'message_queue.json'
LAST_APPLICATION_FILE = 'last_application.json'
TICKETS_FILE = 'tickets.json'
ERROR_LOG = 'bot_errors.log'

user_states = {}
admin_states = {}
admin_reply_to = None
pending_admin_notifications = []  # Очередь уведомлений на время ввода комментария
pending = {}
blocked_users = set()
registration_paused = False
last_application = {}

# Тикеты: { str(uid): { 'id': int, 'status': 'open' } }
active_tickets = {}
ticket_counter = 0

chat_history = defaultdict(lambda: deque(maxlen=20))
unread_messages = set()

user_last_request = {}
RATE_LIMIT = 5
RATE_WINDOW = 5
RATE_COOLDOWN = 10
user_cooldown_until = {}

# ---------- Загрузка ----------
def load_json(filename, default):
    if os.path.exists(filename):
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    return default

def save_json(filename, data):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

pending = load_json(PENDING_FILE, {})
config = load_json(CONFIG_FILE, {'paused': False})
registration_paused = config.get('paused', False)
blocked_users = set(load_json(BLOCKED_FILE, []))
history_data = load_json(CHAT_HISTORY_FILE, {})
for uid, msgs in history_data.items():
    chat_history[uid] = deque(msgs, maxlen=20)
unread_messages = set(load_json(MESSAGE_QUEUE_FILE, []))
last_application = load_json(LAST_APPLICATION_FILE, {})
_tickets_data = load_json(TICKETS_FILE, {'counter': 0, 'tickets': {}})
ticket_counter = _tickets_data.get('counter', 0)
active_tickets = _tickets_data.get('tickets', {})

if not os.path.exists(APPROVED_CSV):
    with open(APPROVED_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow(['Дата', 'TG_Username', 'TG_ID', 'Minecraft_Ник', 'Пароль', 'Статус', 'Комментарий_игрока', 'Комментарий_админа'])

def log_error(e):
    with open(ERROR_LOG, 'a', encoding='utf-8') as f:
        f.write(f"[{datetime.now()}] {traceback.format_exc()}\n")

def escape_md(text):
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', str(text))

def escape_html(text):
    """Экранирует спецсимволы для HTML parse_mode в Telegram."""
    return _html.escape(str(text), quote=False)

def safe_send(chat_id, text, parse_mode=None, reply_markup=None, **kwargs):
    try:
        return bot.send_message(chat_id, text, parse_mode=parse_mode, reply_markup=reply_markup, **kwargs)
    except Exception as e:
        if parse_mode:
            try:
                return bot.send_message(chat_id, text, reply_markup=reply_markup, **kwargs)
            except Exception as e2:
                log_error(e2)
                return None
        else:
            log_error(e)
            return None

TG_MAX_LEN = 4096  # Лимит Telegram на длину одного сообщения

def safe_send_long(chat_id, text, parse_mode=None, reply_markup=None, **kwargs):
    """Отправляет текст, разбивая на части если он превышает лимит Telegram (4096 символов)."""
    if len(text) <= TG_MAX_LEN:
        return safe_send(chat_id, text, parse_mode=parse_mode, reply_markup=reply_markup, **kwargs)
    # Разбиваем по абзацам, чтобы не резать посередине строки
    parts = []
    current = ""
    for line in text.split('\n'):
        if len(current) + len(line) + 1 > TG_MAX_LEN:
            if current:
                parts.append(current)
            current = line
        else:
            current = current + '\n' + line if current else line
    if current:
        parts.append(current)
    result = None
    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            result = safe_send(chat_id, part, parse_mode=parse_mode, reply_markup=reply_markup, **kwargs)
        else:
            safe_send(chat_id, part, parse_mode=parse_mode, **kwargs)
    return result

def edit_message_safe(chat_id, message_id, text, parse_mode=None, reply_markup=None):
    try:
        bot.edit_message_text(text, chat_id, message_id, parse_mode=parse_mode, reply_markup=reply_markup)
    except Exception as e:
        log_error(e)
        safe_send(chat_id, text, parse_mode=parse_mode, reply_markup=reply_markup)

def send_console_command(command):
    if not CONSOLE_WEBHOOK_URL:
        return
    try:
        requests.post(CONSOLE_WEBHOOK_URL, json={"content": command}, timeout=10)
    except Exception as e:
        log_error(e)

# ---------- Discord ----------
def discord_escape(text):
    """Для Discord: НЕ экранируем подчёркивания и другие символы в embed-полях — они отображаются как есть."""
    return str(text)

def discord_new_application(user, tg_id, nick, password, comment=""):
    if not DISCORD_WEBHOOK_URL: return
    hidden_pw = '*' * len(password) if password else 'не указан'
    username = f"@{user.username}" if user.username else "—"
    desc = (
        f"**TG Имя:** {discord_escape(user.first_name or '')} {discord_escape(user.last_name or '')}\n"
        f"**TG Username:** {username}\n"
        f"**TG ID:** {tg_id}\n"
        f"**Игровой ник:** `{discord_escape(nick)}`\n"
        f"**Пароль:** {hidden_pw}\n"
        f"**Комментарий:** {comment if comment else 'нет'}"
    )
    embed = {"title": "📩 Новая заявка", "description": desc, "color": 0xFFFF00,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_decision_notify(nick, status, admin_comment=""):
    if not DISCORD_WEBHOOK_URL: return
    color = 0x00ff00 if status == 'Одобрено' else 0xff0000
    status_text = 'Одобрена' if status == 'Одобрено' else 'Отклонена'
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**Статус:** {status_text}"
    if admin_comment:
        desc += f"\n**Комментарий админа:** {discord_escape(admin_comment)}"
    embed = {"title": f"📋 Заявка {status_text.lower()}", "description": desc, "color": color,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_player_message(user, tg_id, nick, message_text):
    if not DISCORD_WEBHOOK_URL: return
    username = f"@{user.username}" if user.username else "—"
    desc = (
        f"**TG Имя:** {discord_escape(user.first_name or '')} {discord_escape(user.last_name or '')}\n"
        f"**TG Username:** {username}\n"
        f"**TG ID:** {tg_id}\n"
        f"**Игровой ник:** `{discord_escape(nick)}`\n\n"
        f"*Администратор – перейдите в Telegram для просмотра сообщения.*"
    )
    embed = {"title": "📬 Обращение игрока", "description": desc, "color": 0x808080,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_guest_message(user, tg_id):
    if not DISCORD_WEBHOOK_URL: return
    username = f"@{user.username}" if user.username else "—"
    desc = (
        f"**TG Имя:** {discord_escape(user.first_name or '')} {discord_escape(user.last_name or '')}\n"
        f"**TG Username:** {username}\n"
        f"**TG ID:** {tg_id}\n\n"
        f"*Администратор – перейдите в Telegram для просмотра сообщения.*"
    )
    embed = {"title": "📬 Обращение гостя", "description": desc, "color": 0x808080,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_player_blocked(nick, tg_id, username, reason=""):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}"
    if reason:
        desc += f"\n**Причина:** {discord_escape(reason)}"
    embed = {"title": "🚫 Игрок заблокирован", "description": desc, "color": 0xff4400,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_dialog_opened(nick, tg_id, username):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}"
    embed = {"title": "💬 Диалог открыт администратором", "description": desc, "color": 0x00aaff,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_dialog_closed(nick, tg_id, username, by_user=False):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    who = "игроком" if by_user else "администратором"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}\n**Закрыт:** {who}"
    embed = {"title": "🔇 Диалог (тикет) закрыт", "description": desc, "color": 0x888888,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_application_cancelled(nick, tg_id, username, tg_name=""):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username and not username.startswith('id') else "—"
    desc = (
        f"**TG Имя:** {discord_escape(tg_name) if tg_name else '—'}\n"
        f"**TG Username:** {uname}\n"
        f"**TG ID:** {tg_id}\n"
        f"**Игровой ник:** `{discord_escape(nick)}`"
    )
    embed = {"title": "↩️ Игрок отменил заявку", "description": desc, "color": 0xff8800,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def discord_daily_reminder():
    if not DISCORD_WEBHOOK_URL: return
    reload_pending()
    if not pending: return
    desc = f"В очереди {len(pending)} заявок(и). Проверьте их в Telegram."
    embed = {"title": "⏳ Незакрытые заявки", "description": desc, "color": 0xffaa00,
             "timestamp": datetime.now(MOSCOW_TZ).isoformat()}
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        log_error(e)

def reload_pending():
    global pending
    pending = load_json(PENDING_FILE, {})

# ---------- Валидация AuthMe ----------
def validate_nick_authme(nick):
    """
    Проверяет ник по правилам AuthMe:
    - Длина: 3–16 символов
    - Разрешённые символы: латиница, цифры, подчёркивание
    Возвращает (True, '') или (False, 'причина')
    """
    if not nick:
        return False, "Ник не может быть пустым."
    if len(nick) < 3:
        return False, f"Ник слишком короткий ({len(nick)} симв.). Минимум - 3 символа."
    if len(nick) > 16:
        return False, f"Ник слишком длинный ({len(nick)} симв.). Максимум - 16 символов."
    if not re.fullmatch(r'[A-Za-z0-9_]+', nick):
        invalid = set(re.sub(r'[A-Za-z0-9_]', '', nick))
        return False, f"Ник содержит недопустимые символы: {' '.join(invalid)}.\nРазрешены только латинские буквы, цифры и знак подчёркивания (_)."
    return True, ''

WEAK_PASSWORDS = {
    # Цифровые последовательности и повторы
    "123456", "1234567", "12345678", "123456789", "1234567890",
    "123123", "123123123", "1231231234", "111111", "1111111", "11111111",
    "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999", "000000",
    "112233", "121212", "123321", "654321", "987654321", "010101", "102030",
    "147258", "147258369", "159357", "123654", "321321",
    # Клавиатурные паттерны
    "qwerty", "qwerty123", "qwertyui", "qwertyuiop", "qwertyu",
    "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
    "qazwsx", "qazwsxedc", "1qaz2wsx", "1q2w3e", "1q2w3e4r", "1q2w3e4r5t",
    "qweqwe", "asdaSD", "zxczxc",
    # Часто используемые слова
    "password", "password1", "password123", "passw0rd", "passwd",
    "minecraft", "minecraf", "mine1234", "minecraft1",
    "dragon", "master", "monkey", "shadow", "superman", "batman",
    "letmein", "welcome", "login", "admin", "administrator",
    "hello", "hello123", "iloveyou", "love", "lovely",
    "test", "test123", "testing", "temp", "temp123",
    "user", "user123", "guest", "guest123",
    "hunter", "hunter2", "hunter123",
    "abc123", "abc1234", "abcd1234", "abcdef", "abcdefg",
    "football", "baseball", "soccer", "hockey", "gaming",
    "pass", "pass1234", "mypass", "mypassword",
    # Дополнительно популярные
    "sunshine", "princess", "flower", "computer", "internet",
    "samsung", "iphone", "android", "windows", "linux",
}

def _is_sequential(password):
    """Проверяет, является ли пароль простой последовательностью (1234..., abcd..., zyxw...)."""
    if len(password) < 4:
        return False
    ascending = all(ord(password[i+1]) - ord(password[i]) == 1 for i in range(len(password)-1))
    descending = all(ord(password[i]) - ord(password[i+1]) == 1 for i in range(len(password)-1))
    return ascending or descending

def _is_repeated_pattern(password):
    """Проверяет, состоит ли пароль из повторяющегося блока (abcabc, 123123, aaaa и т.д.)."""
    n = len(password)
    for block_len in range(1, n // 2 + 1):
        if n % block_len == 0:
            block = password[:block_len]
            if password == block * (n // block_len):
                return True
    return False

def validate_password_authme(password, nick=None):
    """
    Проверяет пароль по правилам AuthMe:
    - Длина: 6–30 символов
    - Пробелы запрещены
    - Нет кириллицы
    - Не должен совпадать с ником (регистронезависимо)
    - Не должен быть из списка слабых паролей
    - Не должен быть простой последовательностью или повтором
    Возвращает (True, '') или (False, 'причина')
    """
    if not password:
        return False, "Пароль не может быть пустым."
    if len(password) < 6:
        return False, f"Пароль слишком короткий ({len(password)} симв.). Минимум - 6 символов."
    if len(password) > 30:
        return False, f"Пароль слишком длинный ({len(password)} симв.). Максимум - 30 символов."
    if re.search(r'[а-яёА-ЯЁ]', password):
        return False, "Пароль не может содержать кириллицу. Используйте только латинские буквы, цифры и спецсимволы."
    if ' ' in password:
        return False, "Пароль не может содержать пробелы."
    if nick and password.lower() == nick.lower():
        return False, "Пароль не должен совпадать с ником. Придумайте другой пароль."
    if password.lower() in WEAK_PASSWORDS:
        return False, "Этот пароль слишком простой и не принимается сервером. Придумайте более надёжный пароль."
    if _is_repeated_pattern(password):
        return False, "Пароль состоит из повторяющихся символов или блоков. Придумайте более надёжный пароль."
    if _is_sequential(password):
        return False, "Пароль является простой последовательностью символов. Придумайте более надёжный пароль."
    if re.fullmatch(r'\d+', password):
        return False, "Пароль не может состоять только из цифр. Добавьте буквы или спецсимволы."
    return True, ''

def check_nick_already_approved(nick):
    """
    Проверяет, был ли данный ник одобрен ранее (строка статуса = 'Одобрено').
    Сравнение регистронезависимое.
    Возвращает True если ник уже занят.
    """
    if not os.path.exists(APPROVED_CSV):
        return False
    nick_lower = nick.lower()
    with open(APPROVED_CSV, 'r', encoding='utf-8-sig') as f:
        for row in list(csv.reader(f))[1:]:
            if len(row) >= 6 and row[5] == 'Одобрено' and row[3].lower() == nick_lower:
                return True
    return False

def check_duplicate_tg_id(tg_id):
    """
    Проверяет, подавал ли данный TG ID заявку ранее (по approved CSV).
    Возвращает True если был в прошлых заявках.
    """
    if not os.path.exists(APPROVED_CSV):
        return False
    str_id = str(tg_id)
    with open(APPROVED_CSV, 'r', encoding='utf-8-sig') as f:
        for row in list(csv.reader(f))[1:]:
            if len(row) >= 3 and row[2] == str_id:
                return True
    return False

def check_rate_limit(user_id):
    if user_id == ADMIN_ID:
        return True
    now = time.time()
    if user_id in user_cooldown_until and now < user_cooldown_until[user_id]:
        return False
    timestamps = user_last_request.get(user_id, [])
    timestamps.append(now)
    timestamps = [t for t in timestamps if now - t < RATE_WINDOW]
    user_last_request[user_id] = timestamps
    if len(timestamps) > RATE_LIMIT:
        user_cooldown_until[user_id] = now + RATE_COOLDOWN
        user_last_request[user_id] = []
        try: bot.send_message(user_id, "⚠️ Слишком много запросов. Подождите 10 сек.")
        except: pass
        return False
    return True

def user_display_name(user):
    name = (user.first_name or "") + (" " + user.last_name if user.last_name else "")
    name = name.strip()
    if name:
        return name
    if user.username:
        return f"@{user.username}"
    return f"id{user.id}"

def format_admin_notify(user, text, extra="", ticket_id=None):
    name = user_display_name(user)
    uid = user.id
    username = f"@{escape_html(user.username)}" if user.username else "нет"
    ticket_str = f"🎫 Тикет: <b>#{ticket_id}</b>\n" if ticket_id else ""
    msg = f"📬 <b>Новое сообщение</b>\n"
    msg += ticket_str
    msg += f"От: {escape_html(name)}\n"
    msg += f"Username: {username}\n"
    msg += f"ID: <code>{uid}</code>\n"
    if extra:
        msg += extra
    msg += f"\nТекст: {escape_html(text[:200])}"
    return msg

def get_user_label(uid):
    for app in pending.values():
        if str(app.get('user_id')) == str(uid):
            nick = app.get('nick', '')
            username = app.get('username', '')
            if username and not username.startswith('id'): return f"@{username} ({nick})"
            return f"Ник {nick}"
    return f"ID {uid}"

def enrich_user_label(uid):
    try:
        chat = bot.get_chat(uid)
        first = chat.first_name or ""
        last = chat.last_name or ""
        username = chat.username or ""
    except:
        first = last = username = ""
    name = (first + " " + last).strip()
    nick = ""
    for app in pending.values():
        if str(app.get('user_id')) == str(uid):
            nick = app.get('nick', '')
            break
    parts = []
    if name:
        parts.append(name)
    if username:
        parts.append(f"@{username}")
    else:
        parts.append("— (tg)")
    if nick:
        parts.append(f"[{nick}]")
    else:
        parts.append("[—]")
    return " ".join(parts)

def add_to_history(user_id, text, from_user=True):
    chat_history[str(user_id)].append({
        "from": "user" if from_user else "admin",
        "text": text,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    save_json(CHAT_HISTORY_FILE, {uid: list(msgs) for uid, msgs in chat_history.items()})

def add_unread(user_id):
    unread_messages.add(str(user_id))
    save_json(MESSAGE_QUEUE_FILE, list(unread_messages))

def clear_unread(user_id):
    uid = str(user_id)
    if uid in unread_messages:
        unread_messages.remove(uid)
        save_json(MESSAGE_QUEUE_FILE, list(unread_messages))

def save_tickets():
    save_json(TICKETS_FILE, {'counter': ticket_counter, 'tickets': active_tickets})

def notify_admin(text, parse_mode=None, reply_markup=None):
    """Отправляет уведомление админу, или откладывает если он сейчас вводит комментарий."""
    if ADMIN_ID in admin_states:
        pending_admin_notifications.append({
            'text': text,
            'parse_mode': parse_mode,
            'reply_markup': reply_markup
        })
    else:
        safe_send(ADMIN_ID, text, parse_mode=parse_mode, reply_markup=reply_markup)

def flush_admin_notifications():
    """Доставляет все отложенные уведомления."""
    if not pending_admin_notifications:
        return
    count = len(pending_admin_notifications)
    safe_send(ADMIN_ID, f"📬 Пока вы вводили комментарий, пришло {count} уведомление(-й):")
    for n in pending_admin_notifications:
        safe_send(ADMIN_ID, n['text'], parse_mode=n['parse_mode'], reply_markup=n['reply_markup'])
    pending_admin_notifications.clear()

def open_ticket(user_id, message_text='', nick=''):
    """Открывает новый тикет для пользователя. Возвращает номер тикета."""
    global ticket_counter
    ticket_counter += 1
    active_tickets[str(user_id)] = {
        'id': ticket_counter,
        'status': 'open',
        'message': message_text,
        'nick': nick,
        'date': datetime.now().strftime('%Y-%m-%d %H:%M')
    }
    save_tickets()
    return ticket_counter

def close_ticket(user_id):
    """Закрывает тикет пользователя."""
    uid = str(user_id)
    if uid in active_tickets:
        del active_tickets[uid]
        save_tickets()

def get_ticket(user_id):
    """Возвращает данные тикета или None."""
    return active_tickets.get(str(user_id))

def main_keyboard(is_admin=False, user_id=None):
    # Для совместимости: reply-клавиатура нужна только пользователю в диалоге/вводе
    if is_admin:
        # Больше не используем reply-клавиатуру для админа — возвращаем RemoveKeyboard
        return types.ReplyKeyboardRemove()
    else:
        step = user_states.get(user_id, {}).get('step') if user_id else None
        text_input_steps = {'nick', 'password', 'comment', 'support_nick', 'support_text', 'guest_message'}
        in_text_input = step in text_input_steps
        in_active_dialog = (admin_reply_to is not None and user_id is not None and user_id == admin_reply_to)

        if in_text_input or in_active_dialog:
            markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=1)
            if in_active_dialog:
                markup.add("❌ Завершить диалог")
            elif step in {'support_nick', 'support_text', 'guest_message'}:
                markup.add("❌ Отменить")
            else:
                markup.add("❌ Отменить заявку")
            return markup

        markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=1)
        markup.add("🏠 Главное меню")
        has_ticket = (user_id is not None and get_ticket(user_id))
        has_active_app = (user_id is not None and str(user_id) in pending)
        if has_ticket:
            markup.add("📋 Мои обращения")
        if has_active_app:
            markup.add("❌ Отменить заявку")
        return markup

def send_admin_menu(chat_id, edit_message=None):
    """Отправляет/обновляет инлайн-панель администратора."""
    pending_count = len(pending)
    unread_count = len(unread_messages)

    pending_label = f"📋 Заявки" + (f"  •  {pending_count} новых" if pending_count else "")
    messages_label = f"💬 Сообщения" + (f"  •  {unread_count} непрочитанных" if unread_count else "")
    dialog_label = f"🔴 Завершить диалог с {enrich_user_label(admin_reply_to)}" if admin_reply_to else None

    inline = types.InlineKeyboardMarkup(row_width=1)
    inline.add(types.InlineKeyboardButton(pending_label, callback_data="admin_menu_applications"))
    inline.add(types.InlineKeyboardButton(messages_label, callback_data="admin_menu_messages"))
    inline.add(types.InlineKeyboardButton("📊 Статистика", callback_data="admin_menu_stats"))
    inline.add(types.InlineKeyboardButton("🔍 Поиск по нику", callback_data="admin_search"))
    inline.add(types.InlineKeyboardButton("⚙️ Управление", callback_data="admin_menu_controls"))
    if dialog_label:
        inline.add(types.InlineKeyboardButton(dialog_label, callback_data="admin_end_dialog"))

    lines = ["🛡 <b>Панель администратора</b>"]
    if pending_count:
        lines.append(f"⏳ Ожидают рассмотрения: <b>{pending_count}</b>")
    if unread_count:
        lines.append(f"📬 Непрочитанных сообщений: <b>{unread_count}</b>")
    if admin_reply_to:
        lines.append(f"💬 Активный диалог: <b>{enrich_user_label(admin_reply_to)}</b>")
    text = "\n".join(lines)

    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=inline)
    else:
        try:
            rm = bot.send_message(chat_id, "...", reply_markup=types.ReplyKeyboardRemove())
            bot.delete_message(chat_id, rm.message_id)
        except Exception:
            pass
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=inline)

def send_main_menu(uid, edit_message=None):
    """Отправляет главное меню. Убирает реплай-клавиатуру одним сообщением."""
    text = "🏠 Главное меню"
    inline = types.InlineKeyboardMarkup(row_width=1)
    buttons = [
        types.InlineKeyboardButton("📝 Подать заявку на сервер", callback_data="menu_apply"),
        types.InlineKeyboardButton("🚨 Жалоба / вопрос администратору", callback_data="menu_support"),
        types.InlineKeyboardButton("📖 О сервере", callback_data="menu_handbook"),
        types.InlineKeyboardButton("📢 Подписаться на группу", callback_data="menu_subscribe"),
    ]
    if get_ticket(uid):
        buttons.insert(1, types.InlineKeyboardButton("📋 Мои обращения", callback_data="menu_my_tickets"))
    inline.add(*buttons)
    if edit_message:
        # Редактируем существующее сообщение вместо нового
        edit_message_safe(uid, edit_message.message_id, text, reply_markup=inline)
    else:
        # Убираем реплай-клавиатуру и отправляем инлайн-меню.
        try:
            rm = bot.send_message(uid, "...", reply_markup=types.ReplyKeyboardRemove())
            bot.delete_message(uid, rm.message_id)
        except Exception:
            pass
        safe_send(uid, text, reply_markup=inline)


def cancel_keyboard(label="❌ Отменить заявку"):
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=1)
    markup.add(label)
    return markup

# ---------- Интерфейсные разделы ----------
def show_pending_applications(chat_id, page=0, edit_message=None):
    """Показывает текущие заявки постранично — одно сообщение с листанием."""
    if not pending:
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, "⏳ Нет заявок в ожидании.", reply_markup=markup)
        else:
            safe_send(chat_id, "⏳ Нет заявок в ожидании.", reply_markup=markup)
        return
    # Сортируем: сначала старые (в порядке очереди)
    sorted_apps = sorted(pending.items(), key=lambda x: x[1].get('date', ''))
    total = len(sorted_apps)
    app_id, app = sorted_apps[page]
    try:
        nick = escape_html(app.get('nick', '?'))
        comment = escape_html(app.get('comment', ''))
        user_id = app.get('user_id', app_id)
        username = app.get('username', '')
        tg_name = escape_html(app.get('tg_name', ''))
        date_str = app.get('date', '')[:19].replace('T', ' ')
        display_name = f"@{escape_html(username)}" if username and not username.startswith('id') else f"ID {user_id}"
        hidden_pw = '●' * len(app.get('password', ''))
        text = (
            f"📩 <b>Заявка {page + 1} из {total}</b>\n"
            f"👤 Ник: <code>{nick}</code>\n"
            f"🔑 Пароль: <code>{hidden_pw}</code>\n"
            f"🧑 Имя TG: {tg_name if tg_name else '—'}\n"
            f"🆔 ID TG: <code>{user_id}</code>\n"
            f"📛 Username: {display_name}"
        )
        if comment:
            text += f"\n💬 Комментарий: {comment}"
        text += f"\n📅 {date_str}"
        if check_duplicate_tg_id(user_id):
            text += f"\n\n⚠️ <b>Внимание:</b> данный TG ID (<code>{user_id}</code>) уже подавал заявку ранее!"
        markup = types.InlineKeyboardMarkup(row_width=3)
        # Навигация
        nav = []
        if page > 0:
            nav.append(types.InlineKeyboardButton("◀️", callback_data=f"pending_page_{page - 1}"))
        nav.append(types.InlineKeyboardButton(f"{page + 1}/{total}", callback_data="noop"))
        if page < total - 1:
            nav.append(types.InlineKeyboardButton("▶️", callback_data=f"pending_page_{page + 1}"))
        if nav:
            markup.add(*nav)
        markup.add(
            types.InlineKeyboardButton("✅ Одобрить", callback_data=f"approve_{user_id}"),
            types.InlineKeyboardButton("❌ Отклонить", callback_data=f"reject_{user_id}"),
        )
        markup.add(types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{user_id}"))
        markup.add(types.InlineKeyboardButton("💬 Ответить", callback_data=f"reply_{user_id}"))
        markup.add(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
        else:
            safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)
    except Exception as e:
        safe_send(chat_id, f"⚠️ Ошибка при показе заявки {app_id}: {e}")
        log_error(e)


def do_nick_search(chat_id, query):
    """Ищет ник в активных заявках, истории CSV и сообщениях. Показывает результат."""
    results = []
    # 1. Ищем в pending (активные заявки)
    for app_id, app in pending.items():
        nick = app.get('nick', '')
        if query in nick.lower():
            results.append({
                'source': 'pending',
                'nick': nick,
                'tg_name': app.get('tg_name', ''),
                'username': app.get('username', ''),
                'tg_id': str(app.get('user_id', app_id)),
                'date': app.get('date', '')[:10],
                'status': '⏳ Ожидает',
                'comment': app.get('comment', ''),
            })
    # 2. Ищем в CSV истории
    for row in read_approved_csv():
        if len(row) < 6:
            continue
        nick = row[3]
        if query in nick.lower():
            status_icon = '✅' if row[5] == 'Одобрено' else '❌'
            results.append({
                'source': 'csv',
                'nick': nick,
                'tg_name': '',
                'username': row[1],
                'tg_id': row[2],
                'date': row[0][:10],
                'status': f"{status_icon} {row[5]}",
                'comment': row[6] if len(row) > 6 else '',
            })
    if not results:
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))
        safe_send(chat_id, f"🔍 По запросу <b>{escape_html(query)}</b> ничего не найдено.", parse_mode='HTML', reply_markup=markup)
        return
    lines = [f"🔍 <b>Результаты поиска по «{escape_html(query)}»</b> — найдено: {len(results)}\n"]
    for i, r in enumerate(results[:20], 1):
        uname = f"@{escape_html(r['username'])}" if r['username'] and not r['username'].startswith('id') else ''
        tg_id = r['tg_id']
        nick_e = escape_html(r['nick'])
        lines.append(
            f"<b>{i}.</b> 🎮 <code>{nick_e}</code> | {r['status']}\n"
            f"   🆔 {tg_id}" + (f" | {uname}" if uname else '') +
            (f" | 🧑 {escape_html(r['tg_name'])}" if r['tg_name'] else '') +
            f"\n   📅 {r['date']}"
        )
    text = "\n".join(lines)
    markup = types.InlineKeyboardMarkup(row_width=1)
    # Для активных заявок — добавляем быстрые кнопки
    for r in results[:5]:
        if r['source'] == 'pending' and r['tg_id']:
            markup.add(types.InlineKeyboardButton(
                f"📋 Открыть заявку {r['nick']}", callback_data=f"pending_goto_{r['tg_id']}"))
        elif r['tg_id']:
            markup.add(types.InlineKeyboardButton(
                f"👤 Профиль {r['nick']}", callback_data=f"user_profile_{r['tg_id']}"))
    markup.add(types.InlineKeyboardButton("🔍 Новый поиск", callback_data="admin_search"))
    markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="admin_back"))
    safe_send_long(chat_id, text, parse_mode='HTML', reply_markup=markup)


def show_application_history(chat_id, page=0, edit_message=None):
    """История всех заявок из CSV — постраничный просмотр."""
    all_rows = read_approved_csv()
    if not all_rows:
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, "📂 История заявок пуста.", reply_markup=markup)
        else:
            safe_send(chat_id, "📂 История заявок пуста.", reply_markup=markup)
        return
    total = len(all_rows)
    per_page = 1
    row = all_rows[page]  # [Дата, TG_Username, TG_ID, MC_Ник, Пароль, Статус, Комм_игрока, Комм_админа]
    num = page + 1
    date_s = row[0][:19].replace('T', ' ') if len(row) > 0 else '—'
    tg_uname = row[1] if len(row) > 1 else '—'
    tg_id = row[2] if len(row) > 2 else '—'
    mc_nick = row[3] if len(row) > 3 else '—'
    status = row[5] if len(row) > 5 else '—'
    player_comment = row[6] if len(row) > 6 else ''
    admin_comment = row[7] if len(row) > 7 else ''
    status_icon = '✅' if status == 'Одобрено' else ('❌' if status == 'Отклонено' else '⏳')
    uname_display = f"@{escape_html(tg_uname)}" if tg_uname and not tg_uname.startswith('id') else f"ID {tg_id}"
    text = (
        f"📂 <b>История заявок — #{num} из {total}</b>\n\n"
        f"🎮 Ник: <code>{escape_html(mc_nick)}</code>\n"
        f"🧑 TG Username: {uname_display}\n"
        f"🆔 TG ID: <code>{tg_id}</code>\n"
        f"📅 Дата: {date_s}\n"
        f"📌 Статус: {status_icon} {status}"
    )
    if player_comment:
        text += f"\n💬 Комментарий игрока: {escape_html(player_comment)}"
    if admin_comment:
        text += f"\n👑 Комментарий админа: {escape_html(admin_comment)}"
    markup = types.InlineKeyboardMarkup(row_width=3)
    nav = []
    if page > 0:
        nav.append(types.InlineKeyboardButton("◀️", callback_data=f"apphistory_page_{page - 1}"))
    nav.append(types.InlineKeyboardButton(f"{num}/{total}", callback_data="noop"))
    if page < total - 1:
        nav.append(types.InlineKeyboardButton("▶️", callback_data=f"apphistory_page_{page + 1}"))
    if nav:
        markup.add(*nav)
    markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_menu_stats"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_statistics(chat_id, edit_message=None):
    total_approved = total_rejected = today_approved = today_rejected = 0
    today_str = date.today().isoformat()
    for r in read_approved_csv():
        if len(r) < 6:
            continue
        if r[5] == 'Одобрено':
            total_approved += 1
            if r[0].startswith(today_str): today_approved += 1
        elif r[5] == 'Отклонено':
            total_rejected += 1
            if r[0].startswith(today_str): today_rejected += 1
    pending_count = len(pending)
    text = (
        f"📊 <b>Статистика</b>\n"
        f"✅ Одобрено: {total_approved} (сегодня: {today_approved})\n"
        f"❌ Отклонено: {total_rejected} (сегодня: {today_rejected})\n"
        f"⏳ Ожидают: {pending_count}\n"
    )
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.add(types.InlineKeyboardButton("✅ Подтверждённые", callback_data="show_approved"),
               types.InlineKeyboardButton("❌ Отклонённые", callback_data="show_rejected"))
    markup.add(types.InlineKeyboardButton("👥 Профили пользователей", callback_data="show_apphistory"))
    markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def read_approved_csv():
    """Читает все строки из APPROVED_CSV (без заголовка). Возвращает список строк."""
    if not os.path.exists(APPROVED_CSV):
        return []
    with open(APPROVED_CSV, 'r', encoding='utf-8-sig') as f:
        return [row for row in list(csv.reader(f))[1:] if row]

def show_approved_list(chat_id, page=0, edit_message=None):
    approved = [row for row in read_approved_csv() if len(row) >= 6 and row[5] == 'Одобрено']
    if not approved:
        markup = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("🔙 Назад", callback_data="back_to_stats"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, "Нет одобренных заявок.", reply_markup=markup)
        else:
            safe_send(chat_id, "Нет одобренных заявок.", reply_markup=markup)
        return
    per_page = 10
    pages = (len(approved) + per_page - 1) // per_page
    chunk = approved[page * per_page:(page + 1) * per_page]
    lines = [f"• <code>{escape_html(r[3])}</code> | {r[0][:10]} | @{escape_html(r[1])}" for r in chunk]
    text = f"✅ <b>Подтверждённые заявки</b> ({page+1}/{pages})\n" + "\n".join(lines)
    markup = types.InlineKeyboardMarkup(row_width=3)
    if page > 0: markup.add(types.InlineKeyboardButton("◀️", callback_data=f"approved_page_{page-1}"))
    if page < pages - 1: markup.add(types.InlineKeyboardButton("▶️", callback_data=f"approved_page_{page+1}"))
    markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="back_to_stats"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_rejected_list(chat_id, page=0, edit_message=None):
    rejected = [row for row in read_approved_csv() if len(row) >= 6 and row[5] == 'Отклонено']
    if not rejected:
        markup = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("🔙 Назад", callback_data="back_to_stats"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, "Нет отклонённых заявок.", reply_markup=markup)
        else:
            safe_send(chat_id, "Нет отклонённых заявок.", reply_markup=markup)
        return
    per_page = 10
    pages = (len(rejected) + per_page - 1) // per_page
    chunk = rejected[page * per_page:(page + 1) * per_page]
    lines = [f"• <code>{escape_html(r[3])}</code> | {r[0][:10]} | @{escape_html(r[1])}" for r in chunk]
    text = f"❌ <b>Отклонённые заявки</b> ({page+1}/{pages})\n" + "\n".join(lines)
    markup = types.InlineKeyboardMarkup(row_width=3)
    if page > 0: markup.add(types.InlineKeyboardButton("◀️", callback_data=f"rejected_page_{page-1}"))
    if page < pages - 1: markup.add(types.InlineKeyboardButton("▶️", callback_data=f"rejected_page_{page+1}"))
    markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="back_to_stats"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_messages_menu(message, page=0, edit_message=None, category='unanswered'):
    """Показывает меню сообщений с категориями: не отвеченные / отвеченные."""
    uids_with_history = [uid for uid, msgs in chat_history.items() if msgs]
    chat_id = message.chat.id
    if not uids_with_history:
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, "Нет сообщений.", reply_markup=markup)
        else:
            safe_send(chat_id, "Нет сообщений.", reply_markup=markup)
        return

    unread_set = {str(u) for u in unread_messages}
    unanswered_uids = [uid for uid in uids_with_history if uid in unread_set]
    answered_uids = [uid for uid in uids_with_history if uid not in unread_set]

    def last_time(uid):
        msgs = chat_history.get(uid)
        return max(m['time'] for m in msgs) if msgs else '0'

    if category == 'unanswered':
        pool = sorted(unanswered_uids, key=last_time, reverse=True)
        tab_current = f"🔴 Не отвеченные ({len(unanswered_uids)})"
        tab_other = f"✅ Отвеченные ({len(answered_uids)})"
        other_cat = 'answered'
        empty_text = "📬 Нет неотвеченных сообщений."
    else:
        pool = sorted(answered_uids, key=last_time, reverse=True)
        tab_current = f"✅ Отвеченные ({len(answered_uids)})"
        tab_other = f"🔴 Не отвеченные ({len(unanswered_uids)})"
        other_cat = 'unanswered'
        empty_text = "✅ Нет отвеченных сообщений."

    per_page = 5
    total_pages = max(1, (len(pool) + per_page - 1) // per_page)
    start = page * per_page
    page_uids = pool[start:start + per_page]

    markup = types.InlineKeyboardMarkup(row_width=2)
    # Вкладки-переключатели (активная подчёркнута символом ▸)
    markup.add(
        types.InlineKeyboardButton(f"▸ {tab_current}", callback_data=f"msg_cat_{category}_0"),
        types.InlineKeyboardButton(tab_other, callback_data=f"msg_cat_{other_cat}_0")
    )

    if not page_uids:
        markup.add(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))
        header = f"💬 <b>Сообщения</b>"
        if unanswered_uids and category == 'answered':
            header += f"\n🔴 Неотвеченных: <b>{len(unanswered_uids)}</b>"
        text = f"{header}\n\n{empty_text}"
        if edit_message:
            edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
        else:
            safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)
        return

    for uid in page_uids:
        label = get_user_label(int(uid)) if uid.isdigit() else uid
        markup.add(types.InlineKeyboardButton(f"👤 {label}", callback_data=f"user_profile_{uid}"))

    nav_buttons = []
    if page > 0:
        nav_buttons.append(types.InlineKeyboardButton("◀️", callback_data=f"msg_cat_{category}_{page-1}"))
    if page < total_pages - 1:
        nav_buttons.append(types.InlineKeyboardButton("▶️", callback_data=f"msg_cat_{category}_{page+1}"))
    if nav_buttons:
        markup.add(*nav_buttons)
    markup.add(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))

    # Заголовок — при открытии «не отвеченных» перечисляем их ники отдельным блоком
    header = f"💬 <b>Сообщения</b>"
    if unanswered_uids:
        header += f"\n🔴 Неотвеченных: <b>{len(unanswered_uids)}</b>"
        if category == 'unanswered' and page == 0:
            names = []
            for uid in unanswered_uids[:10]:
                lbl = get_user_label(int(uid)) if uid.isdigit() else uid
                names.append(f"• {lbl}")
            header += "\n" + "\n".join(names)

    text = f"{header}\n\nСтраница {page+1}/{total_pages}"
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_user_profile(admin_chat_id, target_uid, origin_msg):
    """Показывает профиль пользователя, редактируя текущее сообщение (плашка профиля)."""
    uid = int(target_uid)
    # Собираем данные
    try:
        tchat = bot.get_chat(uid)
        first = tchat.first_name or ""
        last = tchat.last_name or ""
        tg_username = tchat.username or ""
    except:
        first = last = tg_username = ""

    tg_name = (first + " " + last).strip()
    nick = ""
    for app in pending.values():
        if str(app.get('user_id')) == str(uid):
            nick = app.get('nick', '')
            break
    # Если ника нет в pending — ищем в CSV
    if not nick:
        for row in read_approved_csv():
            if len(row) >= 4 and str(row[2]) == str(uid) and row[5] == 'Одобрено':
                nick = row[3]
                break

    lines = [f"👤 <b>Профиль пользователя</b>"]
    lines.append(f"🆔 ID: <code>{uid}</code>")
    if tg_name:
        lines.append(f"🧑 Имя TG: {escape_html(tg_name)}")
    if tg_username:
        lines.append(f"📛 Username: @{escape_html(tg_username)}")
    if nick:
        lines.append(f"🎮 Игровой ник: <code>{escape_html(nick)}</code>")

    # Статистика обращений
    msgs = list(chat_history.get(str(uid), []))
    lines.append(f"\n📨 Сообщений в истории: {len(msgs)}")
    ticket = get_ticket(uid)
    if ticket:
        lines.append(f"🎫 Тикет: #{ticket['id']} (открыт)")
    is_blocked = uid in blocked_users
    if is_blocked:
        lines.append("🚫 <b>Заблокирован</b>")

    profile_text = "\n".join(lines)

    markup = types.InlineKeyboardMarkup(row_width=1)
    markup.add(types.InlineKeyboardButton("💬 Ответить на тикет", callback_data=f"reply_{uid}"))
    if ticket:
        markup.add(types.InlineKeyboardButton("🔒 Закрыть тикет без диалога", callback_data=f"admin_close_ticket_{uid}"))
    markup.add(types.InlineKeyboardButton("📜 История сообщений", callback_data=f"hist_{uid}"))
    if is_blocked:
        markup.add(types.InlineKeyboardButton("🔓 Разблокировать", callback_data=f"unblock_{uid}"))
    else:
        markup.add(types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{uid}"))
    markup.add(types.InlineKeyboardButton("🔙 Назад к сообщениям", callback_data="admin_menu_messages"))
    markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="admin_back"))

    edit_message_safe(admin_chat_id, origin_msg.message_id, profile_text, parse_mode='HTML', reply_markup=markup)

def show_blocked_users(chat_id, edit_message=None):
    if not blocked_users:
        text = "Список заблокированных пуст."
        markup = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
    else:
        text = "🚫 Заблокированные пользователи:\n" + "\n".join(f"• <code>{uid}</code>" for uid in blocked_users)
        markup = types.InlineKeyboardMarkup()
        for uid in list(blocked_users)[:10]:
            markup.add(types.InlineKeyboardButton(f"🔓 Разблокировать {uid}", callback_data=f"unblock_{uid}"))
        markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_back"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_admin_controls(chat_id, edit_message=None):
    markup = types.InlineKeyboardMarkup(row_width=1)
    if registration_paused:
        markup.add(types.InlineKeyboardButton("▶️ Возобновить регистрацию", callback_data="admin_resume"))
    else:
        markup.add(types.InlineKeyboardButton("⏸️ Приостановить регистрацию", callback_data="admin_pause"))
    markup.add(types.InlineKeyboardButton("📊 Статус", callback_data="admin_status"))
    markup.add(types.InlineKeyboardButton("🚫 Заблокированные", callback_data="show_blocked"))
    markup.add(types.InlineKeyboardButton("⏰ Сбросить таймеры заявок", callback_data="admin_resettimers"))
    markup.add(types.InlineKeyboardButton("🧹 Очистить статистику", callback_data="admin_clearstats"))
    markup.add(types.InlineKeyboardButton("🗑 Очистить историю диалогов", callback_data="admin_cleardialogs"))
    markup.add(types.InlineKeyboardButton("📖 Инструкция", callback_data="admin_help"))
    markup.add(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))
    text = "⚙️ Управление ботом"
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, reply_markup=markup)
    else:
        safe_send(chat_id, text, reply_markup=markup)

def end_dialog(chat_obj, user_initiated=False):
    global admin_reply_to
    if admin_reply_to:
        target = admin_reply_to
        admin_reply_to = None
        label = enrich_user_label(target)
        close_ticket(target)
        if user_initiated:
            safe_send(ADMIN_ID, f"🔔 Пользователь {label} завершил диалог (тикет закрыт).")
        else:
            safe_send(ADMIN_ID, f"🔇 Диалог с {label} завершён.")
        # Discord уведомление
        try:
            tchat = bot.get_chat(target)
            t_nick = ""
            for app in pending.values():
                if str(app.get('user_id')) == str(target):
                    t_nick = app.get('nick', '')
                    break
            discord_dialog_closed(t_nick or f"ID {target}", target, tchat.username or "", by_user=user_initiated)
        except Exception:
            pass
        send_admin_menu(ADMIN_ID)
        try:
            safe_send(target, "🔇 Диалог с администратором завершён.",
                      reply_markup=main_keyboard(is_admin=False, user_id=target))
        except: pass
    else:
        safe_send(ADMIN_ID, "Нет активного диалога.")
        send_admin_menu(ADMIN_ID)

# ---------- Справочник "О сервере" ----------

HANDBOOK_CHAPTERS = {
    'rules': {
        'emoji': '🛡',
        'title': 'Правила',
        'text': (
            "🛡 <b>Правила сервера</b>\n\n"
            "<b>Запрещено и наказуемо баном:</b>\n"
            "• Порча чужих построек\n"
            "• Воровство\n"
            "• PvP без согласия\n"
            "• Оскорбление родных\n"
            "• Агрессивное обсуждение политики\n\n"
            "Если вы стали жертвой — узнайте ник нарушителя командой <code>/co i</code> "
            "и отправьте жалобу в Discord. Администрация откатит ущерб и вернёт лут.\n\n"
            "<i>Действия, которые могут не входить в список правил, но всё равно портят окружающим людям игровой процесс, могут повлечь за собой наказание — просто будьте вежливыми и не мешайте другим!</i>"
        )
    },
    'start': {
        'emoji': '🚢',
        'title': 'Начало игры',
        'text': (
            "🚢 <b>Начало игры</b>\n\n"
            "При первом заходе вы появляетесь на корабле — это общий мир.\n\n"
            "🚣 Возьмите лодку и плывите в любом направлении, пока не попадёте на берег.\n\n"
            "🏗 Стройте, творите и развивайтесь!\n\n"
            "По пути вы можете встретить дома, селения и города — просим не разрушать "
            "и не брать чужих ресурсов без спроса."
        )
    },
    'life': {
        'emoji': '🌍',
        'title': 'Жизнь игроков',
        'text': (
            "🌍 <b>Жизнь игроков</b>\n\n"
            "<b>Идея и геймплей:</b>\n"
            "Основная идея — застройка мира красивыми проектами в выживании и история, "
            "которую игроки создают сами.\n\n"
            "Популярные занятия: ивенты, настолки на редстоуне, написание истории на вики, "
            "отыгрыш политики и общение.\n\n"
            "📌 <b>Важные факты:</b>\n"
            "• Вайп основного мира — никогда\n"
            "• Вайп Края и Незера — раз в полгода\n"
            "• Границы расширяются со временем\n"
            "• Точка возрождения — кровать\n"
            "• Телепортов нет — метро в незере или элитры\n"
            "• Незер-хаб: координаты <code>0, 0</code>\n\n"
            "🏪 Торговая зона — нулевые координаты. В радиусе 500 блоков можно ставить "
            "магазины после разрешения администрации."
        )
    },
    'clans': {
        'emoji': '⚔️',
        'title': 'Кланы и PvP',
        'text': (
            "⚔️ <b>Кланы и PvP</b>\n\n"
            "В игре нет принудительного PvP и фракционных режимов. Для RolePlay политики "
            "организована система кланов — объединений игроков с общей идеей и историей.\n\n"
            "<b>Главное преимущество клана</b> — возможность проводить PvP-сражения.\n\n"
            "<b>⚔️ Правила войн:</b>\n"
            "• Лидеры фиксируют условия конфликта книгой и пером\n"
            "• Оба лидера подписывают свой экземпляр и обмениваются им\n"
            "• Проигравшая сторона выполняет условия победителя\n"
            "• PvP вне войны — запрещено\n\n"
            "<b>Требования для создания клана:</b>\n"
            "• 3 участника\n"
            "• Клановая база\n"
            "• Баннер (флаг)\n"
            "• Стабильный онлайн\n\n"
            "Для создания клана обратитесь к администрации."
        )
    },
    'commands': {
        'emoji': '⌨️',
        'title': 'Команды',
        'text': (
            "⌨️ <b>Команды (плагины)</b>\n\n"
            "<b>Скин и внешность:</b>\n"
            "• <code>/skin &lt;название&gt;</code> — смена скина по нику\n\n"
            "<b>Проверка и приват:</b>\n"
            "• <code>/co i</code> — история блока (выявление гриферов)\n"
            "• <code>/lock</code> — приват сундука\n"
            "• <code>/unlock</code> — снять приват с сундука\n"
            "• <code>/cmodify &lt;ник&gt;</code> — дать доступ к сундуку\n"
            "• <code>/cpassword</code> — пароль на сундук\n"
            "• <code>/cpersist</code> — спам команд (для приватки множества сундуков)\n"
            "• <code>/cremoveall</code> — удалить все приваты сундуков\n"
            "• <code>/chopper on</code> — открыть сундук для воронки\n\n"
            "<b>Чат:</b>\n"
            "• <code>/tell &lt;ник&gt;</code> — личное сообщение\n"
            "• <code>/r</code> — быстрый ответ\n"
            "• <code>/ignore &lt;ник&gt;</code> — скрыть сообщения\n"
            "• <code>/me</code> — РП описание действия\n"
            "• <code>/toggleshout</code> — переключить глобальный чат\n\n"
            "<b>Прочее:</b>\n"
            "• <code>/sit</code> или ПКМ по ступенькам — сесть (анимация)"
        )
    },
    'links': {
        'emoji': '🔗',
        'title': 'Ссылки',
        'text': (
            "🔗 <b>Ссылки</b>\n\n"
            "💬 <b>Discord:</b> <a href=\"https://discord.gg/MWeUjNWJG3\">discord.gg/MWeUjNWJG3</a>\n\n"
            "📘 <b>ВКонтакте:</b> <a href=\"https://vk.com/totemcraftnet\">vk.com/totemcraftnet</a>\n\n"
            "🌐 <b>Сайт:</b> <a href=\"https://totemcraft.net\">totemcraft.net</a>\n\n"
            "📚 <b>Вики:</b> <a href=\"https://wiki.totemcraft.net\">wiki.totemcraft.net</a>"
        )
    },
}

CHAPTER_ORDER = ['rules', 'start', 'life', 'clans', 'commands', 'links']

def handbook_index_markup():
    markup = types.InlineKeyboardMarkup(row_width=2)
    buttons = []
    for key in CHAPTER_ORDER:
        ch = HANDBOOK_CHAPTERS[key]
        buttons.append(types.InlineKeyboardButton(f"{ch['emoji']} {ch['title']}", callback_data=f"hb_{key}"))
    markup.add(*buttons)
    markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="user_main_menu"))
    return markup

def handbook_chapter_markup():
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("🔙 К разделам", callback_data="hb_index"))
    markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="user_main_menu"))
    return markup

def show_handbook_index(chat_id, edit_message=None):
    text = (
        "📖 <b>Справочник TotemCraft</b>\n\n"
        "Выберите раздел:"
    )
    markup = handbook_index_markup()
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_handbook_chapter(chat_id, chapter_key, edit_message=None):
    if chapter_key not in HANDBOOK_CHAPTERS:
        return
    chapter = HANDBOOK_CHAPTERS[chapter_key]
    markup = handbook_chapter_markup()
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, chapter['text'], parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, chapter['text'], parse_mode='HTML', reply_markup=markup)


# ---------- Команды ----------
@bot.message_handler(commands=['pause'])
def pause_reg(m):
    if m.chat.id != ADMIN_ID: return
    global registration_paused
    registration_paused = True
    config['paused'] = True
    save_json(CONFIG_FILE, config)
    safe_send(m.chat.id, "⏸️ Регистрация приостановлена.")

@bot.message_handler(commands=['resume'])
def resume_reg(m):
    if m.chat.id != ADMIN_ID: return
    global registration_paused
    registration_paused = False
    config['paused'] = False
    save_json(CONFIG_FILE, config)
    safe_send(m.chat.id, "▶️ Регистрация возобновлена.")

@bot.message_handler(commands=['block'])
def block_user(m):
    if m.chat.id != ADMIN_ID: return
    parts = m.text.strip().split()
    if len(parts) < 2:
        safe_send(m.chat.id, "Использование: /block <user_id> [причина]")
        return
    try:
        tid = int(parts[1])
    except ValueError:
        safe_send(m.chat.id, "ID пользователя должно быть числом.")
        return
    reason = ' '.join(parts[2:]) if len(parts) > 2 else ''
    process_block(str(tid), reason, m)

@bot.message_handler(commands=['unblock'])
def unblock_user(m):
    if m.chat.id != ADMIN_ID: return
    try:
        tid = int(m.text.split()[1])
    except:
        safe_send(m.chat.id, "/unblock <id>"); return
    blocked_users.discard(tid)
    save_json(BLOCKED_FILE, list(blocked_users))
    safe_send(m.chat.id, f"✅ {tid} разблокирован.")
    try:
        safe_send(tid, "✅ Вы были разблокированы администратором. Можете снова пользоваться ботом.",
                  reply_markup=main_keyboard(is_admin=False, user_id=tid))
    except: pass

@bot.message_handler(commands=['status'])
def status_cmd(m):
    if m.chat.id != ADMIN_ID: return
    safe_send(m.chat.id, f"📌 Регистрация: {'приостановлена' if registration_paused else 'активна'}\n"
                         f"🚫 Заблокировано: {len(blocked_users)}\n"
                         f"📨 Диалог: {get_user_label(admin_reply_to) if admin_reply_to else 'нет'}")

@bot.message_handler(commands=['history'])
def history_cmd(m):
    if m.chat.id != ADMIN_ID: return
    try:
        target = int(m.text.split()[1])
    except:
        safe_send(m.chat.id, "/history <id>"); return
    msgs = chat_history.get(str(target), [])
    if not msgs:
        safe_send(m.chat.id, "История пуста."); return
    txt = f"📜 История с {enrich_user_label(target)}:\n" + "\n".join(
        f"{'👤' if x['from']=='user' else '👑'} {x['time']}: {x['text']}" for x in msgs)
    safe_send(m.chat.id, txt)

@bot.message_handler(commands=['stopreply'])
def stopreply_cmd(m):
    if m.chat.id != ADMIN_ID: return
    end_dialog(m)

# ---------- Старт ----------
@bot.message_handler(commands=['start'])
def start_cmd(m):
    if not check_rate_limit(m.chat.id): return
    is_admin = m.chat.id == ADMIN_ID
    if m.chat.id in blocked_users:
        try:
            bot.send_message(m.chat.id, "🚫 Вы заблокированы и не можете использовать бота.", reply_markup=types.ReplyKeyboardRemove())
        except: pass
        return
    if is_admin:
        send_admin_menu(m.chat.id)
    else:
        send_main_menu(m.chat.id)

# ---------- Основной обработчик текста ----------
@bot.message_handler(content_types=['text'])
def handle_all_messages(m):
    if not check_rate_limit(m.chat.id): return
    global admin_reply_to
    uid, text = m.chat.id, m.text.strip()

    if uid in blocked_users: return

    # Возврат в главное меню (для пользователя)
    if text == "🏠 Главное меню" and uid != ADMIN_ID:
        step = user_states.get(uid, {}).get('step')
        text_input_steps = {'nick', 'password', 'comment', 'support_nick', 'support_text', 'guest_message'}
        # Если пользователь в активном диалоге — кнопка не должна была быть видна,
        # но на всякий случай: не прерываем диалог, напоминаем
        if admin_reply_to == uid:
            safe_send(uid, "⚠️ Сейчас идёт диалог с администратором. Чтобы выйти — нажмите «❌ Завершить диалог».",
                      reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        # Если ждём ввода текста — тоже не сбрасываем молча, а предупреждаем
        if step in text_input_steps:
            safe_send(uid, "⚠️ Ввод прерван. Возвращаю в главное меню.")
            del user_states[uid]
        send_main_menu(uid)
        return
    if text == "❌ Отменить заявку":
        cancelled = False
        nick_cancelled = None
        # Отмена на этапе заполнения (до подтверждения)
        if uid in user_states:
            step = user_states[uid].get('step')
            if step not in ['support_nick', 'support_text', 'guest_message']:
                nick_cancelled = user_states[uid].get('nick')
                del user_states[uid]
                cancelled = True
        # Отмена уже поданной заявки (находится в pending)
        if not cancelled and str(uid) in pending:
            app = pending[str(uid)]
            nick_cancelled = app.get('nick', '?')
            del pending[str(uid)]
            save_json(PENDING_FILE, pending)
            # Сбрасываем таймер чтобы игрок мог подать заново немедленно
            if str(uid) in last_application:
                del last_application[str(uid)]
                save_json(LAST_APPLICATION_FILE, last_application)
            # Если админ как раз обрабатывает эту заявку — прерываем операцию
            if ADMIN_ID in admin_states and admin_states[ADMIN_ID].get('user_id') == str(uid):
                del admin_states[ADMIN_ID]
                safe_send(ADMIN_ID,
                    f"⚠️ <b>Заявка отменена игроком!</b>\n\n"
                    f"Игрок <code>{escape_html(nick_cancelled)}</code> (ID: <code>{uid}</code>) "
                    f"отозвал свою заявку пока вы вводили комментарий.\n"
                    f"Операция одобрения/отклонения прервана.",
                    parse_mode='HTML')
                send_admin_menu(ADMIN_ID)
                flush_admin_notifications()
            else:
                label = enrich_user_label(uid)
                notify_admin(
                    f"🔔 <b>Заявка отозвана игроком</b>\n\n"
                    f"Игрок {label} (<code>{escape_html(nick_cancelled)}</code>) отменил свою заявку.",
                    parse_mode='HTML')
                discord_application_cancelled(nick_cancelled, uid, app.get('username', ''), app.get('tg_name', ''))
                send_admin_menu(ADMIN_ID)
            cancelled = True
        if cancelled:
            safe_send(uid, "❌ Заявка отменена.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        # Кнопка нажата но нет активной заявки
        safe_send(uid, "У вас нет активной заявки.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return
    if uid in user_states:
        step = user_states[uid].get('step')
        if text == "❌ Отменить" and step in ['support_nick','support_text','guest_message']:
            del user_states[uid]
            safe_send(uid, "❌ Отменено.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return

    # Админ вводит комментарий/причину
    if uid == ADMIN_ID and ADMIN_ID in admin_states:
        state = admin_states[ADMIN_ID]
        if state.get('action') == 'search':
            query = text.strip().lower()
            del admin_states[ADMIN_ID]
            do_nick_search(uid, query)
            return
        if state.get('action') in ('approve', 'reject'):
            action_label = 'одобрению' if state['action'] == 'approve' else 'отклонению'
            # Удаляем сообщение с просьбой ввести комментарий
            if state.get('prompt_msg_id'):
                try:
                    bot.delete_message(chat_id=ADMIN_ID, message_id=state['prompt_msg_id'])
                except Exception:
                    pass
            # Удаляем само сообщение-комментарий администратора
            try:
                bot.delete_message(chat_id=m.chat.id, message_id=m.message_id)
            except Exception:
                pass
            process_admin_decision(state['action'], state['user_id'],
                                   text if text != '-' else '', state)
            del admin_states[ADMIN_ID]
            flush_admin_notifications()
            return
        if state.get('action') == 'block':
            target_id = state['user_id']
            reason = text if text != '-' else ''
            process_block(target_id, reason, m)
            del admin_states[ADMIN_ID]
            flush_admin_notifications()
            return

    # Админ в диалоге: любой текст — сообщение пользователю
    if uid == ADMIN_ID and admin_reply_to is not None:
        try:
            safe_send(admin_reply_to, f"📨 <b>Сообщение от администрации:</b>\n\n{escape_html(text)}", parse_mode='HTML')
            add_to_history(admin_reply_to, text, from_user=False)
            clear_unread(admin_reply_to)
        except Exception as e:
            log_error(e)
            safe_send(uid, f"❌ Ошибка отправки: {e}")
        return

    # Админ без диалога — любой текст возвращает в панель
    if uid == ADMIN_ID:
        send_admin_menu(uid)
        return

    # Пользовательские состояния (анкета, поддержка)
    if uid in user_states:
        state = user_states[uid]
        step = state.get('step')
        if step == 'support_nick':
            state['support_nick'] = text
            state['step'] = 'support_text'
            safe_send(uid, "Опишите вашу проблему или вопрос:", reply_markup=cancel_keyboard("❌ Отменить"))
            return
        elif step == 'support_text':
            nick = state.get('support_nick', '')
            text_msg = text
            add_to_history(uid, f"Игровой ник: {nick}\nСообщение: {text_msg}", from_user=True)
            add_unread(uid)
            tid = open_ticket(uid, message_text=text_msg, nick=nick)
            notify = format_admin_notify(m.from_user, text_msg, extra=f"Игровой ник: <code>{escape_html(nick)}</code>\n", ticket_id=tid)
            markup = types.InlineKeyboardMarkup()
            markup.add(types.InlineKeyboardButton("💬 Ответить", callback_data=f"reply_{uid}"),
                       types.InlineKeyboardButton("📜 История", callback_data=f"hist_{uid}"))
            markup.add(types.InlineKeyboardButton("🔒 Закрыть тикет", callback_data=f"admin_close_ticket_{uid}"),
                       types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{uid}"))
            notify_admin(notify, parse_mode='HTML', reply_markup=markup)
            discord_player_message(m.from_user, uid, nick, text_msg)
            del user_states[uid]
            safe_send(uid, f"✅ Ваше обращение отправлено администратору (тикет #{tid}). Ожидайте ответа.")
            send_main_menu(uid)
            return
        elif step == 'guest_message':
            text_msg = text
            add_to_history(uid, f"Гость: {text_msg}", from_user=True)
            add_unread(uid)
            tid = open_ticket(uid, message_text=text_msg)
            notify = format_admin_notify(m.from_user, text_msg, ticket_id=tid)
            markup = types.InlineKeyboardMarkup()
            markup.add(types.InlineKeyboardButton("💬 Ответить", callback_data=f"reply_{uid}"),
                       types.InlineKeyboardButton("📜 История", callback_data=f"hist_{uid}"))
            markup.add(types.InlineKeyboardButton("🔒 Закрыть тикет", callback_data=f"admin_close_ticket_{uid}"),
                       types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{uid}"))
            notify_admin(notify, parse_mode='HTML', reply_markup=markup)
            discord_guest_message(m.from_user, uid)
            del user_states[uid]
            safe_send(uid, f"✅ Ваше сообщение отправлено администратору (тикет #{tid}). Ожидайте ответа.")
            send_main_menu(uid)
            return
        else:
            handle_application(m)
            return

    # Общие кнопки гостя
    if text == "📝 Подать заявку на сервер":
        if registration_paused:
            safe_send(uid, "⏸️ Регистрация временно приостановлена."); return
        if uid in blocked_users:
            safe_send(uid, "🚫 Вы заблокированы."); return
        last_time_str = last_application.get(str(uid))
        if last_time_str:
            last_dt = datetime.fromisoformat(last_time_str)
            if datetime.now() - last_dt < timedelta(hours=24):
                remaining = last_dt + timedelta(hours=24) - datetime.now()
                hours, rem = divmod(remaining.seconds, 3600)
                minutes = rem // 60
                safe_send(uid, f"⏳ Вы уже подавали заявку. Пожалуйста, подождите {hours} ч. {minutes} мин. перед повторной отправкой.",
                          reply_markup=main_keyboard(is_admin=False, user_id=uid))
                return
        if str(uid) in pending:
            safe_send(uid, "⏳ У вас уже есть активная заявка. Дождитесь решения администратора."); return
        user_states[uid] = {'step': 'nick'}
        safe_send(uid, "Введите ваш Minecraft ник (3–16 символов, A-Z, a-z, 0-9, _):", reply_markup=cancel_keyboard("❌ Отменить заявку"))
        return
    if text == "🚨 Жалоба/вопрос админу":
        # Запрет писать при активной заявке
        if str(uid) in pending:
            safe_send(uid,
                "⚠️ <b>Обращение к администрации недоступно</b>\n\n"
                "У вас есть активная заявка на регистрацию, которая ожидает рассмотрения.\n\n"
                "Пожалуйста, дождитесь решения по вашей заявке - она будет рассмотрена в порядке очереди.\n\n"
                "<i>Обратиться к администрации можно только после получения решения по заявке.</i>",
                parse_mode='HTML', reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        # Предупреждение об использовании поддержки
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Понимаю, продолжить", callback_data="support_confirmed"),
                   types.InlineKeyboardButton("❌ Отмена", callback_data="support_cancel"))
        safe_send(uid,
            "📋 <b>Важная информация перед обращением</b>\n\n"
            "Данный канал связи предназначен исключительно для:\n"
            "• технических вопросов и проблем;\n"
            "• жалоб и спорных ситуаций;\n"
            "• сообщений об ошибках и неполадках.\n\n"
            "⛔ <b>Обращения со следующими вопросами не рассматриваются:</b>\n"
            "• «Когда рассмотрят мою заявку?»\n"
            "• «Зарегистрируйте меня быстрее»\n"
            "• и иные вопросы, касающиеся сроков рассмотрения заявок.\n\n"
            "❗ За подобные обращения заявка на регистрацию может быть <b>отклонена без объяснения причин</b>.\n\n"
            "Вы подтверждаете, что ваш вопрос соответствует указанным критериям?",
            parse_mode='HTML', reply_markup=markup)
        return
    if text == "📢 Подписаться на группу":
        markup = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("➡️ Перейти в группу", url="https://t.me/totemcraftnet"))
        safe_send(uid, "📢 <b>TotemCraft – игровое сообщество</b>\nПрисоединяйтесь к нашей группе!", parse_mode='HTML', reply_markup=markup)
        return
    if text == "📖 О сервере":
        show_handbook_index(uid)
        return
    if text == "❌ Завершить диалог" and uid != ADMIN_ID:
        if admin_reply_to == uid:
            end_dialog(m, user_initiated=True)
        else:
            safe_send(uid, "Нет активного диалога.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return
    if text == "📋 Мои обращения" and uid != ADMIN_ID:
        ticket = get_ticket(uid)
        if ticket:
            markup = types.InlineKeyboardMarkup()
            markup.add(types.InlineKeyboardButton("❌ Закрыть тикет", callback_data="close_ticket"))
            safe_send(uid, f"📋 У вас открыт тикет #{ticket['id']}. Ожидайте ответа администратора.", reply_markup=markup)
        else:
            safe_send(uid, "У вас нет открытых обращений.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return

    # Пользователь в активном диалоге с админом — пересылаем сообщение
    if admin_reply_to == uid:
        label = enrich_user_label(uid)
        add_to_history(uid, text, from_user=True)
        notify_admin(f"👤 {label}: {text}")
        return

    # Если у пользователя открытый тикет — не создаём новый, просим ждать
    ticket = get_ticket(uid)
    if ticket:
        safe_send(uid, f"⏳ У вас уже открыт тикет #{ticket['id']}. Пожалуйста, ожидайте ответа администратора.\n\nЕсли хотите закрыть обращение — нажмите кнопку ниже.",
                  reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return

    # Остальное — неизвестная команда, предлагаем меню
    send_main_menu(uid)

# ---------- Фото ----------
@bot.message_handler(content_types=['photo'])
def handle_photo(m):
    if not check_rate_limit(m.chat.id): return
    uid = m.chat.id
    if uid in blocked_users: return

    # Админ отправляет фото пользователю
    if uid == ADMIN_ID and admin_reply_to is not None:
        file_id = m.photo[-1].file_id
        caption = m.caption or ""
        try:
            bot.send_photo(admin_reply_to, file_id,
                           caption="📨 Фото от администрации" + (f"\n{caption}" if caption else ""))
            add_to_history(admin_reply_to, f"[фото от админа]{': ' + caption if caption else ''}", from_user=False)
            clear_unread(admin_reply_to)
        except Exception as e:
            log_error(e)
            safe_send(uid, f"❌ Ошибка отправки фото: {e}")
        return

    # Пользователь в активном диалоге отправляет фото админу
    if admin_reply_to == uid:
        label = enrich_user_label(uid)
        file_id = m.photo[-1].file_id
        caption = m.caption or ""
        try:
            bot.send_photo(ADMIN_ID, file_id,
                           caption=f"🖼 Фото от {label}" + (f"\n{caption}" if caption else ""))
            add_to_history(uid, f"[фото]{': ' + caption if caption else ''}", from_user=True)
            notify_admin(f"🖼 {label} прислал фото" + (f': «{caption}»' if caption else ""))
        except Exception as e:
            log_error(e)
        return

    # Вне диалога — подсказываем
    safe_send(uid, "📷 Картинки можно отправлять только во время активного диалога с администратором. Напишите ваше сообщение:",
              reply_markup=main_keyboard(is_admin=False, user_id=uid))

# ---------- Анкета ----------
def handle_application(m):
    uid, text = m.chat.id, m.text.strip()
    state = user_states[uid]
    step = state['step']

    if step == 'nick':
        ok, reason = validate_nick_authme(text)
        if not ok:
            safe_send(uid, f"❌ Недопустимый ник.\n\n{reason}\n\nПожалуйста, введите другой ник:", reply_markup=cancel_keyboard("❌ Отменить заявку"))
            return
        if check_nick_already_approved(text):
            safe_send(uid, "❌ Данный никнейм уже используется на сервере. Пожалуйста, выберите другой ник:", reply_markup=cancel_keyboard("❌ Отменить заявку"))
            return
        state['nick'] = text
        state['step'] = 'password'
        safe_send(uid, "🔑 Введите пароль (6–30 символов, без пробелов):", reply_markup=cancel_keyboard("❌ Отменить заявку"))
    elif step == 'password':
        ok, reason = validate_password_authme(text, nick=state.get('nick'))
        if not ok:
            safe_send(uid, f"❌ Недопустимый пароль.\n\n{reason}\n\nПожалуйста, придумайте другой пароль:", reply_markup=cancel_keyboard("❌ Отменить заявку"))
            return
        state['password'] = text
        state['step'] = 'comment'
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
        markup.add("Пропустить", "❌ Отменить заявку")
        safe_send(uid,
            "💬 Хотите оставить комментарий к заявке? Напишите сейчас или нажмите кнопку «Пропустить».\n\n"
            "<i>⚠️ Обращения с просьбами ускорить или осуществить регистрацию не рассматриваются и могут повлечь отклонение заявки.</i>",
            parse_mode='HTML', reply_markup=markup)
    elif step == 'comment':
        if text == "Пропустить":
            state['comment'] = ''
        else:
            state['comment'] = text
        show_confirmation(uid, state)

def show_confirmation(uid, state):
    try:
        bot.send_message(uid, " ", reply_markup=types.ReplyKeyboardRemove())
    except: pass
    nick = escape_html(state['nick'])
    password = escape_html(state['password'])
    comment = escape_html(state.get('comment', ''))
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.add(types.InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_yes"),
               types.InlineKeyboardButton("❌ Отмена", callback_data="confirm_no"))
    text = f"📋 <b>Проверьте данные:</b>\n\n👤 Ник: <code>{nick}</code>\n🔑 Пароль: <code>{password}</code>"
    if comment: text += f"\n💬 Комментарий: {comment}"
    text += "\n\nВсё верно?"
    safe_send(uid, text, parse_mode='HTML', reply_markup=markup)
    state['step'] = 'confirm'

# ---------- Callback-обработчик ----------
@bot.callback_query_handler(func=lambda call: True)
def callback_handler(call):
    global admin_reply_to, registration_paused
    if not check_rate_limit(call.from_user.id):
        bot.answer_callback_query(call.id); return
    data, uid, msg = call.data, call.from_user.id, call.message

    # --- Поддержка ---
    if data == "support_confirmed":
        if get_ticket(uid):
            ticket = get_ticket(uid)
            bot.answer_callback_query(call.id, f"У вас уже открыт тикет #{ticket['id']}", show_alert=True)
            safe_send(uid, f"⏳ У вас уже открыт тикет #{ticket['id']}. Дождитесь ответа или закройте его.",
                      reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Да, есть аккаунт", callback_data="support_existing"),
                   types.InlineKeyboardButton("❌ Нет аккаунта", callback_data="support_no_account"))
        safe_send(uid, "У вас уже есть аккаунт на сервере?", reply_markup=markup)
        bot.answer_callback_query(call.id)
        return
    if data == "support_cancel":
        safe_send(uid, "Обращение отменено.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        bot.answer_callback_query(call.id)
        return
    if data == "support_existing":
        if get_ticket(uid):
            ticket = get_ticket(uid)
            bot.answer_callback_query(call.id, f"У вас уже открыт тикет #{ticket['id']}", show_alert=True)
            return
        user_states[uid] = {'step': 'support_nick'}
        safe_send(uid, "Введите ваш игровой ник на сервере:", reply_markup=cancel_keyboard("❌ Отменить"))
        bot.answer_callback_query(call.id)
        return
    if data == "support_no_account":
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("📝 Подать заявку", callback_data="support_new"),
                   types.InlineKeyboardButton("✉️ Просто сообщение", callback_data="support_guest"))
        safe_send(uid, "Хотите подать заявку на регистрацию?", reply_markup=markup)
        bot.answer_callback_query(call.id)
        return
    if data == "support_new":
        if registration_paused:
            safe_send(uid, "⏸️ Регистрация временно приостановлена.")
        elif uid in blocked_users:
            safe_send(uid, "🚫 Вы заблокированы.")
        elif str(uid) in pending:
            safe_send(uid, "⏳ У вас уже есть активная заявка.")
        else:
            user_states[uid] = {'step': 'nick'}
            safe_send(uid, "Введите ваш Minecraft ник (3–16 символов, A-Z, a-z, 0-9, _):", reply_markup=cancel_keyboard("❌ Отменить заявку"))
        bot.answer_callback_query(call.id)
        return
    if data == "support_guest":
        if get_ticket(uid):
            ticket = get_ticket(uid)
            bot.answer_callback_query(call.id, f"У вас уже открыт тикет #{ticket['id']}", show_alert=True)
            return
        user_states[uid] = {'step': 'guest_message'}
        safe_send(uid, "✍️ Напишите ваше сообщение:", reply_markup=cancel_keyboard("❌ Отменить"))
        bot.answer_callback_query(call.id)
        return

    # --- Комментарий админа ---
    if data == "skip_admin_comment" and uid == ADMIN_ID and ADMIN_ID in admin_states:
        state = admin_states[ADMIN_ID]
        if state.get('action') in ('approve', 'reject'):
            # Удаляем сообщение с просьбой ввести комментарий (текущее сообщение с кнопками Пропустить/Отмена)
            try:
                bot.delete_message(chat_id=msg.chat.id, message_id=msg.message_id)
            except Exception:
                pass
            state['prompt_msg_id'] = None  # уже удалили выше
            process_admin_decision(state['action'], state['user_id'], '', state)
            del admin_states[ADMIN_ID]
        elif state.get('action') == 'block':
            try:
                bot.delete_message(chat_id=msg.chat.id, message_id=msg.message_id)
            except Exception:
                pass
            process_block(state['user_id'], '', msg)
            del admin_states[ADMIN_ID]
        flush_admin_notifications()
        bot.answer_callback_query(call.id, "Пропущено")
        return
    if data == "cancel_admin_comment" and uid == ADMIN_ID:
        if ADMIN_ID in admin_states:
            del admin_states[ADMIN_ID]
        flush_admin_notifications()
        bot.answer_callback_query(call.id, "Отменено")
        try:
            bot.delete_message(chat_id=msg.chat.id, message_id=msg.message_id)
        except Exception:
            pass
        send_admin_menu(ADMIN_ID)
        return

    # --- Подтверждение заявки ---
    if data in ("confirm_yes", "confirm_no"):
        if uid not in user_states:
            bot.answer_callback_query(call.id, "Заявка устарела."); return
        state = user_states[uid]
        if state.get('step') != 'confirm':
            bot.answer_callback_query(call.id, "Уже обработана."); return
        if data == "confirm_yes":
            last_time_str = last_application.get(str(uid))
            if last_time_str:
                last_dt = datetime.fromisoformat(last_time_str)
                if datetime.now() - last_dt < timedelta(hours=24):
                    remaining = last_dt + timedelta(hours=24) - datetime.now()
                    hours, rem = divmod(remaining.seconds, 3600)
                    minutes = rem // 60
                    safe_send(uid, f"⏳ Вы уже подавали заявку. Пожалуйста, подождите {hours} ч. {minutes} мин. перед повторной отправкой.",
                              reply_markup=main_keyboard(is_admin=False, user_id=uid))
                    del user_states[uid]
                    bot.answer_callback_query(call.id)
                    return
            # Показываем правила перед отправкой заявки
            state['step'] = 'rules'
            rules_text = (
                "📜 <b>Правила сервера</b>\n\n"
                "Перед отправкой заявки ознакомьтесь с правилами и подтвердите своё согласие:\n\n"
                "• Запрещено воровать и портить чужое имущество\n"
                "• Запрещены читы\n"
                "• Запрещено PvP без согласия двух сторон\n"
                "• Запрещена реклама\n"
                "• Запрещена политика\n"
                "• Запрещено оскорбление родных\n"
                "• Запрещены механизмы, нагружающие сервер (большое количество воронок)\n\n"
                "<i>Действия, которые могут не входить в список правил, но всё равно портят окружающим людям игровой процесс, могут повлечь за собой наказание — просто будьте вежливыми и не мешайте другим!</i>\n\n"
                "Вы принимаете правила сервера?"
            )
            rules_markup = types.InlineKeyboardMarkup(row_width=2)
            rules_markup.add(
                types.InlineKeyboardButton("Согласен", callback_data="rules_agree"),
                types.InlineKeyboardButton("Не согласен", callback_data="rules_disagree")
            )
            safe_send(uid, rules_text, parse_mode='HTML', reply_markup=rules_markup)
        else:
            safe_send(uid, "❌ Заявка отменена.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            del user_states[uid]
        bot.answer_callback_query(call.id)
        return

    # --- Правила сервера ---
    if data in ("rules_agree", "rules_disagree"):
        if uid not in user_states:
            bot.answer_callback_query(call.id, "Заявка устарела."); return
        state = user_states[uid]
        if state.get('step') != 'rules':
            bot.answer_callback_query(call.id, "Уже обработана."); return
        if data == "rules_agree":
            app_id = str(uid)
            pending[app_id] = {
                'user_id': uid,
                'username': call.from_user.username or f"id{uid}",
                'tg_name': user_display_name(call.from_user),
                'nick': state['nick'],
                'password': state['password'],
                'comment': state.get('comment', ''),
                'date': datetime.now().isoformat()
            }
            save_json(PENDING_FILE, pending)
            last_application[str(uid)] = datetime.now().isoformat()
            save_json(LAST_APPLICATION_FILE, last_application)
            dup_warning = ""
            if check_duplicate_tg_id(uid):
                dup_warning = f"\n⚠️ <b>Внимание:</b> данный TG ID уже подавал заявку ранее!"
            admin_markup = types.InlineKeyboardMarkup()
            admin_markup.add(types.InlineKeyboardButton("📋 Открыть заявки", callback_data="admin_menu_applications"))
            admin_msg = (
                f"📩 <b>Новая заявка!</b>\n"
                f"В очереди: <b>{len(pending)}</b>"
                f"{dup_warning}"
            )
            notify_admin(admin_msg, parse_mode='HTML', reply_markup=admin_markup)
            discord_new_application(call.from_user, uid, state['nick'], state['password'], state.get('comment', ''))
            safe_send(uid,
                "✅ <b>Ваша заявка принята и отправлена на рассмотрение.</b>\n\n"
                "📋 Заявки рассматриваются в порядке очереди. Срок рассмотрения - <b>как правило, до 24 часов</b>.\n\n"
                "Результат рассмотрения придёт вам автоматически.",
                parse_mode='HTML',
                reply_markup=main_keyboard(is_admin=False, user_id=uid))
        else:
            safe_send(uid, "❌ Заявка отменена - вы не приняли правила сервера.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        del user_states[uid]
        bot.answer_callback_query(call.id)
        return

    # --- Главное меню пользователя (инлайн-кнопка) ---
    if data == "user_main_menu":
        bot.answer_callback_query(call.id)
        send_main_menu(uid, edit_message=msg)
        return
    if data == "menu_my_tickets" and uid != ADMIN_ID:
        ticket = get_ticket(uid)
        if ticket:
            nick_line = f"🎮 Ник: <code>{escape_html(ticket['nick'])}</code>\n" if ticket.get('nick') else ""
            date_line = f"📅 Дата: {ticket.get('date', '—')}\n" if ticket.get('date') else ""
            msg_text = escape_html(ticket.get('message', '')) or '<i>нет текста</i>'
            text_out = (
                f"📋 <b>Тикет #{ticket['id']}</b>\n"
                f"Статус: 🟡 Открыт\n"
                f"{nick_line}"
                f"{date_line}\n"
                f"<b>Ваше обращение:</b>\n{msg_text}"
            )
            markup = types.InlineKeyboardMarkup()
            markup.add(types.InlineKeyboardButton("❌ Закрыть тикет", callback_data="close_ticket"))
            markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="user_main_menu"))
            safe_send(uid, text_out, parse_mode='HTML', reply_markup=markup)
        else:
            safe_send(uid, "У вас нет открытых обращений.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        bot.answer_callback_query(call.id)
        return
    if data == "close_ticket" and uid != ADMIN_ID:
        ticket = get_ticket(uid)
        if ticket:
            close_ticket(uid)
            label = enrich_user_label(uid)
            # Если с этим пользователем открыт диалог — завершаем его
            if admin_reply_to == uid:
                end_dialog(msg, user_initiated=True)
            else:
                safe_send(ADMIN_ID, f"🔔 Пользователь {label} закрыл тикет #{ticket['id']}.")
                send_admin_menu(ADMIN_ID)
            try:
                bot.edit_message_reply_markup(uid, msg.message_id, reply_markup=None)
            except Exception:
                pass
            safe_send(uid, "✅ Тикет закрыт.")
            send_main_menu(uid)
        else:
            safe_send(uid, "Тикет не найден.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        bot.answer_callback_query(call.id)
        return

    # --- Кнопки главного меню ---
    if data == "menu_apply":
        bot.answer_callback_query(call.id)
        if registration_paused:
            safe_send(uid, "⏸️ Регистрация временно приостановлена.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        if uid in blocked_users:
            safe_send(uid, "🚫 Вы заблокированы.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        last_time_str = last_application.get(str(uid))
        if last_time_str:
            last_dt = datetime.fromisoformat(last_time_str)
            if datetime.now() - last_dt < timedelta(hours=24):
                remaining = last_dt + timedelta(hours=24) - datetime.now()
                hours_r, rem = divmod(remaining.seconds, 3600)
                minutes_r = rem // 60
                safe_send(uid, f"⏳ Вы уже подавали заявку. Пожалуйста, подождите {hours_r} ч. {minutes_r} мин. перед повторной отправкой.",
                          reply_markup=main_keyboard(is_admin=False, user_id=uid))
                return
        if str(uid) in pending:
            safe_send(uid, "⏳ У вас уже есть активная заявка. Дождитесь решения администратора.")
            return
        user_states[uid] = {'step': 'nick'}
        safe_send(uid, "Введите ваш Minecraft ник (3–16 символов, A-Z, a-z, 0-9, _):", reply_markup=cancel_keyboard("❌ Отменить заявку"))
        return
    if data == "menu_support":
        bot.answer_callback_query(call.id)
        if str(uid) in pending:
            safe_send(uid,
                "⚠️ <b>Обращение к администрации недоступно</b>\n\n"
                "У вас есть активная заявка на регистрацию, которая ожидает рассмотрения.\n\n"
                "Пожалуйста, дождитесь решения по вашей заявке.\n\n"
                "<i>Обратиться к администрации можно только после получения решения по заявке.</i>",
                parse_mode='HTML')
            return
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Понимаю, продолжить", callback_data="support_confirmed"),
                   types.InlineKeyboardButton("❌ Отмена", callback_data="support_cancel"))
        safe_send(uid,
            "📋 <b>Важная информация перед обращением</b>\n\n"
            "Данный канал связи предназначен исключительно для:\n"
            "• технических вопросов и проблем;\n"
            "• жалоб и спорных ситуаций;\n"
            "• сообщений об ошибках и неполадках.\n\n"
            "⛔ <b>Обращения со следующими вопросами не рассматриваются:</b>\n"
            "• «Когда рассмотрят мою заявку?»\n"
            "• «Зарегистрируйте меня быстрее»\n\n"
            "❗ За подобные обращения заявка может быть <b>отклонена без объяснения причин</b>.\n\n"
            "Вы подтверждаете, что ваш вопрос соответствует указанным критериям?",
            parse_mode='HTML', reply_markup=markup)
        return
    if data == "menu_handbook":
        bot.answer_callback_query(call.id)
        show_handbook_index(uid, edit_message=msg)
        return
    if data == "menu_subscribe":
        bot.answer_callback_query(call.id)
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("➡️ Перейти в группу", url="https://t.me/totemcraftnet"))
        markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="user_main_menu"))
        edit_message_safe(uid, msg.message_id, "📢 TotemCraft – игровое сообщество\nПрисоединяйтесь к нашей группе!", reply_markup=markup)
        return

    # --- Справочник (доступен всем) ---
    if data == "hb_index":
        show_handbook_index(uid, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data.startswith("hb_"):
        chapter_key = data[3:]
        show_handbook_chapter(uid, chapter_key, edit_message=msg)
        bot.answer_callback_query(call.id)
        return

    # --- Только админ ---
    if uid != ADMIN_ID:
        bot.answer_callback_query(call.id, "Нет доступа."); return

    if data == "admin_back":
        send_admin_menu(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "admin_menu_applications":
        bot.answer_callback_query(call.id)
        show_pending_applications(ADMIN_ID, page=0, edit_message=msg)
        return
    if data.startswith('pending_page_'):
        page = int(data.split('_')[2])
        show_pending_applications(ADMIN_ID, page=page, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data.startswith('pending_goto_'):
        # Прыгнуть на конкретную заявку по TG ID
        target_id = data.split('_')[2]
        sorted_apps = sorted(pending.items(), key=lambda x: x[1].get('date', ''))
        idx = next((i for i, (aid, app) in enumerate(sorted_apps)
                    if str(app.get('user_id', aid)) == target_id), 0)
        show_pending_applications(ADMIN_ID, page=idx, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "noop":
        bot.answer_callback_query(call.id)
        return
    if data == "admin_menu_messages":
        bot.answer_callback_query(call.id)
        show_messages_menu(msg, edit_message=msg)
        return
    if data == "admin_menu_stats":
        bot.answer_callback_query(call.id)
        show_statistics(ADMIN_ID, edit_message=msg)
        return
    if data == "admin_menu_controls":
        bot.answer_callback_query(call.id)
        show_admin_controls(ADMIN_ID, edit_message=msg)
        return
    if data == "admin_end_dialog":
        end_dialog(msg)
        bot.answer_callback_query(call.id)
        return
    if data == "back_to_stats":
        show_statistics(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return

    if data == "show_approved":
        show_approved_list(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "show_rejected":
        show_rejected_list(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "show_blocked":
        show_blocked_users(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "show_apphistory":
        show_application_history(ADMIN_ID, page=0, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data.startswith('apphistory_page_'):
        page = int(data.split('_')[2])
        show_application_history(ADMIN_ID, page=page, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data == "admin_search":
        admin_states[ADMIN_ID] = {'action': 'search'}
        bot.answer_callback_query(call.id)
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel_admin_search"))
        safe_send(ADMIN_ID, "🔍 Введите ник (или его часть) для поиска:", reply_markup=markup)
        return
    if data == "cancel_admin_search":
        if ADMIN_ID in admin_states and admin_states[ADMIN_ID].get('action') == 'search':
            del admin_states[ADMIN_ID]
        send_admin_menu(ADMIN_ID, edit_message=msg)
        bot.answer_callback_query(call.id)
        return

    if data.startswith('approved_page_'):
        page = int(data.split('_')[2])
        show_approved_list(ADMIN_ID, page=page, edit_message=msg)
        bot.answer_callback_query(call.id)
        return
    if data.startswith('rejected_page_'):
        page = int(data.split('_')[2])
        show_rejected_list(ADMIN_ID, page=page, edit_message=msg)
        bot.answer_callback_query(call.id)
        return

    if data == "admin_pause":
        registration_paused = True; config['paused'] = True; save_json(CONFIG_FILE, config)
        bot.answer_callback_query(call.id, "Регистрация приостановлена.")
        show_admin_controls(ADMIN_ID, edit_message=msg)
    elif data == "admin_resume":
        registration_paused = False; config['paused'] = False; save_json(CONFIG_FILE, config)
        bot.answer_callback_query(call.id, "Регистрация возобновлена.")
        show_admin_controls(ADMIN_ID, edit_message=msg)
    elif data == "admin_status":
        bot.answer_callback_query(call.id)
        safe_send(ADMIN_ID, f"📌 Регистрация: {'приостановлена' if registration_paused else 'активна'}\n"
                            f"🚫 Заблокировано: {len(blocked_users)}\n"
                            f"📨 Диалог: {get_user_label(admin_reply_to) if admin_reply_to else 'нет'}")
    elif data == "admin_clearstats":
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Да, очистить статистику", callback_data="confirm_clearstats_yes"),
                   types.InlineKeyboardButton("❌ Нет", callback_data="confirm_clearstats_no"))
        safe_send(ADMIN_ID, "Вы уверены, что хотите очистить всю статистику и заявки?", reply_markup=markup)
        bot.answer_callback_query(call.id)
    elif data == "admin_resettimers":
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Да, сбросить таймеры", callback_data="confirm_resettimers_yes"),
                   types.InlineKeyboardButton("❌ Нет", callback_data="confirm_resettimers_no"))
        safe_send(ADMIN_ID, "Сбросить 24-часовой таймер повторной заявки для всех пользователей?", reply_markup=markup)
        bot.answer_callback_query(call.id)
    elif data == "admin_cleardialogs":
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("✅ Да, очистить диалоги", callback_data="confirm_cleardialogs_yes"),
                   types.InlineKeyboardButton("❌ Нет", callback_data="confirm_cleardialogs_no"))
        safe_send(ADMIN_ID, "Вы уверены, что хотите очистить историю всех диалогов?", reply_markup=markup)
        bot.answer_callback_query(call.id)
    elif data == "admin_help":
        help_text = (
            "📖 <b>Инструкция для администратора</b>\n\n"
            "• <b>Блокировка:</b> используйте кнопку «🚫 Заблокировать» в уведомлениях или команду /block &lt;ID&gt; &lt;причина&gt;.\n"
            "• <b>Разблокировка:</b> в разделе «Заблокированные» или команда /unblock &lt;ID&gt;.\n"
            "• <b>Заявки:</b> нажмите «Одобрить»/«Отклонить», можно оставить комментарий.\n"
            "• <b>Повторная заявка:</b> игрок не сможет подать заявку раньше чем через 24 часа.\n"
            "• <b>Сброс таймеров:</b> кнопка «⏰ Сбросить таймеры» снимает 24-часовой лимит для всех.\n"
            "• <b>Тикеты:</b> каждое обращение получает номер #N. Удалить через «Очистить диалоги»."
        )
        safe_send(ADMIN_ID, help_text, parse_mode='HTML')
        bot.answer_callback_query(call.id)
    elif data == "confirm_clearstats_yes":
        with open(APPROVED_CSV, 'w', newline='', encoding='utf-8-sig') as f:
            csv.writer(f).writerow(['Дата','TG_Username','TG_ID','Minecraft_Ник','Пароль','Статус','Комментарий_игрока','Комментарий_админа'])
        pending.clear(); save_json(PENDING_FILE, pending)
        bot.answer_callback_query(call.id, "Статистика и заявки очищены.")
        safe_send(ADMIN_ID, "🧹 Статистика и заявки полностью очищены.")
    elif data == "confirm_clearstats_no":
        bot.answer_callback_query(call.id, "Отменено.")
    elif data == "confirm_resettimers_yes":
        last_application.clear()
        save_json(LAST_APPLICATION_FILE, {})
        bot.answer_callback_query(call.id, "Таймеры сброшены.")
        safe_send(ADMIN_ID, "⏰ Таймеры 24-часового ожидания сброшены для всех пользователей.")
        send_admin_menu(ADMIN_ID)
    elif data == "confirm_resettimers_no":
        bot.answer_callback_query(call.id, "Отменено.")
    elif data == "confirm_cleardialogs_yes":
        chat_history.clear(); unread_messages.clear()
        active_tickets.clear(); save_tickets()
        save_json(CHAT_HISTORY_FILE, {}); save_json(MESSAGE_QUEUE_FILE, [])
        bot.answer_callback_query(call.id, "История диалогов очищена.")
        safe_send(ADMIN_ID, "🗑 История диалогов и все тикеты полностью очищены.")
    elif data == "confirm_cleardialogs_no":
        bot.answer_callback_query(call.id, "Отменено.")
    elif data.startswith('msg_page_'):
        page = int(data.split('_')[2])
        show_messages_menu(call.message, page=page, edit_message=msg)
        bot.answer_callback_query(call.id)
    elif data.startswith('msg_cat_'):
        # msg_cat_{category}_{page}
        parts = data.split('_')
        cat = parts[2]
        pg = int(parts[3])
        show_messages_menu(call.message, page=pg, edit_message=msg, category=cat)
        bot.answer_callback_query(call.id)
    elif data.startswith('user_profile_'):
        target_uid = data.split('_')[2]
        show_user_profile(ADMIN_ID, target_uid, msg)
        bot.answer_callback_query(call.id)
    elif data.startswith('admin_close_ticket_'):
        target = int(data.split('_')[3])
        ticket = get_ticket(target)
        if ticket:
            close_ticket(target)
            label = enrich_user_label(target)
            # Если с этим юзером открыт диалог — завершаем его тоже
            if admin_reply_to == target:
                admin_reply_to = None
                try:
                    safe_send(target, "🔇 Диалог с администратором завершён.",
                              reply_markup=main_keyboard(is_admin=False, user_id=target))
                except Exception:
                    pass
            else:
                try:
                    safe_send(target, f"✅ Ваш тикет #{ticket['id']} закрыт администратором.",
                              reply_markup=main_keyboard(is_admin=False, user_id=target))
                except Exception:
                    pass
            bot.answer_callback_query(call.id, f"Тикет #{ticket['id']} закрыт.")
            show_user_profile(ADMIN_ID, target, msg)
        else:
            bot.answer_callback_query(call.id, "Тикет уже закрыт.")
            show_user_profile(ADMIN_ID, target, msg)
    elif data.startswith('reply_'):
        try:
            target = int(data.split('_')[1])
            admin_reply_to = target
            clear_unread(target)
            i_markup = types.InlineKeyboardMarkup()
            i_markup.add(types.InlineKeyboardButton("❌ Завершить", callback_data="end_dialog"),
                         types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{target}"),
                         types.InlineKeyboardButton("✅ Разблокировать", callback_data=f"unblock_{target}"))
            label = enrich_user_label(target)
            safe_send(ADMIN_ID, f"📨 Диалог с <b>{escape_html(label)}</b> активирован.\nТеперь все ваши сообщения будут пересылаться этому пользователю.",
                      parse_mode='HTML', reply_markup=i_markup)
            send_admin_menu(ADMIN_ID)
            # Discord уведомление об открытии диалога
            try:
                tchat = bot.get_chat(target)
                t_nick = ""
                for app in pending.values():
                    if str(app.get('user_id')) == str(target):
                        t_nick = app.get('nick', '')
                        break
                discord_dialog_opened(t_nick or f"ID {target}", target, tchat.username or "")
            except Exception:
                pass
            try:
                safe_send(target, "📨 Администратор начал с вами диалог.", reply_markup=main_keyboard(is_admin=False, user_id=target))
            except: pass
            bot.answer_callback_query(call.id, f"Диалог с {target}")
        except Exception as e:
            log_error(e); bot.answer_callback_query(call.id, "Ошибка.")
    elif data.startswith('hist_'):
        target = int(data.split('_')[1])
        msgs = chat_history.get(str(target), [])
        if not msgs:
            bot.answer_callback_query(call.id, "История пуста.")
            return
        lines = []
        for x in list(msgs)[-20:]:
            who = '👤 Игрок' if x['from'] == 'user' else '👑 Админ'
            lines.append(f"{who} [{x['time']}]:\n{x['text']}")
        header = f"📜 История с {enrich_user_label(target)}:\n\n"
        history_text = header + "\n\n".join(lines)
        hist_markup = types.InlineKeyboardMarkup(row_width=1)
        hist_markup.add(types.InlineKeyboardButton("🔙 Назад к профилю", callback_data=f"user_profile_{target}"))
        hist_markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="admin_back"))
        safe_send_long(ADMIN_ID, history_text, reply_markup=hist_markup)
        bot.answer_callback_query(call.id)
    elif data == "end_dialog":
        end_dialog(msg); bot.answer_callback_query(call.id, "Диалог завершён.")
    elif data.startswith('block_'):
        target = int(data.split('_')[1])
        if admin_reply_to is not None and admin_reply_to != target:
            bot.answer_callback_query(call.id, "⚠️ Сначала завершите активный диалог!", show_alert=True)
            safe_send(ADMIN_ID, f"⚠️ У вас открыт диалог с пользователем {enrich_user_label(admin_reply_to)}.\n\n"
                                f"Сначала завершите его кнопкой «❌ Завершить диалог», затем заблокируйте.")
            return
        admin_states[ADMIN_ID] = {
            'action': 'block',
            'user_id': str(target),
            'msg_chat_id': msg.chat.id,
            'msg_message_id': msg.message_id
        }
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("Пропустить", callback_data="skip_admin_comment"),
                   types.InlineKeyboardButton("Отмена", callback_data="cancel_admin_comment"))
        safe_send(ADMIN_ID, f"✍️ Введите причину блокировки для {enrich_user_label(target)} или нажмите кнопку:", reply_markup=markup)
        bot.answer_callback_query(call.id)
    elif data.startswith('unblock_'):
        target = int(data.split('_')[1])
        blocked_users.discard(target)
        save_json(BLOCKED_FILE, list(blocked_users))
        bot.answer_callback_query(call.id, f"Пользователь {target} разблокирован.")
        try:
            if target not in blocked_users:
                safe_send(target, "✅ Вы были разблокированы администратором. Можете снова пользоваться ботом.",
                          reply_markup=main_keyboard(is_admin=False, user_id=target))
        except: pass
        if msg and msg.text and msg.text.startswith("🚫 Заблокированные"):
            show_blocked_users(ADMIN_ID, edit_message=msg)
    elif data.startswith('approve_') or data.startswith('reject_'):
        action = 'approve' if data.startswith('approve_') else 'reject'
        target_id = data.split('_')[1]
        # Защита: если открыт активный диалог с другим пользователем — предупредить
        if admin_reply_to is not None and str(admin_reply_to) != str(target_id):
            bot.answer_callback_query(call.id, "\u26a0\ufe0f Сначала завершите активный диалог!", show_alert=True)
            safe_send(ADMIN_ID, f"\u26a0\ufe0f У вас открыт диалог с пользователем {enrich_user_label(admin_reply_to)}.\n\n"
                                f"Сначала завершите его кнопкой «\u274c Завершить диалог», затем обработайте заявку.")
            return
        # Если одобряем — сразу отправляем authme register через webhook, не дожидаясь комментария
        if action == 'approve':
            app = pending.get(target_id)
            if app:
                send_console_command(f"authme register {app['nick']} {app['password']}")
        admin_states[ADMIN_ID] = {
            'action': action,
            'user_id': target_id,
            'app_msg_chat_id': msg.chat.id,
            'app_msg_message_id': msg.message_id
        }
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("Пропустить", callback_data="skip_admin_comment"),
                   types.InlineKeyboardButton("Отмена", callback_data="cancel_admin_comment"))
        action_label = 'одобрению' if action == 'approve' else 'отклонению'
        prompt_msg = safe_send(ADMIN_ID, f"\u270d\ufe0f Введите комментарий к {action_label} или нажмите кнопку.\n\n"
                            f"\u26a0\ufe0f <b>Не отвечайте сейчас на другие сообщения</b> - любой текст будет принят как комментарий.",
                  parse_mode='HTML', reply_markup=markup)
        if prompt_msg:
            admin_states[ADMIN_ID]['prompt_msg_id'] = prompt_msg.message_id
        bot.answer_callback_query(call.id)
    else:
        bot.answer_callback_query(call.id)

# ---------- Обработка решения по заявке ----------
def process_admin_decision(action, user_id_str, comment, state):
    app = pending.get(user_id_str)
    if not app:
        safe_send(ADMIN_ID, "⚠️ Заявка не найдена - возможно, игрок её уже отменил.")
        return
    status = 'Одобрено' if action == 'approve' else 'Отклонено'
    with open(APPROVED_CSV, 'a', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow([
            datetime.now().isoformat(),
            app['username'],
            app['user_id'],
            app['nick'],
            app['password'],
            status,
            app.get('comment', ''),
            comment
        ])
    del pending[user_id_str]
    save_json(PENDING_FILE, pending)

    # Редактируем карточку заявки — оставляем её в чате с пометкой решения
    action_icon = "✅" if action == 'approve' else "❌"
    action_label = "ОДОБРЕНО" if action == 'approve' else "ОТКЛОНЕНО"
    try:
        orig_chat_id = state.get('app_msg_chat_id', ADMIN_ID)
        orig_msg_id = state['app_msg_message_id']
        orig_msg_obj = bot.forward_message(ADMIN_ID, orig_chat_id, orig_msg_id) if False else None  # не нужно
        # Получаем текст оригинального сообщения и добавляем метку решения
        decided_at = datetime.now().strftime('%Y-%m-%d %H:%M')
        decision_suffix = f"\n\n{action_icon} <b>{action_label}</b> [{decided_at}]"
        if comment:
            decision_suffix += f"\n💬 Комментарий: {escape_html(comment)}"
        try:
            cur = bot.forward_message(ADMIN_ID, orig_chat_id, orig_msg_id) if False else None
        except Exception:
            pass
        # Редактируем оригинальное сообщение: убираем кнопки и добавляем итог
        try:
            cur_text = bot.edit_message_text(
                chat_id=orig_chat_id,
                message_id=orig_msg_id,
                text=f"📁 <b>Заявка закрыта</b>\n"
                     f"👤 Ник: <code>{escape_html(app['nick'])}</code>\n"
                     f"🧑 {escape_html(app.get('tg_name', '—'))}\n"
                     f"🆔 <code>{app['user_id']}</code>\n"
                     f"📛 @{escape_html(app.get('username',''))} \n"
                     f"📅 {app.get('date','')[:19].replace('T',' ')}"
                     f"{decision_suffix}",
                parse_mode='HTML',
                reply_markup=None
            )
        except Exception:
            pass
    except Exception:
        pass

    # Удаляем сообщение с просьбой ввести комментарий
    if state.get('prompt_msg_id'):
        try:
            bot.delete_message(chat_id=ADMIN_ID, message_id=state['prompt_msg_id'])
        except Exception:
            pass

    try:
        if action == 'approve':
            msg = (
                f"🎉 Ваша заявка одобрена!\n\n"
                f"Ник: <code>{escape_html(app['nick'])}</code>\n"
                f"Пароль: <code>{escape_html(app['password'])}</code>\n\n"
                f"IP для всех: <code>play.totemcraft.net</code>\n"
                f"IP для России: <code>ru.totemcraft.net</code>\n\n"
                f"Ждём вас на сервере!\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"💬 Основной актив сервера в дискорде - более 100 человек. "
                f"Общайся с игроками - вступай в Discord:\n"
                f"https://discord.gg/MWeUjNWJG3"
            )
            if comment:
                msg += f"\n\nКомментарий администратора: {escape_html(comment)}"
            uid_int = int(user_id_str)
            discord_banner_url = "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0b5061df29d55a92d945_full_logo_blurple_RGB.png"
            try:
                bot.send_photo(uid_int, discord_banner_url)
            except Exception:
                pass
            safe_send_long(uid_int, msg, parse_mode='HTML', reply_markup=main_keyboard(is_admin=False, user_id=uid_int))
        else:
            msg = "❌ Ваша заявка отклонена администратором."
            if comment:
                msg += f"\nКомментарий: {comment}"
            safe_send_long(int(user_id_str), msg, reply_markup=main_keyboard(is_admin=False, user_id=int(user_id_str)))
    except Exception as e:
        log_error(e)

    discord_decision_notify(app['nick'], status, comment)
    # Возврат в панель администратора
    send_admin_menu(ADMIN_ID)

# ---------- Блокировка ----------
def process_block(user_id_str, reason, original_msg):
    global admin_reply_to
    try:
        uid = int(user_id_str)
    except ValueError:
        safe_send(original_msg.chat.id, "Некорректный ID."); return
    blocked_users.add(uid)
    save_json(BLOCKED_FILE, list(blocked_users))

    # Завершаем диалог если он был активен с этим пользователем — до уведомлений
    was_in_dialog = (admin_reply_to == uid)
    if was_in_dialog:
        admin_reply_to = None
        close_ticket(uid)

    msg_text = "🚫 Вы были заблокированы администратором."
    if reason:
        msg_text += f"\nПричина: {reason}"
    try:
        bot.send_message(uid, msg_text, reply_markup=types.ReplyKeyboardRemove())
    except Exception as e:
        log_error(e)
        safe_send(original_msg.chat.id, f"Заблокирован, но не удалось уведомить {uid}: {e}")
        return

    if was_in_dialog:
        safe_send(ADMIN_ID, f"🔇 Диалог с {enrich_user_label(uid)} завершён — пользователь заблокирован.")
    safe_send(original_msg.chat.id, f"🚫 Пользователь {uid} заблокирован.")
    # Discord уведомление о блокировке
    try:
        t_nick = ""
        t_username = ""
        for app in pending.values():
            if str(app.get('user_id')) == str(uid):
                t_nick = app.get('nick', '')
                t_username = app.get('username', '')
                break
        if not t_username:
            try:
                tchat = bot.get_chat(uid)
                t_username = tchat.username or ""
            except Exception:
                pass
        discord_player_blocked(t_nick or f"ID {uid}", uid, t_username, reason)
    except Exception:
        pass
    # Возврат в главное меню после блокировки
    send_admin_menu(ADMIN_ID)

# ---------- Ежедневное напоминание ----------
def daily_job():
    reload_pending()
    if pending:
        discord_daily_reminder()
        try:
            safe_send(ADMIN_ID, f"⏳ Напоминание: в очереди {len(pending)} заявок(и). Проверьте бот.")
        except: pass

def run_scheduler():
    schedule.every().day.at("08:00", "Europe/Moscow").do(daily_job)
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == '__main__':
    print("✅ TotemCraftBot запущен")
    threading.Thread(target=run_scheduler, daemon=True).start()
    bot.infinity_polling()
