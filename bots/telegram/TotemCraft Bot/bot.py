import telebot
from telebot import types
import os, re, time, requests, threading, schedule, html as _html
from datetime import date, timedelta
from collections import defaultdict

from tcbot import config, storage, timeutil
from tcbot.config import TOKEN, ADMIN_ID, DISCORD_WEBHOOK_URL, CONSOLE_WEBHOOK_URL
from tcbot.logs import log_error, log_warning
from tcbot.rcon import rcon_command
from tcbot import autoaccept, bans, badwords, mmdb, tgage

bot = telebot.TeleBot(TOKEN)

# База: схема и разовый перенос старых файлов JSON/CSV
storage.migrate()

user_states = {}                                   # игрок -> шаг анкеты или обращения (в памяти, это черновик)
pending = storage.PersistentDict('pending')        # заявки в очереди: str(tg_id) -> данные заявки
blocked_users = storage.PersistentSet('blocked', int)
last_application = storage.PersistentDict('last_application')  # str(tg_id) -> UTC ISO последней подачи
active_tickets = storage.PersistentDict('tickets')  # str(tg_id) -> {'id', 'status', 'message', 'nick', 'date'}
unread_messages = storage.PersistentSet('unread', str)
registration_paused = bool(storage.setting('paused', False))

user_last_request = {}
RATE_LIMIT = 5
RATE_WINDOW = 5
RATE_COOLDOWN = 10
user_cooldown_until = {}

HIDDEN_PASSWORD = '***'

def save_json(_name, data):
    """Совместимость со старым кодом: записать изменения вложенных значений в базу."""
    data.sync()

def escape_md(text):
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', str(text))

def escape_html(text):
    """Экранирует спецсимволы для HTML parse_mode в Telegram."""
    return _html.escape(str(text), quote=False)

def tz_of(uid):
    """Пояс, в котором человеку показываем время: свой у админа, иначе по умолчанию (Москва)."""
    return staff.get(uid, {}).get('tz') or config.DEFAULT_TZ

def fmt_time(value, uid=None, pattern='%d.%m.%Y %H:%M'):
    """Время из базы (UTC) в поясе того, кто смотрит."""
    try:
        return timeutil.fmt(value, tz_of(uid), pattern)
    except (TypeError, ValueError):
        return str(value or '—')


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
    lines = []
    for line in text.split('\n'):
        # строку длиннее лимита (сообщение без переносов) режем на куски
        lines += [line[i:i + TG_MAX_LEN] for i in range(0, len(line), TG_MAX_LEN)] or ['']
    for line in lines:
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

def run_in_background(func, *args, **kwargs):
    """Запускает медленную работу (Discord, картинки, RCON) отдельно, чтобы кнопки не ждали её."""
    def runner():
        try:
            func(*args, **kwargs)
        except Exception as e:
            log_error(e)
    threading.Thread(target=runner, daemon=True).start()

def _post_webhook(url, payload):
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        log_error(e)

def post_discord(payload):
    if DISCORD_WEBHOOK_URL:
        run_in_background(_post_webhook, DISCORD_WEBHOOK_URL, payload)

def send_console_command(command):
    """Дублирует строку в канал консоли Discord. Команды отсюда сервер не выполняет."""
    if CONSOLE_WEBHOOK_URL:
        run_in_background(_post_webhook, CONSOLE_WEBHOOK_URL, {"content": command})

# Пароли одобренных игроков, которых не удалось зарегистрировать: ник -> пароль (только в памяти)
failed_registrations = {}

def register_on_server(nick, password, decided_by=None, player_id=None):
    """Регистрирует аккаунт в AuthMe через RCON. В Discord уходит команда со звёздочками."""
    send_console_command(f"authme register {nick} {'*' * 8}")
    try:
        answer = rcon_command(f"authme register {nick} {password}")
        failed_registrations.pop(nick, None)
        audit(None, 'registered', player_id, nick, answer)
        if answer:
            send_console_command(f"Ответ сервера: {answer}")
    except Exception as e:
        log_error(e)
        audit(None, 'reg_failed', player_id, nick, str(e))
        failed_registrations[nick] = (password, player_id)
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("🔁 Повторить регистрацию", callback_data=f"retry_reg_{nick}"))
        notify_staff(None, f"⚠️ Не удалось зарегистрировать <code>{escape_html(nick)}</code> на сервере: {escape_html(e)}\n\n"
                           f"Когда сервер будет доступен, нажмите кнопку. После перезапуска бота кнопка не сработает.",
                     reply_markup=markup, kind='reg', ref=nick,
                     only=sorted({a for a in (decided_by, ADMIN_ID) if a in staff}))

# ---------- Discord ----------
def discord_escape(text):
    """Для Discord: НЕ экранируем подчёркивания и другие символы в embed-полях — они отображаются как есть."""
    return str(text)

