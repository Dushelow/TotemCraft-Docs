"""Чистая логика TotemCraftCore без зависимости от discord.py: её проверяют тесты."""
import re
from datetime import datetime

THREAD_NAME_MAX = 100
CHANNEL_NAME_MAX = 100
FIELD_MAX = 1024

ROOM_PREFIX = "🏠┃#"

_MARKDOWN = re.compile(r"(\*\*|__|~~|\|\||`+|^#+\s*|^>\s*)", re.MULTILINE)
_MENTION = re.compile(r"<(@[!&]?|#)\d+>|<a?:\w+:\d+>")
_URL = re.compile(r"https?://\S+")


# Ящик задач: три имени одной команды; писать могут модератор и выше и владелец сервера
TASK_COMMANDS = ("dushelow", "totemcraft", "adminbot")
TASK_ROLE_IDS = {
    1454170537113681967,  # Модератор
    1454170537113681968,  # Администратор
    1454170537113681969,  # Главный администратор
    1454170537130590210,  # Заместитель основателя проекта
    1454170537130590211,  # Основатель проекта
}


def may_give_task(role_ids, user_id: int, owner_id: int) -> bool:
    """Модератор и выше или владелец сервера."""
    return user_id == owner_id or bool(TASK_ROLE_IDS & set(role_ids))


def truncate(text: str, limit: int) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def thread_title(content: str, fallback: str) -> str:
    """Название треда по первой непустой строке поста, иначе запасное.

    Убираем разметку, упоминания и ссылки: в названии треда они не работают.
    """
    text = _URL.sub("", content or "")
    text = _MENTION.sub("", text)
    text = _MARKDOWN.sub("", text)
    for line in text.splitlines():
        line = " ".join(line.split())
        if line:
            return truncate(line, THREAD_NAME_MAX)
    return fallback


def room_name(number: int, username: str) -> str:
    return truncate(f"{ROOM_PREFIX}{number} - комната игрока {username}", CHANNEL_NAME_MAX)


def next_room_number(used: set[int]) -> int:
    """Самый маленький свободный номер комнаты: #1, #2, ... как у Лакуны."""
    n = 1
    while n in used:
        n += 1
    return n


def format_archive(minutes: int | None) -> str:
    """Время автоархивации ветки в виде 168:00:00, как писала Лакуна."""
    if not minutes:
        return "-"
    return f"{minutes // 60}:{minutes % 60:02d}:00"


def role_diff(before: set[int], after: set[int]) -> tuple[set[int], set[int]]:
    return after - before, before - after


def timeout_change(before_until: datetime | None, after_until: datetime | None, now: datetime) -> str | None:
    """'given', 'removed' или None. Истечение мута по времени не считаем снятием."""
    was = before_until is not None and before_until > now
    is_ = after_until is not None and after_until > now
    if is_ and (not was or before_until != after_until):
        return "given"
    if was and after_until is None:
        return "removed"
    return None


CHANNEL_FIELDS = (
    ("name", "название"),
    ("topic", "описание"),
    ("user_limit", "лимит участников"),
    ("slowmode_delay", "медленный режим"),
    ("nsfw", "возрастное ограничение"),
    ("bitrate", "битрейт"),
)


def channel_changes(before: dict, after: dict) -> list[tuple[str, str, str]]:
    """Список (что, до, после) по полям канала, которые стоит писать в журнал.

    Позицию не пишем: она сдвигается у соседей при каждом создании канала.
    """
    out = []
    for key, label in CHANNEL_FIELDS:
        b, a = before.get(key), after.get(key)
        if b != a:
            out.append((label, "-" if b in (None, "") else str(b), "-" if a in (None, "") else str(a)))
    return out


def message_body(content: str | None, attachments: int) -> str:
    """Текст сообщения для журнала: содержимое и пометка о вложениях."""
    parts = []
    if content:
        parts.append(content)
    if attachments:
        parts.append("`[Вложение]`" if attachments == 1 else f"`[Вложения: {attachments}]`")
    return truncate("\n".join(parts) or "-", FIELD_MAX)
