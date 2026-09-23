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
check(not hasattr(bot, 'ago') and not hasattr(bot, 'waiting'),
      "относительного времени в сообщениях нет: «18 минут назад» застывает, сообщение в чате не обновляется")

print("\n=== 2. Карточка заявки: все подписи на месте ===")
bot.user_states[P] = {'step': 'rules', 'nick': 'Elka_1221', 'password': 'Str0ngPass1', 'comment': 'друг позвал'}
_, log = press(P, 'rules_agree')
note = plain(sent_to(log, OWNER)[0])
check(note.startswith('📩 Новая заявка!') and 'В очереди: 1' in note, f"уведомление короткое, как раньше: {note!r}")
check(buttons(log, OWNER) == ['📋 Открыть заявки'], "в уведомлении одна кнопка «Открыть заявки»")
_, log = press(OWNER, 'admin_menu_applications_new')
check(sent_to(log, OWNER) and not edited(log), "очередь открывается отдельным сообщением, уведомление остаётся на месте")
card = plain(sent_to(log, OWNER)[-1])
for label in ['Ник в игре: Elka_1221', 'Имя в Telegram: Ёлка', 'Username: @', 'ID в Telegram: 7700001',
              'Подал: сегодня в ', 'Комментарий игрока: друг позвал']:
    check(label in card, f"в карточке есть «{label.split(':')[0]}»")
check('Замечаний: 1' in card and 'Подробнее' in card, f"замечания не списком, а счётом со ссылкой на «Подробнее»: {card[-80:]!r}")
check('Есть комментарий к заявке' not in card, "причины мелочей в карточку не лезут")
check('Пароль' not in card, "пароля в карточке нет")
check('ждёт ' not in card, "относительного времени нет: оно бы устарело")
check('✅ Одобрить' in buttons(log, OWNER), "в очереди кнопки решения")
Q = 7_700_009
bot.user_states[Q] = {'step': 'rules', 'nick': 'Second_One', 'password': 'Str0ngPass1', 'comment': ''}
press(Q, 'rules_agree')
_, log = press(OWNER, 'admin_menu_applications_new')
keys = buttons(log, OWNER)
check('1/2' in keys and '▶️' in keys, f"заявки листаются: {keys[:4]}")
_, log = press(OWNER, 'pending_page_1')
check(any('Second_One' in plain(t) for _, t in edited(log)), "▶️ показывает следующую заявку")
bot.pending.pop(str(Q))

print("\n=== 3. Очередь заявок: время подачи ===")
app = bot.pending[str(P)]
app['date'] = (tu.now_utc() - timedelta(days=1, minutes=40)).isoformat(timespec='seconds')
bot.pending[str(P)] = app
(t, _), log = press(OWNER, 'admin_menu_applications')
queue = plain(edited(log)[-1][1] if edited(log) else sent_to(log, OWNER)[0])
check('Подал: вчера в ' in queue, f"в списке заявок время подачи абсолютное: {[l for l in queue.splitlines() if 'Подал' in l]}")
check('ждёт' not in queue, "«ждёт N минут» не пишем: в сообщении это число устаревает")

print("\n=== 4. Профиль: время решения с часами, подписи, свёрнутые подробности ===")
press(OWNER, f'approve_{P}', mid=90)
log = say(OWNER, '-')
closed = [plain(t) for c, t in edited(log) if 'Заявка закрыта' in t]
check(closed and all(x in closed[0] for x in ('Ник в игре: Elka_1221', 'Имя в Telegram: Ёлка', 'ID в Telegram: 7700001',
                                             'Username: @', 'Подал: ', 'ОДОБРЕНО сегодня в ')),
      f"закрытая заявка хранит, кто это был, и когда решили: {closed[:1]}")
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
              'Статус: одобрена сегодня в ', 'Подал: вчера в ', 'Решил: ', 'Всего заявок: 1',
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

print("\n=== 6. Анкета и обращение: шаги ===")
S = 7_700_004
say(S, '/start'); press(S, 'lang_ru')
_, log = press(S, 'menu_apply')
check('Заявка · шаг 1 из 2' in plain(sent_to(log, S)[0]), "ник: шаг 1 из 2")
log = say(S, 'Stepper_1')
check('Заявка · шаг 2 из 2' in plain(sent_to(log, S)[0]), "пароль: шаг 2 из 2")
log = say(S, 'Str0ngPass1')
check('шаг' not in plain(sent_to(log, S)[0]), "комментарий шагом не считается: незачем подталкивать писать")
log = say(S, 'Пропустить')
check(any('Проверьте данные' in plain(t) for t in sent_to(log, S)), "после шагов проверка данных")

print("\n=== 7. Главное меню игрока: состояние заявки ===")
M = 7_700_003
say(M, '/start'); press(M, 'lang_ru')
bot.user_states[M] = {'step': 'rules', 'nick': 'MenuGuy', 'password': 'Str0ngPass1', 'comment': ''}
press(M, 'rules_agree')
log = say(M, '/start')
menu = plain(sent_to(log, M)[-1])
keys = buttons(log, M)
check('на рассмотрении' in menu, f"в меню видно, что заявка на рассмотрении: {menu.splitlines()[-2:]}")
check(not any('Подать заявку' in k for k in keys), f"кнопки подачи заявки нет, пока заявка ждёт: {keys}")
press(OWNER, f'approve_{M}', mid=95)
say(OWNER, '-')
log = say(M, '/start')
menu = plain(sent_to(log, M)[-1])
check('Вы играете под ником MenuGuy' in menu, f"после одобрения в меню ник игрока: {menu.splitlines()[-1:]}")

print("\n=== 8. Нажатие пролежало в очереди дольше 15 секунд ===")
L = 7_700_005
say(L, '/start'); press(L, 'lang_ru')
ctx.too_old = True
_, log = press(L, 'menu_support')
check(any('Важная информация' in plain(t) for t in sent_to(log, L)),
      "Telegram не принял опоздавший ответ, но игрок всё равно получил экран обращения")
_, log = press(OWNER, 'admin_menu_applications')
check(edited(log) or sent_to(log, OWNER), "у админа очередь заявок тоже открылась")
ctx.too_old = False
check(bot.bot.worker_pool.num_threads == 4, "нажатия разбирают 4 потока")

fakes.finish()
