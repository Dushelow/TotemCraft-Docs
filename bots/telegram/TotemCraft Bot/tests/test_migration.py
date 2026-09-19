"""Перенос старых файлов бота (JSON/CSV и bot.db версии 1) в базу версии 2.
Запуск: python tests/test_migration.py <временная папка>"""
import csv
import json
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
BOT_WORK = os.path.join(WORK, 'bot')
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
os.makedirs(BOT_WORK)

# --- Старые файлы, как их писал бот до перехода (время по Москве, без пояса) ---
with open(os.path.join(BOT_WORK, 'approved_applications.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['Дата', 'TG_Username', 'TG_ID', 'Minecraft_Ник', 'Пароль', 'Статус', 'Комментарий_игрока', 'Комментарий_админа'])
    w.writerow(['2026-04-27T10:52:00.123456', 'marat', '5121881741', 'marat_binkov', '***', 'Одобрено', 'привет, я "Марат"', ''])
    w.writerow(['2026-05-01 12:00:00', 'id777', '777', 'Old_One', '***', 'Отклонено', '', 'читы'])
    w.writerow(['2026-09-19T14:44:00', 'cx', '7815237229', 'CXhex', '***', 'Одобрено', '', '', 'Вася @u2000'])
json.dump({'42': {'user_id': 42, 'username': 'p42', 'tg_name': 'П', 'nick': 'Pending42', 'password': 'pw1234567',
                  'comment': '', 'date': '2026-09-19T12:00:00'}},
          open(os.path.join(BOT_WORK, 'pending.json'), 'w', encoding='utf-8'))
json.dump({'paused': True}, open(os.path.join(BOT_WORK, 'bot_config.json'), 'w'))
json.dump([111, 222], open(os.path.join(BOT_WORK, 'blocked_users.json'), 'w'))
json.dump(['333'], open(os.path.join(BOT_WORK, 'message_queue.json'), 'w'))
json.dump({'42': '2026-09-19T12:00:00'}, open(os.path.join(BOT_WORK, 'last_application.json'), 'w'))
json.dump({'counter': 57, 'tickets': {'333': {'id': 57, 'status': 'open', 'message': 'помогите', 'nick': 'X',
                                              'date': '2026-09-19 12:00'}}},
          open(os.path.join(BOT_WORK, 'tickets.json'), 'w', encoding='utf-8'), ensure_ascii=False)
json.dump({'333': [{'from': 'user', 'text': 'помогите', 'time': '2026-09-19 12:00:00'},
                   {'from': 'admin', 'text': 'сейчас', 'time': '2026-09-19 12:05:00', 'by': 'Вася'}]},
          open(os.path.join(BOT_WORK, 'chat_history.json'), 'w', encoding='utf-8'), ensure_ascii=False)
# bot.db версии 1 (как на сервере сейчас): журнал по Москве без пояса
old = sqlite3.connect(os.path.join(BOT_WORK, 'bot.db'))
old.execute("CREATE TABLE staff (tg_id INTEGER PRIMARY KEY, name TEXT, role TEXT NOT NULL, added_by INTEGER, added_at TEXT)")
old.execute("CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor_id INTEGER, actor_name TEXT, "
            "actor_role TEXT, action TEXT NOT NULL, target_id INTEGER, target_nick TEXT, details TEXT)")
old.execute("CREATE TABLE notices (kind TEXT, ref TEXT, chat_id INTEGER, message_id INTEGER, text TEXT)")
old.execute("INSERT INTO staff VALUES (1000, 'Влад', 'owner', 1000, '2026-09-19 16:40')")
old.execute("INSERT INTO audit (ts, actor_id, actor_name, actor_role, action, target_id) "
            "VALUES ('2026-09-19 16:40:00', 1000, 'Влад', 'owner', 'approved', 5)")
old.commit(); old.close()

print("=== Перенос ===")
ctx = fakes.start(BOT_WORK, MC, owner=1000)
bot = ctx.bot
q = bot.storage.query
check(q("SELECT value FROM meta WHERE key='schema_version'")[0][0] == '2', "база обновлена до версии 2")
check(os.path.exists(os.path.join('backups', 'bot-before-v2.db')), "перед обновлением сделана копия старой базы")
apps = q("SELECT tg_id, nick, status, player_comment, decided_at, decided_by_name FROM applications ORDER BY id")
check(len(apps) == 3, f"перенесены 3 заявки истории: {len(apps)}")
check(apps[0][4] == '2026-04-27T07:52:00+00:00', f"10:52 по Москве стало 07:52 UTC: {apps[0][4]}")
check(apps[0][3] == 'привет, я "Марат"', "комментарий с кавычками и запятой цел")
check(apps[2][5] == 'Вася @u2000', "кто рассмотрел — перенесено")
check(bot.pending['42']['date'] == '2026-09-19T09:00:00+00:00' and bot.pending['42']['password'] == 'pw1234567',
      "заявка в очереди перенесена, время в UTC")
check(bot.registration_paused is True, "пауза регистрации сохранилась")
check(111 in bot.blocked_users and 222 in bot.blocked_users, "заблокированные перенесены")
check('333' in bot.unread_messages, "непрочитанные перенесены")
check(bot.last_application['42'] == '2026-09-19T09:00:00+00:00', "таймер 24 часа перенесён в UTC")
check(bot.active_tickets['333']['id'] == 57 and bot.active_tickets['333']['date'] == '2026-09-19T09:00:00+00:00',
      "тикет перенесён, время в UTC")
check(bot.storage.next_counter('ticket_counter') == 58, "нумерация тикетов продолжается с 58")
msgs = bot.storage.get_messages(333)
check([m['text'] for m in msgs] == ['помогите', 'сейчас'] and msgs[1]['by'] == 'Вася', "переписка перенесена по порядку")
check(q("SELECT ts FROM audit")[0][0] == '2026-09-19T13:40:00+00:00', "журнал: 16:40 по Москве стало 13:40 UTC")
check(q("SELECT added_at FROM staff WHERE tg_id=1000")[0][0] == '2026-09-19T13:40:00+00:00', "дата в команде в UTC")
left = [f for f in os.listdir('.') if f.endswith('.json') or f.endswith('.csv')]
check(left == [] and os.path.exists(os.path.join('legacy_files', 'approved_applications.csv')),
      f"старые файлы отложены в legacy_files/, не удалены: осталось {left}")

print("\n=== Повторный запуск ===")
check(bot.storage.migrate() == [], "второй раз ничего не переносится")
check(q("SELECT COUNT(*) FROM applications")[0][0] == 3, "дублей нет")

fakes.finish()
