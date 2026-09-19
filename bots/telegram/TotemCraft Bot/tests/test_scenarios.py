"""Сценарии бота: заявки, команда из нескольких админов, обращения, журнал, режим игрока, баны, пояса.
Запуск: python tests/test_scenarios.py <временная папка>"""
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check, sent_to, edited, buttons

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
OWNER, ADMIN, HELPER, P1, P2 = 1000, 2000, 3000, 5001, 6001
NAMES = {OWNER: 'Влад', ADMIN: 'Вася', HELPER: 'Петя', P1: 'Игрок1', P2: 'Игрок2'}
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER, names=NAMES)
bot, press, say = ctx.bot, ctx.press, ctx.say
storage = bot.storage


def db(sql, params=()):
    return storage.query(sql, params)


# Прошлая заявка игрока P1 с другим ником — чтобы проверить повторную подачу
storage.execute("INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status) VALUES (?,?,?,?,?,?)",
                ('2026-05-01T07:00:00+00:00', '2026-05-01T08:00:00+00:00', P1, 'p1', 'jojo111', 'Отклонено'))

print("=== 1. Команда ===")
(t, _), log = press(OWNER, 'staff_list')
check('➕ Добавить' in buttons(log), "в «Команде» есть кнопка «Добавить»")
press(OWNER, 'staff_add')
log = say(OWNER, str(ADMIN))
check(any('Вася' in t for t in sent_to(log, OWNER)), "по ID бот показал имя будущего админа")
press(OWNER, f'staff_new_{ADMIN}_admin')
press(OWNER, 'staff_add'); say(OWNER, str(HELPER)); (t, _), log = press(OWNER, f'staff_new_{HELPER}_helper')
check(bot.staff.get(ADMIN, {}).get('role') == 'admin' and bot.staff.get(HELPER, {}).get('role') == 'helper',
      "Вася стал админом, Петя помощником")
check(any('доступ' in t for t in sent_to(log, HELPER)), "помощнику пришло сообщение о доступе")
added = db("SELECT added_at FROM staff WHERE tg_id=?", (ADMIN,))[0][0]
check(added.endswith('+00:00'), f"дата добавления в базе в UTC: {added}")

print("\n=== 2. Меню по ролям ===")
(t, _), log = press(HELPER, 'admin_back'); b = buttons(log)
check(any('Заявки' in x for x in b) and not any('Сообщения' in x or 'Журнал' in x or 'Команда' in x for x in b),
      "у помощника нет сообщений, журнала и команды")
(t, _), log = press(ADMIN, 'admin_back'); b = buttons(log)
check(any('Сообщения' in x for x in b) and not any('Журнал' in x or 'Команда' in x for x in b), "у админа нет журнала и команды")
(t, alert), _ = press(HELPER, 'admin_menu_messages')
check(alert and 'нет доступа' in (t or ''), "помощнику отказ в сообщениях")
(t, alert), _ = press(ADMIN, 'jr_a_0_0')
check(alert and 'нет доступа' in (t or ''), "админу отказ в журнале")
(t, alert), _ = press(ADMIN, 'admin_export')
check(alert and 'нет доступа' in (t or ''), "админу отказ в выгрузке")

print("\n=== 3. Заявка: уведомление всем, двое жмут одновременно ===")
bot.user_states[P1] = {'step': 'rules', 'nick': 'CrystalDisk', 'password': 'bananas12345', 'comment': ''}
(t, _), log = press(P1, 'rules_agree')
got = {c for c in (OWNER, ADMIN, HELPER) if sent_to(log, c)}
check(got == {OWNER, ADMIN, HELPER}, f"уведомление о заявке у всех троих: {sorted(got)}")
note = sent_to(log, OWNER)[0]
check('Уже подавал' in note and 'jojo111' in note and '✋ Вручную' in note, "в коротком уведомлении прошлый ник и «вручную»")
check(bot.pending[str(P1)]['date'].endswith('+00:00'), "дата заявки в базе в UTC")
press(ADMIN, f'approve_{P1}', text='📩 Заявка 1 из 1', mid=77)
(t, alert), _ = press(HELPER, f'approve_{P1}')
check(alert and 'Вася' in (t or ''), "Пете: «заявку рассматривает Вася»")
n_rcon = len(ctx.rcon_log)
log = say(ADMIN, 'добро пожаловать')
ed = edited(log)
check(any(c == OWNER and 'ОДОБРЕНО' in x and 'Вася' in x for c, x in ed), "у владельца уведомление стало «ОДОБРЕНО · Вася»")
check(any(c == ADMIN and 'Заявка закрыта' in x for c, x in ed), "у Васи карточка «Заявка закрыта»")
pm = sent_to(log, P1)
check(any('одобрена' in x for x in pm) and not any('Вася' in x for x in pm), "игрок получил одобрение без имени админа")
check(ctx.rcon_log[n_rcon:] == ['authme register CrystalDisk bananas12345', 'authme register .CrystalDisk bananas12345'],
      "регистрация через RCON: ник и .ник для Bedrock")
