"""Автопринятие заявок, рейд-режим, словарь.
Запуск: python tests/test_auto.py <временная папка>"""
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
OWNER, ADMIN, HELPER = 1000, 2000, 3000
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER, names={OWNER: 'Влад', ADMIN: 'Вася', HELPER: 'Петя'})
bot, storage = ctx.bot, ctx.bot.storage
bot.RATE_LIMIT = 10 ** 6
aa, bw, tu = bot.autoaccept, bot.badwords, bot.timeutil
for tg, name, role in ((ADMIN, 'Вася', 'admin'), (HELPER, 'Петя', 'helper')):
    storage.execute("INSERT INTO staff (tg_id, name, role, added_by, added_at) VALUES (?,?,?,?,?)",
                    (tg, name, role, OWNER, tu.now_iso()))
bot.load_staff()
# Старая заявка другого игрока «месяц назад» — чтобы у бота была граница «совсем новых» аккаунтов
storage.execute("INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status) VALUES (?,?,?,?,?,?)",
                ('2026-01-01T00:00:00+00:00', '2026-01-01T01:00:00+00:00', 8_500_000_000, 'old', 'OldPlayer', 'Одобрено'))

print("=== 1. Правила ===")
base = {'nick': 'GoodNick', 'has_photo': True, 'has_username': True, 'tg_age_days': 900}
v = aa.decide(base)
check(not v['manual'] and v['delay'] == timedelta(hours=1), "чистая заявка: 1 час")
check(aa.decide(dict(base, subscribed=True))['delay'] == timedelta(minutes=5), "чистая и подписан: 5 минут")
check(aa.decide(dict(base, has_photo=False))['delay'] == timedelta(hours=12), "одна мелочь (нет аватарки): 12 часов")
check(aa.decide(dict(base, has_photo=False, has_username=False))['delay'] == timedelta(hours=24), "две мелочи: сутки")
check(aa.decide(dict(base, has_photo=False, has_username=False, comment='привет'))['delay'] == timedelta(hours=48),
      "три мелочи: 48 часов")
check(aa.decide(dict(base, has_photo=False, subscribed=True))['delay'] == timedelta(hours=12), "подписка не ускоряет заявку с мелочью")
check(aa.decide(dict(base, tg_age_days=200))['minor'] == ['Аккаунту Telegram меньше года'], "Telegram моложе года: мелочь")
check(aa.decide(dict(base, nick='Steve1234567'))['minor'] == ['В нике 6 и больше цифр подряд'], "6+ цифр в нике: мелочь")
for key, value, what in [('bans', ['GoodNick (бан)'], 'бан'), ('approved_before', ['Old'], 'твинк по TG'),
                         ('blocked', True, 'блок в боте'),
                         ('bad_nick', [('мат', 'pidor')], 'брань в нике'), ('bad_password', [('символика', '14/88')], 'символика в пароле'),
                         ('bad_comment', [('мат', 'сука')], 'брань в комментарии'), ('rejected_before', 1, 'раньше отклоняли'),
                         ('tg_age_days', 40, 'Telegram моложе 2 месяцев'), ('asked_support', True, 'писал в поддержку')]:
    check(aa.decide(dict(base, **{key: value}))['manual'], f"стоп: {what}")
check(not aa.decide(dict(base, tg_age_days=70))['manual'], "Telegram 70 дней: не стоп (только мелочь)")

print("\n=== 2. Заявка: вердикт виден команде, игрок ничего не видит ===")
P = 6_000_000_001  # аккаунт ~2023 года
bot.user_states[P] = {'step': 'rules', 'nick': 'CleanNick', 'password': 'Str0ngPass1', 'comment': ''}
(t, _), log = ctx.press(P, 'rules_agree')
app = bot.pending[str(P)]
check(app['auto']['icon'] == '🟢' and not app['auto']['manual'], f"вердикт: 🟢 ({app['auto']})")
note = sent_to(log, OWNER)[0]
check('Новая заявка!' in note and buttons(log, OWNER) == ['📋 Открыть заявки'], "уведомление короткое, одна кнопка «Открыть заявки»")
(t, _), qlog = ctx.press(OWNER, 'admin_menu_applications_new')
check(any('Автопринятие: выключено' in x for x in sent_to(qlog, OWNER)) and '✅ Одобрить' in buttons(qlog, OWNER),
      "в очереди видно, что автопринятие выключено, и есть кнопки решения")
