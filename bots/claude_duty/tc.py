#!/usr/bin/env python3
"""tc: единственная дверь дежурного Claude на сервер TotemCraft.

Дежурный (учётная запись claudebot, без root) может вызывать только `sudo -n /opt/tcclaude/tc <действие> ...`.
Здесь перечислено всё, что ему можно; каждый аргумент проверяется, каждое действие пишется в журнал
/var/log/tcclaude/actions.log. Ключи ботов инструмент берёт сам и не печатает. Чего тут нет, того дежурный
сделать не может: разбана, откатов, произвольных команд консоли, правки файлов, ролей. Бессрочный бан только за
читы и только со ссылкой на доказательство; бан до 365 дней только за гриф.

Чтение:
  logs "<регулярка>" [дней<=7]      поиск по логам сервера (время МСК)
  chat <ник> [дней<=7]              что игрок писал в чат и какие команды вводил
  coreprotect "SELECT ..."          CoreProtect только на чтение
  botdb "SELECT ..."                база Telegram-бота без таблицы kv (там пароли заявок)
  authme <ник>                      регистрация и последний вход, без пароля и IP
  abx <ник> [ник...]                история наказаний AdvancedBanX
  vulcan <ник>                      срабатывания античита Vulcan по проверкам (сводка и последние 15)
  online                            входы и выходы за сутки
  forum                             открытые темы форума Discord
  thread <id> [сообщений<=100]      переписка темы или канала Discord (время UTC)
  snapshot                          сводка для обхода: службы, рестарт, ошибки, туннель, заявки, обращения,
                                    переписка и общий чат Telegram за 26 ч, ящик задач, входы, наказания за 26 ч
  inbox                             задачи из ящика админ-чата, ещё не сделанные
  reports [дней<=7]                 отчёты прошлых обходов (что уже сделано), по умолчанию 2 дня
Ящик и отчёты:
  task-answer <номер> (текст на вход)  ответ на задачу из ящика: Core покажет его карточкой в админ-чате
                                       с автором задачи и пометит задачу сделанной
  day-report (текст на вход)           дописать раздел в отчёт за сегодня (что сделано, что открыто)
Действия в игре:
  mute <ник> <срок до 7d> <причина>     мут
  unmute <ник>                          снять мут
  tempban <ник> <срок> <причина>        временный бан; причина начинается с одного из:
                                        Читы, Реклама, Взлом, Гриф, Обход бана, Оскорбление администрации.
                                        Срок до 30d, за Гриф до 365d
  ban <ник> <ссылка на доказательство> Читы ...   бессрочный бан, только за читы, только при 100% доказательствах
  kick <ник> <причина>                  кик
Действия в Discord (от имени «TotemCraft | Ванильный сервер»):
  forum-reply <id темы>   (текст на вход)   ответ в теме форума
  forum-close <id темы>                     закрыть тему (архив и замок)
  forum-open <id темы>                      открыть закрытую тему
  report      (текст на вход)               отчёт о наказании в «📜┃отчёты»
  general     (текст на вход)               сообщение в «📝┃общий-чат» (упоминания игроков <@id> работают)
  discord-mute <id участника> <срок до 7d> <причина>   мут в Discord
Telegram (заявки и обращения видны только здесь: в botdb их нет, они лежат рядом с паролями):
  tg-pending                            заявки, ждущие решения: tg_id | ник | дата UTC | вердикт автомата | срок |
                                        стоп-причины | мелкие замечания | подписан | комментарий игрока
  tg-tickets                            открытые обращения (тикеты) и непрочитанные переписки
  tg-approve <tg_id> (комментарий на вход, можно пустой)   одобрить заявку
  tg-reject <tg_id>  (причина на вход, обязательна)        отклонить заявку
  tg-send <tg_id> [--close] (текст на вход)   личное сообщение игроку; --close закрывает его обращение
  tg-close <tg_id>                      закрыть решённое обращение молча
  tg-group <номер>   (текст на вход)    ответ в общем чате Telegram на сообщение с этим номером
"""
import base64
import datetime
import glob
import gzip
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request

