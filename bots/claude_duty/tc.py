#!/usr/bin/env python3
"""tc: единственная дверь дежурного Claude на сервер TotemCraft.

Дежурный (учётная запись claudebot, без root) может вызывать только `sudo -n /opt/tcclaude/tc <действие> ...`.
Здесь перечислено всё, что ему можно; каждый аргумент проверяется, каждое действие пишется в журнал
/var/log/tcclaude/actions.log. Чего тут нет, того дежурный сделать не может: банов, откатов, произвольных
команд консоли, правки файлов, ролей.

Чтение:
  logs "<регулярка>" [дней<=7]    поиск по логам сервера (МСК)
  chat <ник> [дней<=7]            что игрок писал в чат и какие команды вводил
  coreprotect "SELECT ..."        CoreProtect только на чтение
  botdb "SELECT ..."              база Telegram-бота без таблицы kv (там пароли заявок)
  authme <ник>                    регистрация и последний вход, без пароля и IP
  abx <ник> [ник...]              история наказаний AdvancedBanX
  online                          входы и выходы за сутки
Действия:
  mute <ник> <1m..24h> <причина>  мут в игре
  kick <ник> <причина>            кик с сервера
  tg-send <tg_id>  (текст на вход)  личное сообщение игроку через очередь Telegram-бота
  tg-group <номер> (текст на вход)  ответ в общем чате Telegram на сообщение с этим номером
"""
import datetime
import glob
import gzip
import json
import os
import re
import sqlite3
import subprocess
import sys

MC = '/home/minecraft/server'
LOGS = MC + '/logs'
COREPROTECT = MC + '/plugins/CoreProtect/database.db'
AUTHME = MC + '/plugins/AuthMe/authme.db'
BOT = '/home/totembot/totemcraft_bot'
HERE = os.path.dirname(os.path.realpath(__file__))
ACTIONS_LOG = '/var/log/tcclaude/actions.log'
MAX_LINES = 300

NICK = re.compile(r'^\.?[A-Za-z0-9_]{3,17}$')
DURATION = re.compile(r'^([1-9][0-9]?)([mh])$')
REASON = re.compile(r'^[\w .,()«»№-]{3,80}$')  # без кавычек, слэшей, ^ и переводов строки: идёт в консоль


def die(msg):
    print('ОТКАЗ: ' + msg)
    sys.exit(2)


def record(action, details):
    os.makedirs(os.path.dirname(ACTIONS_LOG), exist_ok=True)
    with open(ACTIONS_LOG, 'a', encoding='utf-8') as f:
        f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {action} {details}\n")


def log_files(days):
    days = max(1, min(int(days), 7))
    cutoff = datetime.datetime.now().timestamp() - days * 86400
    files = sorted((f for f in glob.glob(LOGS + '/*.log.gz') if os.path.getmtime(f) >= cutoff), key=os.path.getmtime)
    return files + [LOGS + '/latest.log']


def grep_logs(pattern, days):
    try:
        rx = re.compile(pattern, re.IGNORECASE)
    except re.error as e:
        die(f'неверное выражение: {e}')
    found = 0
    for f in log_files(days):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    if rx.search(line):
                        print(os.path.basename(f).split('.')[0], line.rstrip()[:300])
                        found += 1
                        if found >= MAX_LINES:
                            print(f'... обрезано на {MAX_LINES} строках, сузьте поиск')
                            return
        except FileNotFoundError:
            pass
    if not found:
        print('ничего не найдено')


def query(path, sql, deny_tables=(), deny_columns=()):
    """Один SELECT только для чтения; запрещённые таблицы и столбцы отсекает авторизатор SQLite."""
    sql = sql.strip().rstrip(';')
    if not re.match(r'^(select|with)\b', sql, re.IGNORECASE) or ';' in sql:
        die('только один запрос SELECT')
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)

    def auth(action, a1, a2, dbname, trigger):
        if action == sqlite3.SQLITE_READ:
            return sqlite3.SQLITE_DENY if (a1 in deny_tables or (a1, a2) in deny_columns) else sqlite3.SQLITE_OK
        return sqlite3.SQLITE_OK if action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_FUNCTION) else sqlite3.SQLITE_DENY
    db.set_authorizer(auth)
    start = datetime.datetime.now()
    db.set_progress_handler(lambda: 1 if (datetime.datetime.now() - start).total_seconds() > 60 else 0, 10000)
    try:
        cur = db.execute(sql)
        print(' | '.join(d[0] for d in cur.description))
        for i, row in enumerate(cur):
            if i >= 200:
                print('... обрезано на 200 строках')
                break
            print(' | '.join('' if v is None else str(v)[:300] for v in row))
    except sqlite3.Error as e:
        die(f'запрос не выполнен: {e}')


