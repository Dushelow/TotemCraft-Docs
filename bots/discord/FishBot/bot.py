import discord
from discord.ext import commands, tasks
from discord import app_commands
import os
import asyncio
import json
import time
from pathlib import Path
from dotenv import load_dotenv

from database import (
    init_db, save_fish, save_catch, get_record_by_type,
    update_message_id, get_all_fish_ids, get_all_claimed_fish_ids, claim_fish,
    expire_pending_transfers,
)
from parser import is_any_catch, parse_catch_embed
from generator import generate_fish_card, normalize_fish_type
from card import build_card, build_full_card, FISH_NAMES, FishDetailsView
from api import run_api_thread, set_bot

import commands.fishcheck as fishcheck_cmd
import commands.fishtop as fishtop_cmd
import commands.fishtransfer as fishtransfer_cmd
import commands.fishhistory as fishhistory_cmd
import commands.claim as claim_cmd
import commands.fishstats as fishstats_cmd

load_dotenv("/home/fishbot/.env")

BOT_TOKEN           = os.getenv("BOT_TOKEN")
CHRONICLE_CHANNEL_ID = int(os.getenv("CHRONICLE_CHANNEL_ID"))
FISH_CHANNEL_ID      = int(os.getenv("FISH_CHANNEL_ID"))
GUILD_ID             = int(os.getenv("GUILD_ID"))

intents = discord.Intents.default()
intents.message_content = True
intents.messages = True


