import aiosqlite
import json
from datetime import datetime, timedelta

DB_PATH = "/home/fishbot/fish.db"

# Обычные уловы всегда дают очки в статистику.
# Легендарные/мифические: 0 очков в catches — их очки идут через fish-таблицу (с привязкой к владельцу).
TIER_POINTS = {
    "common":    1,
    "good":      3,
    "rare":      12,
    "legendary": 0,
    "mythic":    0,
}

ATTR_TIER_BONUS = {
    "common":    0,
    "uncommon":  5,
    "rare":      15,
    "epic":      30,
    "legendary": 60,
    "mythic":    100,
}

BASE_TROPHY_SCORE = {"legendary": 200, "mythic": 600}  # базовый балл по тиру


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS fish (
                fish_id TEXT PRIMARY KEY,
                fish_type TEXT NOT NULL,
                tier TEXT NOT NULL DEFAULT 'mythic',
                caught_by TEXT NOT NULL,
                caught_at DATETIME NOT NULL,
                weight REAL NOT NULL,
                biome TEXT,
                weather TEXT,
                time_of_day TEXT,
                attributes TEXT NOT NULL,
                rarity_score INTEGER NOT NULL,
                combo_id TEXT,
                combo_bonus INTEGER DEFAULT 0,
                current_owner TEXT NOT NULL,
                discord_id TEXT,
                claimed INTEGER DEFAULT 0,
                claimed_at DATETIME,
                discord_message_id TEXT,
                raw_embed TEXT,
                is_released INTEGER DEFAULT 0,
                lore_applied INTEGER DEFAULT 0
            )
        """)
        for col, definition in [
            ("is_released",  "INTEGER DEFAULT 0"),
            ("tier",         "TEXT NOT NULL DEFAULT 'mythic'"),
            ("discord_id",   "TEXT"),
            ("lore_applied", "INTEGER DEFAULT 0"),
        ]:
            try:
                await db.execute(f"ALTER TABLE fish ADD COLUMN {col} {definition}")
            except Exception:
                pass

        await db.execute("""
            CREATE TABLE IF NOT EXISTS catches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player TEXT NOT NULL,
                tier TEXT NOT NULL,
                fish_type TEXT NOT NULL,
                weight REAL NOT NULL,
                caught_at DATETIME NOT NULL,
                points INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS transfers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fish_id TEXT NOT NULL,
                from_owner TEXT NOT NULL,
                to_owner TEXT NOT NULL,
                transferred_at DATETIME NOT NULL,
                FOREIGN KEY (fish_id) REFERENCES fish(fish_id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pending_transfers (
                fish_id TEXT PRIMARY KEY,
                from_player TEXT NOT NULL,
                to_player TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                expires_at DATETIME NOT NULL,
                discord_message_id TEXT
            )
        """)
        await db.commit()


# ── catches ───────────────────────────────────────────────────────

async def save_catch(player: str, tier: str, fish_type: str, weight: float, caught_at: str):
    points = TIER_POINTS.get(tier, 1)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO catches (player, tier, fish_type, weight, caught_at, points)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (player, tier, fish_type, weight, caught_at, points))
        await db.commit()


# ── fish ──────────────────────────────────────────────────────────

async def save_fish(fish_data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO fish (
                fish_id, fish_type, tier, caught_by, caught_at, weight,
                biome, weather, time_of_day, attributes, rarity_score,
                combo_id, combo_bonus, current_owner, discord_id,
                discord_message_id, raw_embed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            fish_data["fish_id"],
            fish_data["fish_type"],
            fish_data.get("tier", "mythic"),
            fish_data["caught_by"],
            fish_data["caught_at"],
            fish_data["weight"],
            fish_data.get("biome"),
            fish_data.get("weather"),
            fish_data.get("time_of_day"),
            json.dumps(fish_data["attributes"], ensure_ascii=False),
            fish_data["rarity_score"],
            fish_data.get("combo_id"),
            fish_data.get("combo_bonus", 0),
            fish_data["caught_by"],
            fish_data.get("discord_id"),
            fish_data.get("discord_message_id"),
            fish_data.get("raw_embed"),
        ))
        await db.commit()


async def get_fish(fish_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM fish WHERE fish_id = ?", (fish_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_fish_by_message(message_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM fish WHERE discord_message_id = ?", (message_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_latest_trophy_fish(player: str, fish_type: str) -> dict | None:
    """Последняя legendary/mythic рыба игрока по caught_by."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish
            WHERE caught_by = ? AND fish_type = ? AND tier IN ('legendary', 'mythic')
            ORDER BY caught_at DESC
            LIMIT 1
        """, (player, fish_type)) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_latest_trophy_fish_recent(player: str, fish_type: str, seconds: int = 90) -> dict | None:
    """Последняя legendary/mythic рыба игрока, пойманная не ранее чем seconds секунд назад.

    Используется FishCatchListener для получения lore: короткое окно гарантирует,
    что старые незаклеймленные трофеи (пойманные до привязки Discord) не будут
    ошибочно применены к новому улову.  90 секунд с запасом покрывают время
    обработки ботом + все 5 попыток повтора плагина (~1 с суммарно).
    """
    cutoff = (datetime.utcnow() - timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish
            WHERE caught_by = ? AND fish_type = ? AND tier IN ('legendary', 'mythic')
            AND caught_at >= ?
            ORDER BY caught_at DESC
            LIMIT 1
        """, (player, fish_type, cutoff)) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_latest_trophy_fish_by_owner(player: str, fish_type: str) -> dict | None:
    """Последняя legendary/mythic рыба по current_owner (нужна после передачи)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish
            WHERE current_owner = ? AND fish_type = ? AND tier IN ('legendary', 'mythic')
            ORDER BY caught_at DESC
            LIMIT 1
        """, (player, fish_type)) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_latest_fish_by_weight(player: str, fish_type: str, weight: float) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish
            WHERE caught_by = ? AND fish_type = ? AND weight = ?
            ORDER BY caught_at DESC
            LIMIT 1
        """, (player, fish_type, weight)) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def claim_fish(fish_id: str, discord_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            UPDATE fish SET claimed = 1, discord_id = ?, claimed_at = ?
            WHERE fish_id = ?
        """, (discord_id, datetime.utcnow().isoformat(), fish_id))
        await db.commit()
        return True


