"""Хранилище бота: одна база SQLite (bot.db).

Время в базе — UTC ISO 8601. Запись атомарная: либо изменение целиком, либо никак.
Схема обновляется по номеру версии (таблица meta), старые файлы JSON/CSV переносятся один раз.
"""
import csv
import glob
import json
import os
import shutil
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime

from . import config, timeutil
from .logs import log_error, log_warning

SCHEMA_VERSION = 2
LEGACY_DIR = 'legacy_files'  # сюда переезжают старые файлы после переноса в базу

_lock = threading.RLock()
_conn = None


def conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_FILE, timeout=10, check_same_thread=False, isolation_level=None)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


@contextmanager
def transaction():
    """Всё внутри — одна транзакция: при ошибке ничего не записывается."""
    with _lock:
        c = conn()
        try:
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise


def query(sql, params=()):
    with _lock:
        return conn().execute(sql, params).fetchall()


def execute(sql, params=()):
    with transaction() as c:
        cur = c.execute(sql, params)
        return cur.lastrowid


# ---------- Схема ----------
def _v1(c):
    """Таблицы, которые уже были на сервере до версии 2 (команда, журнал, уведомления)."""
    c.execute("""CREATE TABLE IF NOT EXISTS staff (tg_id INTEGER PRIMARY KEY, name TEXT, role TEXT NOT NULL,
                 added_by INTEGER, added_at TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
                 actor_id INTEGER, actor_name TEXT, actor_role TEXT, action TEXT NOT NULL,
                 target_id INTEGER, target_nick TEXT, details TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS audit_actor ON audit(actor_id)")
    c.execute("CREATE INDEX IF NOT EXISTS audit_target ON audit(target_id)")
    c.execute("CREATE TABLE IF NOT EXISTS notices (kind TEXT, ref TEXT, chat_id INTEGER, message_id INTEGER, text TEXT)")


def _v2(c):
    """Все данные бота в базе, время в UTC, пояс у каждого админа."""
    cols = [r[1] for r in c.execute("PRAGMA table_info(staff)")]
    if 'tz' not in cols:
        c.execute("ALTER TABLE staff ADD COLUMN tz TEXT")
    c.execute("""CREATE TABLE IF NOT EXISTS applications (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 created_at TEXT, decided_at TEXT, tg_id INTEGER, tg_username TEXT, nick TEXT,
                 status TEXT, player_comment TEXT, admin_comment TEXT,
                 decided_by INTEGER, decided_by_name TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS applications_tg ON applications(tg_id)")
    c.execute("CREATE INDEX IF NOT EXISTS applications_nick ON applications(nick COLLATE NOCASE)")
    c.execute("""CREATE TABLE IF NOT EXISTS messages (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, sender TEXT NOT NULL,
                 staff_id INTEGER, staff_name TEXT, text TEXT, created_at TEXT NOT NULL)""")
    c.execute("CREATE INDEX IF NOT EXISTS messages_tg ON messages(tg_id, id)")
    c.execute("""CREATE TABLE IF NOT EXISTS kv (space TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
                 PRIMARY KEY (space, key))""")
    c.execute("CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts)")
    # Журнал и команда до версии 2 писали время по Москве без пояса — переводим в UTC
    for row_id, ts in c.execute("SELECT id, ts FROM audit").fetchall():
        if ts and '+' not in ts:
            c.execute("UPDATE audit SET ts=? WHERE id=?",
                      (timeutil.legacy_to_iso(ts.replace(' ', 'T')) or ts, row_id))
    for tg_id, added_at in c.execute("SELECT tg_id, added_at FROM staff").fetchall():
        if added_at and '+' not in added_at:
            c.execute("UPDATE staff SET added_at=? WHERE tg_id=?",
                      (timeutil.legacy_to_iso(added_at, '%Y-%m-%d %H:%M') or added_at, tg_id))
    _import_legacy_files(c)


MIGRATIONS = {1: _v1, 2: _v2}


def migrate():
    """Доводит базу до последней версии. Каждая версия — отдельная транзакция."""
    with _lock:
        conn().execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        row = conn().execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        version = int(row[0]) if row else 0
        if version == 0 and conn().execute("SELECT name FROM sqlite_master WHERE name='staff'").fetchone():
            version = 1  # база от прошлой версии бота, без таблицы meta
        imported = []
        if 0 < version < SCHEMA_VERSION:
            backup(suffix=f"before-v{SCHEMA_VERSION}")  # копия базы до обновления схемы
        for v in range(version + 1, SCHEMA_VERSION + 1):
            with transaction() as c:
                MIGRATIONS[v](c)
                c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", (str(v),))
            imported.append(v)
        if 2 in imported:
            _move_legacy_files()
        return imported


# ---------- Перенос старых файлов (один раз, внутри транзакции миграции) ----------
LEGACY_FILES = ['pending.json', 'approved_applications.csv', 'bot_config.json', 'blocked_users.json',
                'chat_history.json', 'message_queue.json', 'last_application.json', 'tickets.json', 'admin_panel.json']


def _load_json(name, default):
    if not os.path.exists(name):
        return default
    with open(name, 'r', encoding='utf-8') as f:
        return json.load(f)


def _kv_put(c, space, key, value):
    c.execute("INSERT OR REPLACE INTO kv (space, key, value) VALUES (?,?,?)",
              (space, str(key), json.dumps(value, ensure_ascii=False)))


def _import_legacy_files(c):
    pending = _load_json('pending.json', {})
    for key, app in pending.items():
        app = dict(app)
        app['date'] = timeutil.legacy_to_iso(app.get('date')) or timeutil.now_iso()
        _kv_put(c, 'pending', key, app)

    if os.path.exists('approved_applications.csv'):
        with open('approved_applications.csv', 'r', newline='', encoding='utf-8-sig') as f:
            rows = list(csv.reader(f))[1:]
        for r in rows:
            if len(r) < 6 or not r[0]:
                continue
            r = r + [''] * (9 - len(r))
            c.execute("""INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status,
                         player_comment, admin_comment, decided_by, decided_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                      (None, timeutil.legacy_to_iso(r[0]), int(r[2]) if r[2].strip().isdigit() else None,
                       r[1], r[3], r[5], r[6], r[7], None, r[8] or None))

    cfg = _load_json('bot_config.json', {})
    _kv_put(c, 'settings', 'paused', bool(cfg.get('paused', False)))

    for uid in _load_json('blocked_users.json', []):
        _kv_put(c, 'blocked', int(uid), True)
    for uid in _load_json('message_queue.json', []):
        _kv_put(c, 'unread', str(uid), True)

    for uid, ts in _load_json('last_application.json', {}).items():
        iso = timeutil.legacy_to_iso(ts)
        if iso:
            _kv_put(c, 'last_application', uid, iso)

    tickets = _load_json('tickets.json', {'counter': 0, 'tickets': {}})
    _kv_put(c, 'settings', 'ticket_counter', int(tickets.get('counter', 0)))
    for uid, t in tickets.get('tickets', {}).items():
        t = dict(t)
        t['date'] = timeutil.legacy_to_iso(t.get('date'), '%Y-%m-%d %H:%M') or timeutil.now_iso()
        _kv_put(c, 'tickets', uid, t)

    for uid, msgs in _load_json('chat_history.json', {}).items():
        if not str(uid).lstrip('-').isdigit():
            continue
        for m in msgs:
            c.execute("""INSERT INTO messages (tg_id, sender, staff_id, staff_name, text, created_at)
                         VALUES (?,?,?,?,?,?)""",
                      (int(uid), 'user' if m.get('from') == 'user' else 'admin', None, m.get('by'),
                       m.get('text', ''), timeutil.legacy_to_iso(m.get('time'), '%Y-%m-%d %H:%M:%S') or timeutil.now_iso()))


def _move_legacy_files():
    """После успешного переноса старые файлы откладываются в legacy_files/ (не удаляются)."""
    found = [f for f in LEGACY_FILES if os.path.exists(f)]
    if not found:
        return
    os.makedirs(LEGACY_DIR, exist_ok=True)
    for f in found:
        try:
            shutil.move(f, os.path.join(LEGACY_DIR, f))
        except OSError as e:
            log_error(e)


# ---------- Словарь и множество, которые сразу пишутся в базу ----------
class PersistentDict:
    """Ведёт себя как dict, но каждое изменение сразу записывается в таблицу kv."""

    def __init__(self, space, key_type=str):
        self.space, self.key_type = space, key_type
        self._data = {}
        self.reload()

    def reload(self):
        rows = query("SELECT key, value FROM kv WHERE space=?", (self.space,))
        self._data = {self.key_type(k): json.loads(v) for k, v in rows}

    def _put(self, key, value):
        execute("INSERT OR REPLACE INTO kv (space, key, value) VALUES (?,?,?)",
                (self.space, str(key), json.dumps(value, ensure_ascii=False)))

    def __setitem__(self, key, value):
        key = self.key_type(key)
        self._put(key, value)
        self._data[key] = value

    def __getitem__(self, key):
        return self._data[self.key_type(key)]

    def __delitem__(self, key):
        key = self.key_type(key)
        execute("DELETE FROM kv WHERE space=? AND key=?", (self.space, str(key)))
        del self._data[key]

    def __contains__(self, key):
        try:
            return self.key_type(key) in self._data
        except (TypeError, ValueError):
            return False

    def __len__(self):
        return len(self._data)

    def __iter__(self):
        return iter(list(self._data))

    def get(self, key, default=None):
        try:
            return self._data.get(self.key_type(key), default)
        except (TypeError, ValueError):
            return default

    def pop(self, key, *default):
        key = self.key_type(key)
        if key in self._data:
            execute("DELETE FROM kv WHERE space=? AND key=?", (self.space, str(key)))
            return self._data.pop(key)
        if default:
            return default[0]
        raise KeyError(key)

    def items(self):
        return list(self._data.items())

    def keys(self):
        return list(self._data.keys())

    def values(self):
        return list(self._data.values())

    def clear(self):
        execute("DELETE FROM kv WHERE space=?", (self.space,))
        self._data.clear()

    def sync(self):
        """Переписать всё содержимое (после изменения вложенных значений на месте)."""
        with transaction() as c:
            c.execute("DELETE FROM kv WHERE space=?", (self.space,))
            for k, v in self._data.items():
                c.execute("INSERT INTO kv (space, key, value) VALUES (?,?,?)",
                          (self.space, str(k), json.dumps(v, ensure_ascii=False)))


class PersistentSet:
    """Ведёт себя как set, каждое изменение сразу записывается в таблицу kv."""

    def __init__(self, space, item_type=str):
        self.space, self.item_type = space, item_type
        self._data = {item_type(k) for (k,) in query("SELECT key FROM kv WHERE space=?", (space,))}

    def add(self, item):
        item = self.item_type(item)
        execute("INSERT OR REPLACE INTO kv (space, key, value) VALUES (?,?,'true')", (self.space, str(item)))
        self._data.add(item)

    def discard(self, item):
        item = self.item_type(item)
        if item in self._data:
            execute("DELETE FROM kv WHERE space=? AND key=?", (self.space, str(item)))
            self._data.discard(item)

    def remove(self, item):
        if self.item_type(item) not in self._data:
            raise KeyError(item)
        self.discard(item)

    def clear(self):
        execute("DELETE FROM kv WHERE space=?", (self.space,))
        self._data.clear()

    def __contains__(self, item):
        try:
            return self.item_type(item) in self._data
        except (TypeError, ValueError):
            return False

    def __len__(self):
        return len(self._data)

    def __iter__(self):
        return iter(list(self._data))

    def sync(self):
        pass  # всё и так записано


def setting(key, default=None):
    rows = query("SELECT value FROM kv WHERE space='settings' AND key=?", (key,))
    return json.loads(rows[0][0]) if rows else default


def set_setting(key, value):
    execute("INSERT OR REPLACE INTO kv (space, key, value) VALUES ('settings', ?, ?)",
            (key, json.dumps(value, ensure_ascii=False)))


def next_counter(key):
    """Атомарно увеличивает счётчик (номер тикета и т.п.) и возвращает новое значение."""
    with transaction() as c:
        row = c.execute("SELECT value FROM kv WHERE space='settings' AND key=?", (key,)).fetchone()
        value = (json.loads(row[0]) if row else 0) + 1
        c.execute("INSERT OR REPLACE INTO kv (space, key, value) VALUES ('settings', ?, ?)", (key, json.dumps(value)))
        return value


# ---------- История заявок ----------
APP_COLUMNS = "id, created_at, decided_at, tg_id, tg_username, nick, status, player_comment, admin_comment, decided_by, decided_by_name"


def add_application(app, status, admin_comment, decided_by, decided_by_name):
    return execute("""INSERT INTO applications (created_at, decided_at, tg_id, tg_username, nick, status,
                       player_comment, admin_comment, decided_by, decided_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                   (app.get('date'), timeutil.now_iso(), int(app['user_id']), app.get('username', ''), app['nick'],
                    status, app.get('comment', ''), admin_comment, decided_by, decided_by_name))


def applications(where="", params=(), order="id"):
    """Заявки из истории как словари."""
    rows = query(f"SELECT {APP_COLUMNS} FROM applications {where} ORDER BY {order}", params)
    keys = [k.strip() for k in APP_COLUMNS.split(',')]
    return [dict(zip(keys, r)) for r in rows]


def clear_applications():
    execute("DELETE FROM applications")


def export_applications_csv(path):
    """Выгрузка истории заявок в CSV (для Excel). Паролей там нет."""
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['Подана (UTC)', 'Решение (UTC)', 'TG_ID', 'TG_Username', 'Ник', 'Статус',
                    'Комментарий игрока', 'Комментарий админа', 'Рассмотрел'])
        for a in applications():
            w.writerow([a['created_at'] or '', a['decided_at'] or '', a['tg_id'] or '', a['tg_username'] or '',
                        a['nick'], a['status'], a['player_comment'] or '', a['admin_comment'] or '',
                        a['decided_by_name'] or ''])


# ---------- Переписка ----------
def add_message(tg_id, sender, text, staff_id=None, staff_name=None):
    execute("INSERT INTO messages (tg_id, sender, staff_id, staff_name, text, created_at) VALUES (?,?,?,?,?,?)",
            (int(tg_id), sender, staff_id, staff_name, text, timeutil.now_iso()))


def get_messages(tg_id, limit=20):
    """Последние сообщения переписки, старые сверху. Формат как раньше: from/text/time/by."""
    rows = query("SELECT sender, text, created_at, staff_name FROM messages WHERE tg_id=? ORDER BY id DESC LIMIT ?",
                 (int(tg_id), limit))
    return [{'from': s, 'text': t, 'time': ts, 'by': n or ''} for s, t, ts, n in reversed(rows)]


def message_count(tg_id):
    return query("SELECT COUNT(*) FROM messages WHERE tg_id=?", (int(tg_id),))[0][0]


def message_users():
    """Кто писал: {tg_id (str): время последнего сообщения}."""
    return {str(uid): ts for uid, ts in query("SELECT tg_id, MAX(created_at) FROM messages GROUP BY tg_id")}


def clear_messages():
    execute("DELETE FROM messages")


# ---------- Копии базы ----------
def backup(suffix=None):
    """Копия базы в backups/bot-ГГГГ-ММ-ДД.db (хранится BACKUP_KEEP_DAYS последних)
    или в backups/bot-<suffix>.db для разовой копии (не удаляется)."""
    os.makedirs(config.BACKUP_DIR, exist_ok=True)
    name = f"bot-{suffix}.db" if suffix else f"bot-{datetime.now().strftime('%Y-%m-%d')}.db"
    target = os.path.join(config.BACKUP_DIR, name)
    with _lock:
        dst = sqlite3.connect(target)
        try:
            conn().backup(dst)
        finally:
            dst.close()
    files = sorted(glob.glob(os.path.join(config.BACKUP_DIR, 'bot-[0-9][0-9][0-9][0-9]-*.db')))
    for old in files[:-config.BACKUP_KEEP_DAYS]:
        try:
            os.remove(old)
        except OSError as e:
            log_warning(f"не удалось удалить старую копию {old}: {e}")
    return target
