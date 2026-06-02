from flask import Flask, request, jsonify
import asyncio
import threading
import json
import os
from pathlib import Path
from datetime import datetime, timedelta

from database import (
    get_fish, claim_fish, get_transfers, get_leaderboard, set_fish_released,
    get_latest_fish_by_weight, get_latest_trophy_fish, get_latest_trophy_fish_recent,
    create_pending_transfer, get_pending_transfer, delete_pending_transfer,
    transfer_fish, set_lore_applied,
)
from card import build_card, FISH_NAMES, find_trait_by_id

app = Flask(__name__)

ACCOUNTS_PATH = Path("/home/minecraft/server/plugins/DiscordSRV/accounts.aof")
USERCACHE_PATH = Path("/home/minecraft/server/usercache.json")


def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def get_player_uuid(minecraft_nick: str) -> str | None:
    try:
        if not USERCACHE_PATH.exists():
            return None
        with open(USERCACHE_PATH, "r", encoding="utf-8") as f:
            cache = json.load(f)
        for entry in cache:
            if entry.get("name", "").lower() == minecraft_nick.lower():
                return entry.get("uuid")
        return None
    except Exception as e:
        print(f"[API] Ошибка при чтении usercache: {e}")
        return None


def check_discord_link(minecraft_nick: str) -> str | None:
    try:
        if not ACCOUNTS_PATH.exists():
            return None
        uuid = get_player_uuid(minecraft_nick)
        if not uuid:
            return None
        uuid_clean = uuid.replace("-", "")
        with open(ACCOUNTS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) == 2:
                    discord_id, file_uuid = parts
                    if file_uuid.replace("-", "") == uuid_clean:
                        return discord_id
        return None
    except Exception as e:
        print(f"[API] Ошибка при проверке accounts.aof: {e}")
        return None


# ── claim ─────────────────────────────────────────────────────────

@app.route("/claim", methods=["POST"])
def claim():
    data    = request.get_json() or {}
    fish_id = data.get("fish_id", "").strip().upper()
    player  = data.get("player", "").strip()

    if not fish_id or not player:
        return jsonify({"error": "fish_id and player are required"}), 400

    fish = run_async(get_fish(fish_id))
    if not fish:
        return jsonify({"error": "fish not found"}), 404
    if fish.get("claimed"):
        return jsonify({"error": "fish already claimed"}), 409
    if fish["current_owner"].lower() != player.lower():
        return jsonify({"error": "this is not your fish"}), 403

    discord_id = check_discord_link(player)
    if not discord_id:
        return jsonify({"error": "no_discord_link"}), 403

    success = run_async(claim_fish(fish_id, discord_id))
    if success:
        if _bot_instance:
            asyncio.run_coroutine_threadsafe(_update_card_and_register_view(fish_id), _bot_instance.loop)
        return jsonify({"ok": True}), 200
    return jsonify({"error": "failed to claim fish"}), 500


# ── fishcheck ─────────────────────────────────────────────────────

@app.route("/fishcheck/<fish_id>", methods=["GET"])
def fishcheck(fish_id):
    fish = run_async(get_fish(fish_id.upper()))
    if not fish:
        return "Рыба не найдена.", 404

    transfers = run_async(get_transfers(fish_id.upper()))
    fish_name = FISH_NAMES.get(fish["fish_type"], fish["fish_type"])

    released = fish.get("is_released", 0)
    status = (
        "Выпущена в мир" if released
        else ("Заклеймлена" if fish.get("claimed") else "Не заклеймлена")
    )

    lines = [
        f"Тип: {fish_name} • Вес: {fish['weight']} кг",
        f"Поймал: {fish['caught_by']} • {str(fish['caught_at'])[:10]}",
        f"Владелец: {fish['current_owner']}",
        f"Очки: {fish.get('rarity_score', 0) + fish.get('combo_bonus', 0)}",
        f"Статус: {status}",
    ]
    if fish.get("biome"):
        lines.insert(2, f"Биом: {fish['biome']}")
    if transfers:
        lines.append(f"Передач: {len(transfers)}")

    # Три выбранных атрибута: внешность, аура, происхождение
    attrs = fish.get("attributes", {})
    for attr_key, line_label in [("appearance", "Внешность"), ("aura", "Аура"), ("origin", "Воды")]:
        trait_id = attrs.get(attr_key)
        if trait_id:
            trait = find_trait_by_id(trait_id)
            if trait:
                lines.append(f"{line_label}: {trait['label']}")

    return "\n".join(lines), 200


# ── fwhere ────────────────────────────────────────────────────────

