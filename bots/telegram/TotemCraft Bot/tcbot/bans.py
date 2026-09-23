"""Поиск наказаний игрока на сервере: AdvancedBanX и ванильный список банов, только по нику.

По IP не ищем: через обратный прокси в России игровой сервер видит разных людей с одним IP,
и бан одного оказался бы у всех. Записи IP-банов AdvancedBanX хранят только IP, ника в них нет.

Только чтение файлов сервера. Каждый источник читается отдельно: сбой одного не мешает остальным.
Время в результатах — datetime в UTC.
"""
import json
import os
import re
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone

from . import config, timeutil
from .logs import log_error

ABX_DATA_DIR = os.path.join(config.MC_SERVER_DIR, 'plugins', 'AdvancedBanX', 'data')
AUTHME_DB = os.path.join(config.MC_SERVER_DIR, 'plugins', 'AuthMe', 'authme.db')

PUNISHMENT_NAMES = {
    'BAN': 'бан', 'TEMP_BAN': 'временный бан',
    'IP_BAN': 'бан по IP', 'TEMP_IP_BAN': 'временный бан по IP',
    'MUTE': 'мут', 'TEMP_MUTE': 'временный мут',
    'WARNING': 'предупреждение', 'TEMP_WARNING': 'временное предупреждение',
    'KICK': 'кик', 'NOTE': 'заметка',
}
BAN_TYPES = {'BAN', 'TEMP_BAN', 'IP_BAN', 'TEMP_IP_BAN'}

_SQL_ROW = re.compile(r'^(?:/\*C\d+\*/)?INSERT INTO (PUNISHMENTS|PUNISHMENTHISTORY) VALUES\((.*)\)\s*$')
_SQL_DEL = re.compile(r'^(?:/\*C\d+\*/)?DELETE FROM (PUNISHMENTS|PUNISHMENTHISTORY) WHERE ID=(\d+)\s*$')
_abx_cache = {'key': None, 'data': None}


def _parse_sql_values(s):
    """Разбирает список значений из строки INSERT базы HSQLDB: числа, NULL и строки в кавычках."""
    vals, i = [], 0
    while i < len(s):
        if s[i] == "'":
            j, buf = i + 1, []
            while True:
                if s[j] == "'":
                    if j + 1 < len(s) and s[j + 1] == "'":
                        buf.append("'"); j += 2; continue
                    break
                buf.append(s[j]); j += 1
            vals.append(re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), ''.join(buf)))
            i = j + 1
        else:
            j = s.find(',', i)
            j = len(s) if j == -1 else j
            tok = s[i:j].strip()
            vals.append(None if tok == 'NULL' else int(tok) if re.fullmatch(r'-?\d+', tok) else tok)
            i = j
        if i < len(s) and s[i] == ',':
            i += 1
    return vals


def read_advancedban():
    """Читает базу AdvancedBanX (файлы storage.script и storage.log). Возвращает (активные, история).
    Результат кэшируется, пока файлы не изменились."""
    files = [os.path.join(ABX_DATA_DIR, 'storage.script'), os.path.join(ABX_DATA_DIR, 'storage.log')]
    key = tuple((os.path.getmtime(p), os.path.getsize(p)) if os.path.exists(p) else None for p in files)
    if key[0] is None:
        raise FileNotFoundError(f"нет файла {files[0]}")
    if _abx_cache['key'] == key:
        return _abx_cache['data']
    tables = {'PUNISHMENTS': {}, 'PUNISHMENTHISTORY': {}}
    for path in files:
        if not os.path.exists(path):
            continue
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                m = _SQL_ROW.match(line)
                if m:
                    v = _parse_sql_values(m.group(2))
                    if len(v) >= 8:
                        tables[m.group(1)][v[0]] = {'name': v[1] or '', 'uuid': v[2] or '', 'reason': v[3] or '',
                                                    'operator': v[4] or '', 'type': v[5] or '', 'start': v[6], 'end': v[7]}
                    continue
                m = _SQL_DEL.match(line)
                if m:
                    tables[m.group(1)].pop(int(m.group(2)), None)
    data = (list(tables['PUNISHMENTS'].values()), list(tables['PUNISHMENTHISTORY'].values()))
    _abx_cache.update(key=key, data=data)
    return data