pm = " ".join(sent_to(log, P))
check('Автопринят' not in pm and 'мелоч' not in pm, "игрок критериев и сроков не видит")
check('подпишитесь на нашу группу' in pm and '✅ Я подписался' in buttons(log, P), "игроку предложили подписаться на группу")
disc = [j for u, j in ctx.webhook_log if j and 'embeds' in j and 'Новая заявка' in j['embeds'][0]['title']]
check(disc and 'Автомат:' in disc[-1]['embeds'][0]['description'], "в Discord вердикт автомата")
(t, _), log = ctx.press(ADMIN, 'admin_menu_applications')
check(any('Автопринятие' in x for _, x in edited(log)), "в карточке заявки вердикт")

print("\n=== 3. Подписка ускоряет чистую заявку ===")
(t, _), _ = ctx.press(P, 'sub_check')
check('Пока не вижу' in (t or ''), "без подписки: «пока не вижу подписки»")
ctx.members.add(P)
(t, _), _ = ctx.press(P, 'sub_check')
due = tu.parse(bot.pending[str(P)]['auto']['due'])
check(t == 'Спасибо за подписку!' and due - tu.parse(bot.pending[str(P)]['date']) == timedelta(minutes=5),
      "подписался: срок 5 минут")

print("\n=== 4. Автомат выключен — ничего не принимает; включён — принимает ===")
bot.pending[str(P)] = dict(bot.pending[str(P)], date=(tu.now_utc() - timedelta(hours=2)).isoformat(timespec='seconds'))
bot.schedule_auto(P, bot.pending[str(P)])
bot.auto_job()
check(str(P) in bot.pending, "автопринятие выключено: заявка ждёт")
(t, alert), _ = ctx.press(ADMIN, 'auto_toggle')
check(alert and 'нет доступа' in (t or ''), "включать автомат может только владелец")
ctx.press(OWNER, 'auto_toggle')
check(bot.auto_enabled(), "владелец включил автопринятие")
n_rcon = len(ctx.rcon_log)
ctx.tg_log.clear()
bot.auto_job()
log = list(ctx.tg_log)
check(str(P) not in bot.pending, "заявка принята автоматически")
check(ctx.rcon_log[n_rcon:] == ['authme register CleanNick Str0ngPass1', 'authme register .CleanNick Str0ngPass1'],
      "регистрация на сервере: ник и Bedrock-вариант .ник")
check(any('одобрена' in x for x in sent_to(log, P)), "игрок получил обычное одобрение")
check(any('🤖 автоматически' in x for _, x in edited(log)), "у команды уведомление: «ОДОБРЕНО · 🤖 автоматически»")
row = storage.query("SELECT decided_by, decided_by_name FROM applications WHERE tg_id=?", (P,))[0]
check(row == (None, '🤖 автоматически'), "в истории «рассмотрел: автоматически»")
check(storage.query("SELECT COUNT(*) FROM audit WHERE actor_role='system' AND action='approved'")[0][0] == 1,
      "в журнале: бот одобрил")

print("\n=== 5. Перепроверка перед принятием ===")
def submit(tg, nick, hours_ago=2, comment='', photo=True):
    if not photo:
        ctx.no_photo.add(tg)
    bot.user_states[tg] = {'step': 'rules', 'nick': nick, 'password': 'Str0ngPass1', 'comment': comment}
    ctx.press(tg, 'rules_agree')
    a = bot.pending[str(tg)]
    a['date'] = (tu.now_utc() - timedelta(hours=hours_ago)).isoformat(timespec='seconds')
    bot.pending[str(tg)] = a
    bot.schedule_auto(tg, a)
    return a
Q = 6_000_000_002
submit(Q, 'LaterBanned')
with open(os.path.join(MC, 'banned-players.json'), 'w', encoding='utf-8') as f:
    f.write('[{"name": "LaterBanned", "created": "2026-09-19 12:00:00 +0300", "source": "Steve", "expires": "forever", "reason": "x"}]')
