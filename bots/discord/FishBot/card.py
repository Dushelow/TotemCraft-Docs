import discord
import json
import os
import asyncio
from datetime import datetime

TRAITS_PATH = os.path.join(os.path.dirname(__file__), "data/traits.json")
COMBOS_PATH = os.path.join(os.path.dirname(__file__), "data/combos.json")

with open(TRAITS_PATH, "r", encoding="utf-8") as f:
    TRAITS_DATA = json.load(f)

with open(COMBOS_PATH, "r", encoding="utf-8") as f:
    COMBOS_DATA = json.load(f)

FISH_NAMES = {
    "COD":           "Треска",
    "SALMON":        "Лосось",
    "PUFFERFISH":    "Иглобрюх",
    "TROPICAL_FISH": "Тропическая рыба",
}

FISH_EMOJI = {
    "COD":           "🐟",
    "SALMON":        "🐠",
    "PUFFERFISH":    "🐡",
    "TROPICAL_FISH": "🐠",
}

FISH_TITLE_LEGENDARY = {
    "COD":           "Трофейная треска",
    "SALMON":        "Трофейный лосось",
    "PUFFERFISH":    "Трофейный иглобрюх",
    "TROPICAL_FISH": "Трофейная тропическая рыба",
}

FISH_TITLE_MYTHIC = {
    "COD":           "Мифическая трофейная треска",
    "SALMON":        "Мифический трофейный лосось",
    "PUFFERFISH":    "Мифический трофейный иглобрюх",
    "TROPICAL_FISH": "Мифическая трофейная тропическая рыба",
}

FISH_TITLE = FISH_TITLE_LEGENDARY


def find_trait_by_id(trait_id: str) -> dict | None:
    for group in TRAITS_DATA["groups"].values():
        for trait in group.get("traits", []):
            if trait["id"] == trait_id:
                return trait
        for traits_list in group.get("biome_traits", {}).values():
            for trait in traits_list:
                if trait["id"] == trait_id:
                    return trait
        for traits_list in group.get("weather_traits", {}).values():
            for trait in traits_list:
                if trait["id"] == trait_id:
                    return trait
        for traits_list in group.get("time_traits", {}).values():
            for trait in traits_list:
                if trait["id"] == trait_id:
                    return trait
        for trait in group.get("default_traits", []):
            if trait["id"] == trait_id:
                return trait
    return None


def find_combo_by_id(combo_id: str) -> dict | None:
    for combo in COMBOS_DATA["combos"]:
        if combo["id"] == combo_id:
            return combo
    return None


def format_attributes_block(attributes: dict) -> str:
    groups = TRAITS_DATA["groups"]
    tiers  = TRAITS_DATA["tiers"]
    lines  = []
    for group_key in groups:
        trait_id = attributes.get(group_key)
        if not trait_id:
            continue
        trait     = find_trait_by_id(trait_id)
        if not trait:
            trait = {"label": "Неизвестно", "tier": "common"}
        tier_info = tiers.get(trait["tier"], tiers["common"])
        lines.append(f"{tier_info['symbol']} {trait['label']}")
    return "\n".join(lines) if lines else "—"


def format_world_block(attributes: dict) -> str:
    lines = []
    if attributes.get("biome"):
        lines.append(f"**Биом:** {attributes['biome']}")
    if attributes.get("weather"):
        lines.append(f"**Погода:** {attributes['weather']}")
    if attributes.get("time_of_day"):
        lines.append(f"**Время:** {attributes['time_of_day']}")
    return "\n".join(lines) if lines else "—"


def format_history_block(fish_data: dict, transfers: list) -> str:
    lines = []
    caught_at = fish_data["caught_at"]
    if isinstance(caught_at, str):
        try:
            caught_at_str = datetime.fromisoformat(caught_at).strftime("%d.%m.%Y")
        except Exception:
            caught_at_str = caught_at
    else:
        caught_at_str = str(caught_at)

    history = [{"owner": fish_data["caught_by"], "action": "поймал", "date": caught_at_str}]
    for t in transfers:
        try:
            date_str = datetime.fromisoformat(t["transferred_at"]).strftime("%d.%m.%Y")
        except Exception:
            date_str = t["transferred_at"]
        history.append({"owner": t["to_owner"], "action": "владелец", "date": date_str})

    history.reverse()
    for i, entry in enumerate(history):
        if i == 0:
            lines.append(f"**{entry['owner']}** — текущий (с {entry['date']})")
        else:
            lines.append(f"{entry['owner']} — {entry['action']} {entry['date']}")

    return "\n".join(lines) if lines else f"**{fish_data['caught_by']}** — поймал"


def get_fish_title(fish_type: str, tier: str = "mythic") -> str:
    if tier == "mythic":
        return FISH_TITLE_MYTHIC.get(fish_type, fish_type)
    return FISH_TITLE_LEGENDARY.get(fish_type, fish_type)