MC = '/home/minecraft/server'
LOGS = MC + '/logs'
COREPROTECT = MC + '/plugins/CoreProtect/database.db'
AUTHME = MC + '/plugins/AuthMe/authme.db'
BOT = '/home/totembot/totemcraft_bot'
CORE_ENV = '/home/totemcraftcore/.env'
HERE = os.path.dirname(os.path.realpath(__file__))
STATE = '/var/lib/tcclaude-root'          # вебхуки; только root
ACTIONS_LOG = '/var/log/tcclaude/actions.log'
CORE_DB = '/home/totemcraftcore/totemcraftcore.db'
DUTY_OUTBOX = '/var/lib/tcclaude/outbox'
REPORTS_DIR = '/var/lib/tcclaude/reports'
MAX_LINES = 300

GUILD = '1454170536765558911'
FORUM = '1454170538015723716'
REPORTS = '1454170538095153249'
GENERAL = '1454170538326102214'
SERVER_BOT = '1559465125055037540'
SERVER_NAME = 'TotemCraft | Ванильный сервер'
API = 'https://discord.com/api/v10'

NICK = re.compile(r'^\.?[A-Za-z0-9_]{3,17}$')
DURATION = re.compile(r'^([1-9][0-9]{0,2})([mhd])$')
REASON = re.compile(r'^[\w .,()«»№:+-]{3,100}$')  # без кавычек, слэшей, ^ и переводов строки: идёт в консоль
BAN_REASONS = ('Читы', 'Реклама', 'Взлом', 'Гриф', 'Обход бана', 'Оскорбление администрации')
SNOWFLAKE = re.compile(r'^\d{15,21}$')
PROOF = re.compile(r'^https://\S{10,300}$')
VULCAN = MC + '/plugins/Vulcan/violations.txt'


def die(msg):
    print('ОТКАЗ: ' + msg)
    sys.exit(2)


def record(action, details):
    os.makedirs(os.path.dirname(ACTIONS_LOG), exist_ok=True)
    with open(ACTIONS_LOG, 'a', encoding='utf-8') as f:
        f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {action} {details}\n")


def minutes(text):
    m = DURATION.match(text or '')
    if not m:
        return None
    return int(m.group(1)) * {'m': 1, 'h': 60, 'd': 1440}[m.group(2)]


# ── чтение ───────────────────────────────────────────────────────
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


# ── Discord ──────────────────────────────────────────────────────
def core_token():
    for line in open(CORE_ENV, encoding='utf-8'):
        if line.startswith('BOT_TOKEN='):
            return line.split('=', 1)[1].strip()
    die('нет ключа бота Core')