def console(command):
    subprocess.run(['su', '-s', '/bin/bash', 'minecraft', '-c',
                    f"screen -S minecraft -p 0 -X stuff '{command}\r'"], check=True, timeout=20)


def outbox(args, text):
    p = subprocess.run(['sudo', '-u', 'totembot', BOT + '/venv/bin/python', '-m', 'tcbot.outbox_cli', *args],
                       cwd=BOT, input=text.encode('utf-8'), capture_output=True, timeout=60)
    print((p.stdout or p.stderr).decode('utf-8', 'replace').strip())
    return p.returncode


def need_nick(args, usage):
    if not args or not NICK.match(args[0]):
        die(usage)
    return args[0]


def need_reason(words):
    reason = ' '.join(words)
    if not REASON.match(reason):
        die('причина: 3-80 знаков, буквы, цифры, пробелы, точки, запятые, скобки')
    return reason


def main(argv):
    if not argv or argv[0] in ('help', '-h', '--help'):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    if cmd == 'logs':
        if not args:
            die('нужно выражение')
        grep_logs(args[0], args[1] if len(args) > 1 else 2)
    elif cmd == 'chat':
        nick = re.escape(need_nick(args, 'нужно: chat <ник> [дней]'))
        grep_logs(rf'(<{nick}>|\b{nick} issued server command)', args[1] if len(args) > 1 else 2)
    elif cmd == 'coreprotect':
        query(COREPROTECT, ' '.join(args))
    elif cmd == 'botdb':
        query(BOT + '/bot.db', ' '.join(args), deny_tables=('kv',))
    elif cmd == 'authme':
        nick = need_nick(args, 'нужно: authme <ник>').lower()
        query(AUTHME, "SELECT realname, datetime(regdate/1000,'unixepoch','+3 hours') AS reg_msk, "
                      "datetime(lastlogin/1000,'unixepoch','+3 hours') AS last_msk FROM authme "
                      f"WHERE username = '{nick}'",
              deny_columns=(('authme', 'password'), ('authme', 'totp'), ('authme', 'ip'), ('authme', 'regip')))
    elif cmd == 'abx':
        nicks = [n for n in args if NICK.match(n)]
        if not nicks:
            die('нужно: abx <ник> [ник...]')
        subprocess.run([sys.executable, os.path.join(HERE, 'abx_history.py'), *nicks], timeout=60)
    elif cmd == 'online':
        grep_logs(r'(joined the game|left the game)', 1)
    elif cmd == 'mute':
        nick = need_nick(args, 'нужно: mute <ник> <срок> <причина>')
        m = DURATION.match(args[1] if len(args) > 1 else '')
        if not m or (m.group(2) == 'h' and int(m.group(1)) > 24):
            die('срок от 1m до 24h')
        reason = need_reason(args[2:])
        console(f'tempmute {nick} {args[1]} {reason}')
        record('mute', f'{nick} {args[1]} {reason}')
        print(f'мут {nick} на {args[1]} отправлен в консоль. Проверка: tc abx {nick}')
    elif cmd == 'kick':
        nick = need_nick(args, 'нужно: kick <ник> <причина>')
        reason = need_reason(args[1:])
        console(f'kick {nick} {reason}')
        record('kick', f'{nick} {reason}')
        print(f'кик {nick} отправлен в консоль')
    elif cmd in ('tg-send', 'tg-group'):
        if not args or not args[0].isdigit():
            die(f'нужно: {cmd} <число>')
        text = sys.stdin.read().strip()
        if not text or len(text) > 3500:
            die('текст 1-3500 знаков')
        record(cmd, f'{args[0]} {json.dumps(text[:200], ensure_ascii=False)}')
        sys.exit(outbox(['send' if cmd == 'tg-send' else 'group', args[0]], text))
    else:
        die(f'нет такого действия: {cmd}. Список: tc help')


if __name__ == '__main__':
    main(sys.argv[1:])
