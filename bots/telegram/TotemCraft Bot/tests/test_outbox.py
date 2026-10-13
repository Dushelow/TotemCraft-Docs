"""Очередь ответов от Claude (outbox) и журнал группы: бот пишет только в личку тем, кто ему писал,
в группе молчит и только запоминает. Запуск: python tests/test_outbox.py <временная папка>"""
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check, sent_to

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
OWNER, ADMIN, P1, P2, P3, STRANGER, GROUP = 1000, 2000, 5001, 6001, 7001, 8001, -1001234567890
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER, names={OWNER: 'Влад', ADMIN: 'Вася'})
bot, press, say = ctx.bot, ctx.press, ctx.say
storage = bot.storage
storage.execute("INSERT INTO staff (tg_id, name, role) VALUES (?,?,?)", (ADMIN, 'Вася', 'admin'))
bot.load_staff()


def queue(tg_id, text, close=False):
    return storage.execute("INSERT INTO outbox (created_at, tg_id, text, close) VALUES (?,?,?,?)",
                           ('2026-10-13T12:00:00+00:00', tg_id, text, int(close)))


def row(row_id):
    return storage.query("SELECT status, note FROM outbox WHERE id=?", (row_id,))[0]


def run_job():
    ctx.tg_log.clear()
    bot.outbox_job()
    return list(ctx.tg_log)


for p in (P1, P2, P3):
    storage.add_message(p, 'user', 'помогите')
    bot.open_ticket(p, 'помогите')
    bot.add_unread(p)

print("=== 1. Ответ и закрытие обращения ===")
ticket_id = bot.get_ticket(P1)['id']
r = queue(P1, "Сбросили пароль. Новый: <секрет> & заходите", close=True)
log = run_job()
texts = sent_to(log, P1)
check(len(texts) == 2 and 'Сообщение от администрации' in texts[0] and '&lt;секрет&gt; &amp;' in texts[0],
      "игрок получил «Сообщение от администрации», разметка экранирована")
check(f"#{ticket_id}" in texts[1], "игроку сказано, что обращение закрыто")
check(row(r)[0] == 'sent' and bot.get_ticket(P1) is None and str(P1) not in bot.unread_messages,
      "в очереди «sent», обращение закрыто, из непрочитанных убрано")
hist = storage.query("SELECT sender, staff_name, text FROM messages WHERE tg_id=? ORDER BY id", (P1,))
check(hist[-1][:2] == ('admin', 'Claude') and 'Сбросили пароль' in hist[-1][2], "ответ в переписке с подписью Claude")
acts = [a for a, n in storage.query("SELECT action, actor_name FROM audit WHERE target_id=? ORDER BY id", (P1,))]
check(acts[-2:] == ['msg_to_player', 'ticket_answered'], f"в журнале: написал и закрыл ({acts})")
check(storage.query("SELECT actor_name FROM audit WHERE target_id=? ORDER BY id DESC LIMIT 1", (P1,))[0][0] == 'Claude',
      "в журнале действие подписано Claude")
check(run_job() == [], "второй проход ничего не шлёт повторно")

print("\n=== 2. Ответ без закрытия ===")
r = queue(P2, "Подайте новую заявку с новым ником.")
log = run_job()
check(len(sent_to(log, P2)) == 1 and bot.get_ticket(P2) is not None and row(r)[0] == 'sent',
      "без --close одно сообщение, обращение остаётся открытым")

print("\n=== 3. Куда писать нельзя ===")
bot.blocked_users.add(P3)
bot.dialogs[ADMIN] = P2
cases = [(GROUP, "группа"), (ADMIN, "команда"), (OWNER, "владелец"), (STRANGER, "не писал боту"),
         (P3, "заблокирован"), (P2, "диалог у админа")]
ids = [(queue(t, "текст"), t, what) for t, what in cases]
ids.append((queue(P1, "   "), P1, "пустой текст"))
ids.append((queue(P1, "x" * 4000), P1, "слишком длинный"))
log = run_job()
check(not [m for m, p in log if m.startswith('send')], f"никому ничего не отправлено: {[m for m, _ in log]}")
for r, t, what in ids:
    st, note = row(r)
    check(st == 'refused' and note, f"{what}: отказ «{note}»")
del bot.dialogs[ADMIN]
bot.blocked_users.discard(P3)

APPLICANT = 9001  # подал заявку, но в обращения не писал
storage.execute("INSERT INTO applications (created_at, tg_id, nick, status) VALUES (?,?,?,?)",
                ('2026-10-13T08:00:00+00:00', APPLICANT, 'Kufirix', 'Одобрено'))
