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


def from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def today_bounds_iso(tz_name=None):
    """Начало и конец «сегодня» в поясе человека, в UTC ISO — для подсчёта «за сегодня»."""
    tz = zone(tz_name)
    start_local = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    start = start_local.astimezone(timezone.utc)
    end = (start_local + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat(timespec='seconds'), end.isoformat(timespec='seconds')
