import hashlib
import json
import os

RU_RU_PATH = "/minecraft/server/plugins/DiscordSRV/assets/ru_ru.json"

def translate_biome(biome_raw: str) -> str:
    try:
        with open(RU_RU_PATH, "r", encoding="utf-8") as f:
            translations = json.load(f)
        key = f"biome.minecraft.{biome_raw.lower()}"
        return translations.get(key, biome_raw)
    except Exception:
        return biome_raw

TRAITS_PATH = os.path.join(os.path.dirname(__file__), "data/traits.json")
COMBOS_PATH = os.path.join(os.path.dirname(__file__), "data/combos.json")

with open(TRAITS_PATH, "r", encoding="utf-8") as f:
    TRAITS_DATA = json.load(f)

with open(COMBOS_PATH, "r", encoding="utf-8") as f:
    COMBOS_DATA = json.load(f)

FISH_TYPE_MAP = {
    "COD":                        "COD",
    "SALMON":                     "SALMON",
    "PUFFERFISH":                 "PUFFERFISH",
    "TROPICAL_FISH":              "TROPICAL_FISH",
    # Простые русские названия (из embed.description обычных/хороших/редких уловов)
    "Треска":                     "COD",
    "Лосось":                     "SALMON",
    "Иглобрюх":                   "PUFFERFISH",
    "Тропическая рыба":           "TROPICAL_FISH",
    # Трофейные (из embed.title легендарных/мифических)
    "Трофейная треска":           "COD",
    "Трофейный лосось":           "SALMON",
    "Трофейный иглобрюх":         "PUFFERFISH",
    "Трофейная тропическая рыба": "TROPICAL_FISH",
    "Мифическая трофейная треска":           "COD",
    "Мифический трофейный лосось":           "SALMON",
    "Мифический трофейный иглобрюх":         "PUFFERFISH",
    "Мифическая трофейная тропическая рыба": "TROPICAL_FISH",
}

FISH_ID_PREFIX = {
    "COD":           "COD",
    "SALMON":        "SAL",
    "PUFFERFISH":    "PUF",
    "TROPICAL_FISH": "TRP",
}

ATTR_TIER_BONUS = {
    "common":    0,
    "uncommon":  5,
    "rare":      15,
    "epic":      30,
    "legendary": 60,
    "mythic":    100,
}

BASE_TROPHY_SCORE = {"legendary": 200, "mythic": 600}

BIOME_KEY_MAP = {
    # Порядок важен — более специфичные подстроки должны идти раньше общих.

    # Океаны
    "холодный океан": "cold_ocean",
    "глубокий холодный": "cold_ocean",
    "тёплый океан":   "warm_ocean",
    "слегка тёплый":  "warm_ocean",
    "океан":          "ocean",        # общий fallback для всех океанов

    # Реки и водоёмы
    "замёрзшая река": "frozen",
    "река":           "river",

    # Болота
    "мангров":        "mangrove",
    "болото":         "swamp",

    # Джунгли
    "бамбуковые джунгли": "bamboo_jungle",
    "бамбуковый":     "bamboo_jungle",
    "джунгли":        "jungle",

    # Вишнёвый сад
    "вишнёвый":       "cherry",
    "сакура":         "cherry",

    # Бэдлэндс
    "разрушенные бэдлэндс": "eroded_badlands",
    "разрушенный":    "eroded_badlands",
    "бэдлэндс":       "badlands",
    "бесплодные земли": "badlands",

    # Снег и лёд
    "ледяные шипы":   "frozen",
    "заснеженн":      "frozen",
    "снежн":          "frozen",

    # Особые
    "глубокая тьма":  "deep_dark",
    "грибной":        "mushroom",
    "край":           "end",
}


def get_biome_key(biome_translated: str) -> str | None:
    if not biome_translated:
        return None
    b = biome_translated.lower()
    for keyword, key in BIOME_KEY_MAP.items():
        if keyword in b:
            return key
    return None


def make_seed(caught_by: str, fish_type: str, weight: float, caught_at: str) -> int:
    raw = f"{caught_by}:{fish_type}:{weight}:{caught_at}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16)


def pick_trait(seed: int, offset: int, traits: list) -> dict:
    total_weight = sum(t["weight"] for t in traits)
    val = (seed >> offset) % total_weight
    cumulative = 0
    for trait in traits:
        cumulative += trait["weight"]
        if val < cumulative:
            return trait
    return traits[-1]


