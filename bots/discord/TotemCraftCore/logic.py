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
TASK_COMMANDS = ("dushelow", "totemcraft", "adminbot", "admin")
TASK_ROLE_IDS = {
    1454170537113681967,  # Модератор
    1454170537113681968,  # Администратор
    1454170537113681969,  # Главный администратор
    1454170537130590210,  # Заместитель основателя проекта
    1454170537130590211,  # Основатель проекта
}


def is_urgent(text: str) -> bool:
    """Слово «срочно» в любом регистре: такую задачу Claude разбирает первой."""
    return "срочн" in (text or "").lower()


def task_ack(task_id: int, text: str, waiting: int) -> str:
    """Короткое подтверждение автору; саму задачу все видят карточкой в чате."""
    return f"📥 Задача #{task_id} записана, карточка в чате. Открытых задач: {waiting}."


ORANGE, GREEN, RED, BLUE = 0xFAA61A, 0x43B581, 0xF04747, 0x5865F2
EMBED_TEXT = 4000  # Дискорд: описание карточки до 4096 знаков


def author_label(user_id: int, owner_id: int) -> str:
    """Кто дал задачу. Владельца не упоминаем (он так попросил), остальных упоминанием."""
    return "владелец" if user_id == owner_id else f"<@{user_id}>"


def quote(text: str) -> str:
    return "\n".join("> " + line if line.strip() else ">" for line in (text or "").strip().splitlines())


def task_card(task_id: int, author: str, text: str, duty: bool = False) -> dict:
    """Карточка сразу в админ-чат: все видят задачу и кто её дал. Срочная оранжевая, обычная синяя."""
    if is_urgent(text):
        title, color = f"⚡ Срочная задача #{task_id}", ORANGE
        tail = "Дежурный уже разбирает, ответ придёт сюда." if duty else "Записана, разберу первой."
    else:
        title, color = f"📥 Задача #{task_id}", BLUE
        tail = "Разберу на ближайшем обходе: утром после рестарта или вечером."
    return {"title": title, "color": color,
            "description": f"**От:** {author}\n\n{quote(truncate(text, 1500))}\n\n*{tail}*"}


def urgent_card(task_id: int, author: str, text: str, duty: bool = False) -> dict:
    return task_card(task_id, author, text if is_urgent(text) else "срочно " + text, duty)


_NOISE = re.compile(r"^\s*(\**\s*ответ( в админ-чат)?\s*:?\s*\**\s*|<@!?\d+>[\s,:]*)+", re.IGNORECASE)


def _kind(line: str) -> str:
    s = line.lstrip()
    if s.startswith("#"):
        return "head"
    if s.startswith(">"):
        return "quote"
    if re.match(r"([-•*]|\d+[.)])\s", s):
        return "list"
    if s.startswith("**") and ":**" in s[:60]:
        return "label"
    return "text"


def airy(text: str) -> str:
    """Пустые строки между блоками (абзац, список, цитата, подпись **Что:**), чтобы текст не слипался."""
    out, code = [], False
    for line in text.splitlines():
        if line.startswith("```"):
            code = not code
        elif not code and out and out[-1].strip() and line.strip():
            prev, cur = _kind(out[-1]), _kind(line)
            if cur in ("head", "label") or prev == "head" or (cur != prev and prev != "label"):
                out.append("")
        out.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def clean_answer(answer: str) -> str:
    """Убирает то, что дежурный иногда дописывает сам («Ответ в админ-чат:», упоминание в начале), и разрежает текст."""
    return airy(_NOISE.sub("", (answer or "").strip()).strip()) or "(пустой ответ)"


def app_card(nick: str, answer: str) -> dict:
    """Заявку Telegram дежурный оставил людям: просим команду решить."""
    return {"title": f"📋 Заявки ждут решения команды: {nick}", "color": ORANGE, "footer": {"text": "Дежурный Claude"},
            "description": truncate(clean_answer(answer), EMBED_TEXT)}


def answer_card(task_id: int, author: str, ok: bool, answer: str) -> dict:
    """Карточка ответа дежурного: зелёная готово, красная не вышло."""
    head = f"**От:** {author}\n\n"
    return {"title": f"{'✅' if ok else '❌'} Задача #{task_id}" + ("" if ok else ": не вышло"),
            "color": GREEN if ok else RED, "footer": {"text": "Дежурный Claude"},
            "description": head + truncate(clean_answer(answer), EMBED_TEXT - len(head))}


_LINK = re.compile(r"https://(?:ptb\.|canary\.)?discord(?:app)?\.com/channels/(\d+)/(\d+)")


def linked_channels(text: str, guild_id: int):
    """Каналы и ветки нашего сервера по ссылкам в задаче, не больше трёх."""
    out = []
    for g, ch in _LINK.findall(text or ""):
        if int(g) == guild_id and int(ch) not in out:
            out.append(int(ch))
    return out[:3]


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
