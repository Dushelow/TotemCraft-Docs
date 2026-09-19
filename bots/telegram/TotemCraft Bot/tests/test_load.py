"""Нагрузка: база в ~10 раз больше боевой (19.09.2026: 1069 заявок, 365 сообщений) и большая база банов.
Замеряется время каждого экрана админки. Порог — 300 мс на экран (без сети).
Запуск: python tests/test_load.py <временная папка>"""
import os
import random
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
random.seed(1)

# Большая база банов: 5000 записей AdvancedBanX и 3000 в ванильном списке
data = os.path.join(MC, 'plugins', 'AdvancedBanX', 'data', 'storage.script')
with open(data, 'a', encoding='utf-8') as f:
    for i in range(100, 5100):
        f.write(f"INSERT INTO PUNISHMENTS VALUES({i},'player{i}','player{i}','Grief','Steve','TEMP_BAN',1775000000000,4102444800000,'')\n")
        f.write(f"INSERT INTO PUNISHMENTHISTORY VALUES({i},'player{i}','player{i}','Grief','Steve','TEMP_BAN',1775000000000,4102444800000,'')\n")
import json
with open(os.path.join(MC, 'banned-players.json'), 'w', encoding='utf-8') as f:
    json.dump([{"name": f"vplayer{i}", "created": "2026-04-01 12:00:00 +0300", "source": "Steve",
                "expires": "forever", "reason": "Grief"} for i in range(3000)], f)

OWNER = 1000
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER)
bot, storage = ctx.bot, ctx.bot.storage
bot.run_in_background = lambda f, *a, **k: None  # Discord и т.п. в замер не входят

print("=== Наполнение базы ===")
t0 = time.time()
statuses = ['Одобрено'] * 9 + ['Отклонено']
with storage.transaction() as c:
    for i in range(10000):
        tg = 5_000_000_000 + i * 397_000
        day = 1 + i % 28
        c.execute("""INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status, player_comment,
                     admin_comment, decided_by, decided_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                  (f'2026-0{4 + i % 5}-{day:02d}T10:00:00+00:00', f'2026-0{4 + i % 5}-{day:02d}T11:00:00+00:00', tg,
                   f'user{i}', f'player{i}', random.choice(statuses), 'коммент', '', OWNER, 'Влад'))
    for i in range(40000):
        c.execute("INSERT INTO messages (tg_id, sender, text, created_at) VALUES (?,?,?,?)",
                  (5_000_000_000 + (i % 3000) * 397_000, 'user' if i % 2 else 'admin', f'сообщение {i}',
                   f'2026-09-{1 + i % 18:02d}T10:{i % 60:02d}:00+00:00'))
    for i in range(30000):
        c.execute("INSERT INTO audit (ts, actor_id, actor_name, actor_role, action, target_id, target_nick, details) "
                  "VALUES (?,?,?,?,?,?,?,?)",
                  (f'2026-09-{1 + i % 18:02d}T10:{i % 60:02d}:00+00:00', OWNER, 'Влад', 'owner', 'approved',
                   5_000_000_000 + (i % 10000) * 397_000, f'player{i % 10000}', ''))
for i in range(300):
    bot.pending[str(9_000_000_000 + i)] = {'user_id': 9_000_000_000 + i, 'username': f'new{i}', 'tg_name': 'Имя',
                                           'nick': f'player{i}', 'password': 'x' * 8, 'comment': '',
                                           'date': bot.timeutil.now_iso()}
for i in range(200):
    bot.unread_messages.add(str(5_000_000_000 + i * 397_000))
print(f"  10000 заявок, 40000 сообщений, 30000 записей журнала, 300 в очереди: {time.time() - t0:.1f} с")

LIMIT_MS = 300
results = []


def measure(name, fn, repeat=5):
    fn()  # прогрев: кэши файлов банов и т.п.
    t = time.perf_counter()
    for _ in range(repeat):
        fn()
    ms = (time.perf_counter() - t) / repeat * 1000
    results.append((name, ms))
    check(ms < LIMIT_MS, f"{name}: {ms:.0f} мс")


P = 5_000_000_000 + 5 * 397_000
print("\n=== Экраны ===")
measure("главная панель", lambda: ctx.press(OWNER, 'admin_back'))
measure("карточка заявки (досье + баны)", lambda: ctx.press(OWNER, 'pending_page_150'))
measure("статистика", lambda: ctx.press(OWNER, 'admin_menu_stats'))
measure("профили: страница списка", lambda: ctx.press(OWNER, 'apphistory_page_500'))
measure("профили: карточка", lambda: ctx.press(OWNER, 'apphistory_view_5000'))
measure("сообщения: непрочитанные", lambda: ctx.press(OWNER, 'msg_cat_unanswered_0'))
measure("сообщения: отвеченные, стр. 100", lambda: ctx.press(OWNER, 'msg_cat_answered_100'))
measure("профиль игрока", lambda: ctx.press(OWNER, f'user_profile_{P}'))
measure("вся переписка", lambda: ctx.press(OWNER, f'hist_{P}'))
measure("журнал: все", lambda: ctx.press(OWNER, 'jr_a_0_0'))
measure("журнал: страница 3000", lambda: ctx.press(OWNER, 'jr_a_0_3000'))
measure("журнал: по игроку", lambda: ctx.press(OWNER, f'jr_p_{P}_0'))
measure("подтверждённые: страница 800", lambda: ctx.press(OWNER, 'approved_page_800'))


def search():
    ctx.press(OWNER, 'admin_search')
    ctx.say(OWNER, 'player12')
measure("поиск по нику", search)
measure("проверка «ник занят» при подаче", lambda: bot.check_nick_already_approved('player9999'))
measure("выгрузка истории в CSV", lambda: storage.export_applications_csv('export_test.csv'), repeat=1)
measure("копия базы", lambda: storage.backup(), repeat=1)

print("\n=== Самые медленные ===")
for name, ms in sorted(results, key=lambda r: -r[1])[:5]:
    print(f"  {ms:7.1f} мс  {name}")
print(f"  размер bot.db: {os.path.getsize('bot.db') // 1024} КБ")
fakes.finish()