def pick_trait_with_context(seed: int, offset: int, group_data: dict,
                             biome_key: str = None,
                             weather: str = None,
                             time_of_day: str = None) -> dict:
    """Выбирает трейт с учётом контекста.

    Приоритет: биом → погода → время суток → базовый пул.
    Для группы origin биом берётся из biome_traits, для остальных групп —
    тоже, если они заданы. Позволяет единообразно применять контекст
    ко всем пяти атрибутам рыбы.
    """
    if biome_key and biome_key in group_data.get("biome_traits", {}):
        return pick_trait(seed, offset, group_data["biome_traits"][biome_key])
    if weather and weather in group_data.get("weather_traits", {}):
        return pick_trait(seed, offset, group_data["weather_traits"][weather])
    if time_of_day and time_of_day in group_data.get("time_traits", {}):
        return pick_trait(seed, offset, group_data["time_traits"][time_of_day])
    # Группа origin использует default_traits как fallback; остальные — traits.
    fallback = group_data.get("default_traits") or group_data.get("traits", [])
    return pick_trait(seed, offset, fallback)


def generate_fish_id(fish_type: str, seed: int, existing_ids: set = None) -> str:
    prefix = FISH_ID_PREFIX.get(fish_type, "UNK")
    hex_full = hashlib.sha256(str(seed).encode()).hexdigest().upper()
    for i in range(0, len(hex_full) - 5, 1):
        candidate = f"{prefix}-{hex_full[i:i+6]}"
        if existing_ids is None or candidate not in existing_ids:
            return candidate
    import time
    return f"{prefix}-{hex(int(time.time()))[-6:].upper()}"


def calculate_rarity_score(attributes: dict, tier: str = "mythic") -> int:
    score = BASE_TROPHY_SCORE.get(tier, 50)
    for group_key, trait_id in attributes.items():
        if group_key in ("biome", "weather", "time_of_day"):
            continue
        trait = find_trait_by_id(trait_id)
        if trait:
            score += ATTR_TIER_BONUS.get(trait["tier"], 0)
    return score


def find_trait_by_id(trait_id: str) -> dict | None:
    groups = TRAITS_DATA["groups"]
    for group in groups.values():
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


def find_combo(attributes: dict) -> dict | None:
    trait_ids = set(attributes.values())
    for combo in COMBOS_DATA["combos"]:
        if all(t in trait_ids for t in combo["required_traits"]):
            return combo
    return None


def normalize_fish_type(raw: str) -> str:
    # Сначала точное совпадение (регистронезависимо)
    raw_lower = raw.strip().lower()
    for key, val in FISH_TYPE_MAP.items():
        if key.lower() == raw_lower:
            return val
    # Затем подстрока (для составных названий вроде "Мифическая трофейная треска")
    for key, val in FISH_TYPE_MAP.items():
        if key.lower() in raw_lower:
            return val
    return "COD"


def generate_attributes(caught_by: str, fish_type: str, weight: float, caught_at: str,
                         biome: str = None, weather: str = None, time_of_day: str = None) -> dict:
    seed = make_seed(caught_by, fish_type, weight, caught_at)
    biome_key = get_biome_key(biome) if biome else None
    groups = TRAITS_DATA["groups"]
    attributes = {}
    offset = 0
    for group_key, group_data in groups.items():
        trait = pick_trait_with_context(
            seed, offset, group_data,
            biome_key=biome_key,
            weather=weather,
            time_of_day=time_of_day,
        )
        attributes[group_key] = trait["id"]
        offset += 16
    if biome:
        attributes["biome"] = biome
    if weather:
        attributes["weather"] = weather
    if time_of_day:
        attributes["time_of_day"] = time_of_day
    return attributes


def generate_fish_card(caught_by: str, fish_type_raw: str, weight: float,
                       caught_at: str, biome: str = None,
                       weather: str = None, time_of_day: str = None,
                       existing_ids: set = None, tier: str = "mythic") -> dict:
    fish_type = normalize_fish_type(fish_type_raw)
    if biome:
        biome = translate_biome(biome)
    seed = make_seed(caught_by, fish_type, weight, caught_at)
    fish_id = generate_fish_id(fish_type, seed, existing_ids)
    attributes = generate_attributes(caught_by, fish_type, weight, caught_at,
                                     biome, weather, time_of_day)
    rarity_score = calculate_rarity_score(attributes, tier)
    combo = find_combo(attributes)
    combo_bonus = combo["bonus_points"] if combo else 0
    return {
        "fish_id":       fish_id,
        "fish_type":     fish_type,
        "tier":          tier,
        "caught_by":     caught_by,
        "caught_at":     caught_at,
        "weight":        weight,
        "biome":         biome,
        "weather":       weather,
        "time_of_day":   time_of_day,
        "attributes":    attributes,
        "rarity_score":  rarity_score,
        "combo_id":      combo["id"] if combo else None,
        "combo_bonus":   combo_bonus,
        "current_owner": caught_by,
    }