@app.route("/fwhere/<fish_id>", methods=["GET"])
def fwhere(fish_id):
    fish = run_async(get_fish(fish_id.upper()))
    if not fish:
        return "not_found", 404

    released = fish.get("is_released", 0)
    if released:
        status = "released"
    elif fish.get("claimed"):
        status = "claimed"
    else:
        status = "unclaimed"

    return jsonify({
        "status":        status,
        "current_owner": fish["current_owner"],
        "fish_type":     fish["fish_type"],
        "weight":        fish["weight"],
        "tier":          fish.get("tier", "mythic"),
        "lore_applied":  fish.get("lore_applied", 0),
    }), 200


# ── fish_lookup ───────────────────────────────────────────────────

@app.route("/fish_lookup", methods=["GET"])
def fish_lookup():
    player    = request.args.get("player", "").strip()
    fish_type = request.args.get("type", "").strip().upper()
    try:
        weight = float(request.args.get("weight", "0"))
    except ValueError:
        return jsonify({"error": "invalid weight"}), 400

    if not player or not fish_type:
        return jsonify({"error": "player and type required"}), 400

    fish = run_async(get_latest_fish_by_weight(player, fish_type, weight))
    if not fish:
        return jsonify({"error": "not found"}), 404

    return jsonify({"fish_id": fish["fish_id"]}), 200


# ── check_discord ────────────────────────────────────────────────

@app.route("/check_discord", methods=["GET"])
def check_discord():
    """Проверяет привязку Discord для Minecraft-ника. 200 = привязан, 404 = нет."""
    player = request.args.get("player", "").strip()
    if not player:
        return jsonify({"error": "player required"}), 400
    discord_id = check_discord_link(player)
    if discord_id:
        return jsonify({"discord_id": discord_id}), 200
    return jsonify({"error": "not linked"}), 404


# ── fish_lookup_latest ────────────────────────────────────────────

@app.route("/fish_lookup_latest", methods=["GET"])
def fish_lookup_latest():
    """
    Последний трофей игрока данного типа.

    ?recent=1  — только рыба, пойманная в последние 90 секунд (для FishCatchListener).
                 Предотвращает выдачу старых незаклеймленных трофеев при новом улове.
    Без recent — любая рыба (для FishConvertCommand и других нужд).
    """
    player    = request.args.get("player", "").strip()
    fish_type = request.args.get("type", "").strip().upper()
    recent    = request.args.get("recent", "0") == "1"

    if not player or not fish_type:
        return jsonify({"error": "player and type required"}), 400

    if recent:
        fish = run_async(get_latest_trophy_fish_recent(player, fish_type))
    else:
        fish = run_async(get_latest_trophy_fish(player, fish_type))

    if not fish:
        return jsonify({"error": "not found"}), 404

    return jsonify({
        "fish_id": fish["fish_id"],
        "tier":    fish.get("tier", "mythic"),
        "weight":  fish["weight"],
    }), 200


# ── fconvert ──────────────────────────────────────────────────────

@app.route("/fconvert", methods=["POST"])
def fconvert():
    data    = request.get_json() or {}
    fish_id = data.get("fish_id", "").strip().upper()
    player  = data.get("player", "").strip()
    action  = data.get("action", "").strip()

    if not fish_id or not player or action not in ("release", "restore"):
        return jsonify({"error": "fish_id, player and action (release/restore) required"}), 400

    fish = run_async(get_fish(fish_id))
    if not fish:
        return jsonify({"error": "fish not found"}), 404
    if fish["current_owner"].lower() != player.lower():
        return jsonify({"error": "not your fish"}), 403

    if action == "release":
        if fish.get("is_released"):
            return jsonify({"error": "already released"}), 409
        # set_fish_released(True) уже сбрасывает lore_applied=0 внутри database.py
        run_async(set_fish_released(fish_id, True))
        return jsonify({"ok": True, "status": "released"}), 200
    else:
        if not fish.get("is_released"):
            return jsonify({"error": "not released"}), 409
        # При restore предмет-рыба будет создан заново через Java — lore_applied
        # выставится в 1 отдельным вызовом /set_lore_applied после applyTrophyLore.
        run_async(set_fish_released(fish_id, False))
        return jsonify({"ok": True, "status": "restored"}), 200


# ── set_lore_applied ──────────────────────────────────────────────

