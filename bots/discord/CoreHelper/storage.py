"""SQLite: память сообщений (чтобы показать текст удалённого) и голосовые комнаты."""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY,
    channel_id  INTEGER NOT NULL,
    author_id   INTEGER NOT NULL,
    author_name TEXT NOT NULL,
    content     TEXT NOT NULL,
    attachments INTEGER NOT NULL DEFAULT 0,
    created     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_created ON messages(created);
CREATE TABLE IF NOT EXISTS rooms (
    channel_id INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL,
    number     INTEGER NOT NULL
);
"""


class Storage:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)
        self.db.commit()

    # ── сообщения ────────────────────────────────────────────────
    def save_message(self, msg_id, channel_id, author_id, author_name, content, attachments):
        self.db.execute(
            "INSERT OR REPLACE INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)",
            (msg_id, channel_id, author_id, author_name, content, attachments, time.time()),
        )
        self.db.commit()

    def get_message(self, msg_id):
        row = self.db.execute(
            "SELECT channel_id, author_id, author_name, content, attachments FROM messages WHERE id = ?",
            (msg_id,),
        ).fetchone()
        if not row:
            return None
        return dict(zip(("channel_id", "author_id", "author_name", "content", "attachments"), row))

    def update_content(self, msg_id, content):
        self.db.execute("UPDATE messages SET content = ? WHERE id = ?", (content, msg_id))
        self.db.commit()

    def forget_message(self, msg_id):
        self.db.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
        self.db.commit()

    def prune_messages(self, max_age_days: int) -> int:
        cur = self.db.execute("DELETE FROM messages WHERE created < ?", (time.time() - max_age_days * 86400,))
        self.db.commit()
        return cur.rowcount

    # ── голосовые комнаты ────────────────────────────────────────
    def add_room(self, channel_id, owner_id, number):
        self.db.execute("INSERT OR REPLACE INTO rooms VALUES (?, ?, ?)", (channel_id, owner_id, number))
        self.db.commit()

    def remove_room(self, channel_id):
        self.db.execute("DELETE FROM rooms WHERE channel_id = ?", (channel_id,))
        self.db.commit()

    def rooms(self) -> dict[int, tuple[int, int]]:
        """{channel_id: (owner_id, number)}"""
        return {c: (o, n) for c, o, n in self.db.execute("SELECT channel_id, owner_id, number FROM rooms")}