def discord_new_application(user, tg_id, nick, password, comment="", old_nicks=None, bans_found=0, test_by=None, risks=None,
                            verdict=""):
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
    if old_nicks:
        desc += "\n**Повторная заявка, прошлые ники:** " + ", ".join(f"`{discord_escape(n)}`" for n in old_nicks)
    if bans_found:
        desc += f"\n**⚠️ Блокировки:** найдено {bans_found}, подробности в Telegram"
    if test_by:
        desc += f"\n**🧪 Тестовая заявка** (режим игрока, {discord_escape(test_by)})"
    for risk in risks or []:
        desc += f"\n**🔴 Риск:** {discord_escape(risk)}"
    if verdict:
        desc += f"\n**Автомат:** {discord_escape(verdict)}"
    embed = {"title": "📩 Новая заявка", "description": desc, "color": 0xFFFF00,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def discord_decision_notify(nick, status, admin_comment="", decided_by=""):
    if not DISCORD_WEBHOOK_URL: return
    color = 0x00ff00 if status == 'Одобрено' else 0xff0000
    status_text = 'Одобрена' if status == 'Одобрено' else 'Отклонена'
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**Статус:** {status_text}"
    if decided_by:
        desc += f"\n**Рассмотрел:** {discord_escape(decided_by)}"
    if admin_comment:
        desc += f"\n**Комментарий админа:** {discord_escape(admin_comment)}"
    embed = {"title": f"📋 Заявка {status_text.lower()}", "description": desc, "color": color,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
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
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
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
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def discord_player_blocked(nick, tg_id, username, reason="", blocked_by=""):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}"
    if blocked_by:
        desc += f"\n**Заблокировал:** {discord_escape(blocked_by)}"
    if reason:
        desc += f"\n**Причина:** {discord_escape(reason)}"
    embed = {"title": "🚫 Игрок заблокирован", "description": desc, "color": 0xff4400,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def discord_dialog_opened(nick, tg_id, username, admin_name=""):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}"
    if admin_name:
        desc += f"\n**Администратор:** {discord_escape(admin_name)}"
    embed = {"title": "💬 Диалог открыт администратором", "description": desc, "color": 0x00aaff,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def discord_dialog_closed(nick, tg_id, username, by_user=False, admin_name=""):
    if not DISCORD_WEBHOOK_URL: return
    uname = f"@{username}" if username else "—"
    who = "игроком" if by_user else "администратором"
    if admin_name:
        who += f" ({discord_escape(admin_name)})"
    desc = f"**Игровой ник:** `{discord_escape(nick)}`\n**TG ID:** {tg_id}\n**TG Username:** {uname}\n**Закрыт:** {who}"
    embed = {"title": "🔇 Диалог (тикет) закрыт", "description": desc, "color": 0x888888,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
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
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def discord_staff_change(title, name, tg_id, role_text, by_name):
    if not DISCORD_WEBHOOK_URL: return
    desc = (f"**Кто:** {discord_escape(name)}\n**TG ID:** {tg_id}\n"
            f"**Роль:** {role_text}\n**Изменил:** {discord_escape(by_name)}")
    embed = {"title": title, "description": desc, "color": 0x9b59b6,
             "timestamp": timeutil.now_iso()}
    post_discord({"embeds": [embed]})

def discord_daily_reminder():
    if not DISCORD_WEBHOOK_URL: return
    reload_pending()
    if not pending: return
    desc = f"В очереди {len(pending)} заявок(и). Проверьте их в Telegram."
    embed = {"title": "⏳ Незакрытые заявки", "description": desc, "color": 0xffaa00,
             "timestamp": timeutil.now_iso()}
    try:
        post_discord({"embeds": [embed]})
    except Exception as e:
        log_error(e)

def reload_pending():
    pending.reload()

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
    return bool(storage.query("SELECT 1 FROM applications WHERE status='Одобрено' AND nick=? COLLATE NOCASE LIMIT 1",
                              (nick,)))

def check_duplicate_tg_id(tg_id):
    """
    Проверяет, подавал ли данный TG ID заявку ранее (по approved CSV).
    Возвращает True если был в прошлых заявках.
    """
    return bool(storage.query("SELECT 1 FROM applications WHERE tg_id=? LIMIT 1", (int(tg_id),)))

def previous_nicks(tg_id):
    """Ники, с которыми этот TG ID подавал заявки раньше (из истории заявок)."""
    rows = storage.query("SELECT nick FROM applications WHERE tg_id=? AND nick<>'' GROUP BY nick COLLATE NOCASE "
                         "ORDER BY MIN(id)", (int(tg_id),))
    return [r[0] for r in rows]

# ---------- Проверка блокировок на сервере (данные — tcbot/bans.py) ----------
def ban_report(tg_id, nick, viewer=None):
    """Блок для карточки заявки: наказания по нику заявки и по прошлым никам этого TG ID. Пусто, если ничего нет.
    Время показывается в поясе того, кто смотрит (viewer)."""
    try:
        nicks = [n for n in [nick] + [n for n in previous_nicks(tg_id) if n.lower() != (nick or '').lower()] if n]
        found, past, errors = bans.find(nicks)
    except Exception as e:
        log_error(e)
        return f"\n\n⚠️ Не удалось проверить блокировки: {escape_html(e)}"
    lines = []
    for it in found:
        until = "навсегда" if it['until'] is None else f"до {fmt_time(it['until'], viewer)}"
        lines.append(f"{it['icon']} <code>{escape_html(it['who'])}</code>: {escape_html(it['kind'])} ({until})\n"
                     f"    причина: {escape_html(it['reason'])}\n"
                     f"    выдал: {escape_html(it['operator'])}, {fmt_time(it['start'], viewer)} [{', '.join(it['sources'])}]")
    if past:
        lines.append("🕘 Раньше (сейчас сняты или истекли): " + ", ".join(f"{k}: {v}" for k, v in past.items()))
    text = ""
    if lines:
        checked = ", ".join(f"<code>{escape_html(n)}</code>" for n in nicks)
        if len(lines) > 12:
            lines = lines[:12] + [f"…и ещё {len(lines) - 12}"]
        text += f"\n\n🚨 <b>Блокировки</b> (проверены ники: {checked}):\n" + "\n".join(lines)
    for err in errors:
        text += f"\n⚠️ Не удалось проверить {escape_html(err)}"
    return text


# ---------- Досье игрока и проверки ----------
AUTHME_GEOIP = os.path.join(config.MC_SERVER_DIR, 'plugins', 'AuthMe', 'GeoLite2-Country.mmdb')
VERY_NEW_DAYS = 30        # «совсем новый» аккаунт Telegram: новее всех, кто подавал заявки 30+ дней назад
RAID_WINDOW_MIN = 60      # рейд: столько-то заявок от совсем новых аккаунтов за час
RAID_COUNT = 5
_frontier_cache = {'at': 0.0, 'anchors': [], 'border': None}

def _frontier():
    """Граница по истории заявок (обновляется раз в час):
    anchors — месяцы, когда подавал заявку самый свежий ID (для оценки возраста новых аккаунтов);
    border — (самый свежий ID среди заявок старше VERY_NEW_DAYS дней, дата)."""
    if time.time() - _frontier_cache['at'] < 3600:
        return _frontier_cache
    anchors, running = [], max(i for i, _ in tgage.ANCHORS)
    for month, max_id in storage.query(
            "SELECT substr(decided_at,1,7), MAX(tg_id) FROM applications WHERE tg_id IS NOT NULL "
            "AND decided_at IS NOT NULL GROUP BY 1 ORDER BY 1"):
        if max_id and max_id > running:  # только новые максимумы, иначе оценка «помолодеет» зря
            running = max_id
            anchors.append((max_id, date(int(month[:4]), int(month[5:7]), 1)))
    cutoff = (timeutil.now_utc() - timedelta(days=VERY_NEW_DAYS)).isoformat(timespec='seconds')
    row = storage.query("SELECT MAX(tg_id) FROM applications WHERE decided_at < ?", (cutoff,))
    _frontier_cache.update(at=time.time(), anchors=anchors, border=(row[0][0], cutoff) if row and row[0][0] else None)
    return _frontier_cache

def is_very_new(tg_id):
    """Аккаунт новее всех, кто подавал заявки больше VERY_NEW_DAYS дней назад. Возвращает дату-границу или None."""
    border = _frontier()['border']
    return border[1] if border and int(tg_id) > border[0] else None

def _flag_country(iso):
    return ''.join(chr(0x1F1E6 + ord(ch) - ord('A')) for ch in iso.upper()) if iso and len(iso) == 2 else ''

def _authme_time(value):
    """Время из AuthMe (миллисекунды или строка) -> UTC ISO."""
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            v = int(value)
            return timeutil.from_ms(v if v > 10 ** 11 else v * 1000).isoformat(timespec='seconds')
        return timeutil.parse(value).isoformat(timespec='seconds') if value else None
    except Exception:
        return None

def collect_tg_facts(user):
    """Что Telegram отдаёт о человеке: снимается при подаче заявки и хранится в ней."""
    facts = {'premium': bool(getattr(user, 'is_premium', False)), 'lang': user.language_code or '',
             'username': bool(user.username)}
    try:
        facts['photo'] = bot.get_user_profile_photos(user.id, limit=1).total_count > 0
    except Exception as e:
        log_error(e)
    return facts

def dossier(tg_id, nick, viewer=None, app=None, compact=False):
    """Досье игрока и предупреждения. Возвращает (текст для карточки, список (уровень, текст)).
    Каждый источник проверяется отдельно: сбой одного не мешает остальным."""
    tg_id = int(tg_id)
    lines, flags = [], []

    # Telegram
    try:
        line = f"📱 Telegram {tgage.describe(tg_id, _frontier()['anchors'])}"
        facts = (app or {}).get('tg') or {}
        if facts:
            marks = []
            if 'photo' in facts:
                marks.append("фото " + ("✅" if facts['photo'] else "❌"))
            marks.append("username " + ("✅" if facts.get('username') else "❌"))
            marks.append("Premium " + ("✅" if facts.get('premium') else "❌"))
            if facts.get('lang'):
                marks.append(f"язык {escape_html(facts['lang'])}")
            line += "\n    " + " · ".join(marks)
        lines.append(line)
        since = is_very_new(tg_id)
        if since:
            bare = facts and not facts.get('username') and facts.get('photo') is False
            flags.append(('🟡', f"Совсем новый аккаунт Telegram: новее всех, кто подавал заявки до {fmt_time(since, viewer, '%d.%m.%Y')}"
                                + (", без фото и username" if bare else "")))
    except Exception as e:
        log_error(e)
        lines.append(f"📱 Telegram: не удалось оценить ({escape_html(e)})")

    # История в боте
    try:
        rows = storage.query("SELECT status, COUNT(*) FROM applications WHERE tg_id=? GROUP BY status", (tg_id,))
        counts = dict(rows)
        if counts.get('Отклонено'):
            n = counts['Отклонено']
            times = "раза" if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else "раз"
            flags.append(('🟡', f"Раньше отклоняли: {n} {times}"))
        if tg_id in blocked_users:
            flags.append(('🔴', "Заблокирован в боте"))
    except Exception as e:
        log_error(e)

    # Сервер: аккаунты AuthMe, страна по IP, другие аккаунты с того же IP
    nicks = [n for n in [nick] + [n for n in previous_nicks(tg_id) if n.lower() != (nick or '').lower()] if n]
    ips = set()
    try:
        for username, ip, regip, regdate, lastlogin in bans.authme_accounts(nicks):
            geo = None
            try:
                geo = mmdb.country(AUTHME_GEOIP, ip or regip)
            except Exception as e:
                log_error(e)
            where = f", {_flag_country(geo[0])} {escape_html(geo[1])}" if geo else ""
            lines.append(f"🎮 Сервер: <code>{escape_html(username)}</code> рег. {fmt_time(_authme_time(regdate), viewer, '%d.%m.%Y')}, "
                         f"вход {fmt_time(_authme_time(lastlogin), viewer, '%d.%m.%Y')}{where}")
            ips.update(x for x in (ip, regip) if x and x not in ('127.0.0.1', '0.0.0.0'))
        if not compact and ips:
            others = [n for n in bans.authme_accounts_on_ips(sorted(ips)) if n.lower() not in {x.lower() for x in nicks}]
            if others:
                found, _, _ = bans.find(others)
                banned = sorted({it['who'] for it in found if it['icon'] == '🚫' and not it['who'].startswith('IP ')})
                lines.append("👥 С того же IP: " + ", ".join(f"<code>{escape_html(n)}</code>" for n in others[:10])
                             + (f" и ещё {len(others) - 10}" if len(others) > 10 else ""))
                if banned:
                    flags.append(('🔴', "С того же IP есть аккаунты в бане: " + ", ".join(escape_html(n) for n in banned[:5])))
    except Exception as e:
        log_error(e)
        lines.append(f"🎮 Сервер: не удалось прочитать AuthMe ({escape_html(e)})")

    # Действующие баны на своих никах и по IP (подробности — в блоке «Блокировки»)
    try:
        found, _, _ = bans.find(nicks)
        if any(it['icon'] == '🚫' for it in found):
            flags.append(('🔴', "Действующий бан на сервере (подробности ниже)"))
    except Exception as e:
        log_error(e)

    flags.sort(key=lambda f: f[0] != '🔴')
    check_line = "\n".join(f"{lvl} {txt}" for lvl, txt in flags) if flags else "✅ Проверки пройдены"
    text = "\n\n🧾 <b>Досье</b>\n" + "\n".join(lines) + "\n" + check_line
    return text, flags

def check_raid(uid):
    """Рейд: много заявок от совсем новых аккаунтов за час. Включает рейд-режим (если автовключение не выключено)
    или, если выключено, один раз предупреждает команду (не чаще раза в 3 часа)."""
    try:
        if not is_very_new(uid):
            return
        since = (timeutil.now_utc() - timedelta(minutes=RAID_WINDOW_MIN)).isoformat(timespec='seconds')
        ids = [r[0] for r in storage.query("SELECT DISTINCT target_id FROM audit WHERE action='app_submitted' AND ts >= ?", (since,))]
        fresh = [i for i in ids if i and is_very_new(i)]
        if len(fresh) < RAID_COUNT or raid_active():
            return
        reason = f"За последние {RAID_WINDOW_MIN} мин {len(fresh)} заявок от совсем новых аккаунтов Telegram."
        if storage.setting('raid_auto', True):
            set_raid(True, reason=reason)
            return
        last = storage.setting('raid_alert_at')
        if not last or timeutil.now_utc() - timeutil.parse(last) > timedelta(hours=3):
            storage.set_setting('raid_alert_at', timeutil.now_iso())
            notify_staff('apps', f"🔴 <b>Похоже на рейд</b>: {reason}\nАвтовключение рейд-режима выключено. "
                                 f"Включить вручную: «Управление» → «Автопринятие и рейды».")
            post_discord({"embeds": [{"title": "🔴 Похоже на рейд", "color": 0xff0000,
                                      "description": reason, "timestamp": timeutil.now_iso()}]})
    except Exception as e:
        log_error(e)

def check_rate_limit(user_id):
    if user_id in staff:
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
    msg += f"\nТекст: {escape_html(text[:1500])}"
    return msg

def notify_new_ticket(user, text_msg, tid, nick=''):
    """Новое обращение: уведомление всем, кто отвечает на сообщения."""
    uid = user.id
    extra = f"Игровой ник: <code>{escape_html(nick)}</code>\n" if nick else ""
    if uid in player_view:
        extra += f"🧪 Тест: написал {escape_html(staff_name(uid))} в режиме игрока\n"
    notify = format_admin_notify(user, text_msg, extra=extra, ticket_id=tid)
    B = types.InlineKeyboardButton
    markup = types.InlineKeyboardMarkup()
    markup.row(B("💬 Ответить", callback_data=f"reply_{uid}"), B("📜 Переписка", callback_data=f"hist_{uid}"))
    markup.row(B("🔒 Закрыть без ответа", callback_data=f"admin_close_ticket_{uid}"),
               B("🚫 Заблокировать", callback_data=f"block_{uid}"))
    audit(uid, 'ticket_opened', uid, nick, text_msg)
    notify_staff('messages', notify, reply_markup=markup, kind='ticket', ref=uid)

def player_nick(uid):
    """Самый свежий известный ник игрока: заявка в очереди, история заявок, тикет. Пусто, если не знаем."""
    app = pending.get(str(uid))
    if app and app.get('nick'):
        return app['nick']
    try:
        row = storage.query("SELECT nick FROM applications WHERE tg_id=? AND nick<>'' ORDER BY id DESC LIMIT 1", (int(uid),))
        if row:
            return row[0][0]
    except (TypeError, ValueError):
        return ''
    ticket = active_tickets.get(str(uid)) or {}
    return ticket.get('nick') or ''

def player_username(uid):
    app = pending.get(str(uid))
    name = (app or {}).get('username') or ''
    if not name:
        try:
            row = storage.query("SELECT tg_username FROM applications WHERE tg_id=? ORDER BY id DESC LIMIT 1", (int(uid),))
            name = row[0][0] if row else ''
        except (TypeError, ValueError):
            name = ''
    return '' if not name or name.startswith('id') else name

def get_user_label(uid):
    """Короткая подпись игрока для кнопок и списков: «Ник (@username)»."""
    nick, username = player_nick(uid), player_username(uid)
    if nick and username:
        return f"{nick} (@{username})"
    return nick or (f"@{username}" if username else f"ID {uid}")

def enrich_user_label(uid):
    try:
        chat = bot.get_chat(uid)
        first = chat.first_name or ""
        last = chat.last_name or ""
        username = chat.username or ""
    except:
        first = last = username = ""
    name = (first + " " + last).strip()
    nick = player_nick(uid)
    parts = [p for p in (name, f"@{username}" if username else '', f"[{nick}]" if nick else '') if p]
    return " ".join(parts) or f"ID {uid}"

def add_to_history(user_id, text, from_user=True, by=None):
    """Сообщение в переписку. by — кто из команды написал (игрок этого не видит)."""
    storage.add_message(user_id, 'user' if from_user else 'admin', text,
                        staff_id=by, staff_name=staff_name(by) if by is not None else None)

def add_unread(user_id):
    unread_messages.add(str(user_id))

def clear_unread(user_id):
    unread_messages.discard(str(user_id))

# ---------- Команда: админы, роли, журнал (база bot.db) ----------
ROLE_OWNER, ROLE_ADMIN, ROLE_HELPER = 'owner', 'admin', 'helper'
ROLE_NAMES = {ROLE_OWNER: 'Владелец', ROLE_ADMIN: 'Админ', ROLE_HELPER: 'Помощник'}
# Что может каждая роль
PERMS = {
    ROLE_OWNER:  {'apps', 'messages', 'block', 'stats', 'search', 'controls', 'journal', 'staff'},
    ROLE_ADMIN:  {'apps', 'messages', 'block', 'stats', 'search'},
    ROLE_HELPER: {'apps', 'search'},
}

def db_exec(sql, params=(), fetch=False):
    return storage.query(sql, params) if fetch else storage.execute(sql, params)

staff = {}  # tg_id -> {'name': ..., 'role': ..., 'tz': ...}

def load_staff():
    staff.clear()
    for tg_id, name, role, tz in db_exec("SELECT tg_id, name, role, tz FROM staff", fetch=True):
        staff[tg_id] = {'name': name, 'role': role, 'tz': tz}
    owner = staff.get(ADMIN_ID, {})
    staff[ADMIN_ID] = {'name': owner.get('name') or 'Владелец', 'role': ROLE_OWNER, 'tz': owner.get('tz')}

load_staff()

player_view = set()  # админы, которые сейчас смотрят бота глазами игрока

def is_staff(uid):
    """Член команды, который сейчас работает как админ (не в режиме игрока)."""
    return uid in staff and uid not in player_view

def can(uid, perm):
    return is_staff(uid) and perm in PERMS.get(staff[uid]['role'], set())

def staff_name(uid):
    return staff[uid]['name'] if uid in staff else f"ID {uid}"

def staff_with(perm):
    return [a for a, s in staff.items() if perm in PERMS.get(s['role'], set())]

ACTION_NAMES = {
    'app_submitted': '📩 подал заявку', 'app_cancelled': '↩️ отозвал заявку',
    'approved': '✅ одобрил заявку', 'rejected': '❌ отклонил заявку',
    'registered': '🎮 зарегистрирован на сервере', 'reg_failed': '⚠️ регистрация не прошла',
    'ticket_opened': '🎫 открыл обращение', 'ticket_closed_by_player': '🔒 закрыл своё обращение',
    'dialog_opened': '💬 начал диалог', 'dialog_closed': '🔇 завершил диалог',
    'msg_to_player': '✉️ написал игроку', 'ticket_closed': '🔒 закрыл обращение без ответа',
    'blocked': '🚫 заблокировал в боте', 'unblocked': '✅ разблокировал в боте',
    'paused': '⏸️ приостановил регистрацию', 'resumed': '▶️ возобновил регистрацию',
    'reset_timers': '⏰ сбросил таймеры заявок', 'clear_stats': '🧹 очистил статистику',
    'clear_dialogs': '🗑 очистил историю диалогов',
    'staff_added': '👥 выдал доступ', 'staff_role': '👥 сменил роль', 'staff_removed': '👥 снял доступ',
    'auto_on': '🤖 включил автопринятие', 'auto_off': '🤖 выключил автопринятие', 'auto_limit': '🤖 упёрся в лимит автопринятия',
    'raid_on': '🛡 включил рейд-режим', 'raid_off': '🛡 выключил рейд-режим',
    'raid_auto_on': '🛡 включил автовключение рейд-режима', 'raid_auto_off': '🛡 выключил автовключение рейд-режима',
    'word_added': '📖 добавил слово в словарь', 'word_removed': '📖 убрал слово из словаря',
}

def audit(actor_id, action, target_id=None, target_nick='', details='', actor_role=None):
    """Запись в журнал: кто, что и с кем сделал. actor_id=None — действие самого бота."""
    try:
        if actor_role is None:
            actor_role = staff[actor_id]['role'] if actor_id in staff else ('system' if actor_id is None else 'player')
        name = 'бот' if actor_id is None else (staff_name(actor_id) if actor_role != 'player' else '')
        db_exec("INSERT INTO audit (ts, actor_id, actor_name, actor_role, action, target_id, target_nick, details) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (timeutil.now_iso(), actor_id, name, actor_role, action,
                 int(target_id) if target_id not in (None, '') else None, target_nick or '', (details or '')[:2000]))
    except Exception as e:
        log_error(e)

def last_decision(target_id):
    """Кто и когда последним рассмотрел заявку игрока: (имя, время, действие) или None."""
    try:
        rows = db_exec("SELECT actor_name, ts, action FROM audit WHERE target_id=? AND action IN ('approved','rejected') "
                       "ORDER BY id DESC LIMIT 1", (int(target_id),), fetch=True)
        return rows[0] if rows else None
    except Exception as e:
        log_error(e)
        return None

# ---------- Уведомления команде ----------
admin_states = {}                          # admin_id -> что админ сейчас вводит
delayed_notifications = defaultdict(list)  # admin_id -> уведомления, отложенные на время ввода комментария
dialogs = storage.PersistentDict('dialogs', int)  # admin_id -> player_id: с кем админ в диалоге (переживает перезапуск)
app_claims = {}                            # player_id (str) -> admin_id: кто сейчас пишет решение по заявке

def dialog_admin(player_id):
    """Админ, который ведёт диалог с игроком, или None."""
    return next((a for a, p in dialogs.items() if p == player_id), None)

def _deliver(aid, text, markup, kind, ref):
    m = safe_send(aid, text, parse_mode='HTML', reply_markup=markup)
    if m and kind:
        try:
            db_exec("INSERT INTO notices VALUES (?,?,?,?,?)", (kind, str(ref), aid, m.message_id, text))
        except Exception as e:
            log_error(e)

def notify_staff(perm, text, reply_markup=None, kind=None, ref=None, only=None):
    """Уведомление всем, у кого есть право perm (или списку only).
    Кто сейчас вводит комментарий, получит его после ввода.
    kind/ref запоминают сообщение, чтобы потом у всех дописать итог (close_notices)."""
    for aid in (only if only is not None else staff_with(perm)):
        if aid in admin_states:
            delayed_notifications[aid].append((text, reply_markup, kind, ref))
        else:
            _deliver(aid, text, reply_markup, kind, ref)

def flush_admin_notifications(aid):
    """Доставляет админу уведомления, отложенные на время ввода комментария."""
    items = delayed_notifications.pop(aid, [])
    if items:
        safe_send(aid, f"📬 Пока вы вводили комментарий, пришло уведомлений: {len(items)}")
        for text, markup, kind, ref in items:
            _deliver(aid, text, markup, kind, ref)

def close_notices(kind, ref, footer):
    """Дописывает итог к уведомлению у всех админов и убирает кнопки, чтобы дело не взяли дважды."""
    try:
        rows = db_exec("SELECT chat_id, message_id, text FROM notices WHERE kind=? AND ref=?", (kind, str(ref)), fetch=True)
        db_exec("DELETE FROM notices WHERE kind=? AND ref=?", (kind, str(ref)))
    except Exception as e:
        log_error(e)
        return
    now = timeutil.now_iso()
    def edit_all():
        for chat_id, message_id, text in rows:
            line = footer.replace('{t}', fmt_time(now, chat_id, '%H:%M'))
            try:
                bot.edit_message_text(f"{text}\n\n{line}"[:TG_MAX_LEN], chat_id, message_id, parse_mode='HTML', reply_markup=None)
            except Exception:
                pass
    run_in_background(edit_all)
    # Отложенные, ещё не доставленные уведомления по этому делу тоже устарели
    for aid in list(delayed_notifications):
        delayed_notifications[aid] = [n for n in delayed_notifications[aid] if not (n[2] == kind and str(n[3]) == str(ref))]

def open_ticket(user_id, message_text='', nick=''):
    """Открывает новый тикет для пользователя. Возвращает номер тикета."""
    number = storage.next_counter('ticket_counter')
    active_tickets[str(user_id)] = {
        'id': number,
        'status': 'open',
        'message': message_text,
        'nick': nick,
        'date': timeutil.now_iso()
    }
    return number

def close_ticket(user_id):
    """Закрывает тикет пользователя."""
    active_tickets.pop(str(user_id), None)

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
        in_active_dialog = user_id is not None and dialog_admin(user_id) is not None

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
    my_dialog = dialogs.get(chat_id)
    B = types.InlineKeyboardButton

    inline = types.InlineKeyboardMarkup(row_width=2)
    if can(chat_id, 'apps'):
        inline.row(B("📋 Заявки" + (f" • {pending_count}" if pending_count else ""), callback_data="admin_menu_applications"))
    if can(chat_id, 'messages'):
        inline.row(B("💬 Сообщения" + (f" • {unread_count}" if unread_count else ""), callback_data="admin_menu_messages"))
    row = [B("🔍 Поиск по нику", callback_data="admin_search")] if can(chat_id, 'search') else []
    if can(chat_id, 'stats'):
        row.append(B("📊 Статистика", callback_data="admin_menu_stats"))
    if row:
        inline.row(*row)
    row = []
    if can(chat_id, 'journal'):
        row.append(B("📒 Журнал", callback_data="jr_a_0_0"))
    if can(chat_id, 'staff'):
        row.append(B("👥 Команда", callback_data="staff_list"))
    if row:
        inline.row(*row)
    inline.row(B("⚙️ Управление и настройки", callback_data="admin_menu_controls"))
    inline.row(B("👤 Посмотреть как игрок", callback_data="player_view_on"))
    if my_dialog:
        inline.row(B(f"🔴 Завершить диалог с {get_user_label(my_dialog)}", callback_data="admin_end_dialog"))

    lines = ["🛡 <b>Панель администратора</b>"]
    if can(chat_id, 'staff'):
        lines.append(f"👑 {escape_html(staff_name(chat_id))}")
    if pending_count and can(chat_id, 'apps'):
        lines.append(f"⏳ Ожидают рассмотрения: <b>{pending_count}</b>")
    if can(chat_id, 'apps') and raid_active():
        lines.append("🛡 <b>Рейд-режим</b>: автопринятие на паузе")
    if can(chat_id, 'controls') and auto_enabled() and not raid_active():
        hour, day = auto_counts()
        lines.append(f"🤖 Автопринятие: вкл · сегодня {day}/{autoaccept.LIMIT_DAY}")
    if unread_count and can(chat_id, 'messages'):
        lines.append(f"📬 Непрочитанных сообщений: <b>{unread_count}</b>")
    busy = [f"{escape_html(staff_name(a))} ↔ {escape_html(get_user_label(p))}" for a, p in dialogs.items() if a != chat_id]
    if my_dialog:
        lines.append(f"💬 Ваш диалог: <b>{escape_html(enrich_user_label(my_dialog))}</b>")
    if busy and can(chat_id, 'messages'):
        lines.append("🗣 Диалоги коллег: " + "; ".join(busy))
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
    if uid in player_view:
        # Кнопку видит только админ в режиме игрока, обычным игрокам её нет
        text = "🏠 Главное меню\n\n🧪 <i>Режим игрока: вы видите бота как обычный игрок. Заявки отсюда помечаются как тестовые и не регистрируются на сервере.</i>"
        buttons.append(types.InlineKeyboardButton("🛡 Вернуться в админку", callback_data="player_view_off"))
    inline.add(*buttons)
    if edit_message:
        # Редактируем существующее сообщение вместо нового
        edit_message_safe(uid, edit_message.message_id, text, parse_mode='HTML', reply_markup=inline)
    else:
        # Убираем реплай-клавиатуру и отправляем инлайн-меню.
        try:
            rm = bot.send_message(uid, "...", reply_markup=types.ReplyKeyboardRemove())
            bot.delete_message(uid, rm.message_id)
        except Exception:
            pass
        safe_send(uid, text, parse_mode='HTML', reply_markup=inline)


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
    page = max(0, min(page, total - 1))  # коллега мог закрыть заявку, пока листали
    app_id, app = sorted_apps[page]
    try:
        nick = escape_html(app.get('nick', '?'))
        comment = escape_html(app.get('comment', ''))
        user_id = app.get('user_id', app_id)
        username = app.get('username', '')
        tg_name = escape_html(app.get('tg_name', ''))
        date_str = fmt_time(app.get('date'), chat_id)
        display_name = f"@{escape_html(username)}" if username and not username.startswith('id') else f"ID {user_id}"
        hidden_pw = '●' * len(app.get('password', ''))
        text = f"📩 <b>Заявка {page + 1} из {total}</b>\n"
        if app.get('test_by'):
            text += f"🧪 <b>Тестовая</b> (режим игрока, {escape_html(staff_name(app['test_by']))}): на сервере не регистрируется\n"
        claimer = app_claims.get(str(user_id))
        if claimer and claimer != chat_id:
            text += f"⏳ <b>Сейчас рассматривает: {escape_html(staff_name(claimer))}</b>\n"
        text += (
            f"👤 Ник: <code>{nick}</code>\n"
            f"🔑 Пароль: <code>{hidden_pw}</code>\n"
            f"🧑 Имя TG: {tg_name if tg_name else '—'}\n"
            f"🆔 ID TG: <code>{user_id}</code>\n"
            f"📛 Username: {display_name}"
        )
        if comment:
            text += f"\n💬 Комментарий: {comment}"
        text += f"\n📅 {date_str}"
        old_nicks = previous_nicks(user_id)
        if old_nicks:
            listed = ", ".join(f"<code>{escape_html(n)}</code>" for n in old_nicks)
            text += f"\n\n⚠️ <b>Внимание:</b> данный TG ID (<code>{user_id}</code>) уже подавал заявку ранее! Ники: {listed}"
        line = auto_line(app, chat_id)
        if line:
            text += "\n\n" + line
        text += dossier(user_id, app.get('nick', ''), chat_id, app=app)[0]
        text += ban_report(user_id, app.get('nick', ''), chat_id)
        if len(text) > TG_MAX_LEN:
            text = text[:TG_MAX_LEN - 1] + '…'
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
        extra = []
        if can(chat_id, 'messages'):
            extra.append(types.InlineKeyboardButton("💬 Написать", callback_data=f"reply_{user_id}"))
        if can(chat_id, 'block'):
            extra.append(types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{user_id}"))
        if extra:
            markup.row(*extra)
        if can(chat_id, 'journal'):
            markup.row(types.InlineKeyboardButton("📒 Журнал по игроку", callback_data=f"jr_p_{user_id}_0"))
        markup.row(types.InlineKeyboardButton("🔙 Главное меню", callback_data="admin_back"))
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
                'date': fmt_time(app.get('date'), chat_id, '%d.%m.%Y'),
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
                'date': fmt_time(row[0], chat_id, '%d.%m.%Y'),
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
        elif r['tg_id'] and can(chat_id, 'messages'):
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
    # Список по PROFILES_PER_PAGE, новые сверху; кнопка ника открывает карточку
    total = len(all_rows)
    pages = (total + PROFILES_PER_PAGE - 1) // PROFILES_PER_PAGE
    page = max(0, min(page, pages - 1))
    first = total - 1 - page * PROFILES_PER_PAGE
    indexes = range(first, max(first - PROFILES_PER_PAGE, -1), -1)
    markup = types.InlineKeyboardMarkup(row_width=3)
    for i in indexes:
        row = all_rows[i]
        icon = '✅' if len(row) > 5 and row[5] == 'Одобрено' else ('❌' if len(row) > 5 and row[5] == 'Отклонено' else '⏳')
        nick = row[3] if len(row) > 3 else '—'
        markup.add(types.InlineKeyboardButton(f"{icon} {nick} · {fmt_time(row[0], chat_id, '%d.%m.%Y')}", callback_data=f"apphistory_view_{i}"))
    nav = []
    if page > 0:
        nav.append(types.InlineKeyboardButton("◀️", callback_data=f"apphistory_page_{page - 1}"))
    nav.append(types.InlineKeyboardButton(f"{page + 1}/{pages}", callback_data="noop"))
    if page < pages - 1:
        nav.append(types.InlineKeyboardButton("▶️", callback_data=f"apphistory_page_{page + 1}"))
    markup.add(*nav)
    markup.add(types.InlineKeyboardButton("🔍 Поиск по нику", callback_data="admin_search"))
    markup.add(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_menu_stats"))
    text = f"👥 <b>Профили пользователей</b>\nВсего заявок: {total}, новые сверху. Страница {page + 1} из {pages}."
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

PROFILES_PER_PAGE = 10

def show_application_card(chat_id, index, edit_message=None):
    """Карточка одной заявки из истории. index — номер строки в CSV."""
    all_rows = read_approved_csv()
    if not all_rows:
        show_application_history(chat_id, edit_message=edit_message)
        return
    total = len(all_rows)
    index = max(0, min(index, total - 1))
    row = all_rows[index]  # [Дата, TG_Username, TG_ID, MC_Ник, Пароль, Статус, Комм_игрока, Комм_админа]
    num = total - index  # номер в списке «новые сверху»
    date_s = fmt_time(row[0], chat_id)
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
    if len(row) > 8 and row[8]:
        text += f"\n🛡 Рассмотрел: {escape_html(row[8])}"
    markup = types.InlineKeyboardMarkup(row_width=3)
    nav = []
    if index < total - 1:
        nav.append(types.InlineKeyboardButton("◀️", callback_data=f"apphistory_view_{index + 1}"))
    nav.append(types.InlineKeyboardButton(f"{num}/{total}", callback_data="noop"))
    if index > 0:
        nav.append(types.InlineKeyboardButton("▶️", callback_data=f"apphistory_view_{index - 1}"))
    markup.add(*nav)
    if str(tg_id).isdigit() and can(chat_id, 'messages'):
        markup.add(types.InlineKeyboardButton("👤 Профиль и сообщения", callback_data=f"user_profile_{tg_id}"))
    if str(tg_id).isdigit() and can(chat_id, 'journal'):
        markup.add(types.InlineKeyboardButton("📒 Журнал по игроку", callback_data=f"jr_p_{tg_id}_0"))
    markup.add(types.InlineKeyboardButton("🔙 К списку", callback_data=f"apphistory_page_{(total - 1 - index) // PROFILES_PER_PAGE}"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_statistics(chat_id, edit_message=None):
    total_approved = total_rejected = today_approved = today_rejected = 0
    day_start, day_end = timeutil.today_bounds_iso(tz_of(chat_id))  # «сегодня» в поясе админа
    for status, total, today in storage.query(
            "SELECT status, COUNT(*), SUM(decided_at >= ? AND decided_at < ?) FROM applications GROUP BY status",
            (day_start, day_end)):
        if status == 'Одобрено':
            total_approved, today_approved = total, today or 0
        elif status == 'Отклонено':
            total_rejected, today_rejected = total, today or 0
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
    """История заявок строками в прежнем порядке столбцов:
    [решение (UTC ISO), TG username, TG ID, ник, '***', статус, комм. игрока, комм. админа, рассмотрел]."""
    return [[a['decided_at'] or '', a['tg_username'] or '', str(a['tg_id'] or ''), a['nick'] or '', HIDDEN_PASSWORD,
             a['status'] or '', a['player_comment'] or '', a['admin_comment'] or '', a['decided_by_name'] or '']
            for a in storage.applications()]

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
    lines = [f"• <code>{escape_html(r[3])}</code> | {fmt_time(r[0], chat_id, '%d.%m.%Y')} | @{escape_html(r[1])}" for r in chunk]
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
    lines = [f"• <code>{escape_html(r[3])}</code> | {fmt_time(r[0], chat_id, '%d.%m.%Y')} | @{escape_html(r[1])}" for r in chunk]
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
    last_times = storage.message_users()
    uids_with_history = list(last_times)
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
        return last_times.get(uid) or '0'

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
        talker = dialog_admin(int(uid)) if uid.isdigit() else None
        if talker:
            label += f" · 💬 {staff_name(talker)}"  # видно, кто из команды уже отвечает
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

    # Заявки игрока: сколько, с какими никами, кто рассмотрел последнюю
    apps = [r for r in read_approved_csv() if len(r) >= 6 and str(r[2]) == str(uid)]
    if apps:
        ok_n = sum(1 for r in apps if r[5] == 'Одобрено')
        nicks = ", ".join(dict.fromkeys(f"<code>{escape_html(r[3])}</code>" for r in apps))
        lines.append(f"🗂 Заявок: {len(apps)} (✅ {ok_n}, ❌ {len(apps) - ok_n}), ники: {nicks}")
        last = apps[-1]
        decider = f", рассмотрел: {escape_html(last[8])}" if len(last) > 8 and last[8] else ""
        lines.append(f"    последняя: {fmt_time(last[0], admin_chat_id, '%d.%m.%Y')}, {escape_html(last[5])}{decider}")
    if str(uid) in pending:
        lines.append("⏳ Сейчас есть заявка на рассмотрении")

    # Статистика обращений
    msgs = storage.get_messages(uid, 5)
    lines.append(f"\n📨 Сообщений в истории: {storage.message_count(uid)}")
    ticket = get_ticket(uid)
    if ticket:
        lines.append(f"🎫 Тикет: #{ticket['id']} (открыт)")
    talker = dialog_admin(uid)
    if talker:
        lines.append(f"💬 Сейчас в диалоге с: <b>{escape_html(staff_name(talker))}</b>")
    is_blocked = uid in blocked_users
    if is_blocked:
        lines.append("🚫 <b>Заблокирован в боте</b>")

    # Последние сообщения прямо в профиле, чтобы не открывать историю отдельно
    if msgs:
        lines.append("\n<b>Последние сообщения:</b>")
        for x in msgs[-5:]:
            who = '👤' if x['from'] == 'user' else f"👑 {escape_html(x.get('by', ''))}".rstrip()
            text = x['text'] if len(x['text']) <= 300 else x['text'][:300] + '…'
            lines.append(f"{who} <i>{fmt_time(x['time'], admin_chat_id, '%d.%m %H:%M')}</i>\n{escape_html(text)}")

    profile_text = "\n".join(lines) + dossier(uid, nick, admin_chat_id)[0] + ban_report(uid, nick, admin_chat_id)

    B = types.InlineKeyboardButton
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.row(B("💬 Ответить", callback_data=f"reply_{uid}"),
               B("📜 Вся переписка", callback_data=f"hist_{uid}"))
    if ticket or str(uid) in unread_messages:
        markup.row(B("🔒 Закрыть без ответа", callback_data=f"admin_close_ticket_{uid}"))
    row = []
    if can(admin_chat_id, 'block'):
        row.append(B("🔓 Разблокировать", callback_data=f"unblock_{uid}") if is_blocked
                   else B("🚫 Заблокировать", callback_data=f"block_{uid}"))
    if can(admin_chat_id, 'journal'):
        row.append(B("📒 Журнал", callback_data=f"jr_p_{uid}_0"))
    if row:
        markup.row(*row)
    markup.row(B("🔙 К сообщениям", callback_data="admin_menu_messages"),
               B("🏠 Меню", callback_data="admin_back"))

    if len(profile_text) > TG_MAX_LEN:
        profile_text = profile_text[:TG_MAX_LEN - 1] + '…'
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
    B = types.InlineKeyboardButton
    markup = types.InlineKeyboardMarkup()
    tz_label = timeutil.TZ_NAMES.get(tz_of(chat_id), tz_of(chat_id))
    lines = ["⚙️ <b>Управление и настройки</b>", ""]
    lines.append("📝 Регистрация: " + ("⏸ на паузе" if registration_paused else "✅ открыта"))
    if can(chat_id, 'controls'):
        lines.append("🤖 Автопринятие: " + ("✅ включено" if auto_enabled() else "⛔ выключено")
                     + (" · 🛡 рейд-режим" if raid_active() else ""))
    lines.append(f"🕐 Ваш пояс: {tz_label}")
    if can(chat_id, 'controls'):
        markup.row(B("🤖 Автопринятие и рейды", callback_data="auto_menu"))
        markup.row(B("▶️ Открыть регистрацию" if registration_paused else "⏸ Приостановить регистрацию",
                     callback_data="admin_resume" if registration_paused else "admin_pause"))
    row = [B("📊 Статус", callback_data="admin_status")]
    if can(chat_id, 'block'):
        row.append(B("🚫 Заблокированные", callback_data="show_blocked"))
    markup.row(*row)
    row = [B("🕐 Часовой пояс", callback_data="tz_menu")]
    if can(chat_id, 'controls'):
        row.insert(0, B("📤 Выгрузка в Excel", callback_data="admin_export"))
    markup.row(*row)
    if can(chat_id, 'controls'):
        markup.row(B("⏰ Сбросить таймеры", callback_data="admin_resettimers"),
                   B("🧹 Очистить статистику", callback_data="admin_clearstats"))
        markup.row(B("🗑 Очистить историю диалогов", callback_data="admin_cleardialogs"))
    markup.row(B("📖 Инструкция", callback_data="admin_help"), B("🔙 Меню", callback_data="admin_back"))
    text = "\n".join(lines)
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def end_dialog(admin_id=None, player_id=None, user_initiated=False, quiet_admin=False):
    """Завершает диалог. Можно указать админа или игрока: второго бот найдёт сам."""
    if admin_id is None and player_id is not None:
        admin_id = dialog_admin(player_id)
    target = dialogs.pop(admin_id, None) if admin_id is not None else None
    if not target:
        if admin_id is not None and not quiet_admin:
            safe_send(admin_id, "Нет активного диалога.")
            send_admin_menu(admin_id)
        return
    label = enrich_user_label(target)
    close_ticket(target)
    if user_initiated:
        audit(target, 'ticket_closed_by_player', target, player_nick(target), f"диалог вёл {staff_name(admin_id)}")
        safe_send(admin_id, f"🔔 Пользователь {label} завершил диалог (тикет закрыт).")
    else:
        audit(admin_id, 'dialog_closed', target, player_nick(target))
        if not quiet_admin:
            safe_send(admin_id, f"🔇 Диалог с {label} завершён.")
    try:
        tchat = bot.get_chat(target)
        t_nick = next((app.get('nick', '') for app in pending.values() if str(app.get('user_id')) == str(target)), "")
        discord_dialog_closed(t_nick or f"ID {target}", target, tchat.username or "", by_user=user_initiated,
                              admin_name=staff_name(admin_id))
    except Exception:
        pass
    if not quiet_admin:
        send_admin_menu(admin_id)
    safe_send(target, "🔇 Диалог с администратором завершён.",
              reply_markup=main_keyboard(is_admin=False, user_id=target))

# Какое право нужно для кнопки: первый подходящий префикс (порядок важен: approved_ раньше approve_)
CALLBACK_PERMS = [
    ('approved_page_', 'stats'), ('rejected_page_', 'stats'),
    ('approve_', 'apps'), ('reject_', 'apps'), ('admin_menu_applications', 'apps'), ('pending_', 'apps'),
    ('admin_menu_messages', 'messages'), ('msg_', 'messages'), ('user_profile_', 'messages'),
    ('admin_close_ticket_', 'messages'), ('reply_', 'messages'), ('hist_', 'messages'),
    ('admin_menu_stats', 'stats'), ('back_to_stats', 'stats'), ('show_approved', 'stats'),
    ('show_rejected', 'stats'), ('show_apphistory', 'stats'), ('apphistory_', 'stats'),
    ('admin_search', 'search'),
    ('show_blocked', 'block'), ('block_', 'block'), ('unblock_', 'block'),
    ('admin_pause', 'controls'), ('admin_resume', 'controls'), ('admin_clearstats', 'controls'),
    ('admin_resettimers', 'controls'), ('admin_cleardialogs', 'controls'), ('confirm_', 'controls'),
    ('admin_export', 'controls'),
    ('jr_', 'journal'), ('staff_', 'staff'),
    ('auto_', 'controls'), ('raid_', 'controls'), ('words_', 'controls'),
]

def tg_display_name(tg_id):
    """Имя человека из Telegram для списка команды: «Имя @username»."""
    try:
        chat = bot.get_chat(tg_id)
        name = " ".join(p for p in (chat.first_name, chat.last_name) if p)
        if chat.username:
            name = f"{name} @{chat.username}".strip()
        return name or f"ID {tg_id}"
    except Exception:
        return f"ID {tg_id}"

def admin_help_text(uid):
    role = staff.get(uid, {}).get('role')
    parts = [f"📖 <b>Инструкция</b> · {ROLE_NAMES.get(role, '')}"]
    parts.append("📋 <b>Заявки</b>\n"
                 "Нажмите «Одобрить» или «Отклонить», затем напишите комментарий или нажмите «Пропустить». "
                 "Пока вы пишете, заявка закреплена за вами, коллеги её не возьмут. Решение видят все.")
    parts.append("🧾 <b>Досье и значки</b>\n"
                 "Возраст аккаунта Telegram (примерно, ±3 месяца), аккаунт на сервере, страна, другие аккаунты с того же IP.\n"
                 "🔴 серьёзно: бан, твинк в бане\n🟡 обратить внимание: раньше отклоняли, совсем новый аккаунт\n"
                 "✅ проверки пройдены: ничего не нашлось")
    parts.append("🤖 <b>Автопринятие</b>\n"
                 "В заявке видно, примет ли её бот сам и когда: 🟢 через час, 🟡 через 12 ч, 🟠 через сутки и больше, "
                 "✋ только вручную. Принять или отклонить раньше можно как обычно.")
    if can(uid, 'messages'):
        parts.append("💬 <b>Сообщения</b>\n"
                     "«Ответить» открывает диалог: игрок видит «Администрация», ваше имя ему не показывается. "
                     "«Закрыть без ответа» убирает обращение из непрочитанных.")
    if can(uid, 'block'):
        parts.append("🚫 <b>Блокировка в боте</b>\nКнопка «Заблокировать» или /block &lt;ID&gt; &lt;причина&gt;, снять: /unblock &lt;ID&gt;.")
    parts.append("👤 <b>Посмотреть как игрок</b>\n"
                 "Бот выглядит как у обычного игрока. Заявки оттуда тестовые и на сервере не регистрируются. "
                 "Вернуться: «🛡 Вернуться в админку» или /admin.")
    if can(uid, 'journal'):
        parts.append("📒 <b>Журнал</b>\nВсе действия команды, бота и игроков. Фильтр по админу и по игроку.")
    if can(uid, 'staff'):
        parts.append("👥 <b>Команда</b>\nВыдать доступ по Telegram ID (человек узнаёт его командой /id), сменить роль, снять доступ.")
    if can(uid, 'controls'):
        parts.append("⚙️ <b>Автопринятие, рейд-режим, словарь</b>\n«Управление и настройки» → «Автопринятие и рейды».")
    return "\n\n".join(parts)

# ---------- Журнал ----------
JOURNAL_PER_PAGE = 8

def resolve_player(query):
    """Telegram ID игрока по нику или ID: из заявок, истории и журнала."""
    q = query.strip()
    if q.isdigit():
        return int(q)
    ql = q.lower()
    for app in pending.values():
        if app.get('nick', '').lower() == ql:
            return int(app['user_id'])
    for row in reversed(read_approved_csv()):
        if len(row) > 3 and row[3].lower() == ql and row[2].isdigit():
            return int(row[2])
    rows = db_exec("SELECT target_id FROM audit WHERE LOWER(target_nick)=? AND target_id IS NOT NULL ORDER BY id DESC LIMIT 1",
                   (ql,), fetch=True)
    return rows[0][0] if rows else None

def _journal_line(viewer, ts, actor_id, actor_name, actor_role, action, target_id, target_nick, details):
    when = fmt_time(ts, viewer, '%d.%m %H:%M')
    if actor_role == 'system':
        who = "🤖 Бот"
    elif actor_role == 'player':
        who = "👤 Игрок"
    else:
        who = f"🛡 {escape_html(actor_name or '')}"
    what = ACTION_NAMES.get(action, action)
    target = ""
    if target_id and not (actor_role == 'player' and actor_id == target_id and not target_nick):
        target = f" · <code>{escape_html(target_nick)}</code>" if target_nick else ""
        target += f" (ID {target_id})"
    line = f"<b>{when}</b> {who}\n{what}{target}"
    if details:
        d = details if len(details) <= 160 else details[:160] + '…'
        line += f"\n   <i>{escape_html(d)}</i>"
    return line

def show_journal(chat_id, mode, value, page, edit_message=None):
    """mode: a — все действия, s — действия члена команды value, p — всё по игроку value."""
    where, params, title = "", (), "все действия"
    if mode == 's':
        where, params = "WHERE actor_id=?", (value,)
        title = f"действия: {escape_html(staff_name(value) if value in staff else (db_exec('SELECT actor_name FROM audit WHERE actor_id=? ORDER BY id DESC LIMIT 1', (value,), fetch=True) or [['ID ' + str(value)]])[0][0])}"
    elif mode == 'p':
        where, params = "WHERE target_id=? OR actor_id=?", (value, value)
        nick = next((r[3] for r in reversed(read_approved_csv()) if len(r) > 3 and r[2] == str(value)), '')
        title = f"игрок {escape_html(nick) + ' ' if nick else ''}(ID {value})"
    try:
        total = db_exec(f"SELECT COUNT(*) FROM audit {where}", params, fetch=True)[0][0]
        pages = max(1, (total + JOURNAL_PER_PAGE - 1) // JOURNAL_PER_PAGE)
        page = max(0, min(page, pages - 1))
        rows = db_exec(f"SELECT ts, actor_id, actor_name, actor_role, action, target_id, target_nick, details FROM audit {where} "
                       f"ORDER BY id DESC LIMIT ? OFFSET ?", params + (JOURNAL_PER_PAGE, page * JOURNAL_PER_PAGE), fetch=True)
    except Exception as e:
        log_error(e)
        safe_send(chat_id, f"⚠️ Не удалось прочитать журнал: {escape_html(e)}", parse_mode='HTML')
        return
    head = f"📒 <b>Журнал</b> · {title}\nЗаписей: {total}, страница {page + 1} из {pages}, новые сверху"
    body = "\n\n".join(_journal_line(chat_id, *r) for r in rows) if rows else "<i>Записей пока нет.</i>"
    text = f"{head}\n\n{body}"
    if len(text) > TG_MAX_LEN:
        text = text[:TG_MAX_LEN - 1] + '…'
    B = types.InlineKeyboardButton
    markup = types.InlineKeyboardMarkup()
    nav = []
    if page > 0:
        nav.append(B("◀️ Новее", callback_data=f"jr_{mode}_{value}_{page - 1}"))
    if page < pages - 1:
        nav.append(B("Старее ▶️", callback_data=f"jr_{mode}_{value}_{page + 1}"))
    if nav:
        markup.row(*nav)
    markup.row(B("👥 По админу", callback_data="jr_pick"), B("🔍 По игроку", callback_data="jr_ask"))
    row = []
    if mode != 'a':
        row.append(B("📒 Все действия", callback_data="jr_a_0_0"))
    if mode == 'p' and can(chat_id, 'messages'):
        row.append(B("👤 Профиль", callback_data=f"user_profile_{value}"))
    if mode == 's' and value in staff and can(chat_id, 'staff') and value != ADMIN_ID:
        row.append(B("🛡 Карточка", callback_data=f"staff_card_{value}"))
    if row:
        markup.row(*row)
    markup.row(B("🏠 Меню", callback_data="admin_back"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_journal_staff_pick(chat_id, edit_message):
    """Выбор члена команды для фильтра журнала (и тех, у кого доступ уже сняли)."""
    people = {a: s['name'] for a, s in staff.items()}
    for actor_id, name in db_exec("SELECT DISTINCT actor_id, actor_name FROM audit WHERE actor_role IN ('owner','admin','helper')", fetch=True):
        people.setdefault(actor_id, f"{name} (доступ снят)")
    markup = types.InlineKeyboardMarkup()
    for actor_id, name in sorted(people.items(), key=lambda x: x[1].lower()):
        markup.row(types.InlineKeyboardButton(f"🛡 {name}", callback_data=f"jr_s_{actor_id}_0"))
    markup.row(types.InlineKeyboardButton("🔙 Журнал", callback_data="jr_a_0_0"))
    edit_message_safe(chat_id, edit_message.message_id, "📒 Чьи действия показать?", reply_markup=markup)

# ---------- Команда ----------
def show_staff_list(chat_id, edit_message=None):
    B = types.InlineKeyboardButton
    groups = {ROLE_OWNER: [], ROLE_ADMIN: [], ROLE_HELPER: []}
    for a, s in staff.items():
        groups.setdefault(s['role'], []).append((a, s['name']))
    lines = ["👥 <b>Команда</b>\n"]
    lines.append("👑 Владелец: " + ", ".join(escape_html(n) for _, n in groups[ROLE_OWNER]))
    lines.append("🛡 Админы: " + (", ".join(escape_html(n) for _, n in groups[ROLE_ADMIN]) or "—"))
    lines.append("🤝 Помощники: " + (", ".join(escape_html(n) for _, n in groups[ROLE_HELPER]) or "—"))
    lines.append("\n<b>Что может роль</b>\n"
                 "• Админ: заявки, сообщения, блокировки в боте, статистика, поиск\n"
                 "• Помощник: только заявки и поиск\n"
                 "• Журнал, команда и опасные кнопки есть только у владельца")
    markup = types.InlineKeyboardMarkup()
    for role in (ROLE_ADMIN, ROLE_HELPER):
        for a, n in sorted(groups[role], key=lambda x: x[1].lower()):
            markup.row(B(f"{'🛡' if role == ROLE_ADMIN else '🤝'} {n}", callback_data=f"staff_card_{a}"))
    markup.row(B("➕ Добавить", callback_data="staff_add"))
    markup.row(B("🔙 Меню", callback_data="admin_back"))
    text = "\n".join(lines)
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_staff_card(chat_id, member, edit_message=None):
    if member not in staff:
        show_staff_list(chat_id, edit_message=edit_message)
        return
    B = types.InlineKeyboardButton
    s = staff[member]
    info = db_exec("SELECT added_by, added_at FROM staff WHERE tg_id=?", (member,), fetch=True)
    stats = db_exec("SELECT COUNT(*), MAX(ts), SUM(action='approved'), SUM(action='rejected') FROM audit WHERE actor_id=?",
                    (member,), fetch=True)[0]
    lines = [f"🛡 <b>{escape_html(s['name'])}</b>",
             f"Роль: <b>{ROLE_NAMES.get(s['role'], s['role'])}</b>",
             f"TG ID: <code>{member}</code>"]
    if info and info[0][1]:
        lines.append(f"Добавлен: {fmt_time(info[0][1], chat_id)}, выдал: {escape_html(staff_name(info[0][0]))}")
    lines.append(f"\nДействий в журнале: {stats[0]}, одобрил: {stats[2] or 0}, отклонил: {stats[3] or 0}")
    if stats[1]:
        lines.append(f"Последнее действие: {fmt_time(stats[1], chat_id)}")
    if member in dialogs:
        lines.append(f"💬 Сейчас в диалоге с {escape_html(get_user_label(dialogs[member]))}")
    markup = types.InlineKeyboardMarkup()
    if s['role'] == ROLE_ADMIN:
        markup.row(B("🤝 Сделать помощником", callback_data=f"staff_role_{member}_{ROLE_HELPER}"))
    elif s['role'] == ROLE_HELPER:
        markup.row(B("🛡 Сделать админом", callback_data=f"staff_role_{member}_{ROLE_ADMIN}"))
    markup.row(B("📒 Его действия", callback_data=f"jr_s_{member}_0"),
               B("🗑 Снять доступ", callback_data=f"staff_del_{member}"))
    markup.row(B("🔙 К команде", callback_data="staff_list"))
    text = "\n".join(lines)
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_staff_add_role(chat_id, new_id):
    if new_id in staff:
        safe_send(chat_id, "Этот человек уже в команде.")
        show_staff_card(chat_id, new_id)
        return
    name = tg_display_name(new_id)
    warn = ""
    if name == f"ID {new_id}":
        warn = "\n\n⚠️ Бот не знает этого человека: пусть сначала напишет боту /start, иначе бот не сможет присылать ему уведомления."
    if new_id in blocked_users:
        warn += "\n\n⚠️ Он заблокирован в боте. При выдаче доступа блокировка снимется."
    markup = types.InlineKeyboardMarkup()
    markup.row(types.InlineKeyboardButton("🛡 Админ", callback_data=f"staff_new_{new_id}_{ROLE_ADMIN}"),
               types.InlineKeyboardButton("🤝 Помощник", callback_data=f"staff_new_{new_id}_{ROLE_HELPER}"))
    markup.row(types.InlineKeyboardButton("❌ Отмена", callback_data="staff_list"))
    safe_send(chat_id, f"➕ Выдать доступ: <b>{escape_html(name)}</b> (ID <code>{new_id}</code>)\nВыберите роль:{warn}",
              parse_mode='HTML', reply_markup=markup)

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


# ---------- Автопринятие заявок и рейд-режим (правила — tcbot/autoaccept.py) ----------
SUBSCRIBE_CHAT = os.environ.get('SUBSCRIBE_CHAT', '@totemcraftnet')
SUBSCRIBE_URL = 'https://t.me/' + SUBSCRIBE_CHAT.lstrip('@')
RAID_DURATION_MIN = 60
decision_lock = threading.RLock()   # одна заявка не может быть решена дважды (админ и автомат одновременно)

def auto_enabled():
    return bool(storage.setting('auto_enabled', False))

def owner_words():
    return storage.setting('bad_words', []) or []

def raid_active():
    if storage.setting('raid_manual', False):
        return True
    until = storage.setting('raid_until')
    return bool(until and timeutil.parse(until) > timeutil.now_utc())

def raid_status_text(viewer=None):
    if storage.setting('raid_manual', False):
        return "🔴 включён вручную\n   Автопринятие на паузе, пока не выключите"
    until = storage.setting('raid_until')
    if until and timeutil.parse(until) > timeutil.now_utc():
        return f"🔴 активен до {fmt_time(until, viewer, '%H:%M')}\n   Автопринятие на паузе"
    if storage.setting('raid_auto', True):
        return f"👀 слежу\n   Включится сам на час, если за час придёт {RAID_COUNT}+ заявок от совсем новых аккаунтов"
    return "⚪ сам не включается\n   При рейде бот только предупредит команду"

def set_raid(active, actor=None, reason=''):
    """Включить рейд-режим (на RAID_DURATION_MIN минут, или вручную до выключения) или выключить."""
    if active:
        if actor is None:
            storage.set_setting('raid_until', (timeutil.now_utc() + timedelta(minutes=RAID_DURATION_MIN)).isoformat(timespec='seconds'))
        else:
            storage.set_setting('raid_manual', True)
        audit(actor, 'raid_on', details=reason)
        who = f"сам, на {RAID_DURATION_MIN} мин" if actor is None else f"вручную · {escape_html(staff_name(actor))}"
        text = (f"🛡 <b>Рейд-режим включён</b> ({who})\n"
                + (f"{escape_html(reason)}\n" if reason else "")
                + "\nАвтопринятие на паузе. Заявки можно решать вручную как обычно.")
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("⚪ Выключить рейд-режим", callback_data="raid_off"))
        for aid in set(staff_with('apps')) | set(staff_with('controls')):
            notify_staff(None, text, reply_markup=markup if aid in staff_with('controls') else None, only=[aid])
        post_discord({"embeds": [{"title": "🛡 Рейд-режим включён", "color": 0xff0000,
                                  "description": reason or f"Включил: {staff_name(actor)}", "timestamp": timeutil.now_iso()}]})
    else:
        storage.set_setting('raid_manual', False)
        storage.set_setting('raid_until', None)
        audit(actor, 'raid_off')
        notify_staff('apps', "🛡 <b>Рейд-режим выключен</b> (" + (f"вручную · {escape_html(staff_name(actor))}" if actor else "время вышло")
                     + ")\nАвтопринятие снова работает, если включено.")
        post_discord({"embeds": [{"title": "🛡 Рейд-режим выключен", "color": 0x2ecc71, "timestamp": timeutil.now_iso()}]})

def auto_facts(uid, app):
    """Факты о заявке для правил автопринятия."""
    uid = int(uid)
    nick = app.get('nick', '')
    nicks = [n for n in [nick] + [n for n in previous_nicks(uid) if n.lower() != nick.lower()] if n]
    f = {'nick': nick, 'comment': app.get('comment', ''), 'blocked': uid in blocked_users,
         'asked_support': bool(app.get('asked')), 'subscribed': bool(app.get('subscribed'))}
    tg = app.get('tg') or {}
    if 'photo' in tg:
        f['has_photo'] = tg['photo']
    if 'username' in tg:
        f['has_username'] = tg['username']
    try:
        f['tg_age_days'] = (date.today() - tgage.estimate(uid, _frontier()['anchors'])).days
    except Exception as e:
        log_error(e)
    words = owner_words()
    f['bad_nick'] = badwords.find(nick, words)
    f['bad_password'] = badwords.find(app.get('password', ''), words)
    f['bad_comment'] = badwords.find(app.get('comment', ''), words)
    f['approved_before'] = [r[0] for r in storage.query(
        "SELECT nick FROM applications WHERE tg_id=? AND status='Одобрено'", (uid,))]
    f['rejected_before'] = storage.query("SELECT COUNT(*) FROM applications WHERE tg_id=? AND status='Отклонено'", (uid,))[0][0]
    found, past, errors = bans.find(nicks)
    f['bans'] = ([f"{it['who']} ({it['kind']})" for it in found if 'бан' in it['kind'] or 'мут' in it['kind']]
                 + [f"раньше {k} ×{v}" for k, v in past.items() if 'бан' in k or 'мут' in k])
    if errors:
        f['bans'].append("не удалось проверить: " + "; ".join(errors))  # не прочитали баны — не рискуем
    ips = set()
    for username, ip, regip, _, _ in bans.authme_accounts(nicks):
        ips.update(x for x in (ip, regip) if x and x not in ('127.0.0.1', '0.0.0.0'))
    others = [n for n in bans.authme_accounts_on_ips(sorted(ips)) if n.lower() not in {x.lower() for x in nicks}] if ips else []
    if others:
        twin_found, twin_past, _ = bans.find(others)
        f['ip_banned_twins'] = sorted({it['who'] for it in twin_found if 'бан' in it['kind']})
    return f

def schedule_auto(uid, app, keep_due=False):
    """Считает вердикт автомата и записывает его в заявку. keep_due — не сдвигать уже назначенное время."""
    try:
        v = autoaccept.decide(auto_facts(uid, app))
    except Exception as e:
        log_error(e)
        v = {'manual': True, 'stop': [f"не удалось проверить заявку: {e}"], 'minor': [], 'delay': None, 'icon': '✋'}
    old = app.get('auto') or {}
    due = None
    if not v['manual']:
        due = (timeutil.parse(app.get('date')) + v['delay']).isoformat(timespec='seconds')
        if keep_due and old.get('due'):
            due = min(due, old['due'])
    app['auto'] = {'manual': v['manual'], 'stop': v['stop'], 'minor': v['minor'], 'icon': v['icon'], 'due': due,
                   'delay': autoaccept.delay_text(v['delay']) if v['delay'] else None}
    if not v['manual'] and old.get('limit_wait'):
        app['auto']['limit_wait'] = True  # перепроверка не должна сбрасывать очередь лимита
    if str(uid) in pending:
        pending[str(uid)] = app
    return app['auto']

def auto_line(app, viewer=None, html=True):
    """Строка вердикта для карточки, уведомления и Discord (игрок её не видит)."""
    a = (app or {}).get('auto')
    if not a:
        return ""
    esc = escape_html if html else (lambda x: x)
    b = (lambda x: f"<b>{x}</b>") if html else (lambda x: x)
    if not html:  # для Discord одной строкой
        if a['manual']:
            return "✋ только вручную: " + "; ".join(a['stop'])
        return f"{a['icon']} через {a['delay']} · " + (", ".join(a['minor']) or "мелочей нет")
    if a['manual']:
        return f"✋ {b('Только вручную')}\n" + "\n".join(f"   • {esc(r)}" for r in a['stop'])
    when = fmt_time(a['due'], viewer, '%H:%M' if fmt_time(a['due'], viewer, '%d.%m') == fmt_time(timeutil.now_iso(), viewer, '%d.%m') else '%d.%m %H:%M')
    head = f"{a['icon']} {b('Автопринятие через ' + a['delay'])} · в {when}"
    details = ", ".join(a['minor']) if a['minor'] else "мелочей нет"
    if (app or {}).get('subscribed'):
        details += " · подписан на группу"
    note = ""
    if not auto_enabled():
        note = "\n   ⏸ <i>автопринятие выключено в настройках</i>"
    elif raid_active():
        note = "\n   🛡 <i>ждёт окончания рейд-режима</i>"
    elif a.get('limit_wait'):
        note = f"\n   ⏳ <i>ждёт лимита, продолжит примерно в {fmt_time(auto_limit_free_at(), viewer, '%H:%M')}</i>"
    return f"{head}\n   {esc(details)}{note}"

def auto_counts():
    now = timeutil.now_utc()
    hour = (now - timedelta(hours=1)).isoformat(timespec='seconds')
    day = (now - timedelta(days=1)).isoformat(timespec='seconds')
    rows = storage.query("SELECT SUM(ts >= ?), SUM(ts >= ?) FROM audit WHERE actor_role='system' AND action='approved'",
                         (hour, day))[0]
    return rows[0] or 0, rows[1] or 0

def auto_limit_free_at():
    """Когда освободится место в лимите (UTC ISO): самое раннее автопринятие в окне + час или сутки."""
    now = timeutil.now_utc()
    hour, day = auto_counts()
    candidates = []
    if hour >= autoaccept.LIMIT_HOUR:
        first = storage.query("SELECT MIN(ts) FROM audit WHERE actor_role='system' AND action='approved' AND ts >= ?",
                              ((now - timedelta(hours=1)).isoformat(timespec='seconds'),))[0][0]
        if first:
            candidates.append(timeutil.parse(first) + timedelta(hours=1))
    if day >= autoaccept.LIMIT_DAY:
        first = storage.query("SELECT MIN(ts) FROM audit WHERE actor_role='system' AND action='approved' AND ts >= ?",
                              ((now - timedelta(days=1)).isoformat(timespec='seconds'),))[0][0]
        if first:
            candidates.append(timeutil.parse(first) + timedelta(days=1))
    return max(candidates).isoformat(timespec='seconds') if candidates else timeutil.now_iso()

def auto_job():
    """Каждую минуту: рейд-режим по времени и автопринятие подошедших заявок (с перепроверкой)."""
    try:
        until = storage.setting('raid_until')
        if until and timeutil.parse(until) <= timeutil.now_utc():
            set_raid(False)
        if not auto_enabled() or raid_active():
            return
        now = timeutil.now_utc()
        queue = sorted((a['auto']['due'], k) for k, a in pending.items()
                       if a.get('auto') and not a['auto'].get('manual') and a['auto'].get('due'))
        for due, key in queue:
            if timeutil.parse(due) > now:
                break
            if key in app_claims:
                continue  # сейчас решает админ
            app = pending.get(key)
            if not app:
                continue
            verdict = schedule_auto(int(key), app, keep_due=True)  # перепроверка: вдруг появился бан и т.п.
            if verdict['manual']:
                notify_staff('apps', f"✋ Автомат не принял <code>{escape_html(app.get('nick', ''))}</code>: "
                                     f"{escape_html('; '.join(verdict['stop']))}. Решите вручную.",
                             reply_markup=types.InlineKeyboardMarkup().add(
                                 types.InlineKeyboardButton("📋 Открыть заявку", callback_data=f"pending_goto_{key}")))
                continue
            hour, day = auto_counts()
            if hour >= autoaccept.LIMIT_HOUR or day >= autoaccept.LIMIT_DAY:
                # Лимит: подошедшие заявки ждут и примутся сами, когда лимит освободится (админы могут решить раньше)
                waiting = [k for d, k in queue if timeutil.parse(d) <= now and k in pending]
                for k in waiting:
                    a = pending[k]
                    if not a['auto'].get('limit_wait'):
                        a['auto']['limit_wait'] = True
                        pending[k] = a
                last = storage.setting('auto_limit_alert_at')
                if not last or now - timeutil.parse(last) > timedelta(hours=1):
                    storage.set_setting('auto_limit_alert_at', timeutil.now_iso())
                    free_at = auto_limit_free_at()
                    audit(None, 'auto_limit', details=f"за час {hour}, за сутки {day}, ждут {len(waiting)}")
                    notify_staff('apps', f"🤖 <b>Автомат упёрся в лимит</b>: за час {hour} из {autoaccept.LIMIT_HOUR}, "
                                         f"за сутки {day} из {autoaccept.LIMIT_DAY}. Похоже на наплыв заявок.\n"
                                         f"Ждут автопринятия: {len(waiting)}. Продолжу сам примерно в "
                                         f"{fmt_time(free_at, None, '%H:%M')} (МСК). Их можно принять и вручную, "
                                         f"ничего не заморожено и не отклонено.")
                    post_discord({"embeds": [{"title": "🤖 Автопринятие упёрлось в лимит", "color": 0xffaa00,
                                              "description": f"За час {hour}, за сутки {day}. Ждут: {len(waiting)}. "
                                                             f"Продолжит сам, когда лимит освободится.",
                                              "timestamp": timeutil.now_iso()}]})
                break
            desc = f"{app['auto']['icon']} {', '.join(app['auto']['minor']) or 'мелочей нет'}, срок {app['auto']['delay']}"
            if app['auto'].get('limit_wait'):
                desc += ", ждала лимита"
            process_admin_decision('approve', key, '', {'actor': None, 'auto_desc': desc})
    except Exception as e:
        log_error(e)

def show_auto_settings(chat_id, edit_message=None):
    B = types.InlineKeyboardButton
    enabled = auto_enabled()
    hour, day = auto_counts()
    waiting = [a for a in pending.values() if (a.get('auto') or {}).get('due') and not a['auto'].get('manual')]
    manual = [a for a in pending.values() if (a.get('auto') or {}).get('manual')]
    nearest = min((a['auto']['due'] for a in waiting), default=None)
    limit_wait = sum(1 for a in waiting if a['auto'].get('limit_wait'))
    lines = [f"🤖 <b>Автопринятие</b> · {'✅ включено' if enabled else '⛔ выключено'}",
             "",
             "📊 <b>Сейчас</b>",
             f"   Принято за час: <b>{hour}</b> из {autoaccept.LIMIT_HOUR} · за сутки: <b>{day}</b> из {autoaccept.LIMIT_DAY}",
             f"   Ждут автопринятия: <b>{len(waiting)}</b>" + (f" · ближайшая в {fmt_time(nearest, chat_id, '%d.%m %H:%M')}" if nearest else ""),
             *([f"   ⏳ Ждут лимита: <b>{limit_wait}</b> · продолжу примерно в {fmt_time(auto_limit_free_at(), chat_id, '%H:%M')}"]
               if limit_wait else []),
             f"   Только вручную: <b>{len(manual)}</b>",
             "",
             f"🛡 <b>Рейд-режим</b> · {raid_status_text(chat_id)}",
             "",
             "⏱ <b>Сроки</b>",
             "   ⚡ 5 мин: без мелочей и подписан на группу",
             "   🟢 1 ч: без мелочей",
             "   🟡 12 ч: одна мелочь",
             "   🟠 24 ч: две мелочи · 48 ч: три и больше",
             "",
             "🔸 <b>Мелочи</b>: нет аватарки, нет username, Telegram моложе года, есть комментарий, 6+ цифр в нике",
             "✋ <b>Только вручную</b>: бан или мут когда-либо, твинк, блок в боте, брань и символика, раньше отклоняли, "
             "Telegram моложе 2 месяцев, писал в поддержку, пока ждёт",
             "",
             f"📖 Словарь: встроенный + своих слов {len(owner_words())}",
             "<i>Перед принятием бот всё перепроверяет. Игрок ничего этого не видит.</i>"]
    markup = types.InlineKeyboardMarkup()
    markup.row(B("⛔ Выключить автопринятие" if enabled else "✅ Включить автопринятие", callback_data="auto_toggle"))
    raid_auto = storage.setting('raid_auto', True)
    markup.row(B("⚪ Выключить рейд" if raid_active() else "🔴 Включить рейд", callback_data="raid_off" if raid_active() else "raid_on"),
               B(("✅" if raid_auto else "⬜") + " Рейд сам", callback_data="raid_auto_toggle"))
    markup.row(B(f"📖 Свои слова ({len(owner_words())})", callback_data="words_list"),
               B("🔙 Назад", callback_data="admin_menu_controls"))
    text = "\n".join(lines)
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def show_words(chat_id, edit_message=None):
    B = types.InlineKeyboardButton
    words = owner_words()
    text = (f"📖 <b>Свои слова</b> · {len(words)}\n"
            "<i>Ищутся в нике, пароле и комментарии вместе со встроенным словарём: мат, оскорбления, символика, политика.</i>\n\n"
            + (" · ".join(f"<code>{escape_html(w)}</code>" for w in words) + "\n\nЧтобы убрать слово, нажмите ✖ рядом с ним."
               if words else "Своих слов пока нет."))
    markup = types.InlineKeyboardMarkup(row_width=3)
    markup.add(*[B(f"✖ {w}", callback_data=f"words_del_{i}") for i, w in enumerate(words[:60])])
    markup.row(B("➕ Добавить слово", callback_data="words_add"))
    markup.row(B("🔙 Назад", callback_data="auto_menu"))
    if edit_message:
        edit_message_safe(chat_id, edit_message.message_id, text, parse_mode='HTML', reply_markup=markup)
    else:
        safe_send(chat_id, text, parse_mode='HTML', reply_markup=markup)

def mark_asked(uid):
    """Игрок пытался обратиться, пока заявка ждёт: автомат такую заявку не примет."""
    app = pending.get(str(uid))
    if app and not app.get('asked'):
        app['asked'] = True
        schedule_auto(uid, app, keep_due=True)

# ---------- Страховка обработчиков ----------
def guarded(handler):
    """Ошибка в обработчике не должна оставлять кнопку «крутиться» и теряться молча:
    нажавший получает понятный ответ, ошибка — в журнал."""
    def wrapper(obj):
        try:
            return handler(obj)
        except Exception as e:
            is_call = hasattr(obj, 'data') and hasattr(obj, 'message')
            if is_call and isinstance(e, (ValueError, IndexError)):
                # Испорченные данные кнопки (старая кнопка или изменённый клиент): не ошибка бота
                log_warning(f"некорректная кнопка {obj.data!r} от {obj.from_user.id}: {e}")
            else:
                log_error(e)
            try:
                if is_call:
                    bot.answer_callback_query(obj.id, "Кнопка устарела. Откройте меню заново: /start", show_alert=True)
                else:
                    safe_send(obj.chat.id, "⚠️ Что-то пошло не так. Попробуйте ещё раз или нажмите /start.")
            except Exception:
                pass
    wrapper.__name__ = handler.__name__
    wrapper.__doc__ = handler.__doc__
    return wrapper

# ---------- Команды ----------
def set_paused(actor, value):
    global registration_paused
    registration_paused = value
    storage.set_setting('paused', value)
    audit(actor, 'paused' if value else 'resumed')

def do_unblock(actor, tid):
    blocked_users.discard(tid)
    audit(actor, 'unblocked', tid, player_nick(tid))
    safe_send(tid, "✅ Вы были разблокированы администратором. Можете снова пользоваться ботом.",
              reply_markup=main_keyboard(is_admin=False, user_id=tid))

@bot.message_handler(commands=['id'])
@guarded
def id_cmd(m):
    # Нужен, чтобы будущий админ узнал свой ID и передал владельцу
    safe_send(m.chat.id, f"Ваш Telegram ID: <code>{m.chat.id}</code>", parse_mode='HTML')

@bot.message_handler(commands=['admin'])
@guarded
def admin_cmd(m):
    if m.chat.id in staff:
        player_view.discard(m.chat.id)
        send_admin_menu(m.chat.id)

@bot.message_handler(commands=['pause'])
@guarded
def pause_reg(m):
    if not can(m.chat.id, 'controls'): return
    set_paused(m.chat.id, True)
    safe_send(m.chat.id, "⏸️ Регистрация приостановлена.")

@bot.message_handler(commands=['resume'])
@guarded
def resume_reg(m):
    if not can(m.chat.id, 'controls'): return
    set_paused(m.chat.id, False)
    safe_send(m.chat.id, "▶️ Регистрация возобновлена.")

@bot.message_handler(commands=['block'])
@guarded
def block_user(m):
    if not can(m.chat.id, 'block'): return
    parts = m.text.strip().split()
    if len(parts) < 2:
        safe_send(m.chat.id, "Использование: /block <user_id> [причина]")
        return
    try:
        tid = int(parts[1])
    except ValueError:
        safe_send(m.chat.id, "ID пользователя должно быть числом.")
        return
    if tid in staff:
        safe_send(m.chat.id, "Это член команды. Сначала снимите доступ в разделе «Команда».")
        return
    reason = ' '.join(parts[2:]) if len(parts) > 2 else ''
    process_block(str(tid), reason, m, actor=m.chat.id)

@bot.message_handler(commands=['unblock'])
@guarded
def unblock_user(m):
    if not can(m.chat.id, 'block'): return
    try:
        tid = int(m.text.split()[1])
    except:
        safe_send(m.chat.id, "/unblock <id>"); return
    do_unblock(m.chat.id, tid)
    safe_send(m.chat.id, f"✅ {tid} разблокирован.")

def status_text(aid):
    my = dialogs.get(aid)
    lines = [f"📌 Регистрация: {'приостановлена' if registration_paused else 'активна'}",
             f"🚫 Заблокировано в боте: {len(blocked_users)}",
             f"📨 Ваш диалог: {get_user_label(my) if my else 'нет'}"]
    others = [f"{staff_name(a)} ↔ {get_user_label(p)}" for a, p in dialogs.items() if a != aid]
    if others:
        lines.append("🗣 Диалоги коллег: " + "; ".join(others))
    return "\n".join(lines)

@bot.message_handler(commands=['status'])
@guarded
def status_cmd(m):
    if not is_staff(m.chat.id): return
    safe_send(m.chat.id, status_text(m.chat.id))

@bot.message_handler(commands=['history'])
@guarded
def history_cmd(m):
    if not can(m.chat.id, 'messages'): return
    try:
        target = int(m.text.split()[1])
    except:
        safe_send(m.chat.id, "/history <id>"); return
    msgs = storage.get_messages(target, 50)
    if not msgs:
        safe_send(m.chat.id, "История пуста."); return
    txt = f"📜 История с {enrich_user_label(target)}:\n" + "\n".join(
        f"{'👤' if x['from']=='user' else '👑 ' + x.get('by', '')} {fmt_time(x['time'], m.chat.id)}: {x['text']}" for x in msgs)
    safe_send_long(m.chat.id, txt)

@bot.message_handler(commands=['stopreply'])
@guarded
def stopreply_cmd(m):
    if not is_staff(m.chat.id): return
    end_dialog(admin_id=m.chat.id)

# ---------- Старт ----------
@bot.message_handler(commands=['start'])
@guarded
def start_cmd(m):
    if not check_rate_limit(m.chat.id): return
    if m.chat.id in blocked_users:
        try:
            bot.send_message(m.chat.id, "🚫 Вы заблокированы и не можете использовать бота.", reply_markup=types.ReplyKeyboardRemove())
        except: pass
        return
    if is_staff(m.chat.id):
        send_admin_menu(m.chat.id)
    else:
        send_main_menu(m.chat.id)

# ---------- Основной обработчик текста ----------
@bot.message_handler(content_types=['text'])
@guarded
def handle_all_messages(m):
    if not check_rate_limit(m.chat.id): return
    uid, text = m.chat.id, m.text.strip()

    if uid in blocked_users: return

    # Возврат в главное меню (для пользователя)
    if text == "🏠 Главное меню" and not is_staff(uid):
        step = user_states.get(uid, {}).get('step')
        text_input_steps = {'nick', 'password', 'comment', 'support_nick', 'support_text', 'guest_message'}
        # Если пользователь в активном диалоге — кнопка не должна была быть видна,
        # но на всякий случай: не прерываем диалог, напоминаем
        if dialog_admin(uid):
            safe_send(uid, "⚠️ Сейчас идёт диалог с администратором. Чтобы выйти — нажмите «❌ Завершить диалог».",
                      reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        # Если ждём ввода текста — тоже не сбрасываем молча, а предупреждаем
        if step in text_input_steps:
            safe_send(uid, "⚠️ Ввод прерван. Возвращаю в главное меню.")
            del user_states[uid]
        send_main_menu(uid)
        return
    if text == "❌ Отменить заявку" and not is_staff(uid):
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
            app = pending.pop(str(uid))
            nick_cancelled = app.get('nick', '?')
            audit(uid, 'app_cancelled', uid, nick_cancelled)
            # Сбрасываем таймер чтобы игрок мог подать заново немедленно
            last_application.pop(str(uid), None)
            close_notices('app', uid, "↩️ <b>Игрок отозвал заявку</b> [{t}]")
            # Если админ как раз пишет решение по этой заявке — прерываем
            claimer = app_claims.pop(str(uid), None)
            if claimer is not None and admin_states.get(claimer, {}).get('user_id') == str(uid):
                state = admin_states.pop(claimer)
                if state.get('prompt_msg_id'):
                    try:
                        bot.delete_message(claimer, state['prompt_msg_id'])
                    except Exception:
                        pass
                safe_send(claimer,
                    f"⚠️ <b>Заявка отменена игроком!</b>\n\n"
                    f"Игрок <code>{escape_html(nick_cancelled)}</code> (ID: <code>{uid}</code>) "
                    f"отозвал свою заявку, пока вы вводили комментарий. Решение не сохранено.",
                    parse_mode='HTML')
                flush_admin_notifications(claimer)
            label = enrich_user_label(uid)
            notify_staff('apps',
                f"🔔 <b>Заявка отозвана игроком</b>\n\n"
                f"Игрок {escape_html(label)} (<code>{escape_html(nick_cancelled)}</code>) отменил свою заявку.")
            discord_application_cancelled(nick_cancelled, uid, app.get('username', ''), app.get('tg_name', ''))
            cancelled = True
        if cancelled:
            safe_send(uid, "❌ Заявка отменена.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return
        # Кнопка нажата но нет активной заявки
        safe_send(uid, "У вас нет активной заявки.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return
    if uid in user_states and not is_staff(uid):
        step = user_states[uid].get('step')
        if text == "❌ Отменить" and step in ['support_nick','support_text','guest_message']:
            del user_states[uid]
            safe_send(uid, "❌ Отменено.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
            return

    # Админ вводит комментарий, причину, поиск и т.п.
    if is_staff(uid) and uid in admin_states:
        state = admin_states[uid]
        action = state.get('action')
        if action == 'search':
            del admin_states[uid]
            do_nick_search(uid, text.strip().lower())
            flush_admin_notifications(uid)
            return
        if action == 'journal_player':
            del admin_states[uid]
            query = text.strip()
            target = resolve_player(query)
            if target is None:
                safe_send(uid, f"🔍 Игрок «{escape_html(query)}» не найден ни в заявках, ни в журнале.", parse_mode='HTML')
                show_journal(uid, 'a', 0, 0)
            else:
                show_journal(uid, 'p', target, 0)
            flush_admin_notifications(uid)
            return
        if action == 'word_add':
            del admin_states[uid]
            words = owner_words()
            added = [w.lower() for w in text.split() if len(w) >= 3 and w.lower() not in words]
            if added:
                storage.set_setting('bad_words', words + added)
                audit(uid, 'word_added', details=", ".join(added))
            safe_send(uid, ("✅ Добавлено: " + ", ".join(added)) if added else "Ничего не добавлено: слово короче 3 букв или уже есть.")
            show_words(uid)
            flush_admin_notifications(uid)
            return
        if action == 'staff_add':
            del admin_states[uid]
            try:
                new_id = int(text.strip())
            except ValueError:
                safe_send(uid, "❌ Нужен числовой Telegram ID. Человек может узнать его командой /id в этом боте.")
                show_staff_list(uid)
                return
            show_staff_add_role(uid, new_id)
            flush_admin_notifications(uid)
            return
        if action in ('approve', 'reject'):
            del admin_states[uid]
            if state.get('prompt_msg_id'):
                try:
                    bot.delete_message(chat_id=uid, message_id=state['prompt_msg_id'])
                except Exception:
                    pass
            try:
                bot.delete_message(chat_id=uid, message_id=m.message_id)
            except Exception:
                pass
            state['prompt_msg_id'] = None
            process_admin_decision(action, state['user_id'], text if text != '-' else '', state)
            flush_admin_notifications(uid)
            return
        if action == 'block':
            del admin_states[uid]
            process_block(state['user_id'], text if text != '-' else '', m, actor=uid)
            flush_admin_notifications(uid)
            return

    # Админ в диалоге: любой текст — сообщение игроку (игрок видит «администрация», без имени)
    if is_staff(uid) and uid in dialogs:
        target = dialogs[uid]
        sent = safe_send(target, f"📨 <b>Сообщение от администрации:</b>\n\n{escape_html(text)}", parse_mode='HTML')
        if sent:
            add_to_history(target, text, from_user=False, by=uid)
            clear_unread(target)
            audit(uid, 'msg_to_player', target, player_nick(target), text)
        else:
            safe_send(uid, "❌ Сообщение не доставлено: возможно, игрок заблокировал бота.")
        return

    # Админ без диалога — любой текст возвращает в панель
    if is_staff(uid):
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
            notify_new_ticket(m.from_user, text_msg, tid, nick=nick)
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
            notify_new_ticket(m.from_user, text_msg, tid)
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
            last_dt = timeutil.parse(last_time_str)
            if timeutil.now_utc() - last_dt < timedelta(hours=24):
                remaining = last_dt + timedelta(hours=24) - timeutil.now_utc()
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
            mark_asked(uid)
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
    if text == "❌ Завершить диалог" and not is_staff(uid):
        if dialog_admin(uid):
            end_dialog(player_id=uid, user_initiated=True)
        else:
            safe_send(uid, "Нет активного диалога.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return
    if text == "📋 Мои обращения" and not is_staff(uid):
        ticket = get_ticket(uid)
        if ticket:
            markup = types.InlineKeyboardMarkup()
            markup.add(types.InlineKeyboardButton("❌ Закрыть тикет", callback_data="close_ticket"))
            safe_send(uid, f"📋 У вас открыт тикет #{ticket['id']}. Ожидайте ответа администратора.", reply_markup=markup)
        else:
            safe_send(uid, "У вас нет открытых обращений.", reply_markup=main_keyboard(is_admin=False, user_id=uid))
        return

    # Пользователь в активном диалоге с админом — пересылаем сообщение его админу
    talker = dialog_admin(uid)
    if talker:
        label = enrich_user_label(uid)
        add_to_history(uid, text, from_user=True)
        shown = text if len(text) <= 3500 else text[:3500] + '…'  # запас под подпись, лимит Telegram 4096
        notify_staff(None, f"👤 {escape_html(label)}:\n{escape_html(shown)}", only=[talker])
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
@guarded
def handle_photo(m):
    if not check_rate_limit(m.chat.id): return
    uid = m.chat.id
    if uid in blocked_users: return

    # Админ отправляет фото игроку
    if is_staff(uid) and uid in dialogs:
        target = dialogs[uid]
        file_id = m.photo[-1].file_id
        caption = m.caption or ""
        try:
            bot.send_photo(target, file_id,
                           caption="📨 Фото от администрации" + (f"\n{caption}" if caption else ""))
            add_to_history(target, f"[фото от админа]{': ' + caption if caption else ''}", from_user=False, by=uid)
            clear_unread(target)
            audit(uid, 'msg_to_player', target, player_nick(target), f"[фото] {caption}")
        except Exception as e:
            log_error(e)
            safe_send(uid, f"❌ Ошибка отправки фото: {e}")
        return

    # Игрок в активном диалоге отправляет фото своему админу
    talker = dialog_admin(uid)
    if talker:
        label = enrich_user_label(uid)
        file_id = m.photo[-1].file_id
        caption = m.caption or ""
        try:
            bot.send_photo(talker, file_id,
                           caption=f"🖼 Фото от {label}" + (f"\n{caption}" if caption else ""))
            add_to_history(uid, f"[фото]{': ' + caption if caption else ''}", from_user=True)
        except Exception as e:
            log_error(e)
        return

    # Вне диалога — подсказываем
    if is_staff(uid):
        send_admin_menu(uid)
        return
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
        # Убрать нижние кнопки «Пропустить / Отменить»: пустое сообщение Telegram не принимает,
        # поэтому отправляем короткое и сразу удаляем
        rm = bot.send_message(uid, "📋", reply_markup=types.ReplyKeyboardRemove())
        bot.delete_message(uid, rm.message_id)
    except Exception as e:
        log_error(e)
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
@guarded
def callback_handler(call):
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

    # --- Выход из режима игрока (кнопку видит только админ в этом режиме) ---
    if data == "player_view_off" and uid in staff:
        player_view.discard(uid)
        user_states.pop(uid, None)
        bot.answer_callback_query(call.id, "Вы снова в админке")
        send_admin_menu(uid, edit_message=msg)
        return

    # --- Комментарий админа ---
    if data == "skip_admin_comment" and is_staff(uid) and uid in admin_states:
        bot.answer_callback_query(call.id, "Пропущено")
        state = admin_states.pop(uid)
        try:
            bot.delete_message(chat_id=msg.chat.id, message_id=msg.message_id)
        except Exception:
            pass
        if state.get('action') in ('approve', 'reject'):
            state['prompt_msg_id'] = None  # уже удалили выше
            process_admin_decision(state['action'], state['user_id'], '', state)
        elif state.get('action') == 'block':
            process_block(state['user_id'], '', msg, actor=uid)
        flush_admin_notifications(uid)
        return
    if data == "cancel_admin_comment" and is_staff(uid):
        state = admin_states.pop(uid, None)
        if state and app_claims.get(state.get('user_id')) == uid:
            app_claims.pop(state['user_id'], None)
        bot.answer_callback_query(call.id, "Отменено")
        flush_admin_notifications(uid)
        try:
            bot.delete_message(chat_id=msg.chat.id, message_id=msg.message_id)
        except Exception:
            pass
        send_admin_menu(uid)
        return

    # --- Подтверждение заявки ---
    if data in ("confirm_yes", "confirm_no"):
        if uid not in user_states:
            bot.answer_callback_query(call.id, "Заявка устарела."); return
        state = user_states[uid]
        if state.get('step') != 'confirm':
            bot.answer_callback_query(call.id, "Уже обработана."); return
        if data == "confirm_yes":
            last_time_str = None if uid in player_view else last_application.get(str(uid))
            if last_time_str:
                last_dt = timeutil.parse(last_time_str)
                if timeutil.now_utc() - last_dt < timedelta(hours=24):
                    remaining = last_dt + timedelta(hours=24) - timeutil.now_utc()
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
            test_by = uid if uid in player_view else None
            new_app = {
                'user_id': uid,
                'username': call.from_user.username or f"id{uid}",
                'tg_name': user_display_name(call.from_user),
                'nick': state['nick'],
                'password': state['password'],
                'comment': state.get('comment', ''),
                'date': timeutil.now_iso(),
                'tg': collect_tg_facts(call.from_user),
            }
            if test_by:
                new_app['test_by'] = test_by  # заявка из режима игрока: на сервере не регистрируется
            pending[app_id] = new_app
            schedule_auto(uid, new_app)
            if not test_by:
                last_application[str(uid)] = timeutil.now_iso()
            audit(uid, 'app_submitted', uid, state['nick'], state.get('comment', ''))
            old_nicks = previous_nicks(uid)
            dup_warning = ""
            if old_nicks:
                listed = ", ".join(f"<code>{escape_html(n)}</code>" for n in old_nicks)
                dup_warning = f"\n⚠️ <b>Внимание:</b> данный TG ID уже подавал заявку ранее! Ники: {listed}"
            bans = ban_report(uid, state['nick'])
            info, flags = dossier(uid, state['nick'], app=new_app, compact=True)
            admin_markup = types.InlineKeyboardMarkup()
            admin_markup.add(types.InlineKeyboardButton("📋 Открыть заявку", callback_data=f"pending_goto_{uid}"))
            admin_msg = (
                f"📩 <b>Новая заявка</b> · в очереди {len(pending)}\n"
                + (f"🧪 Тестовая: {escape_html(staff_name(uid))} в режиме игрока\n" if test_by else "")
                + f"👤 <code>{escape_html(state['nick'])}</code>"
                f"{dup_warning}"
                f"\n\n{auto_line(new_app)}"
                f"{info}"
                f"{bans}"
            )[:TG_MAX_LEN]
            notify_staff('apps', admin_msg, reply_markup=admin_markup, kind='app', ref=uid)
            discord_new_application(call.from_user, uid, state['nick'], state['password'], state.get('comment', ''),
                                    old_nicks=old_nicks, bans_found=bans.count('\n🚫') + bans.count('\n🔇'),
                                    test_by=staff_name(uid) if test_by else None,
                                    risks=[re.sub(r'<[^>]+>', '', t) for lvl, t in flags if lvl == '🔴'],
                                    verdict=auto_line(new_app, html=False))
            check_raid(uid)
            safe_send(uid,
                "✅ <b>Ваша заявка принята и отправлена на рассмотрение.</b>\n\n"
                "📋 Заявки рассматриваются в порядке очереди. Срок рассмотрения - <b>как правило, до 24 часов</b>.\n\n"
                "Результат рассмотрения придёт вам автоматически.",
                parse_mode='HTML',
                reply_markup=main_keyboard(is_admin=False, user_id=uid))
            sub = types.InlineKeyboardMarkup()
            sub.row(types.InlineKeyboardButton("➡️ Перейти в группу", url=SUBSCRIBE_URL),
                    types.InlineKeyboardButton("✅ Я подписался", callback_data="sub_check"))
            safe_send(uid, "📢 Пока ждёте, подпишитесь на нашу группу TotemCraft: там новости и анонсы сервера.",
                      reply_markup=sub)
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
    if data == "menu_my_tickets" and not is_staff(uid):
        ticket = get_ticket(uid)
        if ticket:
            nick_line = f"🎮 Ник: <code>{escape_html(ticket['nick'])}</code>\n" if ticket.get('nick') else ""
            date_line = f"📅 Дата: {fmt_time(ticket.get('date'))}\n" if ticket.get('date') else ""
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
    if data == "close_ticket" and not is_staff(uid):
        ticket = get_ticket(uid)
        if ticket:
            close_ticket(uid)
            clear_unread(uid)
            label = enrich_user_label(uid)
            # Если с этим пользователем открыт диалог — завершаем его
            if dialog_admin(uid):
                end_dialog(player_id=uid, user_initiated=True)
            else:
                audit(uid, 'ticket_closed_by_player', uid, player_nick(uid))
                close_notices('ticket', uid, "🔒 <b>Игрок сам закрыл обращение</b>")
                notify_staff('messages', f"🔔 Пользователь {escape_html(label)} закрыл тикет #{ticket['id']}.")
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
            last_dt = timeutil.parse(last_time_str)
            if timeutil.now_utc() - last_dt < timedelta(hours=24):
                remaining = last_dt + timedelta(hours=24) - timeutil.now_utc()
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
            mark_asked(uid)
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

    # --- Подписка на группу (игрок): ускоряет только чистые заявки, игрок об этом не знает ---
    if data == "sub_check":
        try:
            member = bot.get_chat_member(SUBSCRIBE_CHAT, uid).status in ('member', 'administrator', 'creator')
        except Exception as e:
            log_warning(f"не удалось проверить подписку на {SUBSCRIBE_CHAT}: {e}")
            member = None
        if member is False:
            bot.answer_callback_query(call.id, "Пока не вижу подписки. Подпишитесь и нажмите ещё раз.", show_alert=True)
            return
        app = pending.get(str(uid))
        if member and app and not app.get('subscribed'):
            app['subscribed'] = True
            schedule_auto(uid, app, keep_due=True)
        bot.answer_callback_query(call.id, "Спасибо за подписку!")
        try:
            bot.edit_message_reply_markup(uid, msg.message_id, reply_markup=None)
        except Exception:
            pass
        return

    # --- Только команда ---
    if uid not in staff:
        bot.answer_callback_query(call.id, "Нет доступа."); return
    if uid in player_view:
        bot.answer_callback_query(call.id, "Вы в режиме игрока. Нажмите «🛡 Вернуться в админку» в меню или /admin.", show_alert=True)
        return
    need = next((perm for prefix, perm in CALLBACK_PERMS if data.startswith(prefix)), None)
    if need and not can(uid, need):
        bot.answer_callback_query(call.id, f"У роли «{ROLE_NAMES.get(staff[uid]['role'], '')}» нет доступа к этому разделу.", show_alert=True)
        return

    def ok(text=None, alert=False):
        bot.answer_callback_query(call.id, text, show_alert=alert)

    if data == "noop":
        ok(); return
    if data == "admin_back":
        ok(); send_admin_menu(uid, edit_message=msg); return
    if data == "player_view_on":
        if uid in dialogs:
            ok("Сначала завершите диалог с игроком.", alert=True); return
        admin_states.pop(uid, None)
        player_view.add(uid)
        ok("Режим игрока включён")
        send_main_menu(uid, edit_message=msg)
        return

    # --- Заявки ---
    if data == "admin_menu_applications":
        ok(); show_pending_applications(uid, page=0, edit_message=msg); return
    if data.startswith('pending_page_'):
        ok(); show_pending_applications(uid, page=int(data.split('_')[2]), edit_message=msg); return
    if data.startswith('pending_goto_'):
        # Прыгнуть на конкретную заявку по TG ID (из уведомления или поиска)
        target_id = data.split('_')[2]
        sorted_apps = sorted(pending.items(), key=lambda x: x[1].get('date', ''))
        idx = next((i for i, (aid, app) in enumerate(sorted_apps) if str(app.get('user_id', aid)) == target_id), None)
        if idx is None:
            ok("Заявка уже рассмотрена или отозвана.", alert=True)
            return
        ok()
        show_pending_applications(uid, page=idx, edit_message=None if msg.text and msg.text.startswith("📩 Новая заявка") else msg)
        return
    if data.startswith('approve_') or data.startswith('reject_'):
        action = 'approve' if data.startswith('approve_') else 'reject'
        target_id = data.split('_')[1]
        if target_id not in pending:
            ok("Заявка уже рассмотрена коллегой или отозвана игроком.", alert=True)
            show_pending_applications(uid, edit_message=msg)
            return
        claimer = app_claims.get(target_id)
        if claimer is not None and claimer != uid and admin_states.get(claimer, {}).get('user_id') == target_id:
            ok(f"Эту заявку сейчас рассматривает {staff_name(claimer)}.", alert=True)
            return
        if uid in admin_states:
            ok("Сначала закончите предыдущее действие (введите комментарий или нажмите «Отмена»).", alert=True)
            return
        ok()
        app_claims[target_id] = uid
        admin_states[uid] = {'action': action, 'user_id': target_id, 'actor': uid,
                             'app_msg_chat_id': msg.chat.id, 'app_msg_message_id': msg.message_id}
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("Пропустить", callback_data="skip_admin_comment"),
                   types.InlineKeyboardButton("Отмена", callback_data="cancel_admin_comment"))
        action_label = 'одобрению' if action == 'approve' else 'отклонению'
        prompt_msg = safe_send(uid, f"✍️ Введите комментарий к {action_label} или нажмите кнопку.\n\n"
                                    f"⚠️ <b>Не отвечайте сейчас на другие сообщения</b> - любой текст будет принят как комментарий.",
                               parse_mode='HTML', reply_markup=markup)
        if prompt_msg:
            admin_states[uid]['prompt_msg_id'] = prompt_msg.message_id
        return
    if data.startswith('retry_reg_'):
        nick = data[len('retry_reg_'):]
        saved = failed_registrations.get(nick)
        if not saved:
            ok("Пароля нет: бот перезапускался. Попросите игрока подать заявку заново.", alert=True)
            return
        ok("Повторяю регистрацию...")
        try:
            bot.edit_message_reply_markup(uid, msg.message_id, reply_markup=None)
        except Exception:
            pass
        run_in_background(register_on_server, nick, saved[0], uid, saved[1])
        return

    # --- Поиск ---
    if data == "admin_search":
        admin_states[uid] = {'action': 'search'}
        ok()
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel_admin_search"))
        safe_send(uid, "🔍 Введите ник (или его часть) для поиска:", reply_markup=markup)
        return
    if data == "cancel_admin_search":
        if admin_states.get(uid, {}).get('action') in ('search', 'journal_player', 'staff_add', 'word_add'):
            del admin_states[uid]
        flush_admin_notifications(uid)
        ok(); send_admin_menu(uid, edit_message=msg); return

    # --- Статистика и история заявок ---
    if data in ("admin_menu_stats", "back_to_stats"):
        ok(); show_statistics(uid, edit_message=msg); return
    if data == "show_approved":
        ok(); show_approved_list(uid, edit_message=msg); return
    if data == "show_rejected":
        ok(); show_rejected_list(uid, edit_message=msg); return
    if data.startswith('approved_page_'):
        ok(); show_approved_list(uid, page=int(data.split('_')[2]), edit_message=msg); return
    if data.startswith('rejected_page_'):
        ok(); show_rejected_list(uid, page=int(data.split('_')[2]), edit_message=msg); return
    if data == "show_apphistory":
        ok(); show_application_history(uid, page=0, edit_message=msg); return
    if data.startswith('apphistory_page_'):
        ok(); show_application_history(uid, page=int(data.split('_')[2]), edit_message=msg); return
    if data.startswith('apphistory_view_'):
        ok(); show_application_card(uid, int(data.split('_')[2]), edit_message=msg); return

    # --- Сообщения и диалоги ---
    if data == "admin_menu_messages":
        ok(); show_messages_menu(msg, edit_message=msg); return
    if data.startswith('msg_page_'):
        ok(); show_messages_menu(msg, page=int(data.split('_')[2]), edit_message=msg); return
    if data.startswith('msg_cat_'):
        parts = data.split('_')  # msg_cat_{category}_{page}
        ok(); show_messages_menu(msg, page=int(parts[3]), edit_message=msg, category=parts[2]); return
    if data.startswith('user_profile_'):
        ok(); show_user_profile(uid, data.split('_')[2], msg); return
    if data in ("admin_end_dialog", "end_dialog"):
        ok(); end_dialog(admin_id=uid); return
    if data.startswith('admin_close_ticket_'):
        target = int(data.split('_')[3])
        ticket = get_ticket(target)
        was_unread = str(target) in unread_messages
        clear_unread(target)  # закрытое обращение уходит из «Не отвеченных»
        from_notification = bool(msg.text and msg.text.startswith("📬 Новое сообщение"))
        talker = dialog_admin(target)
        if talker is not None:
            dialogs.pop(talker, None)
            if talker != uid:
                safe_send(talker, f"🔇 Диалог с {enrich_user_label(target)} завершён: {staff_name(uid)} закрыл обращение.")
        if ticket:
            close_ticket(target)
            safe_send(target, f"✅ Ваш тикет #{ticket['id']} закрыт администратором.",
                      reply_markup=main_keyboard(is_admin=False, user_id=target))
            ok(f"Тикет #{ticket['id']} закрыт.")
        elif was_unread:
            ok("Отмечено как прочитанное.")
        else:
            ok("Тикет уже закрыт.")
        if ticket or was_unread:
            audit(uid, 'ticket_closed', target, player_nick(target), f"тикет #{ticket['id']}" if ticket else "")
        close_notices('ticket', target, f"🔒 <b>Закрыто без ответа</b> · {escape_html(staff_name(uid))}")
        if not from_notification:
            show_messages_menu(msg, edit_message=msg)
        return
    if data.startswith('reply_'):
        target = int(data.split('_')[1])
        if target in staff:
            ok("Это член команды, ему можно написать напрямую.", alert=True); return
        talker = dialog_admin(target)
        if talker is not None and talker != uid:
            if staff[uid]['role'] != ROLE_OWNER:
                ok(f"С этим игроком уже ведёт диалог {staff_name(talker)}.", alert=True); return
            dialogs.pop(talker, None)  # владелец забирает диалог себе
            safe_send(talker, f"👑 {staff_name(uid)} забрал(а) диалог с {enrich_user_label(target)}.")
        if uid in dialogs and dialogs[uid] != target:
            end_dialog(admin_id=uid, quiet_admin=True)  # у админа один диалог за раз
        dialogs[uid] = target
        clear_unread(target)
        audit(uid, 'dialog_opened', target, player_nick(target))
        close_notices('ticket', target, f"💬 <b>Отвечает:</b> {escape_html(staff_name(uid))}")
        i_markup = types.InlineKeyboardMarkup()
        i_markup.row(types.InlineKeyboardButton("❌ Завершить", callback_data="end_dialog"),
                     types.InlineKeyboardButton("🔒 Закрыть без ответа", callback_data=f"admin_close_ticket_{target}"))
        if can(uid, 'block'):
            i_markup.row(types.InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{target}"))
        label = enrich_user_label(target)
        last_user_msg = next((x for x in reversed(storage.get_messages(target, 20)) if x['from'] == 'user'), None)
        quote = ""
        if last_user_msg:
            quote = f"\n\n<b>Последнее сообщение игрока</b> ({fmt_time(last_user_msg['time'], uid, '%d.%m %H:%M')}):\n{escape_html(last_user_msg['text'][:1500])}"
        safe_send(uid, f"📨 Диалог с <b>{escape_html(label)}</b> активирован.\n"
                       f"Всё, что вы напишете, уйдёт игроку от имени «Администрация».{quote}",
                  parse_mode='HTML', reply_markup=i_markup)
        send_admin_menu(uid)
        try:
            tchat = bot.get_chat(target)
            t_nick = next((a.get('nick', '') for a in pending.values() if str(a.get('user_id')) == str(target)), "")
            discord_dialog_opened(t_nick or f"ID {target}", target, tchat.username or "", staff_name(uid))
        except Exception:
            pass
        safe_send(target, "📨 Администратор начал с вами диалог.", reply_markup=main_keyboard(is_admin=False, user_id=target))
        ok("Диалог открыт")
        return
    if data.startswith('hist_'):
        target = int(data.split('_')[1])
        msgs = storage.get_messages(target, 30)
        if not msgs:
            ok("История пуста."); return
        lines = []
        for x in msgs:
            who = '👤 Игрок' if x['from'] == 'user' else f"👑 {x.get('by') or 'Админ'}"
            lines.append(f"{who} [{fmt_time(x['time'], uid)}]:\n{x['text']}")
        history_text = f"📜 История с {enrich_user_label(target)}:\n\n" + "\n\n".join(lines)
        hist_markup = types.InlineKeyboardMarkup(row_width=1)
        hist_markup.add(types.InlineKeyboardButton("🔙 Назад к профилю", callback_data=f"user_profile_{target}"))
        hist_markup.add(types.InlineKeyboardButton("🏠 Главное меню", callback_data="admin_back"))
        safe_send_long(uid, history_text, reply_markup=hist_markup)
        ok()
        return

    # --- Блокировки в боте ---
    if data == "show_blocked":
        ok(); show_blocked_users(uid, edit_message=msg); return
    if data.startswith('block_'):
        target = int(data.split('_')[1])
        if target in staff:
            ok("Это член команды. Сначала снимите доступ в разделе «Команда».", alert=True); return
        if uid in dialogs and dialogs[uid] != target:
            ok("⚠️ Сначала завершите активный диалог!", alert=True); return
        if uid in admin_states:
            ok("Сначала закончите предыдущее действие.", alert=True); return
        admin_states[uid] = {'action': 'block', 'user_id': str(target), 'actor': uid,
                             'msg_chat_id': msg.chat.id, 'msg_message_id': msg.message_id}
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("Пропустить", callback_data="skip_admin_comment"),
                   types.InlineKeyboardButton("Отмена", callback_data="cancel_admin_comment"))
        safe_send(uid, f"✍️ Введите причину блокировки для {enrich_user_label(target)} или нажмите кнопку:", reply_markup=markup)
        ok()
        return
    if data.startswith('unblock_'):
        target = int(data.split('_')[1])
        do_unblock(uid, target)
        ok(f"Пользователь {target} разблокирован.")
        if msg and msg.text and msg.text.startswith("🚫 Заблокированные"):
            show_blocked_users(uid, edit_message=msg)
        return

    # --- Управление и настройки ---
    if data == "admin_menu_controls":
        ok(); show_admin_controls(uid, edit_message=msg); return
    if data == "tz_menu":
        markup = types.InlineKeyboardMarkup(row_width=2)
        current = tz_of(uid)
        markup.add(*[types.InlineKeyboardButton(("✅ " if tz == current else "") + label, callback_data=f"tz_set_{i}")
                     for i, (label, tz) in enumerate(timeutil.TIMEZONES)])
        markup.row(types.InlineKeyboardButton("🔙 Назад", callback_data="admin_menu_controls"))
        now = timeutil.now_iso()
        edit_message_safe(uid, msg.message_id,
                          f"🕐 <b>Часовой пояс</b>\nВо всех карточках, журнале и списках время будет в выбранном поясе.\n"
                          f"Сейчас у вас: {fmt_time(now, uid)}",
                          parse_mode='HTML', reply_markup=markup)
        ok(); return
    if data.startswith('tz_set_'):
        label, tz = timeutil.TIMEZONES[int(data.split('_')[2])]
        db_exec("UPDATE staff SET tz=? WHERE tg_id=?", (tz, uid))
        if not db_exec("SELECT 1 FROM staff WHERE tg_id=?", (uid,), fetch=True):
            db_exec("INSERT INTO staff (tg_id, name, role, added_by, added_at, tz) VALUES (?,?,?,?,?,?)",
                    (uid, staff_name(uid), staff[uid]['role'], uid, timeutil.now_iso(), tz))
        load_staff()
        ok(f"Пояс: {label}")
        show_admin_controls(uid, edit_message=msg)
        return
    if data == "admin_export":
        ok("Готовлю файл...")
        path = f"export_{uid}.csv"
        try:
            storage.export_applications_csv(path)
            with open(path, 'rb') as f:
                bot.send_document(uid, f, visible_file_name=f"zayavki_{fmt_time(timeutil.now_iso(), uid, '%Y-%m-%d')}.csv",
                                  caption="📤 История заявок. Время в файле в UTC, паролей нет.")
        except Exception as e:
            log_error(e)
            safe_send(uid, f"⚠️ Не удалось выгрузить: {e}")
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        return
    if data == "admin_status":
        ok(); safe_send(uid, status_text(uid)); return
    if data == "admin_help":
        ok(); safe_send(uid, admin_help_text(uid), parse_mode='HTML'); return
    if data in ("admin_pause", "admin_resume"):
        set_paused(uid, data == "admin_pause")
        ok("Регистрация приостановлена." if data == "admin_pause" else "Регистрация возобновлена.")
        show_admin_controls(uid, edit_message=msg)
        return
    confirm_texts = {
        'admin_clearstats': ("clearstats", "✅ Да, очистить статистику", "Вы уверены, что хотите очистить всю статистику и заявки?"),
        'admin_resettimers': ("resettimers", "✅ Да, сбросить таймеры", "Сбросить 24-часовой таймер повторной заявки для всех пользователей?"),
        'admin_cleardialogs': ("cleardialogs", "✅ Да, очистить диалоги", "Вы уверены, что хотите очистить историю всех диалогов?"),
    }
    if data in confirm_texts:
        key, yes_text, question = confirm_texts[data]
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton(yes_text, callback_data=f"confirm_{key}_yes"),
                   types.InlineKeyboardButton("❌ Нет", callback_data=f"confirm_{key}_no"))
        safe_send(uid, question, reply_markup=markup)
        ok()
        return
    if data in ("confirm_clearstats_no", "confirm_resettimers_no", "confirm_cleardialogs_no"):
        ok("Отменено.")
        try:
            bot.edit_message_reply_markup(uid, msg.message_id, reply_markup=None)
        except Exception:
            pass
        return
    if data == "confirm_clearstats_yes":
        storage.backup()  # на случай, если нажали по ошибке
        storage.clear_applications()
        pending.clear()
        audit(uid, 'clear_stats')
        ok("Статистика и заявки очищены.")
        safe_send(uid, "🧹 Статистика и заявки полностью очищены.")
        return
    if data == "confirm_resettimers_yes":
        last_application.clear()
        audit(uid, 'reset_timers')
        ok("Таймеры сброшены.")
        safe_send(uid, "⏰ Таймеры 24-часового ожидания сброшены для всех пользователей.")
        send_admin_menu(uid)
        return
    if data == "confirm_cleardialogs_yes":
        storage.backup()  # на случай, если нажали по ошибке
        storage.clear_messages(); unread_messages.clear()
        active_tickets.clear()
        audit(uid, 'clear_dialogs')
        ok("История диалогов очищена.")
        safe_send(uid, "🗑 История диалогов и все тикеты полностью очищены.")
        return

    # --- Автопринятие, рейд-режим, словарь (владелец) ---
    if data == "auto_menu":
        ok(); show_auto_settings(uid, edit_message=msg); return
    if data == "auto_toggle":
        value = not auto_enabled()
        storage.set_setting('auto_enabled', value)
        audit(uid, 'auto_on' if value else 'auto_off')
        post_discord({"embeds": [{"title": "🤖 Автопринятие " + ("включено" if value else "выключено"), "color": 0x9b59b6,
                                  "description": f"Изменил: {staff_name(uid)}", "timestamp": timeutil.now_iso()}]})
        ok("Автопринятие включено" if value else "Автопринятие выключено")
        show_auto_settings(uid, edit_message=msg)
        return
    if data in ("raid_on", "raid_off"):
        if data == "raid_on" and not raid_active():
            set_raid(True, actor=uid)
        elif data == "raid_off" and raid_active():
            set_raid(False, actor=uid)
        ok()
        if msg.text and msg.text.startswith("🤖 Автопринятие"):
            show_auto_settings(uid, edit_message=msg)
        else:
            try:
                bot.edit_message_reply_markup(uid, msg.message_id, reply_markup=None)
            except Exception:
                pass
        return
    if data == "raid_auto_toggle":
        value = not storage.setting('raid_auto', True)
        storage.set_setting('raid_auto', value)
        audit(uid, 'raid_auto_on' if value else 'raid_auto_off')
        ok(); show_auto_settings(uid, edit_message=msg); return
    if data == "words_list":
        ok(); show_words(uid, edit_message=msg); return
    if data == "words_add":
        admin_states[uid] = {'action': 'word_add'}
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel_admin_search"))
        safe_send(uid, "📖 Напишите слово или часть слова (латиницей или по-русски). Несколько слов — через пробел.",
                  reply_markup=markup)
        ok(); return
    if data.startswith('words_del_'):
        words = owner_words()
        i = int(data.split('_')[2])
        if 0 <= i < len(words):
            removed = words.pop(i)
            storage.set_setting('bad_words', words)
            audit(uid, 'word_removed', details=removed)
        ok(); show_words(uid, edit_message=msg); return

    # --- Журнал ---
    if data == "jr_pick":
        ok(); show_journal_staff_pick(uid, msg); return
    if data == "jr_ask":
        admin_states[uid] = {'action': 'journal_player'}
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel_admin_search"))
        safe_send(uid, "🔍 Введите ник игрока или его Telegram ID:", reply_markup=markup)
        ok()
        return
    if data.startswith('jr_'):
        _, mode, value, page = data.split('_')
        ok(); show_journal(uid, mode, int(value), int(page), edit_message=msg); return

    # --- Команда ---
    if data == "staff_list":
        ok(); show_staff_list(uid, edit_message=msg); return
    if data == "staff_add":
        admin_states[uid] = {'action': 'staff_add'}
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel_admin_search"))
        safe_send(uid, "➕ <b>Новый член команды</b>\n\nОтправьте его Telegram ID числом.\n"
                       "Человек может узнать свой ID, написав этому боту команду /id.",
                  parse_mode='HTML', reply_markup=markup)
        ok()
        return
    if data.startswith('staff_card_'):
        ok(); show_staff_card(uid, int(data.split('_')[2]), edit_message=msg); return
    if data.startswith('staff_new_') or data.startswith('staff_role_'):
        _, kind, member, role = data.split('_')
        member = int(member)
        if role not in (ROLE_ADMIN, ROLE_HELPER) or member == ADMIN_ID:
            ok(); return
        if kind == 'new' and member in staff:
            ok("Этот человек уже в команде."); show_staff_card(uid, member, edit_message=msg); return
        name = staff[member]['name'] if member in staff else tg_display_name(member)
        db_exec("INSERT OR REPLACE INTO staff (tg_id, name, role, added_by, added_at) VALUES (?,?,?,?, "
                "COALESCE((SELECT added_at FROM staff WHERE tg_id=?), ?))",
                (member, name, role, uid, member, timeutil.now_iso()))
        load_staff()
        blocked_users.discard(member)
        audit(uid, 'staff_added' if kind == 'new' else 'staff_role', member, name, ROLE_NAMES[role])
        discord_staff_change("👥 Новый член команды" if kind == 'new' else "👥 Роль изменена",
                             name, member, ROLE_NAMES[role], staff_name(uid))
        safe_send(member, f"🛡 Вам выдан доступ к админке TotemCraft.\nРоль: <b>{ROLE_NAMES[role]}</b>\n\nНажмите /start, чтобы открыть панель.",
                  parse_mode='HTML')
        ok("Готово")
        show_staff_card(uid, member, edit_message=msg)
        return
    if data.startswith('staff_del_'):
        member = int(data.split('_')[2])
        markup = types.InlineKeyboardMarkup()
        markup.row(types.InlineKeyboardButton("✅ Да, снять доступ", callback_data=f"staff_delok_{member}"),
                   types.InlineKeyboardButton("❌ Нет", callback_data=f"staff_card_{member}"))
        edit_message_safe(uid, msg.message_id, f"Снять доступ к админке у {escape_html(staff_name(member))}?\n"
                                               f"Журнал его действий сохранится.", parse_mode='HTML', reply_markup=markup)
        ok()
        return
    if data.startswith('staff_delok_'):
        member = int(data.split('_')[2])
        if member == ADMIN_ID or member not in staff:
            ok(); return
        name = staff_name(member)
        end_dialog(admin_id=member, quiet_admin=True)
        admin_states.pop(member, None)
        player_view.discard(member)
        for app_id, who in list(app_claims.items()):
            if who == member:
                app_claims.pop(app_id, None)
        db_exec("DELETE FROM staff WHERE tg_id=?", (member,))
        load_staff()
        audit(uid, 'staff_removed', member, name)
        discord_staff_change("👥 Доступ снят", name, member, "нет", staff_name(uid))
        safe_send(member, "Доступ к админке TotemCraft снят.")
        send_main_menu(member)
        ok("Доступ снят")
        show_staff_list(uid, edit_message=msg)
        return

    ok()


# ---------- Обработка решения по заявке ----------
def process_admin_decision(action, user_id_str, comment, state):
    """Решение по заявке. state['actor'] — кто решил; None — автомат (автопринятие)."""
    actor = state['actor'] if 'actor' in state else ADMIN_ID
    decider = staff_name(actor) if actor is not None else "🤖 автоматически"
    with decision_lock:
        app_claims.pop(user_id_str, None)
        app = pending.get(user_id_str)
        if not app:
            if actor is not None:
                safe_send(actor, "⚠️ Заявка не найдена: игрок её отменил или её уже рассмотрел коллега.")
                send_admin_menu(actor)
            return
        status = 'Одобрено' if action == 'approve' else 'Отклонено'
        test_by = app.get('test_by')
        if not test_by:
            storage.add_application(app, status, comment, actor, decider)
        del pending[user_id_str]
    details = (comment or '') + (' [тестовая заявка]' if test_by else '')
    if actor is None:
        details = "автоматически: " + state.get('auto_desc', '') + details
    audit(actor, 'approved' if action == 'approve' else 'rejected', app['user_id'], app['nick'], details)
    if action == 'approve' and not test_by:
        run_in_background(register_on_server, app['nick'], app['password'], actor, app['user_id'])

    # Карточка заявки остаётся в чате с пометкой решения и того, кто решил
    action_icon = "✅" if action == 'approve' else "❌"
    action_label = "ОДОБРЕНО" if action == 'approve' else "ОТКЛОНЕНО"
    decided_at = fmt_time(timeutil.now_iso(), actor)
    decision_suffix = f"\n\n{action_icon} <b>{action_label}</b> [{decided_at}] · {escape_html(decider)}"
    if comment:
        decision_suffix += f"\n💬 Комментарий: {escape_html(comment)}"
    if test_by:
        decision_suffix += "\n🧪 Тестовая заявка: на сервере не регистрировалась"
    if state.get('app_msg_message_id'):
        try:
            bot.edit_message_text(
                chat_id=state.get('app_msg_chat_id', actor),
                message_id=state['app_msg_message_id'],
                text=f"📁 <b>Заявка закрыта</b>\n"
                     f"👤 Ник: <code>{escape_html(app['nick'])}</code>\n"
                     f"🧑 {escape_html(app.get('tg_name', '—'))}\n"
                     f"🆔 <code>{app['user_id']}</code>\n"
                     f"📛 @{escape_html(app.get('username',''))} \n"
                     f"📅 {fmt_time(app.get('date'), actor)}"
                     f"{decision_suffix}",
                parse_mode='HTML',
                reply_markup=None
            )
        except Exception:
            pass
    # У коллег уведомление о заявке помечается решённым
    close_notices('app', user_id_str, f"{action_icon} <b>{action_label}</b> [{{t}}] · {escape_html(decider)}")

    if state.get('prompt_msg_id') and actor is not None:
        try:
            bot.delete_message(chat_id=actor, message_id=state['prompt_msg_id'])
        except Exception:
            pass

    run_in_background(notify_player_decision, action, user_id_str, app, comment)
    discord_decision_notify(app["nick"], status, (comment or "") + (" [тестовая заявка]" if test_by else ""), decider)
    send_admin_menu(actor)

def notify_player_decision(action, user_id_str, app, comment):
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

# ---------- Блокировка ----------
def process_block(user_id_str, reason, original_msg, actor=ADMIN_ID):
    try:
        uid = int(user_id_str)
    except ValueError:
        safe_send(actor, "Некорректный ID."); return
    if uid in staff:
        safe_send(actor, "Это член команды. Сначала снимите доступ в разделе «Команда».")
        return
    blocked_users.add(uid)
    audit(actor, 'blocked', uid, player_nick(uid), reason)

    # Завершаем диалог, если кто-то из команды его вёл
    talker = dialog_admin(uid)
    if talker is not None:
        dialogs.pop(talker, None)
        close_ticket(uid)
        if talker != actor:
            safe_send(talker, f"🔇 Диалог с {enrich_user_label(uid)} завершён: {staff_name(actor)} заблокировал пользователя.")
    clear_unread(uid)
    close_notices('ticket', uid, f"🚫 <b>Заблокирован</b> · {escape_html(staff_name(actor))}")

    msg_text = "🚫 Вы были заблокированы администратором."
    if reason:
        msg_text += f"\nПричина: {reason}"
    try:
        bot.send_message(uid, msg_text, reply_markup=types.ReplyKeyboardRemove())
    except Exception as e:
        log_error(e)
        safe_send(actor, f"Заблокирован, но не удалось уведомить {uid}: {e}")

    if talker == actor:
        safe_send(actor, f"🔇 Диалог с {enrich_user_label(uid)} завершён — пользователь заблокирован.")
    safe_send(actor, f"🚫 Пользователь {uid} заблокирован.")
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
                t_username = bot.get_chat(uid).username or ""
            except Exception:
                pass
        discord_player_blocked(t_nick or f"ID {uid}", uid, t_username, reason, staff_name(actor))
    except Exception:
        pass
    send_admin_menu(actor)

# ---------- Ежедневное напоминание ----------
def daily_job():
    reload_pending()
    if pending:
        discord_daily_reminder()
        notify_staff('apps', f"⏳ Напоминание: в очереди {len(pending)} заявок(и). Проверьте бот.")


def backup_job():
    try:
        storage.backup()
    except Exception as e:
        log_error(e)

def run_scheduler():
    schedule.every().day.at("08:00", "Europe/Moscow").do(daily_job)
    schedule.every().day.at("04:00", "Europe/Moscow").do(backup_job)
    schedule.every(1).minutes.do(auto_job)  # автопринятие подошедших заявок и конец рейд-режима  # копия bot.db в backups/, 14 последних
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == '__main__':
    # Владелец в списке команды под своим именем из Telegram
    if not db_exec("SELECT 1 FROM staff WHERE tg_id=?", (ADMIN_ID,), fetch=True):
        db_exec("INSERT INTO staff (tg_id, name, role, added_by, added_at) VALUES (?,?,?,?,?)",
                (ADMIN_ID, tg_display_name(ADMIN_ID), ROLE_OWNER, ADMIN_ID, timeutil.now_iso()))
        load_staff()
    print("✅ TotemCraftBot запущен")
    threading.Thread(target=run_scheduler, daemon=True).start()
    bot.infinity_polling()