@app.route("/set_lore_applied", methods=["POST"])
def set_lore_applied_endpoint():
    """
    Вызывается Java-плагином после успешного applyTrophyLore.
    Выставляет lore_applied=1 — означает что предмет с lore уже существует в игре.
    Благодаря этому флагу при следующей поимке рыбы того же вида
    scheduleLookupsAsync не применит lore повторно к другому предмету.
    """
    data    = request.get_json() or {}
    fish_id = data.get("fish_id", "").strip().upper()
    player  = data.get("player", "").strip()

    if not fish_id or not player:
        return jsonify({"error": "fish_id and player required"}), 400

    fish = run_async(get_fish(fish_id))
    if not fish:
        return jsonify({"error": "fish not found"}), 404
    if fish["current_owner"].lower() != player.lower():
        return jsonify({"error": "not your fish"}), 403

    run_async(set_lore_applied(fish_id, True))
    return jsonify({"ok": True}), 200


# ── pending transfer ──────────────────────────────────────────────

@app.route("/ftpending", methods=["POST"])
def ftpending():
    data        = request.get_json() or {}
    fish_id     = data.get("fish_id", "").strip().upper()
    from_player = data.get("from", "").strip()
    to_player   = data.get("to", "").strip()

    if not fish_id or not from_player or not to_player:
        return jsonify({"error": "fish_id, from and to required"}), 400
    if from_player.lower() == to_player.lower():
        return jsonify({"error": "cannot transfer to yourself"}), 400

    fish = run_async(get_fish(fish_id))
    if not fish:
        return jsonify({"error": "fish not found"}), 404
    if fish["current_owner"].lower() != from_player.lower():
        return jsonify({"error": "not your fish"}), 403

    existing = run_async(get_pending_transfer(fish_id))
    if existing:
        return jsonify({"error": "transfer already pending", "to": existing["to_player"]}), 409

    expires_at = (datetime.utcnow() + timedelta(minutes=1)).isoformat()

    if _bot_instance:
        to_discord_id = check_discord_link(to_player)
        asyncio.run_coroutine_threadsafe(
            _do_notify_transfer(fish_id, from_player, to_player, to_discord_id, expires_at),
            _bot_instance.loop,
        )
    else:
        run_async(create_pending_transfer(fish_id, from_player, to_player, expires_at))

    return jsonify({"ok": True}), 200


@app.route("/ftaccept", methods=["POST"])
def ftaccept():
    data    = request.get_json() or {}
    fish_id = data.get("fish_id", "").strip().upper()
    player  = data.get("player", "").strip()

    if not fish_id or not player:
        return jsonify({"error": "fish_id and player required"}), 400

    pending = run_async(get_pending_transfer(fish_id))
    if not pending:
        return jsonify({"error": "no pending transfer or expired"}), 404
    if pending["to_player"].lower() != player.lower():
        return jsonify({"error": "not your transfer"}), 403

    from_player = pending["from_player"]
    run_async(transfer_fish(fish_id, from_player, pending["to_player"]))
    run_async(delete_pending_transfer(fish_id))

    if _bot_instance:
        asyncio.run_coroutine_threadsafe(
            _accept_and_update(fish_id, pending),
            _bot_instance.loop,
        )

    return jsonify({"ok": True, "from": from_player}), 200


@app.route("/ftdecline", methods=["POST"])
def ftdecline():
    data    = request.get_json() or {}
    fish_id = data.get("fish_id", "").strip().upper()
    player  = data.get("player", "").strip()

    if not fish_id or not player:
        return jsonify({"error": "fish_id and player required"}), 400

    pending = run_async(get_pending_transfer(fish_id))
    if not pending:
        return jsonify({"error": "no pending transfer or expired"}), 404
    if pending["to_player"].lower() != player.lower():
        return jsonify({"error": "not your transfer"}), 403

    from_player = pending["from_player"]
    run_async(delete_pending_transfer(fish_id))

    if _bot_instance:
        asyncio.run_coroutine_threadsafe(
            _decline_and_update(fish_id, pending),
            _bot_instance.loop,
        )

    return jsonify({"ok": True, "from": from_player}), 200


# ── fishstats ────────────────────────────────────────────────────