ctx.tg_log.clear()
bot.auto_job()
check(str(Q) in bot.pending and bot.pending[str(Q)]['auto']['manual'], "бан появился, пока заявка ждала: автомат не принял")
check(any('Автомат не принял' in x for x in sent_to(ctx.tg_log, ADMIN)), "команде сообщили почему")
bot.pending.pop(str(Q))

print("\n=== 6. Мелочи, стопы и обращения ===")
R = 6_000_000_003
a = submit(R, 'NoPhotoGuy', hours_ago=1, photo=False)
check(a['auto']['icon'] == '🟡' and a['auto']['minor'] == ['Нет аватарки'], "нет аватарки: 🟡 12 часов")
bot.auto_job()
check(str(R) in bot.pending, "12 часов не прошло: ждёт")
ctx.press(R, 'menu_support')
check(bot.pending[str(R)]['auto']['manual'], "пытался обратиться в поддержку: только вручную")
bot.pending.pop(str(R))
S = 6_000_000_004
a = submit(S, 'Mr_pidor')
check(a['auto']['manual'] and any('в нике' in r for r in a['auto']['stop']), "брань в нике: только вручную")
bot.pending.pop(str(S))
T = 9_900_000_000  # совсем новый аккаунт
a = submit(T, 'FreshNick')
check(a['auto']['manual'] and any('2 месяцев' in r for r in a['auto']['stop']), "Telegram моложе 2 месяцев: только вручную")
bot.pending.pop(str(T))

print("\n=== 7. Лимит 5 в час ===")
storage.execute("DELETE FROM audit WHERE actor_role='system'")
ids = [6_100_000_000 + k for k in range(7)]
for k, tg in enumerate(ids):
    submit(tg, f'LimitNick{k}')
ctx.tg_log.clear()
bot.auto_job()
accepted = [tg for tg in ids if str(tg) not in bot.pending]
left = [tg for tg in ids if str(tg) in bot.pending]
check(len(accepted) == 5, f"принято 5 из 7 ({len(accepted)})")
check(all(not bot.pending[str(tg)]['auto']['manual'] and bot.pending[str(tg)]['auto'].get('limit_wait') for tg in left),
      "остальные ждут лимита: не вручную, не отклонены")
alerts = [x for x in sent_to(ctx.tg_log, OWNER) if 'упёрся в лимит' in x]
check(len(alerts) == 1 and 'Продолжу сам' in alerts[0], "команде одно сообщение про лимит и когда продолжит")
(t, _), log = ctx.press(OWNER, 'auto_menu')
check(any('за час: <b>5</b> из 5' in x and 'Ждут лимита: <b>2</b>' in x for _, x in edited(log)), "в настройках «за час 5 из 5» и «ждут лимита: 2»")
check('ждёт лимита' in bot.auto_line(bot.pending[str(left[0])]), "в карточке заявки «ждёт лимита, продолжит примерно в …»")
bot.auto_job()
check(all(str(tg) in bot.pending for tg in left), "пока лимит занят, повторно не принимает")
# прошло больше часа: сдвигаем время автопринятий в журнале на 2 часа назад
old = (tu.now_utc() - timedelta(hours=2)).isoformat(timespec='seconds')
storage.execute("UPDATE audit SET ts=? WHERE actor_role='system' AND action='approved'", (old,))
bot.auto_job()
check(all(str(tg) not in bot.pending for tg in left), "лимит освободился: ждавшие приняты сами")
check(storage.query("SELECT details FROM audit WHERE actor_role='system' AND action='approved' ORDER BY id DESC LIMIT 1")[0][0].endswith('ждала лимита'),
      "в журнале видно, что заявка ждала лимита")

print("\n=== 8. Рейд-режим ===")
storage.execute("DELETE FROM audit WHERE actor_role='system'")
U = 6_200_000_000
submit(U, 'WaitsRaid')
all_log = []
for k in range(5):
    tg = 9_950_000_000 + k
    bot.user_states[tg] = {'step': 'rules', 'nick': f'RaidNick{k}', 'password': 'Str0ngPass1', 'comment': ''}
    all_log += ctx.press(tg, 'rules_agree')[1]
