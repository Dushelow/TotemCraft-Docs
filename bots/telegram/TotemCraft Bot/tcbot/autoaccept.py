"""Правила автопринятия заявок. Только решение по готовым фактам, без Telegram и базы (легко проверять тестами).

Стоп-факторы (✋ только вручную): бан или мут когда-либо (ник, прошлые ники, IP), твинк (у TG ID уже был
одобренный аккаунт или с того же IP есть аккаунт в бане), блок в боте, брань и символика в нике, пароле
или комментарии, раньше отклоняли, аккаунту Telegram меньше 2 месяцев, игрок пытался обратиться, пока заявка ждёт.
Мелочи (каждая +1): нет аватарки, нет username, аккаунту Telegram меньше года, есть комментарий,
в нике 6 и больше цифр подряд.
Срок: без мелочей 1 ч (5 мин, если подписан на группу), 1 мелочь 12 ч, 2 — 24 ч, 3 и больше — 48 ч.
"""
import re
from datetime import timedelta

DELAYS = {0: timedelta(hours=1), 1: timedelta(hours=12), 2: timedelta(hours=24)}
DELAY_MANY = timedelta(hours=48)
DELAY_SUBSCRIBED = timedelta(minutes=5)
LIMIT_HOUR = 5
LIMIT_DAY = 10
YOUNG_STOP_DAYS = 61      # меньше ~2 месяцев — стоп
YOUNG_MINOR_DAYS = 365    # меньше года — мелочь

MINOR_ICONS = {0: '🟢', 1: '🟡', 2: '🟠'}


def decide(f):
    """f — факты о заявке (словарь). Возвращает словарь:
    manual (bool), stop (причины «только вручную»), minor (мелочи), delay (timedelta или None), icon."""
    stop, minor = [], []
    if f.get('bans'):
        stop.append("Наказания на сервере: " + ", ".join(f['bans'][:3]))
    if f.get('approved_before'):
        stop.append("Твинк: с этого Telegram уже одобрен аккаунт " + ", ".join(f['approved_before'][:3]))
    if f.get('ip_banned_twins'):
        stop.append("Твинк: с того же IP заходил забаненный аккаунт " + ", ".join(f['ip_banned_twins'][:3]))
    if f.get('blocked'):
        stop.append("Игрок заблокирован в боте")
    for where, hits in (('нике', f.get('bad_nick')), ('пароле', f.get('bad_password')), ('комментарии', f.get('bad_comment'))):
        if hits:
            stop.append(f"Недопустимые слова в {where}: " + ", ".join(sorted({cat for cat, _ in hits})))
    if f.get('rejected_before'):
        stop.append(f"Отклоняли раньше: {f['rejected_before']}")
    age = f.get('tg_age_days')
    if age is not None and age < YOUNG_STOP_DAYS:
        stop.append("Аккаунту Telegram меньше 2 месяцев")
    if f.get('asked_support'):
        stop.append("Писал в поддержку, пока заявка ждёт решения")

    if f.get('has_photo') is False:
        minor.append("Нет аватарки")
    if f.get('has_username') is False:
        minor.append("Нет username")
    if age is not None and YOUNG_STOP_DAYS <= age < YOUNG_MINOR_DAYS:
        minor.append("Аккаунту Telegram меньше года")
    if (f.get('comment') or '').strip():
        minor.append("Есть комментарий к заявке")
    if re.search(r'\d{6,}', f.get('nick') or ''):
        minor.append("В нике 6 и больше цифр подряд")

    if stop:
        return {'manual': True, 'stop': stop, 'minor': minor, 'delay': None, 'icon': '✋'}
    n = len(minor)
    if n == 0 and f.get('subscribed'):
        delay, icon = DELAY_SUBSCRIBED, '⚡'
    else:
        delay, icon = DELAYS.get(n, DELAY_MANY), MINOR_ICONS.get(n, '🟠')
    return {'manual': False, 'stop': [], 'minor': minor, 'delay': delay, 'icon': icon}


def delay_text(delay):
    minutes = int(delay.total_seconds() // 60)
    return f"{minutes} мин" if minutes < 60 else f"{minutes // 60} ч"