r = queue(APPLICANT, "Зайдите под ником Kufirix.")
log = run_job()
check(row(r)[0] == 'sent' and len(sent_to(log, APPLICANT)) == 1, "тому, кто подавал заявку, писать можно")

print("\n=== 4. Игрок заблокировал бота ===")
ctx.blocked_chats.add(P3)
r = queue(P3, "ответ")
run_job()
check(row(r)[0] == 'failed', f"Telegram не принял: статус failed ({row(r)})")
ctx.blocked_chats.discard(P3)

print("\n=== 5. Группа: бот молчит, только запоминает ===")
for text in ("привет всем", "/start", "/admin", "бот ответь"):
    log = say(P1, text, chat_id=GROUP, chat_type='supergroup')
    check(not [m for m, _ in log if m.startswith('send') or m.startswith('edit')], f"на «{text}» в группе ни слова")
log = say(OWNER, "/admin", chat_id=GROUP, chat_type='supergroup')
check(not log, "даже владельцу в группе бот не отвечает")
m = ctx.types.Message.de_json({
    'message_id': 91, 'date': 0, 'chat': {'id': GROUP, 'type': 'supergroup', 'title': 'TotemCraft'},
    'from': {'id': P2, 'is_bot': False, 'first_name': 'Игрок2', 'username': 'p2'},
    'photo': [{'file_id': 'small', 'file_unique_id': 's', 'width': 10, 'height': 10},
              {'file_id': 'big', 'file_unique_id': 'b', 'width': 900, 'height': 900}],
    'caption': 'чёрный экран после пароля'})
ctx.tg_log.clear()
bot.handle_photo(m)
check(not ctx.tg_log, "на фото в группе бот молчит")
rows = storage.query("SELECT from_id, text, photo, chat_title FROM group_log ORDER BY id")
check(len(rows) == 6, f"в журнал группы записаны все 6 сообщений: {len(rows)}")
check(rows[-1] == (P2, 'чёрный экран после пароля', 'big', 'TotemCraft'), f"фото: подпись и самый крупный размер {rows[-1]}")
storage.execute("UPDATE group_log SET ts='2020-01-01T00:00:00+00:00' WHERE id=1")
bot.group_log_cleanup()
check(storage.query("SELECT COUNT(*) FROM group_log")[0][0] == 5, "старые записи журнала группы удаляются")
(t, _), log = press(P1, 'menu_apply')  # нажатие в личке работает как раньше
check(any(m == 'answerCallbackQuery' or m.startswith('send') or m.startswith('edit') for m, _ in log), "личка не сломана")

print("\n=== 5а. Закрыть старое обращение молча ===")
bot.open_ticket(P3, 'давно'); bot.add_unread(P3); bot.blocked_users.add(P3)
r = queue(P3, "", close=True)
log = run_job()
check(not [m for m, _ in log if m.startswith('send')] and row(r)[0] == 'sent', "игроку ничего не пришло, статус sent")
check(bot.get_ticket(P3) is None and str(P3) not in bot.unread_messages, "обращение закрыто даже у заблокированного")
r = queue(P3, "", close=True); run_job()
check(row(r) == ('refused', 'открытого обращения нет'), f"повторно закрывать нечего: {row(r)}")
r = queue(GROUP, "", close=True); run_job()
check(row(r)[0] == 'refused', "группу «закрыть» тоже нельзя")
bot.blocked_users.discard(P3)

print("\n=== 6. Команда send с сервера ===")
env = dict(os.environ, PYTHONPATH=fakes.BOT_DIR, PYTHONIOENCODING='utf-8')
proc = subprocess.Popen([sys.executable, '-m', 'tcbot.outbox_cli', 'send', str(P2), '--close'], cwd=os.getcwd(),
                        env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
proc.stdin.write("Заявку можно подать заново.".encode('utf-8')); proc.stdin.close()
for _ in range(40):
    time.sleep(0.3)
    run_job()
    if proc.poll() is not None:
        break
out = proc.stdout.read().decode('utf-8')
check(proc.returncode == 0 and 'sent' in out, f"send дождался отправки: {out.strip()} {proc.stderr.read().decode('utf-8')[-300:]}")
check(bot.get_ticket(P2) is None, "обращение закрыто через команду")
st = subprocess.run([sys.executable, '-m', 'tcbot.outbox_cli', 'status', '3'], cwd=os.getcwd(), env=env,
                    capture_output=True)
check(st.returncode == 0 and 'sent' in st.stdout.decode('utf-8'), "status показывает очередь")

fakes.finish()
