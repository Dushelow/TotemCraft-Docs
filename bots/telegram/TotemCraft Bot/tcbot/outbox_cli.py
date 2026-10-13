"""Ответы игрокам от Claude через бота и чтение журнала группы. Запуск на сервере из папки бота:

  sudo -u totembot venv/bin/python -m tcbot.outbox_cli send <tg_id> [--close] < ответ.txt
  sudo -u totembot venv/bin/python -m tcbot.outbox_cli status [N]
  sudo -u totembot venv/bin/python -m tcbot.outbox_cli photo <file_id> <файл.jpg>

send только кладёт ответ в очередь (таблица outbox). Отправляет сам бот, раз в 10 секунд:
он проверяет, что это личка игрока, который писал боту, пишет ответ в переписку и журнал
и с --close закрывает обращение. В группы и команде бот через очередь ничего не шлёт.
photo скачивает фото из журнала группы (group_log.photo) по токену из .env, токен не печатается.
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone

DB_FILE = 'bot.db'


def db():
    return sqlite3.connect(DB_FILE, timeout=10)


def send(argv):
    if not argv or not argv[0].lstrip('-').isdigit():
        sys.exit("нужен tg_id игрока")
    tg_id, close = int(argv[0]), '--close' in argv[1:]
    text = sys.stdin.buffer.read().decode('utf-8').strip()
    if not text:
        sys.exit("пустой текст")
    with db() as c:
        cur = c.execute("INSERT INTO outbox (created_at, tg_id, text, close) VALUES (?,?,?,?)",
                        (datetime.now(timezone.utc).isoformat(timespec='seconds'), tg_id, text, int(close)))
        row_id = cur.lastrowid
    # ждём, пока бот заберёт: так сразу видно, ушло или отказано и почему
    for _ in range(30):
        time.sleep(1)
        status, note = db().execute("SELECT status, note FROM outbox WHERE id=?", (row_id,)).fetchone()
        if status not in ('new', 'sending'):
            break
    print(f"#{row_id} {status}" + (f": {note}" if note else ''))
    sys.exit(0 if status == 'sent' else 1)


def status(argv):
    n = int(argv[0]) if argv else 10
    for row in db().execute("SELECT id, created_at, tg_id, close, status, note, substr(text,1,60) FROM outbox "
                            "ORDER BY id DESC LIMIT ?", (n,)):
        print(" | ".join('' if x is None else str(x) for x in row))


def token():
    for line in open('.env', encoding='utf-8'):
        key, _, value = line.strip().partition('=')
        if key.strip() == 'BOT_TOKEN':
            return value.strip().strip('"\'')
    sys.exit("в .env нет BOT_TOKEN")


def photo(argv):
    if len(argv) != 2:
        sys.exit("нужно: photo <file_id> <файл>")
    file_id, out = argv
    t = token()
    with urllib.request.urlopen(f"https://api.telegram.org/bot{t}/getFile?file_id={file_id}", timeout=30) as r:
        path = json.load(r)['result']['file_path']
    with urllib.request.urlopen(f"https://api.telegram.org/file/bot{t}/{path}", timeout=60) as r, open(out, 'wb') as f:
        f.write(r.read())
    print(out)


if __name__ == '__main__':
    cmd, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    {'send': send, 'status': status, 'photo': photo}.get(cmd, lambda _: sys.exit(__doc__))(rest)
