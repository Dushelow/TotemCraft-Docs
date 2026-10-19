"""Чистая логика TotemCraftCore без зависимости от discord.py: её проверяют тесты."""
import re
from datetime import datetime, timezone

THREAD_NAME_MAX = 100
CHANNEL_NAME_MAX = 100
FIELD_MAX = 1024

ROOM_PREFIX = "🏠┃#"

_MARKDOWN = re.compile(r"(\*\*|__|~~|\|\||`+|^#+\s*|^>\s*)", re.MULTILINE)
_MENTION = re.compile(r"<(@[!&]?|#)\d+>|<a?:\w+:\d+>")
_URL = re.compile(r"https?://\S+")


# Задачи админ-чата: несколько имён одной команды; писать могут модератор и выше и владелец сервера
TASK_COMMANDS = ("dushelow", "totemcraft", "adminbot", "admin")
TASK_ROLE_IDS = {
    1454170537113681967,  # Модератор
    1454170537113681968,  # Администратор
    1454170537113681969,  # Главный администратор
    1454170537130590210,  # Заместитель основателя проекта
    1454170537130590211,  # Основатель проекта
}


# Сводка по запросу: весь текст задачи только «проведи / пришли / собери / сделай сводку»
SUMMARY = re.compile(r"^\s*(?:срочно[\s,:!]*)?(?:проведи|пришли|собери|сделай)\s+сводку\s*[.!]*\s*$", re.IGNORECASE)


def is_summary(text: str) -> bool:
    return bool(SUMMARY.match(text or ""))


def is_urgent(text: str) -> bool:
    """Слово «срочно» в любом регистре: такую задачу Claude разбирает первой."""
    return "срочн" in (text or "").lower()


def task_ack(task_id: int, text: str, waiting: int) -> str:
    """Короткое подтверждение автору; саму задачу все видят карточкой в чате."""
    return f"Задача № {task_id} принята. Ответ придёт в этот чат ответом на карточку задачи. Открытых задач: {waiting}."


# Карточки в админ-чате: строгий вид, без эмодзи; разделы ответа идут полями карточки,
# Discord сам ставит между ними отступы, поэтому текст не слипается.
AMBER, GREEN, RED, BLUE, SLATE = 0xD89614, 0x2D9D78, 0xD64545, 0x3B6FD8, 0x4F5D75
EMBED_TEXT = 4000   # описание карточки до 4096 знаков
FIELD_TEXT = 1000   # поле до 1024 знаков
FOOTER = {"text": "TotemCraft"}
FIELD_NAMES = {"владельцу": "Требует решения владельца", "команде": "Требует внимания команды"}
FIRST_FIELDS = ("Требует решения владельца", "Требует внимания команды")  # то, что требует действий, наверх
STATUS_COLORS = {"норма": SLATE, "внимание": AMBER, "проблема": RED}
MONTHS = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
          "ноября", "декабря")
SLOTS = ((6, 0), (21, 0))  # время ассистента, МСК (часы сервера)


def day_label(day=None) -> str:
    day = day or datetime.now()
    return f"{day.day} {MONTHS[day.month - 1]}"


def next_slot_label(now=None) -> str:
    """Когда ассистент возьмёт обычную задачу: «сегодня в 21:00» или «завтра в 06:00»."""
    now = now or datetime.now()
    for h, m in SLOTS:
        if (now.hour, now.minute) < (h, m):
            return f"сегодня в {h:02d}:{m:02d}"
    return f"завтра в {SLOTS[0][0]:02d}:{SLOTS[0][1]:02d}"


def author_label(user_id: int, owner_id: int) -> str:
    """Кто дал задачу. Владельца не упоминаем (он так попросил), остальных упоминанием."""
    return "владелец" if user_id == owner_id else f"<@{user_id}>"


def quote(text: str) -> str:
    return "\n".join("> " + line if line.strip() else ">" for line in (text or "").strip().splitlines())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _field(name: str, value: str, inline: bool = False) -> dict:
    return {"name": name, "value": truncate(value.strip() or "нет", FIELD_TEXT), "inline": inline}


def _card(title: str, color: int, description: str = "", fields=()) -> dict:
    card = {"title": title, "color": color, "footer": FOOTER, "timestamp": _now(), "fields": list(fields)[:25]}
    if description:
        card["description"] = truncate(description, EMBED_TEXT)
    return card


