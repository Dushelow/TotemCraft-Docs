"""Поддельные Telegram, Discord и RCON для тестов бота. Настоящие сервисы не трогаются.

Использование: ctx = fakes.start(workdir, mc_dir); затем ctx.press(...), ctx.say(...).
Бот импортируется в папке workdir: там появятся bot.db и прочие файлы.
"""
import importlib.util
import json
import os
import socket
import struct
import sys
import threading

BOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FAILS = []


def check(cond, what):
    print(("  ок      " if cond else "  ОШИБКА ") + what)
    if not cond:
        FAILS.append(what)


def finish():
    print("\nИТОГ:", "всё прошло" if not FAILS else f"ошибок {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1 if FAILS else 0)


class Ctx:
    pass


# Разметка HTML, которую принимает Telegram
_TG_TAGS = {'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'span', 'tg-spoiler', 'a', 'code', 'pre',
            'blockquote', 'tg-emoji'}
_TAG = __import__('re').compile(r'<(/?)([a-zA-Z-]+)(\s[^<>]*)?>')
_ENTITY = __import__('re').compile(r'&(lt|gt|amp|quot|#\d+|#x[0-9a-fA-F]+);')


def html_problem(text):
    """Ошибка разметки, на которую настоящий Telegram ответит «can't parse entities», или None."""
    stack, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch == '<':
            m = _TAG.match(text, i)
            if not m or m.group(2).lower() not in _TG_TAGS:
                return f"Unsupported start tag or stray '<' at byte offset {i}"
            name = m.group(2).lower()
            if m.group(1):
                if not stack or stack[-1] != name:
                    return f"Unmatched end tag </{name}>"
                stack.pop()
            else:
                stack.append(name)
            i = m.end()
            continue
        if ch == '&':
            m = _ENTITY.match(text, i)
            if not m:
                return f"Stray '&' at byte offset {i}"
            i = m.end()
            continue
        i += 1
    return f"Can't find end tag for <{stack[-1]}>" if stack else None


def strip_tags(text):
    import html
    return html.unescape(_TAG.sub('', text))


def _rcon_server(port, log):
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', port))
    srv.listen()
    while True:
        c, _ = srv.accept()

        def rd():
            n = struct.unpack('<i', c.recv(4))[0]
            d = b''
            while len(d) < n:
                d += c.recv(n - len(d))
            return struct.unpack('<ii', d[:8]) + (d[8:-2].decode(),)

        def wr(rid, body):
            p = struct.pack('<ii', rid, 2) + body.encode() + b'\0\0'
            c.sendall(struct.pack('<i', len(p)) + p)

        rid, _, pw = rd()
        wr(rid if pw == 'testpw' else -1, '')
        rid, _, cmd = rd()
        log.append(cmd)
        wr(rid, '')
        c.close()


def start(workdir, mc_dir, owner=1000, names=None, rcon_port=25597):
    os.makedirs(workdir, exist_ok=True)
    os.chdir(workdir)
    ctx = Ctx()
    ctx.tg_log, ctx.webhook_log, ctx.rcon_log, ctx.answers = [], [], [], {}
    ctx.names = names or {}
    msg_id = [100]
    threading.Thread(target=_rcon_server, args=(rcon_port, ctx.rcon_log), daemon=True).start()
    os.environ.update(BOT_TOKEN='1:x', ADMIN_ID=str(owner), DISCORD_WEBHOOK_URL='http://discord/main',
                      CONSOLE_WEBHOOK_URL='http://discord/console', RCON_PORT=str(rcon_port),
                      RCON_PASSWORD='testpw', MC_SERVER_DIR=mc_dir)

    import requests
    from telebot import apihelper, types
    ctx.types = types

    ctx.blocked_chats = set()   # игроки, заблокировавшие бота: Telegram отвечает 403
    ctx.no_photo = set()        # у кого нет аватарки
    ctx.members = set()         # кто подписан на группу
    ctx.bot_not_admin = False   # бот не админ группы: проверка подписки невозможна
    ctx.tg_errors = []          # ошибки, которые вернул бы настоящий Telegram
    ctx.messages = {}           # (chat_id, message_id) -> (text, markup) — чтобы ловить «message is not modified»

    def fail(method_name, code, description):
        from telebot.apihelper import ApiTelegramException
        ctx.tg_errors.append((method_name, description))
        raise ApiTelegramException(method_name, None, {'error_code': code, 'description': description})

    def fake_request(token, method_name, method='get', params=None, files=None, **kw):
        params = params or {}
        ctx.tg_log.append((method_name, params))
        if method_name == 'answerCallbackQuery':
            ctx.answers[params['callback_query_id']] = (params.get('text'), params.get('show_alert'))
            return True
        if method_name == 'getChat':
            cid = int(params['chat_id'])
            return {'id': cid, 'type': 'private', 'first_name': ctx.names.get(cid, 'Имя'), 'username': f"u{cid}"}
        if method_name == 'getUserProfilePhotos':
            return {'total_count': 0 if int(params['user_id']) in ctx.no_photo else 1, 'photos': []}
        if method_name == 'getChatMember':
            uid = int(params['user_id'])
            if ctx.bot_not_admin:
                fail(method_name, 400, 'Bad Request: member list is inaccessible')
            return {'status': 'member' if uid in ctx.members else 'left',
                    'user': {'id': uid, 'is_bot': False, 'first_name': 'X'}}
        chat = params.get('chat_id')
        if chat is not None and int(chat) in ctx.blocked_chats and method_name.startswith('send'):
            fail(method_name, 403, 'Forbidden: bot was blocked by the user')
        if method_name in ('sendMessage', 'editMessageText'):
            text = params.get('text', '')
            markup = params.get('reply_markup')
            if not str(text).strip():
                fail(method_name, 400, 'Bad Request: text must be non-empty')
            problem = html_problem(text) if params.get('parse_mode') == 'HTML' else None
            if problem:
                fail(method_name, 400, f"Bad Request: can't parse entities: {problem}")
            plain = strip_tags(text) if params.get('parse_mode') == 'HTML' else text
            if len(plain) > 4096:
                fail(method_name, 400, 'Bad Request: message is too long')
            if method_name == 'editMessageText':
                if markup and 'inline_keyboard' not in str(markup):
                    fail(method_name, 400, 'Bad Request: inline keyboard expected')
                key = (int(chat), int(params['message_id']))
                if ctx.messages.get(key) == (text, markup):
                    fail(method_name, 400, 'Bad Request: message is not modified')
                ctx.messages[key] = (text, markup)
        if method_name in ('sendMessage', 'sendPhoto', 'editMessageText', 'sendDocument'):
            msg_id[0] += 1
            mid = int(params.get('message_id', msg_id[0]))
            if method_name == 'sendMessage':
                ctx.messages[(int(chat), mid)] = (params.get('text', ''), params.get('reply_markup'))
            return {'message_id': mid, 'date': 0,
                    'chat': {'id': int(params['chat_id']), 'type': 'private'}, 'text': params.get('text', '')}
        return True

    apihelper._make_request = fake_request
    requests.post = lambda url, json=None, timeout=None, **kw: ctx.webhook_log.append((url, json))

    sys.path.insert(0, BOT_DIR)
    spec = importlib.util.spec_from_file_location('bot', os.path.join(BOT_DIR, 'bot.py'))
    bot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bot)
    bot.run_in_background = lambda f, *a, **k: f(*a, **k)  # в тестах всё синхронно
    ctx.bot = bot

    def press(who, data, text='panel', mid=50):
        cid = f"q{len(ctx.answers)}_{who}_{data}"
        call = types.CallbackQuery.de_json({
            'id': cid, 'from': {'id': who, 'is_bot': False, 'first_name': ctx.names.get(who, 'X'), 'username': f'u{who}'},
            'chat_instance': 'x', 'data': data,
            'message': {'message_id': mid, 'date': 0, 'chat': {'id': who, 'type': 'private'}, 'text': text}})
        ctx.tg_log.clear()
        bot.callback_handler(call)
        return ctx.answers.get(cid, (None, None)), list(ctx.tg_log)

    def say(who, text, mid=70):
        m = types.Message.de_json({
            'message_id': mid, 'date': 0, 'chat': {'id': who, 'type': 'private'},
            'from': {'id': who, 'is_bot': False, 'first_name': ctx.names.get(who, 'X'), 'username': f'u{who}'},
            'text': text})
        ctx.tg_log.clear()
        commands = {'start': 'start_cmd', 'id': 'id_cmd', 'admin': 'admin_cmd', 'status': 'status_cmd',
                    'history': 'history_cmd', 'block': 'block_user', 'unblock': 'unblock_user',
                    'pause': 'pause_reg', 'resume': 'resume_reg', 'stopreply': 'stopreply_cmd'}
        name = text[1:].split()[0] if text.startswith('/') else None
        if name in commands:
            getattr(bot, commands[name])(m)
        else:
            bot.handle_all_messages(m)
        return list(ctx.tg_log)

    def photo(who, caption=''):
        m = types.Message.de_json({
            'message_id': 90, 'date': 0, 'chat': {'id': who, 'type': 'private'},
            'from': {'id': who, 'is_bot': False, 'first_name': ctx.names.get(who, 'X')},
            'photo': [{'file_id': 'ph1', 'file_unique_id': 'u1', 'width': 10, 'height': 10}], 'caption': caption})
        ctx.tg_log.clear()
        bot.handle_photo(m)
        return list(ctx.tg_log)

    ctx.press, ctx.say, ctx.photo = press, say, photo
    return ctx