@app.route("/fishstats", methods=["GET"])
def fishstats():
    from database import get_player_stats
    player = request.args.get("player", "").strip()
    if not player:
        return jsonify({"error": "player required"}), 400

    stats = run_async(get_player_stats(player))
    if not stats or not stats["catches"].get("total_catches"):
        return "Игрок не найден или ещё не поймал ни одной рыбы.", 404

    c      = stats["catches"]
    o      = stats["owned"]
    rank   = stats["leaderboard_rank"]
    score  = stats["total_score"]
    bt     = stats["best_trophy"]
    given  = stats["transfers_given"]
    recvd  = stats["transfers_received"]

    FISH_NAMES = {
        "COD": "Треска", "SALMON": "Лосось",
        "PUFFERFISH": "Иглобрюх", "TROPICAL_FISH": "Тропическая рыба",
    }

    lines = []

    # Заголовок
    rank_str = f"#{rank}" if rank else "—"
    lines.append(f"Игрок: {player}  |  Место в топе: {rank_str}  |  Очки: {score}")

    # Уловы
    lines.append("")
    lines.append("Уловы")
    lines.append(f"  Всего поймано рыб:      {c.get('total_catches') or 0}")
    lines.append(f"  Обычных:                {c.get('common_caught') or 0}")
    lines.append(f"  Хороших:                {c.get('good_caught') or 0}")
    lines.append(f"  Редких:                 {c.get('rare_caught') or 0}")
    lines.append(f"  Легендарных (поймано):  {c.get('legendary_caught') or 0}")
    lines.append(f"  Мифических (поймано):   {c.get('mythic_caught') or 0}")
    lines.append(f"  Трофеев поймано всего:  {stats['total_trophy_caught']}")

    # По видам
    lines.append("")
    lines.append("По видам рыб")
    lines.append(f"  Треска:              {c.get('cod_caught') or 0}")
    lines.append(f"  Лосось:              {c.get('salmon_caught') or 0}")
    lines.append(f"  Иглобрюх:           {c.get('pufferfish_caught') or 0}")
    lines.append(f"  Тропическая рыба:   {c.get('tropical_caught') or 0}")

    # Коллекция
    lines.append("")
    lines.append("Коллекция трофеев")
    lines.append(f"  Трофеев в коллекции:    {o.get('owned_total') or 0}")
    lines.append(f"  Заклеймлено:            {o.get('owned_claimed') or 0}")
    lines.append(f"  Мифических:             {o.get('owned_mythic') or 0}")
    lines.append(f"  Легендарных:            {o.get('owned_legendary') or 0}")
    lines.append(f"  Выпущено в мир:         {o.get('released_count') or 0}")
    lines.append(f"  Очки за трофеи:         {o.get('trophy_score') or 0}")

    if bt:
        tier_label = "Мифический" if bt["tier"] == "mythic" else "Легендарный"
        fish_name  = FISH_NAMES.get(bt["fish_type"], bt["fish_type"])
        bt_score   = bt["rarity_score"] + bt.get("combo_bonus", 0)
        lines.append(f"  Лучший трофей:          {bt['fish_id']}  {tier_label} {fish_name}  {bt['weight']} кг  {bt_score} очков")

    # Передачи
    total_given  = sum(r["cnt"] for r in given)
    total_recvd  = sum(r["cnt"] for r in recvd)

    if total_given > 0 or total_recvd > 0:
        lines.append("")
        lines.append("История передач")
        lines.append(f"  Всего отдано:    {total_given}")
        lines.append(f"  Всего получено:  {total_recvd}")
        if given:
            lines.append("  Отдавал:")
            for r in given:
                lines.append(f"    {r['to_owner']}:  {r['cnt']} раз")
        if recvd:
            lines.append("  Получал:")
            for r in recvd:
                lines.append(f"    {r['from_owner']}:  {r['cnt']} раз")

    return "\n".join(lines), 200


# ── fishtop ───────────────────────────────────────────────────────

@app.route("/fishtop", methods=["GET"])
def fishtop():
    rows = run_async(get_leaderboard(limit=10))
    if not rows:
        return "Пока никто не поймал трофейную рыбу.", 200

    place_labels = ["🥇 1 место: ", "🥈 2 место: ", "🥉 3 место: "]
    lines = []
    for i, row in enumerate(rows):
        place = place_labels[i] if i < 3 else f"{i+1}."
        total = row.get("total_catches", 0)

        catches_parts = []
        if row.get("mythic_count"):    catches_parts.append(f"мифических: {row['mythic_count']}")
        if row.get("legendary_count"): catches_parts.append(f"легендарных: {row['legendary_count']}")
        catches_str = ", ".join(catches_parts) if catches_parts else "трофейных уловов нет"

        owned_parts = []
        if row.get("owned_mythic"):    owned_parts.append(f"{row['owned_mythic']} мифические")
        if row.get("owned_legendary"): owned_parts.append(f"{row['owned_legendary']} легендарные")
        owned_str = f" {', '.join(owned_parts)}" if owned_parts else ""

        score_fmt = f"{row['total_score']:,}".replace(",", " ")
        lines.append(
            f"§f{place} {row['player']} §d- {score_fmt} очков§r\n"
            f"§7   Всего поймано рыб: {total}"
            + (f"\n§7   Трофеи: {owned_str.strip()}" if owned_str else "")
        )

    return "\n\n".join(lines), 200


# ── Flask startup ─────────────────────────────────────────────────