def task_card(task_id: int, author: str, text: str, duty: bool = False, now=None) -> dict:
    """Карточка задачи сразу в админ-чат: что, кто поставил, когда будет ответ."""
    if is_summary(text):
        title, color, when = f"Запрос сводки № {task_id}", SLATE, "сейчас" if duty else next_slot_label(now)
    elif is_urgent(text):
        title, color, when = f"Срочная задача № {task_id}", AMBER, "сейчас" if duty else next_slot_label(now)
    else:
        title, color, when = f"Задача № {task_id}", BLUE, next_slot_label(now)
    return _card(title, color, quote(truncate(text, 1500)),
                 [_field("Автор", author, True), _field("Срок", when, True)])


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
    """Убирает то, что ассистент иногда дописывает сам («Ответ в админ-чат:», упоминание в начале), и разрежает текст."""
    return airy(_NOISE.sub("", (answer or "").strip()).strip()) or "(пустой ответ)"


_LABEL = re.compile(r"^\s*\*\*([^*\n]{1,60}?):\*\*\s*(.*)$")
_META = re.compile(r"^\s*(статус|итог)\s*:\s*(.+)$", re.IGNORECASE)
_KPI = re.compile(r"^\s*[-•]?\s*([^:\n]{1,30}):\s*(.{1,60})$")


def parse_report(answer: str):
    """Ответ ассистента → (статус, вступление, показатели, разделы).

    Договор с ассистентом (RULES.md, routine.md): строки «Статус: норма|внимание|проблема» и «Итог: ...»,
    раздел «**Показатели:**» из строк «Название: значение» (станут плитками в ряд) и разделы «**Название:**»."""
    text = _NOISE.sub("", (answer or "").strip()).strip()
    status, intro, sections_, current = "", [], [], None
    for line in text.splitlines():
        label, meta = _LABEL.match(line), _META.match(line)
        if label:
            name = label.group(1).strip()
            current = [FIELD_NAMES.get(name.lower(), name), [label.group(2)] if label.group(2) else []]
            sections_.append(current)
        elif current is None and meta:
            if meta.group(1).lower() == "статус":
                status = meta.group(2).strip().lower().rstrip(".")
            else:
                intro.append(meta.group(2).strip())
        elif current is not None:
            current[1].append(line)
        else:
            intro.append(line)
    kpis, fields = [], []
    for name, lines in sections_:
        if name.lower() == "показатели":
            kpis += [_field(m.group(1).strip(), m.group(2).strip(), True) for m in map(_KPI.match, lines) if m][:6]
        else:
            fields.append(_field(name, airy("\n".join(lines))))
    fields.sort(key=lambda f: 0 if f["name"] in FIRST_FIELDS else 1)
    summary = airy("\n".join(intro)) or ("" if fields or kpis else "(пустой ответ)")
    return status, summary, kpis, fields


def sections(answer: str):
    """Вступление и разделы без показателей (для ответов на задачи)."""
    _, summary, kpis, fields = parse_report(answer)
    return summary, kpis + fields


def routine_card(title: str, ok: bool, answer: str) -> dict:
    """Сводка ассистента: «Ежедневная сводка · 19 октября», «Сводка на 14:30 · 19 октября», «Требует внимания · 19 октября»."""
    status, summary, kpis, fields = parse_report(answer)
    title = title or "Ежедневная сводка"
    head = (f"Сводка на {datetime.now():%H:%M}" if title == "Сводка на" else title) + f" · {day_label()}"
    color = STATUS_COLORS.get(status, AMBER if title == "Требует внимания" else SLATE)
    if not ok:
        head, color = head + " · не завершена", RED
    return _card(head, color, summary, kpis + fields)


def app_card(nick: str, answer: str) -> dict:
    """Заявки Telegram, которые ассистент оставил людям."""
    summary, fields = sections(answer)
    return _card("Заявки ждут решения команды", AMBER, summary, [_field("Заявки", nick, True)] + fields)


def answer_card(task_id: int, author: str, ok: bool, answer: str) -> dict:
    """Ответ ассистента на задачу (уходит ответом на карточку задачи)."""
    summary, fields = sections(answer)
    return _card(f"Задача № {task_id} · " + ("выполнена" if ok else "не выполнена"), GREEN if ok else RED,
                 summary, [_field("Автор задачи", author, True)] + fields)


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
