import re
import discord

MYTHIC_FOOTER = "мифический улов"
MYTHIC_COLOR = 0xd32ce6
MYTHIC_AUTHOR_KEYWORD = "поймал мифическую рыбу"

TIER_COLORS = {
    0x2f3136: "common",
    0xb2b2b2: "good",
    0x4b69ff: "rare",
    0x8847ff: "legendary",
    0xd32ce6: "mythic",
}

TIER_FOOTERS = {
    "обычный улов":      "common",
    "хороший улов":      "good",
    "редкий улов":       "rare",
    "легендарный улов":  "legendary",
    "мифический улов":   "mythic",
}


def get_catch_tier(message: discord.Message) -> str | None:
    if not message.embeds:
        return None
    embed = message.embeds[0]
    if embed.footer and embed.footer.text:
        footer_low = embed.footer.text.lower()
        for keyword, tier in TIER_FOOTERS.items():
            if keyword in footer_low:
                return tier
    if embed.color:
        return TIER_COLORS.get(embed.color.value)
    return None


def is_any_catch(message: discord.Message) -> bool:
    return get_catch_tier(message) is not None


def is_mythic_catch(message: discord.Message) -> bool:
    return get_catch_tier(message) == "mythic"


def parse_catch_embed(message: discord.Message) -> dict | None:
    if not message.embeds:
        return None
    embed = message.embeds[0]

    tier = get_catch_tier(message)
    if not tier:
        return None

    caught_by = None
    if embed.author and embed.author.name:
        match = re.match(r"^(\S+)\s+поймал", embed.author.name)
        if match:
            caught_by = match.group(1)

    fish_type_raw = None
    if embed.title:
        fish_type_raw = embed.title
    elif embed.description:
        type_match = re.search(r"\*\*(Треска|Лосось|Иглобрюх|Тропическая рыба)\*\*", embed.description)
        if type_match:
            fish_type_raw = type_match.group(1)

    weight = None
    biome = None
    weather = None
    time_of_day = None

    if embed.description:
        weight_match = re.search(r"Вес:\*\*\s*([\d.]+)\s*кг", embed.description)
        if weight_match:
            weight = float(weight_match.group(1))
        else:
            weight_match2 = re.search(r"\*\*([\d.]+)\s*кг", embed.description)
            if weight_match2:
                weight = float(weight_match2.group(1))

        biome_match = re.search(r"\*\*Биом:\*\*\s*([^\n]+)", embed.description)
        if biome_match:
            biome = biome_match.group(1).strip()

        weather_match = re.search(r"\*\*Погода:\*\*\s*([^\n]+)", embed.description)
        if weather_match:
            weather = weather_match.group(1).strip()

        time_match = re.search(r"\*\*Время:\*\*\s*([^\n]+)", embed.description)
        if time_match:
            time_of_day = time_match.group(1).strip()

    if not caught_by or not fish_type_raw or weight is None:
        return None

    caught_at = message.created_at.strftime("%Y-%m-%d %H:%M:%S")

    return {
        "tier":          tier,
        "caught_by":     caught_by,
        "fish_type_raw": fish_type_raw,
        "weight":        weight,
        "caught_at":     caught_at,
        "biome":         biome,
        "weather":       weather,
        "time_of_day":   time_of_day,
        "raw_embed":     str(embed.to_dict()),
    }


def parse_mythic_embed(message: discord.Message) -> dict | None:
    result = parse_catch_embed(message)
    if result and result["tier"] == "mythic":
        return result
    return None