check(bot.raid_active(), "5 заявок от совсем новых аккаунтов за час: рейд-режим включился сам")
raid_msgs = [x for x in sent_to(all_log, OWNER) if 'Рейд-режим включён' in x]
check(len(raid_msgs) == 1, f"владельцу одно сообщение о рейде ({len(raid_msgs)})")
check(any('Выключить рейд-режим' in b for b in buttons(all_log, OWNER)), "в сообщении кнопка «Выключить рейд-режим»")
check(any('Рейд-режим включён' in x for x in sent_to(all_log, ADMIN)), "админ тоже узнал о рейде")
bot.auto_job()
check(str(U) in bot.pending, "во время рейда автомат не принимает")
(t, _), log = ctx.press(ADMIN, 'admin_back')
check(any('Рейд-режим</b>: автопринятие на паузе' in x for _, x in edited(log)), "команда видит рейд-режим в панели")
ctx.press(OWNER, 'raid_off')
check(not bot.raid_active(), "владелец выключил рейд-режим")
bot.auto_job()
check(str(U) not in bot.pending, "после рейда автомат снова принимает")
ctx.press(OWNER, 'raid_on')
check(bot.raid_active() and storage.setting('raid_manual'), "рейд-режим включён вручную")
ctx.press(OWNER, 'raid_off')
storage.set_setting('raid_until', (tu.now_utc() - timedelta(minutes=1)).isoformat(timespec='seconds'))
bot.auto_job()
check(not bot.raid_active() and storage.setting('raid_until') is None, "рейд-режим по времени отключается сам")
for k in range(5):
    bot.pending.pop(str(9_950_000_000 + k), None)

print("\n=== 9. Словарь владельца ===")
ctx.press(OWNER, 'words_add')
ctx.say(OWNER, 'kringe лол')
check(bot.owner_words() == ['kringe', 'лол'], f"добавлены свои слова: {bot.owner_words()}")
check(bw.find('SuperKringe_2010', bot.owner_words()), "своё слово ловится в нике")
ctx.press(OWNER, 'words_del_0')
check(bot.owner_words() == ['лол'], "слово убрано кнопкой")
(t, alert), _ = ctx.press(HELPER, 'words_list')
check(alert, "помощнику словарь недоступен")

print("\n=== 10. Бот не админ группы ===")
ctx.bot_not_admin = True
V = 6_300_000_000
submit(V, 'NoAdminCheck')
(t, _), _ = ctx.press(V, 'sub_check')
check(t == 'Спасибо за подписку!' and not bot.pending[str(V)].get('subscribed'),
      "проверить подписку нельзя: игрок получает «спасибо», ускорения нет, бот не падает")

print("\n=== 12. Твинк только по Telegram ID, IP не учитываем ===")
import sqlite3
authme = sqlite3.connect(os.path.join(MC, 'plugins', 'AuthMe', 'authme.db'))
# artiom83 забанен; сосед с тем же IP (как бывает через обратный прокси в России) — другой человек
authme.execute("INSERT INTO authme (id, username, realname, password, ip, lastlogin, regip, regdate) VALUES "
               "(20,'artiom83','artiom83','h','55.55.55.55',1789000000000,'55.55.55.55',1789000000000),"
               "(21,'neighbour','Neighbour','h','55.55.55.55',1789000000000,'55.55.55.55',1789000000000)")
authme.commit()
N = 6_400_000_003
f = bot.auto_facts(N, {'nick': 'Neighbour'})
check('ip_banned_twins' not in f and not f['approved_before'], "игрок с тем же IP, что у забаненного, твинком не считается")
check(not any('IP' in l for l in bot.server_lines(N, 'Neighbour', OWNER)), "в досье нет строки «С того же IP заходили»")
check(not hasattr(bot, 'first_login_job') and not hasattr(bot, 'check_twin_after_login'),
      "проверка по IP через сутки после принятия убрана")

T = 6_400_000_004  # у этого Telegram уже был одобрен artiom83, и он в бане
storage.execute("INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status) VALUES (?,?,?,?,?,?)",
                ('2026-09-01T10:00:00+00:00', '2026-09-01T11:00:00+00:00', T, 'tw', 'artiom83', 'Одобрено'))
v = aa.decide(bot.auto_facts(T, {'nick': 'FreshNick'}))
twin = [r for r in v['stop'] if r.startswith('Твинк')]
check(twin == ['Твинк: с этого Telegram уже одобрен аккаунт artiom83 (в бане)'], f"твинк по Telegram с пометкой бана: {twin}")
check(not any(r.startswith('Наказания') and 'artiom83' in r for r in v['stop']),
      f"бан прошлого аккаунта не повторяется отдельной строкой: {v['stop']}")