def get_discord_id_by_nick(minecraft_nick: str) -> str | None:
    try:
        usercache = Path("/home/minecraft/server/usercache.json")
        accounts  = Path("/home/minecraft/server/plugins/DiscordSRV/accounts.aof")
        if not usercache.exists() or not accounts.exists():
            return None
        with open(usercache, "r", encoding="utf-8") as f:
            cache = json.load(f)
        uuid = None
        for entry in cache:
            if entry.get("name", "").lower() == minecraft_nick.lower():
                uuid = entry.get("uuid", "").replace("-", "")
                break
        if not uuid:
            return None
        with open(accounts, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 2:
                    discord_id, file_uuid = parts
                    if file_uuid.replace("-", "") == uuid:
                        return discord_id
        return None
    except Exception as e:
        print(f"[FishBot] Ошибка проверки привязки: {e}")
        return None


class FishBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=intents)
        self.chronicle_channel_id = CHRONICLE_CHANNEL_ID
        self.fish_channel_id      = FISH_CHANNEL_ID
        self.guild_id             = GUILD_ID
        # Дедупликация двойных CAUGHT_FISH событий от Minecraft/Purpur.
        # Иногда один заброс генерирует несколько PlayerFishEvent — с разными
        # hashCode() объектов событий, из-за чего DiscordSRV публикует два алерта
        # (например, редкий + легендарный). Храним ключ "игрок:тип_рыбы" →
        # (timestamp, tier) последнего обработанного улова. Второй алерт
        # в пределах DEDUP_WINDOW секунд игнорируется, если текущий тир
        # менее редкий или равен уже обработанному.
        self._recent_catches: dict[str, tuple[float, str]] = {}
        self.DEDUP_WINDOW = 5.0  # секунд

    async def setup_hook(self):
        await init_db()
        guild = discord.Object(id=self.guild_id)
        fishcheck_cmd.setup(self.tree, guild)
        fishtop_cmd.setup(self.tree, guild)
        fishtransfer_cmd.setup(self.tree, guild)
        fishhistory_cmd.setup(self.tree, guild)
        claim_cmd.setup(self.tree, guild)
        fishstats_cmd.setup(self.tree, guild)
        await self.tree.sync(guild=guild)
        print("[FishBot] Команды синхронизированы")

        # Регистрируем persistent views для всех заклеймленных рыб.
        # Это необходимо чтобы кнопки «Открыть карточку рыбы» работали после рестарта бота.
        # Discord.py требует add_view() до on_ready — setup_hook вызывается до подключения.
        claimed_ids = await get_all_claimed_fish_ids()
        for fish_id in claimed_ids:
            self.add_view(FishDetailsView(fish_id))
        print(f"[FishBot] Зарегистрировано {len(claimed_ids)} persistent views")

        run_api_thread()
        set_bot(self)
        print("[FishBot] Flask API запущен на порту 7842")
        self._expire_loop.start()

    async def on_ready(self):
        print(f"[FishBot] Запущен как {self.user}")

    # Каждую минуту чистим просроченные pending transfers
    @tasks.loop(minutes=1)
    async def _expire_loop(self):
        try:
            await expire_pending_transfers()
        except Exception as e:
            print(f"[FishBot] Ошибка expire loop: {e}")

    async def on_message(self, message: discord.Message):
        if message.author.bot and message.channel.id == CHRONICLE_CHANNEL_ID:
            if is_any_catch(message):
                await asyncio.sleep(0.5)
                await self.process_catch(message)
        await self.process_commands(message)

    async def process_catch(self, message: discord.Message):
        parsed = parse_catch_embed(message)
        if not parsed:
            return

        tier      = parsed["tier"]
        fish_type = normalize_fish_type(parsed["fish_type_raw"])

        # ── Дедупликация двойных событий ─────────────────────────────
        # Minecraft/Purpur иногда стреляет несколько PlayerFishEvent CAUGHT_FISH
        # на один заброс удочки. Каждый генерирует отдельный embed в DiscordSRV
        # с разным hashCode() → разным тиром. Так появляются пары «Редкий +
        # Легендарный» на один улов.
        # Решение: в течение DEDUP_WINDOW секунд принимаем только САМЫЙ РЕДКИЙ
        # тир от данного игрока с данным типом рыбы.
        TIER_RANK = {"common": 0, "good": 1, "rare": 2, "legendary": 3, "mythic": 4}
        dedup_key = f"{parsed['caught_by']}:{fish_type}"
        now = time.monotonic()
        prev_time, prev_tier = self._recent_catches.get(dedup_key, (0.0, ""))
        if now - prev_time < self.DEDUP_WINDOW:
            # Уже был улов в окне дедупликации
            if TIER_RANK.get(tier, 0) <= TIER_RANK.get(prev_tier, 0):
                # Текущий тир не более редкий — это дубль, пропускаем
                print(f"[FishBot] Дедупликация: пропускаем {tier} (уже обработан {prev_tier}) для {parsed['caught_by']}")
                return
            else:
                # Текущий тир более редкий — обновляем запись, продолжаем обработку
                print(f"[FishBot] Дедупликация: апгрейд {prev_tier} → {tier} для {parsed['caught_by']}")
        self._recent_catches[dedup_key] = (now, tier)

        await save_catch(
            player=parsed["caught_by"],
            tier=tier,
            fish_type=fish_type,
            weight=parsed["weight"],
            caught_at=parsed["caught_at"],
        )

        if tier in ("mythic", "legendary"):
            await self.process_trophy_catch(message, tier)

    async def process_trophy_catch(self, message: discord.Message, tier: str):
        parsed = parse_catch_embed(message)
        if not parsed:
            print(f"[FishBot] Не удалось распарсить улов: {message.id}")
            return

        # BUG FIX: Легендарные рыбы тоже должны иметь биом/погоду/время.
        # alerts.yml для легендарных содержит только Вес в Description — биом не передаётся.
        # Для легендарных биом/погода/время будут None — это нормально, origin-трейт
        # упадёт в default_traits. Если позже alerts.yml будет расширен — парсер подхватит.
        existing_ids = await get_all_fish_ids()
        fish_data = generate_fish_card(
            caught_by=parsed["caught_by"],
            fish_type_raw=parsed["fish_type_raw"],
            weight=parsed["weight"],
            caught_at=parsed["caught_at"],
            biome=parsed.get("biome"),
            weather=parsed.get("weather"),
            time_of_day=parsed.get("time_of_day"),
            existing_ids=existing_ids,
            tier=tier,
        )
        fish_data["raw_embed"] = parsed.get("raw_embed")
        fish_data["tier"]      = tier

        # Привязка Discord
        linked_discord_id = get_discord_id_by_nick(parsed["caught_by"])
        if linked_discord_id:
            fish_data["discord_id"] = linked_discord_id

        await save_fish(fish_data)

        # ── Авто-клейм для легендарных и мифических ──────────────
        # Если Discord привязан — клеймим сразу, без ручной команды.
        # Если нет — рыба сохраняется незаклеймленной, игрок сможет
        # заклеймить позже через /claim или /discord link → /claim.
        if linked_discord_id:
            await claim_fish(fish_data["fish_id"], linked_discord_id)
            fish_data["claimed"]    = 1
            fish_data["discord_id"] = linked_discord_id
            print(f"[FishBot] Авто-клейм: {fish_data['fish_id']} → discord:{linked_discord_id}")
        else:
            print(f"[FishBot] Discord не привязан у {parsed['caught_by']}, клейм пропущен")

        channel = self.get_channel(CHRONICLE_CHANNEL_ID)
        embed   = build_card(fish_data, transfers=[])
        view    = None
        if fish_data.get("claimed"):
            view = FishDetailsView(fish_data["fish_id"])
            self.add_view(view)  # регистрируем persistent view для новой рыбы
        card_message = await channel.send(embed=embed, view=view)

        await update_message_id(fish_data["fish_id"], str(card_message.id))

        print(f"[FishBot] Новая рыба: {fish_data['fish_id']} tier={tier} поймана {parsed['caught_by']}")


bot = FishBot()

if __name__ == "__main__":
    bot.run(BOT_TOKEN)