def build_card(fish_data: dict, transfers: list = None) -> discord.Embed:
    """Короткая карточка для #chronicle."""
    if transfers is None:
        transfers = []

    fish_id    = fish_data["fish_id"]
    caught_by  = fish_data["caught_by"]
    claimed    = fish_data.get("claimed", 0)
    discord_id = fish_data.get("discord_id")
    tier       = fish_data.get("tier", "mythic")
    current_owner = fish_data.get("current_owner", caught_by)

    embed = discord.Embed(color=0x2f3136)

    if not claimed:
        # BUG FIX: После передачи current_owner != caught_by, discord_id = None.
        # Показываем правильную подсказку актуальному владельцу.
        owner_discord_id = fish_data.get("discord_id")
        if owner_discord_id:
            embed.description = (
                f"<@{owner_discord_id}>, заклейми свою рыбу:\n"
                f"`/claim {fish_id}` в игре"
            )
        else:
            embed.description = (
                f"**{current_owner}**, сначала привяжи Discord:\n"
                f"`/discord link` в игре\n"
                f"Затем: `/claim {fish_id}`"
            )
    else:
        embed.add_field(name="ID", value=f"`{fish_id}`", inline=False)

    embed.set_footer(text="NFT • totemcraft.net")
    return embed


def build_full_card(fish_data: dict, transfers: list = None) -> discord.Embed:
    """Полная карточка."""
    if transfers is None:
        transfers = []

    fish_type    = fish_data["fish_type"]
    fish_id      = fish_data["fish_id"]
    attributes   = fish_data["attributes"]
    rarity_score = fish_data["rarity_score"]
    combo_bonus  = fish_data.get("combo_bonus", 0)
    combo_id     = fish_data.get("combo_id")
    current_owner = fish_data["current_owner"]
    discord_id   = fish_data.get("discord_id")
    claimed      = fish_data.get("claimed", 0)
    tier         = fish_data.get("tier", "mythic")

    caught_at = fish_data["caught_at"]
    if isinstance(caught_at, str):
        try:
            caught_at_str = datetime.fromisoformat(caught_at).strftime("%d.%m.%Y • %H:%M")
        except Exception:
            caught_at_str = caught_at
    else:
        caught_at_str = str(caught_at)

    color = 0xd32ce6 if tier == "mythic" else 0xFFD700
    title = get_fish_title(fish_type, tier)

    embed = discord.Embed(
        title=f"{FISH_EMOJI.get(fish_type, '🐟')} {title}",
        color=color
    )

    tier_label = "✦ Мифический" if tier == "mythic" else "⬡ Легендарный"
    embed.add_field(name=tier_label, value=f"**ID:** `{fish_id}`", inline=False)
    embed.add_field(name="Вес",      value=f"{fish_data['weight']} кг", inline=True)
    embed.add_field(name="Поймано",  value=caught_at_str,               inline=True)
    embed.add_field(name="Поймал",   value=fish_data["caught_by"],      inline=True)

    world = format_world_block(attributes)
    if world != "—":
        embed.add_field(name="Условия поимки", value=world, inline=False)

    attrs_text = format_attributes_block(attributes)
    embed.add_field(name="Атрибуты", value=attrs_text, inline=False)

    total_score = rarity_score + combo_bonus
    embed.add_field(name="Очки редкости", value=f"**{total_score}**", inline=True)

    if combo_id:
        combo = find_combo_by_id(combo_id)
        if combo:
            embed.add_field(
                name="Комбо",
                value=f"**{combo['label']}** +{combo['bonus_points']}",
                inline=True
            )

    owner_text = current_owner
    if discord_id:
        owner_text = f"{current_owner} — <@{discord_id}>"
    embed.add_field(name="Владелец", value=owner_text, inline=False)

    history_text = format_history_block(fish_data, transfers)
    embed.add_field(name="История владения", value=history_text, inline=False)

    status = "✅ Заклеймлена" if claimed else "🔓 Не заклеймлена"
    embed.add_field(name="Статус", value=status, inline=False)

    embed.set_footer(text="NFT • totemcraft.net")
    return embed


class FishDetailsView(discord.ui.View):
    """Кнопка под карточкой в хронике.

    Persistent view: custom_id содержит fish_id чтобы кнопка работала после рестарта бота.
    Формат custom_id: "fish_details:<fish_id>" (например "fish_details:SAL-A3F7C2").
    Бот регистрирует этот view через add_view(FishDetailsView(fish_id)) при старте.
    """

    def __init__(self, fish_id: str):
        super().__init__(timeout=None)
        self.fish_id = fish_id
        # Устанавливаем custom_id на кнопке динамически, так как он включает fish_id
        self.details_button.custom_id = f"fish_details:{fish_id}"

    @discord.ui.button(label="Открыть карточку рыбы", style=discord.ButtonStyle.secondary, emoji="🔍", custom_id="fish_details:placeholder")
    async def details_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        from database import get_fish, get_transfers
        # После рестарта бота self.fish_id берётся из custom_id кнопки, а не из __init__
        fish_id = button.custom_id.split(":", 1)[1] if ":" in button.custom_id else self.fish_id
        fish = await get_fish(fish_id)
        if not fish:
            await interaction.response.send_message("Рыба не найдена.", ephemeral=True)
            return
        if not fish.get("claimed"):
            await interaction.response.send_message(
                "Карточка недоступна — рыба не заклеймлена.", ephemeral=True
            )
            return
        transfers  = await get_transfers(fish_id)
        full_embed  = build_full_card(fish, transfers)
        short_embed = build_card(fish, transfers)
        view = FishDetailsView(fish_id)
        await interaction.response.edit_message(embed=full_embed, view=view)
        await asyncio.sleep(60)  # 1 минута
        await interaction.edit_original_response(embed=short_embed, view=view)