async def transfer_fish(fish_id: str, from_owner: str, to_owner: str):
    async with aiosqlite.connect(DB_PATH) as db:
        # BUG FIX: При передаче сбрасываем claimed и discord_id.
        # Карточка в Discord будет показывать "Не заклеймлена" пока новый владелец
        # не выполнит /claim — это корректное поведение.
        # Очки от трофея не учитываются за не-заклеймленную рыбу (leaderboard уже это проверяет).
        await db.execute(
            "UPDATE fish SET current_owner = ?, discord_id = NULL, claimed = 0, claimed_at = NULL, lore_applied = 0 WHERE fish_id = ?",
            (to_owner, fish_id)
        )
        await db.execute("""
            INSERT INTO transfers (fish_id, from_owner, to_owner, transferred_at)
            VALUES (?, ?, ?, ?)
        """, (fish_id, from_owner, to_owner, datetime.utcnow().isoformat()))
        await db.commit()


async def set_fish_released(fish_id: str, released: bool):
    async with aiosqlite.connect(DB_PATH) as db:
        if released:
            # При выпуске рыбы в мир (→ ведро) сбрасываем lore_applied:
            # предмет-рыба перестаёт существовать, при restore lore будет применён заново.
            await db.execute(
                "UPDATE fish SET is_released = 1, lore_applied = 0 WHERE fish_id = ?",
                (fish_id,)
            )
        else:
            await db.execute(
                "UPDATE fish SET is_released = 0 WHERE fish_id = ?",
                (fish_id,)
            )
        await db.commit()


async def set_lore_applied(fish_id: str, applied: bool):
    """Помечает трофей как «lore применён» (или сбрасывает флаг).
    Флаг = 1 означает что предмет с lore уже существует в игре у текущего владельца.
    Сброс происходит при release (→ ведро) и при transfer (новый владелец ещё не получил предмет).
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE fish SET lore_applied = ? WHERE fish_id = ?",
            (1 if applied else 0, fish_id)
        )
        await db.commit()


# ── transfers ─────────────────────────────────────────────────────

async def get_transfers(fish_id: str) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM transfers WHERE fish_id = ? ORDER BY transferred_at ASC
        """, (fish_id,)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


# ── pending_transfers ─────────────────────────────────────────────

