import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logic
from storage import Storage


class ThreadTitle(unittest.TestCase):
    def test_first_line(self):
        self.assertEqual(logic.thread_title("хаммам\nвторая строка", "Комментарии"), "хаммам")

    def test_empty_gives_fallback(self):
        self.assertEqual(logic.thread_title("", "Комментарии"), "Комментарии")
        self.assertEqual(logic.thread_title("   \n  ", "Комментарии"), "Комментарии")

    def test_only_link_gives_fallback(self):
        self.assertEqual(logic.thread_title("https://youtu.be/x", "Комментарии"), "Комментарии")

    def test_markdown_and_mentions_removed(self):
        self.assertEqual(logic.thread_title("**Бункер** <@123> 14 марта", "x"), "Бункер 14 марта")
        self.assertEqual(logic.thread_title("# Ивент\nтекст", "x"), "Ивент")

    def test_long_title_truncated(self):
        title = logic.thread_title("а" * 300, "x")
        self.assertEqual(len(title), 100)
        self.assertTrue(title.endswith("…"))


class Rooms(unittest.TestCase):
    def test_name_like_lacuna(self):
        self.assertEqual(logic.room_name(2, "captianrage"), "🏠┃#2 - комната игрока captianrage")

    def test_next_number_fills_gaps(self):
        self.assertEqual(logic.next_room_number(set()), 1)
        self.assertEqual(logic.next_room_number({1, 2}), 3)
        self.assertEqual(logic.next_room_number({2, 3}), 1)


class Journal(unittest.TestCase):
    def test_archive_format(self):
        self.assertEqual(logic.format_archive(10080), "168:00:00")
        self.assertEqual(logic.format_archive(60), "1:00:00")
        self.assertEqual(logic.format_archive(None), "-")

    def test_role_diff(self):
        self.assertEqual(logic.role_diff({1, 2}, {2, 3}), ({3}, {1}))

    def test_channel_changes_ignore_position(self):
        self.assertEqual(logic.channel_changes({"name": "a", "position": 1}, {"name": "a", "position": 5}), [])
        self.assertEqual(logic.channel_changes({"topic": "5/50 онлайн"}, {"topic": "6/50 онлайн"}),
                         [("описание", "5/50 онлайн", "6/50 онлайн")])

    def test_message_body(self):
        self.assertEqual(logic.message_body("олух", 0), "олух")
        self.assertEqual(logic.message_body("", 1), "`[Вложение]`")
        self.assertEqual(logic.message_body("", 0), "-")

    def test_timeout(self):
        now = datetime(2026, 10, 12, tzinfo=timezone.utc)
        later = now + timedelta(hours=1)
        self.assertEqual(logic.timeout_change(None, later, now), "given")
        self.assertEqual(logic.timeout_change(later, None, now), "removed")
        self.assertIsNone(logic.timeout_change(None, None, now))
        # мут истёк сам: Дискорд сбрасывает поле, но это не снятие модератором
        self.assertIsNone(logic.timeout_change(now - timedelta(minutes=1), None, now))


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.s = Storage(os.path.join(self.dir.name, "t.db"))

    def tearDown(self):
        self.s.db.close()
        self.dir.cleanup()

    def test_message_roundtrip(self):
        self.s.save_message(1, 10, 20, "negsg", "привет", 0)
        self.s.update_content(1, "пока")
        self.assertEqual(self.s.get_message(1)["content"], "пока")
        self.s.forget_message(1)
        self.assertIsNone(self.s.get_message(1))

    def test_prune(self):
        self.s.save_message(1, 10, 20, "a", "x", 0)
        self.s.db.execute("UPDATE messages SET created = 0")
        self.assertEqual(self.s.prune_messages(30), 1)

    def test_rooms(self):
        self.s.add_room(100, 5, 1)
        self.assertEqual(self.s.rooms(), {100: (5, 1)})
        self.s.remove_room(100)
        self.assertEqual(self.s.rooms(), {})


if __name__ == "__main__":
    unittest.main()
