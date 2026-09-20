"""Вид экранов команды: подписи у значений, единый формат времени, порядок кнопок.
Запуск: python tests/test_ui.py <временная папка>"""
import os
import shutil
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check, sent_to, edited, buttons

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
OWNER, P = 1000, 7_700_001
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER, names={OWNER: 'Влад', P: 'Ёлка *Elka*'})
bot, press, say = ctx.bot, ctx.press, ctx.say
tu = bot.timeutil
bot.RATE_LIMIT = 10 ** 6


def plain(text):
    return fakes.strip_tags(text)


print("=== 1. Время одним форматом ===")
now = tu.now_utc()
check(bot.when(now.isoformat()).startswith('сегодня в '), f"сегодня: {bot.when(now.isoformat())}")
check(bot.when((now - timedelta(days=1)).isoformat()).startswith('вчера в '), "вчера")
old = (now - timedelta(days=40)).isoformat()
check(' в ' in bot.when(old) and bot.when(old)[:2].isdigit(), f"давнее: дата с часами ({bot.when(old)})")
check(bot.when(None) == '—', "пусто остаётся прочерком")
check(bot.ago((now - timedelta(seconds=30)).isoformat()) == 'только что', "полминуты назад")
check(bot.ago((now - timedelta(minutes=21)).isoformat()) == '21 минуту назад', "минуты в правильном падеже")
check(bot.ago((now - timedelta(hours=2)).isoformat()) == '2 часа назад', "часы в правильном падеже")
check(bot.ago((now - timedelta(days=5)).isoformat()) == '5 дней назад', "дни в правильном падеже")

print("\n=== 2. Карточка заявки: все подписи на месте ===")
bot.user_states[P] = {'step': 'rules', 'nick': 'Elka_1221', 'password': 'Str0ngPass1', 'comment': 'друг позвал'}
_, log = press(P, 'rules_agree')
card = plain(sent_to(log, OWNER)[0])
for label in ['Ник в игре: Elka_1221', 'Имя в Telegram: Ёлка', 'Username: @', 'ID в Telegram: 7700001',
              'Подал: сегодня в ', 'Комментарий игрока: друг позвал', 'Проверки']:
    check(label in card, f"в карточке есть «{label.split(':')[0]}»")
check('Пароль' not in card, "пароля в карточке нет")
check('ждёт ' not in card, "в присланном уведомлении относительного времени нет: оно бы устарело")
keys = buttons(log, OWNER)
check('🏠 Меню' in keys and '📋 Все заявки' in keys, f"из уведомления о заявке есть выход в меню и очередь: {keys}")

print("\n=== 3. Очередь заявок: видно, сколько заявка ждёт ===")
app = bot.pending[str(P)]
app['date'] = (tu.now_utc() - timedelta(minutes=40)).isoformat(timespec='seconds')
bot.pending[str(P)] = app
(t, _), log = press(OWNER, 'admin_menu_applications')
queue = plain(edited(log)[-1][1] if edited(log) else sent_to(log, OWNER)[0])
check('ждёт 40 минут' in queue, f"в списке заявок видно ожидание: {[l for l in queue.splitlines() if 'Подал' in l]}")

print("\n=== 4. Профиль: время решения с часами, подписи, свёрнутые подробности ===")
press(OWNER, f'approve_{P}', mid=90)
say(OWNER, '-')
say(P, '/start')
press(P, 'menu_support'); press(P, 'support_confirmed'); press(P, 'support_existing')
say(P, 'Elka_1221')
say(P, 'у меня украли из сундука')
press(OWNER, f'reply_{P}')
say(OWNER, 'посмотрю логи')
(t, _), log = press(OWNER, f'user_profile_{P}')
raw = edited(log)[-1][1]
prof = plain(raw)
for label in ['Ник в игре: Elka_1221', 'Имя в Telegram: Ёлка', 'ID в Telegram: 7700001',
              'Статус: одобрена сегодня в ', 'Подал: сегодня в ', 'Решил: ', 'Всего заявок: 1',
              'Аккаунт на сервере', 'Открытый тикет: #', 'Сообщений в переписке: ', 'Проверки']:
    check(label in prof, f"в профиле есть «{label.rstrip(': ')}»")
check('blockquote expandable' in raw, "подробности свёрнуты в раскрывающуюся цитату")
check('Аккаунт Telegram:' in prof and 'Ещё о человеке' in prof, "в свёрнутом блоке приметы аккаунта")
check(prof.count('Elka_1221') <= 3, f"ник не повторяется лишний раз: {prof.count('Elka_1221')}")
b = buttons(log, OWNER)
check(b[0] == '💬 Написать игроку', f"первая кнопка — главное действие: {b[:2]}")
check(b.index('🚫 Заблокировать') > b.index('🏠 Меню'), "опасная кнопка отдельно, ниже навигации")

print("\n=== 5. Уведомление об обращении: сперва текст человека ===")
G = 7_700_002
say(G, '/start')
press(G, 'menu_support'); press(G, 'support_confirmed'); press(G, 'support_no_account'); press(G, 'support_guest')
log = say(G, 'помогите пожалуйста')
note = [x for x in sent_to(log, OWNER) if 'Обращение' in x]
check(note, "команде пришло уведомление")
body = plain(note[0])
check(body.splitlines()[0].startswith('📬 Обращение #') and ' · сегодня в ' in body.splitlines()[0],
      f"в заголовке номер и абсолютное время: {body.splitlines()[0]}")
check('«помогите пожалуйста»' in body, "текст игрока сразу под заголовком")
check(body.index('помогите пожалуйста') < body.index('ID в Telegram'), "текст выше данных для опознания")

fakes.finish()