C = 6_400_000_005  # у этого Telegram одобрен чистый аккаунт
storage.execute("INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status) VALUES (?,?,?,?,?,?)",
                ('2026-09-01T10:00:00+00:00', '2026-09-01T11:00:00+00:00', C, 'cl', 'CleanOld', 'Одобрено'))
v = aa.decide(bot.auto_facts(C, {'nick': 'SecondAcc'}))
check('Твинк: с этого Telegram уже одобрен аккаунт CleanOld' in v['stop'], f"твинк без бана: просто ник, решает команда: {v['stop']}")

print("\n=== 13. Короткое уведомление, очередь отдельным сообщением, решение из неё ===")
X = 6_500_000_001
bot.user_states[X] = {'step': 'rules', 'nick': 'ShortCard', 'password': 'Str0ngPass1', 'comment': 'Привет'}
(t, _), log = ctx.press(X, 'rules_agree')
note = [p for m, p in log if m == 'sendMessage' and str(p.get('chat_id')) == str(ADMIN)][0]
check(fakes.strip_tags(note['text']).startswith('📩 Новая заявка!') and buttons(log, ADMIN) == ['📋 Открыть заявки'],
      "уведомление короткое, как раньше: одна кнопка «Открыть заявки»")
note_mid = max(k[1] for k in ctx.messages if k[0] == ADMIN)
(t, _), log = ctx.press(ADMIN, 'admin_menu_applications_new', text='📩 Новая заявка!', mid=note_mid)
check(sent_to(log, ADMIN) and not edited(log), "очередь открылась отдельным сообщением, уведомление не тронуто")
check({'✅ Одобрить', '❌ Отклонить', '🧾 Подробнее'} <= set(buttons(log, ADMIN)), "в очереди «Одобрить», «Отклонить», «Подробнее»")
mid = max(k[1] for k in ctx.messages if k[0] == ADMIN)
(t, _), log = ctx.press(ADMIN, f'appv_{X}_d', text='📩 Новая заявка', mid=mid)
check(any('Досье' in x and 'Проверки' in x for _, x in edited(log)) and '🔙 Кратко' in buttons(log), "«Подробнее»: досье на месте, кнопка «Кратко»")
(t, _), log = ctx.press(ADMIN, f'appv_{X}_s', text='🧾 Подробно', mid=mid)
check(any('Досье' not in x for _, x in edited(log)) and '🧾 Подробнее' in buttons(log), "«Кратко»: вернулась короткая карточка")
ctx.press(ADMIN, f'approve_{X}', text='📩 Заявка', mid=mid)
log = ctx.say(ADMIN, '-')
closed = [x for c, x in edited(log) if c == ADMIN and 'Заявка закрыта' in x]
card = fakes.strip_tags(closed[0]) if closed else ''
check(all(x in card for x in ('Ник в игре: ShortCard', 'ID в Telegram: 6500000001', 'Подал: ', 'ОДОБРЕНО сегодня в ', 'Вася')),
      f"закрытая заявка хранит, кто это был, и кто когда решил: {closed[:1]}")
closed_marks = [p.get('reply_markup') for m, p in log
                if m == 'editMessageText' and 'Заявка закрыта' in p.get('text', '') and str(p.get('chat_id')) == str(ADMIN)]
check('Проверки' not in card and closed_marks and not any(closed_marks), "в закрытой заявке нет проверок и кнопок")
others = [x for c, x in edited(log) if c == OWNER and 'Заявка закрыта' in x]
check(others and 'ID в Telegram: 6500000001' in fakes.strip_tags(others[0]), "у владельца закрытая заявка с теми же сведениями")

print("\n=== 11. Инструкция и статус на месте, с кнопкой назад ===")
for data in ('admin_help', 'admin_status'):
    (t, _), log = ctx.press(ADMIN, data, mid=900)
    check(edited(log) and not sent_to(log, ADMIN) and '🔙 Управление' in buttons(log, ADMIN),
          f"{data}: открывается на месте, есть «🔙 Управление»")

fakes.finish()