async def create_pending_transfer(
    fish_id: str, from_player: str, to_player: str,
    expires_at: str, discord_message_id: str = None
):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM pending_transfers WHERE fish_id = ?", (fish_id,))
        await db.execute("""
            INSERT INTO pending_transfers
                (fish_id, from_player, to_player, created_at, expires_at, discord_message_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (fish_id, from_player, to_player,
              datetime.utcnow().isoformat(), expires_at, discord_message_id))
        await db.commit()


async def get_pending_transfer(fish_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM pending_transfers WHERE fish_id = ? AND expires_at > ?",
            (fish_id, datetime.utcnow().isoformat())
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def get_pending_transfers_for_player(to_player: str) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM pending_transfers WHERE to_player = ? AND expires_at > ? ORDER BY created_at DESC",
            (to_player, datetime.utcnow().isoformat())
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def delete_pending_transfer(fish_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM pending_transfers WHERE fish_id = ?", (fish_id,))
        await db.commit()


async def expire_pending_transfers():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM pending_transfers WHERE expires_at <= ?",
            (datetime.utcnow().isoformat(),)
        )
        await db.commit()


# ── leaderboard ───────────────────────────────────────────────────

async def get_leaderboard(limit: int = 10) -> list:
    """
    Очки = catch_score (common/good/rare, всегда) +
           fish_score  (трофеи legendary/mythic, только claimed, по текущему владельцу).
    При передаче трофея очки переходят к новому владельцу.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT
                p.player,
                COALESCE(p.catch_score, 0) + COALESCE(f.fish_score, 0) AS total_score,
                p.mythic_count,
                p.legendary_count,
                p.rare_count,
                p.good_count,
                p.common_count,
                p.total_catches,
                COALESCE(own.owned_mythic, 0)    AS owned_mythic,
                COALESCE(own.owned_legendary, 0) AS owned_legendary
            FROM (
                SELECT
                    player,
                    SUM(points)                                              AS catch_score,
                    SUM(CASE WHEN tier = 'mythic'    THEN 1 ELSE 0 END)     AS mythic_count,
                    SUM(CASE WHEN tier = 'legendary' THEN 1 ELSE 0 END)     AS legendary_count,
                    SUM(CASE WHEN tier = 'rare'      THEN 1 ELSE 0 END)     AS rare_count,
                    SUM(CASE WHEN tier = 'good'      THEN 1 ELSE 0 END)     AS good_count,
                    SUM(CASE WHEN tier = 'common'    THEN 1 ELSE 0 END)     AS common_count,
                    COUNT(*)                                                  AS total_catches
                FROM catches
                GROUP BY player
            ) p
            LEFT JOIN (
                -- Очки трофеев идут тому, кто сейчас владеет и заклеймил
                SELECT
                    current_owner,
                    SUM(rarity_score + combo_bonus) AS fish_score
                FROM fish
                WHERE claimed = 1
                GROUP BY current_owner
            ) f ON f.current_owner = p.player
            LEFT JOIN (
                SELECT
                    current_owner,
                    SUM(CASE WHEN tier = 'mythic'    THEN 1 ELSE 0 END) AS owned_mythic,
                    SUM(CASE WHEN tier = 'legendary' THEN 1 ELSE 0 END) AS owned_legendary
                FROM fish
                WHERE claimed = 1
                GROUP BY current_owner
            ) own ON own.current_owner = p.player
            ORDER BY total_score DESC
            LIMIT ?
        """, (limit,)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_player_catches(player: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT
                SUM(points) as total_score,
                SUM(CASE WHEN tier = 'mythic'    THEN 1 ELSE 0 END) as mythic_count,
                SUM(CASE WHEN tier = 'legendary' THEN 1 ELSE 0 END) as legendary_count,
                SUM(CASE WHEN tier = 'rare'      THEN 1 ELSE 0 END) as rare_count,
                SUM(CASE WHEN tier = 'good'      THEN 1 ELSE 0 END) as good_count,
                SUM(CASE WHEN tier = 'common'    THEN 1 ELSE 0 END) as common_count,
                COUNT(*) as total_catches
            FROM catches WHERE player = ?
        """, (player,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else {}


async def get_player_fish(player: str) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish WHERE current_owner = ? ORDER BY rarity_score DESC
        """, (player,)) as cursor:
            rows = await cursor.fetchall()
            result = []
            for row in rows:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                result.append(data)
            return result


async def update_message_id(fish_id: str, message_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE fish SET discord_message_id = ? WHERE fish_id = ?",
            (message_id, fish_id)
        )
        await db.commit()


async def get_record_by_type(fish_type: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM fish WHERE fish_type = ? ORDER BY weight DESC LIMIT 1
        """, (fish_type,)) as cursor:
            row = await cursor.fetchone()
            if row:
                data = dict(row)
                data["attributes"] = json.loads(data["attributes"])
                return data
            return None


async def get_player_stats(player: str) -> dict:
    """
    Полная статистика игрока для /fishstats.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Уловы по тирам и видам
        async with db.execute("""
            SELECT
                COUNT(*)                                                          AS total_catches,
                SUM(points)                                                       AS catch_score,
                SUM(CASE WHEN tier = 'mythic'    THEN 1 ELSE 0 END)              AS mythic_caught,
                SUM(CASE WHEN tier = 'legendary' THEN 1 ELSE 0 END)              AS legendary_caught,
                SUM(CASE WHEN tier = 'rare'      THEN 1 ELSE 0 END)              AS rare_caught,
                SUM(CASE WHEN tier = 'good'      THEN 1 ELSE 0 END)              AS good_caught,
                SUM(CASE WHEN tier = 'common'    THEN 1 ELSE 0 END)              AS common_caught,
                SUM(CASE WHEN fish_type = 'COD'           THEN 1 ELSE 0 END)     AS cod_caught,
                SUM(CASE WHEN fish_type = 'SALMON'        THEN 1 ELSE 0 END)     AS salmon_caught,
                SUM(CASE WHEN fish_type = 'PUFFERFISH'    THEN 1 ELSE 0 END)     AS pufferfish_caught,
                SUM(CASE WHEN fish_type = 'TROPICAL_FISH' THEN 1 ELSE 0 END)     AS tropical_caught,
                MAX(weight)                                                       AS best_weight
            FROM catches WHERE player = ?
        """, (player,)) as cursor:
            catches_row = await cursor.fetchone()
            catches = dict(catches_row) if catches_row else {}

        # Трофеи в коллекции (текущий владелец)
        async with db.execute("""
            SELECT
                COUNT(*)                                                                AS owned_total,
                SUM(CASE WHEN claimed = 1 THEN 1 ELSE 0 END)                           AS owned_claimed,
                SUM(CASE WHEN claimed = 1 THEN rarity_score + combo_bonus ELSE 0 END)  AS trophy_score,
                SUM(CASE WHEN tier = 'mythic'    AND claimed = 1 THEN 1 ELSE 0 END)   AS owned_mythic,
                SUM(CASE WHEN tier = 'legendary' AND claimed = 1 THEN 1 ELSE 0 END)   AS owned_legendary,
                SUM(CASE WHEN is_released = 1 THEN 1 ELSE 0 END)                       AS released_count
            FROM fish WHERE current_owner = ?
        """, (player,)) as cursor:
            owned_row = await cursor.fetchone()
            owned = dict(owned_row) if owned_row else {}

        # Всего поймано трофеев исторически (caught_by)
        async with db.execute("""
            SELECT COUNT(*) AS total_trophy_caught FROM fish WHERE caught_by = ?
        """, (player,)) as cursor:
            row = await cursor.fetchone()
            total_trophy_caught = row[0] if row else 0

        # Лучший трофей по весу в текущей коллекции
        async with db.execute("""
            SELECT fish_id, fish_type, weight, tier, rarity_score, combo_bonus
            FROM fish WHERE current_owner = ? AND claimed = 1
            ORDER BY weight DESC LIMIT 1
        """, (player,)) as cursor:
            best_trophy_row = await cursor.fetchone()
            best_trophy = dict(best_trophy_row) if best_trophy_row else None

        # Передачи: кому отдавал
        async with db.execute("""
            SELECT to_owner, COUNT(*) AS cnt
            FROM transfers WHERE from_owner = ?
            GROUP BY to_owner ORDER BY cnt DESC LIMIT 10
        """, (player,)) as cursor:
            transfers_given = [dict(r) for r in await cursor.fetchall()]

        # Передачи: от кого получал
        async with db.execute("""
            SELECT from_owner, COUNT(*) AS cnt
            FROM transfers WHERE to_owner = ?
            GROUP BY from_owner ORDER BY cnt DESC LIMIT 10
        """, (player,)) as cursor:
            transfers_received = [dict(r) for r in await cursor.fetchall()]

        # Позиция в лидерборде
        async with db.execute("""
            SELECT rank FROM (
                SELECT p.player,
                    ROW_NUMBER() OVER (ORDER BY
                        COALESCE(p.catch_score, 0) + COALESCE(f.fish_score, 0) DESC
                    ) AS rank
                FROM (
                    SELECT player, SUM(points) AS catch_score
                    FROM catches GROUP BY player
                ) p
                LEFT JOIN (
                    SELECT current_owner, SUM(rarity_score + combo_bonus) AS fish_score
                    FROM fish WHERE claimed = 1 GROUP BY current_owner
                ) f ON f.current_owner = p.player
            ) ranked WHERE player = ?
        """, (player,)) as cursor:
            rank_row = await cursor.fetchone()
            leaderboard_rank = rank_row[0] if rank_row else None

        total_score = (catches.get("catch_score") or 0) + (owned.get("trophy_score") or 0)

        return {
            "player":              player,
            "total_score":         total_score,
            "leaderboard_rank":    leaderboard_rank,
            "catches":             catches,
            "owned":               owned,
            "total_trophy_caught": total_trophy_caught,
            "best_trophy":         best_trophy,
            "transfers_given":     transfers_given,
            "transfers_received":  transfers_received,
        }


async def get_all_fish_ids() -> set:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT fish_id FROM fish") as cursor:
            rows = await cursor.fetchall()
            return {row[0] for row in rows}


async def get_all_claimed_fish_ids() -> list:
    """Возвращает список fish_id всех заклеймленных трофеев.
    Используется при старте бота для регистрации persistent views —
    чтобы кнопки «Открыть карточку рыбы» работали после рестарта.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT fish_id FROM fish WHERE claimed = 1") as cursor:
            rows = await cursor.fetchall()
            return [row[0] for row in rows]