def start_api():
    app.run(host="127.0.0.1", port=7842, debug=False, use_reloader=False)


def run_api_thread():
    t = threading.Thread(target=start_api, daemon=True)
    t.start()
    print("[FishBot] Flask API запущен на http://127.0.0.1:7842")


_bot_instance = None


def set_bot(bot):
    global _bot_instance
    _bot_instance = bot


# ── async helpers ─────────────────────────────────────────────────

async def _update_card(fish_id: str):
    from database import get_fish, get_transfers
    from card import build_card, FishDetailsView

    fish = await get_fish(fish_id)
    if not fish or not fish.get("discord_message_id"):
        return
    transfers = await get_transfers(fish_id)
    channel = _bot_instance.get_channel(_bot_instance.fish_channel_id)
    if not channel:
        return
    try:
        msg   = await channel.fetch_message(int(fish["discord_message_id"]))
        embed = build_card(fish, transfers)
        view  = FishDetailsView(fish_id) if fish.get("claimed") else None
        await msg.edit(embed=embed, view=view)
    except Exception as e:
        print(f"[API] Ошибка обновления карточки: {e}")


async def _update_card_and_register_view(fish_id: str):
    """Обновляет карточку и регистрирует persistent view после клейма."""
    from database import get_fish, get_transfers
    from card import build_card, FishDetailsView

    fish = await get_fish(fish_id)
    if not fish or not fish.get("discord_message_id"):
        return
    transfers = await get_transfers(fish_id)
    channel = _bot_instance.get_channel(_bot_instance.fish_channel_id)
    if not channel:
        return
    try:
        msg   = await channel.fetch_message(int(fish["discord_message_id"]))
        embed = build_card(fish, transfers)
        view  = None
        if fish.get("claimed"):
            view = FishDetailsView(fish_id)
            _bot_instance.add_view(view)  # регистрируем persistent view
        await msg.edit(embed=embed, view=view)
    except Exception as e:
        print(f"[API] Ошибка обновления карточки: {e}")


async def _do_notify_transfer(
    fish_id: str, from_player: str, to_player: str,
    to_discord_id: str | None, expires_at: str,
):
    from transfer_view import notify_transfer_pending
    await notify_transfer_pending(
        _bot_instance,
        _bot_instance.fish_channel_id,
        fish_id, from_player, to_player, to_discord_id,
    )


async def _accept_and_update(fish_id: str, pending: dict):
    await _update_card(fish_id)
    channel = _bot_instance.get_channel(_bot_instance.fish_channel_id)

    # Редактируем сообщение с кнопками (если передача через /ftaccept в игре)
    if pending.get("discord_message_id") and channel:
        try:
            import discord as _discord
            msg = await channel.fetch_message(int(pending["discord_message_id"]))
            embed = _discord.Embed(
                title="✅ Передача завершена",
                description=(
                    f"Рыба `{fish_id}` теперь принадлежит **{pending['to_player']}**."
                ),
                color=0x57f287,
            )
            await msg.edit(embed=embed, view=None)
        except Exception as e:
            print(f"[API] Не удалось обновить Discord-уведомление о передаче: {e}")

    # Отправляем новое сообщение — останется в истории канала
    if channel:
        try:
            import discord as _discord
            from database import get_fish as _get_fish
            from card import FISH_NAMES as _FISH_NAMES
            fish = await _get_fish(fish_id)
            fish_name = _FISH_NAMES.get(fish["fish_type"], fish["fish_type"]) if fish else fish_id
            announce = _discord.Embed(
                title="🤝 Трофей передан",
                description=(
                    f"**{pending['from_player']}** передал **{fish_name}** (`{fish_id}`) "
                    f"игроку **{pending['to_player']}**."
                ),
                color=0x57f287,
            )
            announce.set_footer(text="NFT • totemcraft.net")
            await channel.send(embed=announce)
        except Exception as e:
            print(f"[API] Не удалось отправить анонс передачи: {e}")


async def _decline_and_update(fish_id: str, pending: dict):
    if pending.get("discord_message_id"):
        channel = _bot_instance.get_channel(_bot_instance.fish_channel_id)
        if channel:
            try:
                import discord as _discord
                msg = await channel.fetch_message(int(pending["discord_message_id"]))
                embed = _discord.Embed(
                    title="❌ Передача отклонена",
                    description=(
                        f"**{pending['to_player']}** отклонил передачу `{fish_id}`."
                    ),
                    color=0xed4245,
                )
                await msg.edit(embed=embed, view=None)
            except Exception as e:
                print(f"[API] Не удалось обновить Discord-уведомление: {e}")