def make_mc(mc_dir):
    """Папка «сервера» с банами: AdvancedBanX, ванильные списки, база AuthMe. Данные выдуманные."""
    import sqlite3
    data = os.path.join(mc_dir, 'plugins', 'AdvancedBanX', 'data')
    os.makedirs(data, exist_ok=True)
    os.makedirs(os.path.join(mc_dir, 'plugins', 'AuthMe'), exist_ok=True)
    reason = "\\u0413\\u0440\\u0438\\u0444"  # «Гриф» так, как его пишет HSQLDB
    with open(os.path.join(data, 'storage.script'), 'w', encoding='utf-8') as f:
        f.write("CREATE MEMORY TABLE PUBLIC.PUNISHMENTS(ID INTEGER)\n"
                "INSERT INTO PUNISHMENTS VALUES(1,'jojo111','jojo111','Cheats','Steve','BAN',1775932914100,-1,'')\n"
                f"INSERT INTO PUNISHMENTS VALUES(2,'artiom83','artiom83','{reason}','Steve','TEMP_BAN',1777325353713,4102444800000,'')\n"
                "INSERT INTO PUNISHMENTS VALUES(3,'10.9.9.9','10.9.9.9','Twinks','Steve','IP_BAN',1775512546003,-1,'')\n"
                "INSERT INTO PUNISHMENTS VALUES(4,'expired1','expired1','Old','Steve','TEMP_BAN',1700000000000,1700000100000,'')\n"
                "INSERT INTO PUNISHMENTHISTORY VALUES(1,'jojo111','jojo111','Cheats','Steve','BAN',1775932914100,-1,'')\n"
                "INSERT INTO PUNISHMENTHISTORY VALUES(9,'oldbad','oldbad','Spam','Steve','TEMP_MUTE',1700000000000,1700000100000,'')\n")
    with open(os.path.join(data, 'storage.log'), 'w', encoding='utf-8') as f:
        f.write("/*C2*/SET SCHEMA PUBLIC\n"
                "INSERT INTO PUNISHMENTS VALUES(5,'unbanned','unbanned','x','Steve','BAN',1775932914100,-1,'')\n"
                "DELETE FROM PUNISHMENTS WHERE ID=5\n")
    with open(os.path.join(mc_dir, 'banned-players.json'), 'w', encoding='utf-8') as f:
        json.dump([{"name": "artiom83", "created": "2026-04-28 00:29:13 +0300", "source": "Steve",
                    "expires": "2099-04-28 00:29:13 +0300", "reason": "Гриф"},
                   {"name": "VanillaGuy", "created": "2026-04-01 12:00:00 +0300", "source": "Console",
                    "expires": "forever", "reason": "Ванильный бан"}], f, ensure_ascii=False)
    with open(os.path.join(mc_dir, 'banned-ips.json'), 'w', encoding='utf-8') as f:
        json.dump([], f)
    db = sqlite3.connect(os.path.join(mc_dir, 'plugins', 'AuthMe', 'authme.db'))
    db.execute("CREATE TABLE IF NOT EXISTS authme (id INTEGER, username VARCHAR(255), realname VARCHAR(255), "
               "password VARCHAR(255), ip VARCHAR(40), lastlogin BIGINT, regip VARCHAR(40), regdate BIGINT)")
    db.execute("DELETE FROM authme")
    db.execute("INSERT INTO authme VALUES (1,'oldtwink','OldTwink','hash','10.9.9.9',1775932914100,'10.9.9.9',1775000000000)")
    db.commit()
    db.close()


def sent_to(log, chat, method='sendMessage'):
    return [p.get('text', '') for m, p in log if m == method and str(p.get('chat_id')) == str(chat)]


def edited(log):
    return [(int(p['chat_id']), p.get('text', '')) for m, p in log if m == 'editMessageText']


def buttons(log, chat=None):
    out = []
    for m, p in log:
        if chat is not None and str(p.get('chat_id')) != str(chat):
            continue
        mk = p.get('reply_markup')
        if mk:
            mk = json.loads(mk) if isinstance(mk, str) else mk
            for row in mk.get('inline_keyboard', []):
                out += [b['text'] for b in row]
    return out