check(any('.CrystalDisk' in x and 'Bedrock' in x for x in pm), "игроку подсказка про ник с Bedrock")
console = [j['content'] for u, j in ctx.webhook_log if u.endswith('console')]
stars = chr(92) + '*'
check(f'authme register CrystalDisk {stars * 8}' in console and f'authme register .CrystalDisk {stars * 8}' in console
      and not any('bananas' in c for c in console),
      "в консоль Discord ушла команда со звёздочками")
row = db("SELECT nick, status, admin_comment, decided_by_name, decided_at FROM applications ORDER BY id DESC LIMIT 1")[0]
check(row[:3] == ('CrystalDisk', 'Одобрено', 'добро пожаловать') and row[3].startswith('Вася') and row[4].endswith('+00:00'),
      f"в истории: кто рассмотрел и время в UTC ({row[3]}, {row[4]})")
cols = [r[1] for r in db("PRAGMA table_info(applications)")]
check(not any('pass' in c for c in cols), "в истории заявок нет столбца с паролем")
check(str(P1) not in bot.pending, "заявка ушла из очереди")

print("\n=== 4. Обращение: админ отвечает, владелец забирает диалог ===")
bot.user_states[P2] = {'step': 'guest_message'}
log = say(P2, 'у меня пропал сундук')
got = {c for c in (OWNER, ADMIN, HELPER) if sent_to(log, c)}
check(got == {OWNER, ADMIN}, f"обращение у владельца и админа, не у помощника: {sorted(got)}")
(t, _), log = press(ADMIN, f'reply_{P2}')
check(any(c == OWNER and 'Отвечает' in x for c, x in edited(log)), "у владельца: «Отвечает: Вася»")
check(db("SELECT value FROM kv WHERE space='dialogs' AND key=?", (str(ADMIN),)) != [], "диалог записан в базу (переживёт перезапуск)")
log = say(P2, 'сундук был у дома')
check(sent_to(log, ADMIN) and not sent_to(log, OWNER), "сообщение игрока пришло только Васе")
log = say(ADMIN, 'проверю по логам')
check(any('Сообщение от администрации' in x and 'Вася' not in x for x in sent_to(log, P2)), "игрок видит «администрация»")
(t, _), log = press(OWNER, f'reply_{P2}')
check(bot.dialogs.get(OWNER) == P2 and ADMIN not in bot.dialogs, "владелец забрал диалог")
(t, _), log = press(OWNER, f'user_profile_{P2}')
prof = edited(log)[-1][1]
check('👑 Вася' in prof and 'сундук' in prof, "в профиле переписка и кто из админов писал")
press(OWNER, 'end_dialog')
check(OWNER not in bot.dialogs, "диалог завершён")
msgs = storage.get_messages(P2, 10)
check(len(msgs) == 3 and all(m['time'].endswith('+00:00') for m in msgs), "переписка в базе, время в UTC")