def discord(method, path, body=None, reason=None, raw=False, token=True):
    url = path if path.startswith('https://') else API + path
    headers = {'User-Agent': 'TotemCraftDuty (https://totemcraft.net, 1.0)', 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bot ' + core_token()
    if reason:
        headers['X-Audit-Log-Reason'] = urllib.parse.quote(reason)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            content = r.read()
            return content if raw else (json.loads(content) if content else {})
    except urllib.error.HTTPError as e:
        die(f'Discord ответил {e.code}: {e.read().decode("utf-8", "replace")[:200]}')


def webhook(channel_id):
    """Вебхук «TotemCraft | Ванильный сервер» в канале: ищем или создаём с аватаркой бота сервера."""
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    cache = os.path.join(STATE, f'webhook_{channel_id}.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    hooks = [h for h in discord('GET', f'/channels/{channel_id}/webhooks') if h.get('name') == SERVER_NAME and h.get('token')]
    if hooks:
        hook = hooks[0]
    else:
        user = discord('GET', f'/users/{SERVER_BOT}')
        avatar = None
        if user.get('avatar'):
            png = discord('GET', f"https://cdn.discordapp.com/avatars/{SERVER_BOT}/{user['avatar']}.png?size=256", raw=True, token=False)
            avatar = 'data:image/png;base64,' + base64.b64encode(png).decode()
        hook = discord('POST', f'/channels/{channel_id}/webhooks', {'name': SERVER_NAME, 'avatar': avatar},
                       reason='Ответы дежурного Claude от имени бота сервера')
    fd = os.open(cache, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'id': hook['id'], 'token': hook['token']}, f)
    return {'id': hook['id'], 'token': hook['token']}


def say(channel_id, text, thread_id=None, users=False):
    hook = webhook(channel_id)
    q = '?wait=true' + (f'&thread_id={thread_id}' if thread_id else '')
    msg = discord('POST', f"/webhooks/{hook['id']}/{hook['token']}{q}",
                  {'content': text, 'allowed_mentions': {'parse': ['users'] if users else []}}, token=False)
    return msg.get('id')


def stdin_text(limit=1900):
    text = sys.stdin.read().strip()
    if not text or len(text) > limit:
        die(f'текст 1-{limit} знаков')
    return text


def forum_thread(thread_id):
    if not SNOWFLAKE.match(thread_id or ''):
        die('нужен id темы')
    th = discord('GET', f'/channels/{thread_id}')
    if th.get('parent_id') != FORUM:
        die('это не тема форума')
    return th


def show_messages(channel_id, limit):
    limit = max(1, min(int(limit), 100))
    msgs = discord('GET', f'/channels/{channel_id}/messages?limit={limit}')
    for m in reversed(msgs):
        line = f"[{m['timestamp'][:16].replace('T', ' ')}] {m['author'].get('global_name') or m['author']['username']} " \
               f"(id {m['author']['id']}): {m['content']}"
        for a in m.get('attachments', []):
            line += f" [вложение {a['filename']}]"
        print(line[:2000])


# ── игра ─────────────────────────────────────────────────────────
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
        die('причина: 3-100 знаков, буквы, цифры, пробелы, точки, запятые, скобки, двоеточие')
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
    elif cmd == 'vulcan':
        nick = need_nick(args, 'нужно: vulcan <ник>')
        rx = re.compile(r'^\[([\d-]+)\] \[([\d:]+)\] ' + re.escape(nick) + r' failed (.+?) \[VL: (\d+)\] \[Ping: (\d+)\]', re.IGNORECASE)
        checks, last = {}, []
        for line in open(VULCAN, encoding='utf-8', errors='replace'):
            m = rx.match(line)
            if m:
                c = checks.setdefault(m.group(3), [0, 0, m.group(1), m.group(1)])
                c[0] += 1
                c[1] = max(c[1], int(m.group(4)))
                c[3] = m.group(1)
                last = (last + [line.rstrip()[:220]])[-15:]
        if not checks:
            print('срабатываний нет')
        for name, (n, vl, first, final) in sorted(checks.items(), key=lambda x: -x[1][0]):
            print(f'{name}: {n} раз, макс. VL {vl}, с {first} по {final}')
        print('\n'.join(last))
    elif cmd == 'snapshot':
        p = subprocess.run(['bash', os.path.join(HERE, 'snapshot.sh')], capture_output=True, timeout=180)
        print(p.stdout.decode('utf-8', 'replace')[-60000:])
    elif cmd == 'inbox':
        query(CORE_DB, "SELECT id, datetime(created,'unixepoch','+3 hours') AS msk, author_name, text FROM inbox "
                       "WHERE status='new' ORDER BY id")
    elif cmd == 'reports':
        days = max(1, min(int(args[0]) if args and args[0].isdigit() else 2, 7))
        for i in range(days - 1, -1, -1):
            day = (datetime.date.today() - datetime.timedelta(days=i)).isoformat()
            path = os.path.join(REPORTS_DIR, day + '.md')
            if os.path.exists(path):
                print(f'##### {day}')
                print(open(path, encoding='utf-8').read()[-15000:])
    elif cmd == 'task-answer':
        if not args or not args[0].isdigit():
            die('нужно: task-answer <номер задачи>')
        db = sqlite3.connect(f'file:{CORE_DB}?mode=ro', uri=True, timeout=10)
        row = db.execute("SELECT status FROM inbox WHERE id=?", (int(args[0]),)).fetchone()
        if not row or row[0] != 'new':
            die(f'задачи #{args[0]} нет в ящике или она уже сделана')
        text = stdin_text(3500)
        tmp = os.path.join(DUTY_OUTBOX, f'.{args[0]}.json')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'id': int(args[0]), 'ok': True, 'answer': text}, f, ensure_ascii=False)
        os.chmod(tmp, 0o660)
        os.replace(tmp, os.path.join(DUTY_OUTBOX, f'{args[0]}.json'))
        record('task-answer', f'{args[0]} {json.dumps(text[:200], ensure_ascii=False)}')
        print(f'ответ на задачу #{args[0]} передан, Core опубликует его в админ-чате')
    elif cmd == 'day-report':
        text = stdin_text(8000)
        os.makedirs(REPORTS_DIR, mode=0o750, exist_ok=True)
        path = os.path.join(REPORTS_DIR, datetime.date.today().isoformat() + '.md')
        with open(path, 'a', encoding='utf-8') as f:
            f.write(f"\n## {datetime.datetime.now():%H:%M} МСК\n\n{text}\n")
        record('day-report', path)
        print(f'записано в отчёт {os.path.basename(path)}')
    elif cmd == 'online':
        grep_logs(r'(joined the game|left the game)', 1)
    elif cmd == 'forum':
        tags = {t['id']: t['name'] for t in discord('GET', f'/channels/{FORUM}').get('available_tags', [])}
        for t in discord('GET', f'/guilds/{GUILD}/threads/active').get('threads', []):
            if t.get('parent_id') == FORUM and not t['thread_metadata'].get('locked'):
                print(t['id'], t['thread_metadata'].get('create_timestamp', '')[:16], f"msgs={t.get('message_count')}",
                      ','.join(tags.get(x, x) for x in t.get('applied_tags', [])), '|', t['name'])
    elif cmd == 'thread':
        if not args or not SNOWFLAKE.match(args[0]):
            die('нужно: thread <id> [сообщений]')
        show_messages(args[0], args[1] if len(args) > 1 else 50)
    elif cmd == 'forum-reply':
        th = forum_thread(args[0] if args else '')
        text = stdin_text()
        if th['thread_metadata'].get('archived'):
            discord('PATCH', f"/channels/{th['id']}", {'archived': False}, reason='Ответ дежурного')
        mid = say(FORUM, text, thread_id=th['id'])
        record('forum-reply', f"{th['id']} {json.dumps(text[:200], ensure_ascii=False)}")
        print(f'ответ отправлен в тему «{th["name"]}», сообщение {mid}')
    elif cmd in ('forum-close', 'forum-open'):
        th = forum_thread(args[0] if args else '')
        close = cmd == 'forum-close'
        discord('PATCH', f"/channels/{th['id']}", {'archived': close, 'locked': close},
                reason='Тема закрыта дежурным' if close else 'Тема открыта дежурным')
        record(cmd, th['id'])
        print(f'тема «{th["name"]}» {"закрыта" if close else "открыта"}')
    elif cmd in ('report', 'general'):
        text = stdin_text()
        mid = say(REPORTS if cmd == 'report' else GENERAL, text, users=True)
        record(cmd, json.dumps(text[:200], ensure_ascii=False))
        print(f'отправлено, сообщение {mid}')
    elif cmd == 'discord-mute':
        if not args or not SNOWFLAKE.match(args[0]):
            die('нужно: discord-mute <id участника> <срок до 7d> <причина>')
        mins = minutes(args[1] if len(args) > 1 else '')
        if not mins or mins > 7 * 1440:
            die('срок от 1m до 7d')
        reason = need_reason(args[2:])
        until = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=mins)).isoformat()
        discord('PATCH', f'/guilds/{GUILD}/members/{args[0]}', {'communication_disabled_until': until}, reason=reason)
        record('discord-mute', f'{args[0]} {args[1]} {reason}')
        print(f'мут в Discord для {args[0]} до {until[:16]} UTC')
    elif cmd == 'mute':
        nick = need_nick(args, 'нужно: mute <ник> <срок> <причина>')
        mins = minutes(args[1] if len(args) > 1 else '')
        if not mins or mins > 7 * 1440:
            die('срок от 1m до 7d')
        reason = need_reason(args[2:])
        console(f'tempmute {nick} {args[1]} {reason}')
        record('mute', f'{nick} {args[1]} {reason}')
        print(f'мут {nick} на {args[1]} отправлен в консоль. Проверка: tc abx {nick}')
    elif cmd == 'unmute':
        nick = need_nick(args, 'нужно: unmute <ник>')
        console(f'unmute {nick}')
        record('unmute', nick)
        print(f'мут с {nick} снят')
    elif cmd == 'tempban':
        nick = need_nick(args, 'нужно: tempban <ник> <срок> <причина>')
        mins = minutes(args[1] if len(args) > 1 else '')
        reason = need_reason(args[2:])
        if not reason.startswith(BAN_REASONS):
            die('причина бана начинается с одного из: ' + ', '.join(BAN_REASONS))
        limit = 365 if reason.startswith('Гриф') else 30
        if not mins or mins > limit * 1440:
            die(f'срок от 1m до {limit}d; дольше банит только владелец')
        console(f'tempban {nick} {args[1]} {reason}')
        record('tempban', f'{nick} {args[1]} {reason}')
        print(f'бан {nick} на {args[1]} отправлен в консоль. Проверка: tc abx {nick}')
    elif cmd == 'ban':
        nick = need_nick(args, 'нужно: ban <ник> <ссылка на доказательство> Читы ...')
        if len(args) < 2 or not PROOF.match(args[1]):
            die('нужна ссылка на доказательство (видео, сообщение Discord со скриншотами), начинается с https://')
        reason = need_reason(args[2:])
        if not reason.startswith('Читы'):
            die('навсегда дежурный банит только за читы; остальное временно или через владельца')
        console(f'ban {nick} {reason}')
        record('ban', f'{nick} {reason} доказательство: {args[1]}')
        print(f'бессрочный бан {nick} отправлен в консоль. Проверка: tc abx {nick}')
    elif cmd == 'kick':
        nick = need_nick(args, 'нужно: kick <ник> <причина>')
        reason = need_reason(args[1:])
        console(f'kick {nick} {reason}')
        record('kick', f'{nick} {reason}')
        print(f'кик {nick} отправлен в консоль')
    elif cmd in ('tg-send', 'tg-group'):
        if not args or not args[0].isdigit():
            die(f'нужно: {cmd} <число>')
        text = stdin_text(3500)
        close = ['--close'] if cmd == 'tg-send' and '--close' in args[1:] else []
        record(cmd, f'{args[0]} {" ".join(close)} {json.dumps(text[:200], ensure_ascii=False)}')
        sys.exit(outbox(['send' if cmd == 'tg-send' else 'group', args[0], *close], text))
    elif cmd == 'tg-pending':
        sys.exit(outbox(['pending'], ''))
    elif cmd == 'tg-tickets':
        query(BOT + '/bot.db', "SELECT 'тикет' AS что, key AS tg_id, json_extract(value,'$.nick') AS ник, "
                               "json_extract(value,'$.date') AS дата, substr(json_extract(value,'$.message'),1,300) AS текст "
                               "FROM kv WHERE space='tickets' UNION ALL "
                               "SELECT 'непрочитано', key, '', '', '' FROM kv WHERE space='unread'")
    elif cmd in ('tg-approve', 'tg-reject', 'tg-close'):
        if not args or not args[0].isdigit():
            die(f'нужно: {cmd} <tg_id>')
        text = '' if cmd == 'tg-close' else sys.stdin.read().strip()
        if cmd == 'tg-reject' and not 3 <= len(text) <= 1000:
            die('причина отказа обязательна: 3-1000 знаков, её увидит игрок')
        record(cmd, f'{args[0]} {json.dumps(text[:200], ensure_ascii=False)}')
        sys.exit(outbox([cmd[3:], args[0]], text))
    else:
        die(f'нет такого действия: {cmd}. Список: tc help')


if __name__ == '__main__':
    main(sys.argv[1:])
