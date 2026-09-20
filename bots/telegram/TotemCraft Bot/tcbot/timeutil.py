"""Время: в базе всегда UTC (ISO 8601 с +00:00), человеку показываем в его поясе."""
from datetime import datetime, timedelta, timezone

import pytz

from . import config

# Пояса, из которых админ выбирает свой (название для кнопки, имя пояса)
TIMEZONES = [
    ("Калининград (UTC+2)", "Europe/Kaliningrad"),
    ("Москва (UTC+3)", "Europe/Moscow"),
    ("Самара (UTC+4)", "Europe/Samara"),
    ("Екатеринбург (UTC+5)", "Asia/Yekaterinburg"),
    ("Омск (UTC+6)", "Asia/Omsk"),
    ("Новосибирск (UTC+7)", "Asia/Novosibirsk"),
    ("Иркутск (UTC+8)", "Asia/Irkutsk"),
    ("Якутск (UTC+9)", "Asia/Yakutsk"),
    ("Владивосток (UTC+10)", "Asia/Vladivostok"),
    ("Магадан (UTC+11)", "Asia/Magadan"),
    ("Камчатка (UTC+12)", "Asia/Kamchatka"),
    ("Минск (UTC+3)", "Europe/Minsk"),
    ("Киев (UTC+2/+3)", "Europe/Kyiv"),
    ("Алматы (UTC+5)", "Asia/Almaty"),
    ("UTC", "UTC"),
]
TZ_NAMES = {tz: label for label, tz in TIMEZONES}


def now_utc():
    return datetime.now(timezone.utc)


def now_iso():
    """Текущее время для записи в базу."""
    return now_utc().isoformat(timespec='seconds')


def parse(value):
    """ISO-строка из базы -> datetime с поясом. Строка без пояса считается UTC."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def legacy_to_iso(value, fmt=None):
    """Время из старых файлов (без пояса, по часам сервера) -> UTC ISO. Пустое/кривое -> None."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value, fmt) if fmt else datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = pytz.timezone(config.LEGACY_TZ).localize(dt)
    return dt.astimezone(timezone.utc).isoformat(timespec='seconds')


def zone(tz_name=None):
    try:
        return pytz.timezone(tz_name or config.DEFAULT_TZ)
    except pytz.UnknownTimeZoneError:
        return pytz.timezone(config.DEFAULT_TZ)


def local(value, tz_name=None):
    dt = parse(value)
    return dt.astimezone(zone(tz_name)) if dt else None


def fmt(value, tz_name=None, pattern='%d.%m.%Y %H:%M'):
    """Время для показа человеку в его поясе. Пусто -> «—»."""
    dt = local(value, tz_name)
    return dt.strftime(pattern) if dt else '—'


def plural(n, forms):
    """Русское число со словом: (1, ('минуту','минуты','минут')) -> «1 минуту»."""
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        word = forms[0]
    elif n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        word = forms[1]
    else:
        word = forms[2]
    return f"{n} {word}"


def human(value, tz_name=None):
    """Время для человека: «сегодня в 10:07», «вчера в 21:03», «12.09 в 10:07».
    Для другого года добавляется год. Пусто -> «—»."""
    dt = local(value, tz_name)
    if not dt:
        return '—'
    today = datetime.now(zone(tz_name)).date()
    days = (today - dt.date()).days
    if days == 0:
        return dt.strftime('сегодня в %H:%M')
    if days == 1:
        return dt.strftime('вчера в %H:%M')
    if days == -1:
        return dt.strftime('завтра в %H:%M')
    pattern = '%d.%m в %H:%M' if dt.year == today.year else '%d.%m.%Y в %H:%M'
    return dt.strftime(pattern)


def ago(value, tz_name=None):
    """Сколько прошло: «только что», «12 минут назад», «2 часа назад», «3 дня назад».
    Только для экранов, которые бот рисует в момент открытия: в отправленном сообщении такое устареет."""
    dt = parse(value)
    if not dt:
        return '—'
    seconds = (now_utc() - dt).total_seconds()
    if seconds < 0:
        return human(value, tz_name)
    if seconds < 90:
        return 'только что'
    minutes = seconds / 60
    if minutes < 60:
        return plural(round(minutes), ('минуту', 'минуты', 'минут')) + ' назад'
    hours = minutes / 60
    if hours < 24:
        return plural(round(hours), ('час', 'часа', 'часов')) + ' назад'
    days = hours / 24
    if days < 31:
        return plural(round(days), ('день', 'дня', 'дней')) + ' назад'
    return human(value, tz_name)


def from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def today_bounds_iso(tz_name=None):
    """Начало и конец «сегодня» в поясе человека, в UTC ISO — для подсчёта «за сегодня»."""
    tz = zone(tz_name)
    start_local = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    start = start_local.astimezone(timezone.utc)
    end = (start_local + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat(timespec='seconds'), end.isoformat(timespec='seconds')