print("\n=== 5. Журнал и пояс ===")
(t, _), log = press(OWNER, 'jr_a_0_0')
j = edited(log)[-1][1]
check('одобрил заявку' in j and 'написал игроку' in j, "в журнале одобрение и сообщение игроку")
ts = db("SELECT ts FROM audit WHERE action='approved'")[0][0]
check(ts.endswith('+00:00'), f"журнал хранит UTC: {ts}")
from datetime import datetime
utc = datetime.fromisoformat(ts)
msk = utc.hour + 3
(t, _), log = press(OWNER, 'jr_a_0_0')
check(f"{msk % 24:02d}:{utc.minute:02d}" in edited(log)[-1][1], "в журнале время по Москве по умолчанию")
(t, _), log = press(OWNER, 'tz_menu')
check(any('Владивосток' in x for x in buttons(log)), "выбор пояса открылся")
idx = [tz for _, tz in bot.timeutil.TIMEZONES].index('Asia/Vladivostok')
press(OWNER, f'tz_set_{idx}')
check(bot.tz_of(OWNER) == 'Asia/Vladivostok', "владелец выбрал Владивосток")
(t, _), log = press(OWNER, 'jr_a_0_0')
check(f"{(utc.hour + 10) % 24:02d}:{utc.minute:02d}" in edited(log)[-1][1], "журнал показывает время Владивостока")
check(bot.tz_of(ADMIN) == 'Europe/Moscow', "у Васи по-прежнему Москва")

print("\n=== 6. Режим игрока ===")
(t, _), log = press(OWNER, 'player_view_on')
check('🛡 Вернуться в админку' in buttons(log), "владелец видит меню игрока и кнопку возврата")
(t, _), log = press(P2, 'user_main_menu')
check('🛡 Вернуться в админку' not in buttons(log), "у обычного игрока кнопки админки нет")
bot.user_states[OWNER] = {'step': 'rules', 'nick': 'TestNick', 'password': 'qwerty12345', 'comment': ''}
press(OWNER, 'rules_agree')
check(bot.pending.get(str(OWNER), {}).get('test_by') == OWNER, "заявка из режима игрока тестовая")
n_rcon, n_apps = len(ctx.rcon_log), db("SELECT COUNT(*) FROM applications")[0][0]
press(ADMIN, f'approve_{OWNER}', mid=88); press(ADMIN, 'skip_admin_comment')
check(len(ctx.rcon_log) == n_rcon and db("SELECT COUNT(*) FROM applications")[0][0] == n_apps,
      "тестовая заявка не регистрируется и не попадает в историю")
press(OWNER, 'player_view_off')

print("\n=== 7. Баны в карточке ===")
report = bot.ban_report(P1, 'artiom83', OWNER)
check('временный бан' in report and 'Гриф' in report and 'AdvancedBanX, banned-players.json' in report,
      "временный бан склеен из AdvancedBanX и ванильного списка")
check('unbanned' not in bot.ban_report(1, 'unbanned', OWNER), "снятый бан (DELETE в storage.log) не показывается")
check(bot.ban_report(1, 'expired1', OWNER).count('🚫') == 0, "истёкший бан не показывается как действующий")
check('Раньше' in bot.ban_report(1, 'oldbad', OWNER), "прошлое наказание одной строкой «Раньше»")
check(bot.ban_report(1, 'CleanPlayer', OWNER) == '', "у чистого игрока блока нет")
check('IP 10.9.9.9' in bot.ban_report(1, 'oldtwink', OWNER), "бан по IP найден через AuthMe")
bot.bans.ABX_DATA_DIR = '/нет/такой/папки'
r = bot.ban_report(1, 'jojo111', OWNER)
bot.bans.ABX_DATA_DIR = os.path.join(MC, 'plugins', 'AdvancedBanX', 'data')
check('Не удалось проверить AdvancedBanX' in r, "нет файлов AdvancedBanX: бот пишет об этом и не падает")