def authme_accounts(nicks):
    """Строки аккаунтов AuthMe по никам: username, ip, regip, regdate (мс), lastlogin (мс)."""
    if not nicks:
        return []
    q = (f"SELECT username, ip, regip, regdate, lastlogin FROM authme "
         f"WHERE LOWER(username) IN ({','.join('?' * len(nicks))})")
    args = [n.lower() for n in nicks]
    try:
        with closing(sqlite3.connect('file:' + AUTHME_DB + '?mode=ro', uri=True, timeout=5)) as db:
            return db.execute(q, args).fetchall()
    except sqlite3.OperationalError:
        # Бот не может писать в папку AuthMe: читаем файл как есть, без блокировок
        with closing(sqlite3.connect('file:' + AUTHME_DB + '?immutable=1', uri=True, timeout=5)) as db:
            return db.execute(q, args).fetchall()


def _vanilla_dt(s):
    """Дата из banned-players.json ('2026-04-11 13:16:31 +0300') -> UTC; 'forever'/пусто -> None."""
    if not s or s == 'forever':
        return None
    try:
        return datetime.strptime(s, '%Y-%m-%d %H:%M:%S %z').astimezone(timezone.utc)
    except ValueError:
        return None


def find(nicks):
    """Все наказания по никам (без поиска по IP, см. начало файла).
    Возвращает (активные, прошлые, ошибки):
      активные — список словарей icon/who/kind/until/reason/operator/start/sources (until=None — навсегда);
      прошлые (сняты или истекли) — такие же словари, чтобы было видно ник, причину и кто выдал;
      ошибки — список строк «что не прочиталось: причина»."""
    lower = {n.lower() for n in nicks if n}
    items, errors = {}, []

    def add(icon, who, kind, until, reason, operator, start, source):
        # AdvancedBanX копирует баны в ванильный список: одинаковые записи склеиваем
        key = (who.lower(), reason, start.strftime('%Y%m%d%H%M') if start else '')
        if key in items:
            if source not in items[key]['sources']:
                items[key]['sources'].append(source)
        else:
            items[key] = dict(icon=icon, who=who, kind=kind, until=until, reason=reason,
                              operator=operator, start=start, sources=[source])

    past = []
    try:
        active, history = read_advancedban()
        now_ms = time.time() * 1000
        active_ids = set()
        for p in active:
            if not (p['name'].lower() in lower or p['uuid'].lower() in lower):
                continue
            if isinstance(p['end'], int) and p['end'] != -1 and p['end'] < now_ms:
                continue  # срок уже вышел, плагин просто ещё не убрал запись
            active_ids.add((p['name'], p['start']))
            icon = '🚫' if p['type'] in BAN_TYPES else ('🔇' if 'MUTE' in p['type'] else '⚠️')
            add(icon, p['name'], PUNISHMENT_NAMES.get(p['type'], p['type']),
                None if p['end'] in (-1, None) else timeutil.from_ms(p['end']),
                p['reason'], p['operator'], timeutil.from_ms(p['start']) if p['start'] else None, 'AdvancedBanX')
        for p in history:
            if (p['name'], p['start']) in active_ids or p['type'] in ('NOTE', 'KICK'):
                continue
            if p['name'].lower() in lower or p['uuid'].lower() in lower:
                # end в прошлом — срок вышел сам; иначе наказание сняли вручную (кто снял, плагин не пишет)
                expired = isinstance(p['end'], int) and 0 < p['end'] < now_ms
                past.append(dict(icon='🕘', who=p['name'], kind=PUNISHMENT_NAMES.get(p['type'], p['type']),
                                 until=None if p['end'] in (-1, None) else timeutil.from_ms(p['end']),
                                 reason=p['reason'], operator=p['operator'], expired=expired,
                                 start=timeutil.from_ms(p['start']) if p['start'] else None,
                                 sources=['AdvancedBanX']))
    except Exception as e:
        log_error(e)
        errors.append(f"AdvancedBanX: {e}")

    now = datetime.now(timezone.utc)
    for fname in ('banned-players.json',):  # banned-ips.json не читаем: там только IP, без ника
        try:
            with open(os.path.join(config.MC_SERVER_DIR, fname), 'r', encoding='utf-8') as f:
                entries = json.load(f)
            for b in entries:
                value = str(b.get('name', ''))
                if value.lower() not in lower:
                    continue
                until = _vanilla_dt(b.get('expires'))
                if until and until < now:
                    continue
                add('🚫', value, 'бан', until,
                    b.get('reason', ''), b.get('source', ''), _vanilla_dt(b.get('created')), fname)
        except Exception as e:
            log_error(e)
            errors.append(f"{fname}: {e}")

    past.sort(key=lambda it: it['start'] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return list(items.values()), past, errors