print("\n=== 7а. Досье и проверки ===")
from datetime import date
tgage = bot.tgage
check(tgage.describe(7815237229, today=date(2026, 9, 19)).startswith("≈ май 2025"), "возраст аккаунта по ID: май 2025")
check("3 лет" in tgage.age_text(date(2023, 9, 1), today=date(2026, 9, 19)), "«около 3 лет», падеж правильный")
text, flags = bot.dossier(P1, 'CrystalDisk', OWNER)
check(any(l == '🔴' and 'бан' in t for l, t in flags), "досье игрока с баном на прошлом нике: 🔴")
check(any('отклоняли' in t for _, t in flags), "досье: раньше отклоняли")
check(not any('новый' in t for _, t in flags), "старый аккаунт не помечен новым")
text, flags = bot.dossier(9_900_000_000, 'CleanNick', OWNER)
check(any(l == '🔴' and '2 месяцев' in t for l, t in flags), "Telegram моложе 2 месяцев: 🔴, как у автомата")
text, flags = bot.dossier(1, 'oldtwink', OWNER)
check('🎮 <code>oldtwink</code>: рег.' in text, "досье показывает аккаунт AuthMe")
saved = storage.query("SELECT id, decided_at FROM applications")
storage.execute("UPDATE applications SET decided_at='2026-01-01T00:00:00+00:00'")  # все заявки «давние»
bot._frontier_cache['at'] = 0
text, flags = bot.dossier(1, 'CleanPlayer', OWNER)
check(flags == [] and '✅ Всё чисто' in text, "у чистого старого аккаунта: «Всё чисто»")
n_before = len([1 for u, j in ctx.webhook_log if j and 'Рейд-режим включён' in str(j)])
for k in range(5):
    fresh = 9_600_000_000 + k
    bot.user_states[fresh] = {'step': 'rules', 'nick': f'Raid{k}', 'password': 'qwerty12345', 'comment': ''}
    press(fresh, 'rules_agree')
raids = [1 for u, j in ctx.webhook_log if j and 'Рейд-режим включён' in str(j)]
check(len(raids) - n_before == 1, f"5 заявок от совсем новых аккаунтов за час: рейд-режим включился один раз ({len(raids) - n_before})")
bot.user_states[9_600_000_010] = {'step': 'rules', 'nick': 'Raid10', 'password': 'qwerty12345', 'comment': ''}
press(9_600_000_010, 'rules_agree')
check(len([1 for u, j in ctx.webhook_log if j and 'Рейд-режим включён' in str(j)]) - n_before == 1, "повторно в течение 3 часов не шумит")
for k in list(range(5)) + [10]:
    bot.pending.pop(str(9_600_000_000 + k), None)
for app_id, decided_at in saved:
    storage.execute("UPDATE applications SET decided_at=? WHERE id=?", (decided_at, app_id))
bot._frontier_cache['at'] = 0

print("\n=== 7б. Bedrock ===")
check(bot.bedrock_name('Abcdefghijklmnop') == '.Abcdefghijklmno', "16-значный ник: Bedrock-вариант обрезан до 16 знаков, как у Floodgate")
check(bot.name_variants(['Steve', '.Alex']) == ['Steve', '.Steve', '.Alex'], "варианты ников: .ник добавляется, к .нику второй раз нет")
with open(os.path.join(MC, 'banned-players.json'), 'w', encoding='utf-8') as f:
    f.write('[{"name": ".BedrockBad", "created": "2026-04-01 12:00:00 +0300", "source": "Steve", '
            '"expires": "forever", "reason": "гриф с телефона"}]')
check('гриф с телефона' in bot.ban_report(1, 'BedrockBad', OWNER), "бан на .ник учитывается для ника")

print("\n=== 8. Статистика, выгрузка, таймер 24 часа, копия базы ===")
(t, _), log = press(OWNER, 'admin_menu_stats')
check('Одобрено: 1 (сегодня: 1)' in edited(log)[-1][1], "статистика считает «сегодня» по поясу админа")
(t, _), log = press(OWNER, 'admin_export')
check(any(m == 'sendDocument' for m, _ in log), "выгрузка истории пришла файлом")
bot.last_application[str(P2)] = bot.timeutil.now_iso()
(t, _), log = press(P2, 'menu_apply')
check(any('подождите 23 ч' in x for x in sent_to(log, P2)), "таймер 24 часа считает по UTC")
path = storage.backup()
check(os.path.exists(path) and sqlite3.connect(path).execute("SELECT COUNT(*) FROM applications").fetchone()[0] >= 2,
      "копия базы сделана и читается")

print("\n=== 9. Снятие доступа и сбой журнала ===")
press(OWNER, f'staff_delok_{HELPER}')
(t, _), _ = press(HELPER, 'admin_back')
check(HELPER not in bot.staff and 'Нет доступа' in (t or ''), "у Пети больше нет доступа")
orig = bot.db_exec
bot.db_exec = lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("disk I/O error"))
try:
    bot.audit(OWNER, 'paused'); ok = True
except Exception:
    ok = False
bot.db_exec = orig
check(ok, "ошибка записи журнала не роняет действие")

fakes.finish()
