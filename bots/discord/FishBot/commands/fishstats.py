import discord
from discord import app_commands
from database import get_player_stats
from datetime import datetime
import asyncio


FISH_NAMES = {
    "COD":           "Треска",
    "SALMON":        "Лосось",
    "PUFFERFISH":    "Иглобрюх",
    "TROPICAL_FISH": "Тропическая рыба",
}


def setup(tree: app_commands.CommandTree, guild: discord.Object):
    @tree.command(
        name="fishstats",
        description="Полная статистика рыбака",
        guild=guild
    )
    @app_commands.describe(player="Minecraft-ник (по умолчанию — твой ник)")
    async def fishstats(interaction: discord.Interaction, player: str | None = None):
        await interaction.response.defer(ephemeral=False)

        target = player.strip() if player else interaction.user.name
        stats  = await get_player_stats(target)
        c      = stats["catches"]
        o      = stats["owned"]

        if not c.get("total_catches"):
            await interaction.followup.send(
                f"Игрок **{target}** ещё не поймал ни одной рыбы.",
            )
            return

        rank      = stats["leaderboard_rank"]
        score     = stats["total_score"]
        rank_str  = f"#{rank}" if rank else "—"
        bt        = stats["best_trophy"]
        given     = stats["transfers_given"]
        recvd     = stats["transfers_received"]

        color = 0xd32ce6 if (o.get("owned_mythic") or 0) > 0 else 0xFFD700

        embed = discord.Embed(
            title=f"Статистика рыбака — {target}",
            color=color,
        )

        # Общие очки и место
        embed.add_field(
            name="Итого",
            value=(
                f"**Место в топе:** {rank_str}\n"
                f"**Общие очки:** {score:,}".replace(",", " ")
            ),
            inline=False,
        )

        # Уловы по тирам
        embed.add_field(
            name="Уловы",
            value=(
                f"Всего поймано рыб:       **{c.get('total_catches') or 0}**\n"
                f"Обычных:                 **{c.get('common_caught') or 0}**\n"
                f"Хороших:                 **{c.get('good_caught') or 0}**\n"
                f"Редких:                  **{c.get('rare_caught') or 0}**\n"
                f"Легендарных поймано:     **{c.get('legendary_caught') or 0}**\n"
                f"Мифических поймано:      **{c.get('mythic_caught') or 0}**\n"
                f"Трофеев поймано всего:   **{stats['total_trophy_caught']}**"
            ),
            inline=True,
        )

        # По видам
        embed.add_field(
            name="По видам рыб",
            value=(
                f"Треска:              **{c.get('cod_caught') or 0}**\n"
                f"Лосось:              **{c.get('salmon_caught') or 0}**\n"
                f"Иглобрюх:           **{c.get('pufferfish_caught') or 0}**\n"
                f"Тропическая рыба:   **{c.get('tropical_caught') or 0}**"
            ),
            inline=True,
        )

        # Коллекция трофеев
        trophy_lines = (
            f"Трофеев в коллекции:   **{o.get('owned_total') or 0}**\n"
            f"Заклеймлено:           **{o.get('owned_claimed') or 0}**\n"
            f"Мифических:            **{o.get('owned_mythic') or 0}**\n"
            f"Легендарных:           **{o.get('owned_legendary') or 0}**\n"
            f"Выпущено в мир:        **{o.get('released_count') or 0}**\n"
            f"Очки за трофеи:        **{o.get('trophy_score') or 0}**"
        )
        if bt:
            tier_label = "Мифический" if bt["tier"] == "mythic" else "Легендарный"
            fish_name  = FISH_NAMES.get(bt["fish_type"], bt["fish_type"])
            bt_score   = bt["rarity_score"] + bt.get("combo_bonus", 0)
            trophy_lines += (
                f"\nЛучший трофей:\n"
                f"`{bt['fish_id']}` — {tier_label} {fish_name}\n"
                f"{bt['weight']} кг • {bt_score} очков"
            )
        embed.add_field(name="Коллекция трофеев", value=trophy_lines, inline=False)

        # Передачи
        total_given = sum(r["cnt"] for r in given)
        total_recvd = sum(r["cnt"] for r in recvd)

        if total_given > 0 or total_recvd > 0:
            transfer_lines = (
                f"Всего отдано:    **{total_given}**\n"
                f"Всего получено:  **{total_recvd}**"
            )
            if given:
                transfer_lines += "\n\nОтдавал:"
                for r in given:
                    transfer_lines += f"\n  {r['to_owner']} — {r['cnt']} раз"
            if recvd:
                transfer_lines += "\n\nПолучал:"
                for r in recvd:
                    transfer_lines += f"\n  {r['from_owner']} — {r['cnt']} раз"
            embed.add_field(name="История передач", value=transfer_lines, inline=False)

        embed.set_footer(text="TotemCraft Fish NFT • totemcraft.net")

        msg = await interaction.followup.send(embed=embed)
        await asyncio.sleep(90)
        try:
            await msg.delete()
        except Exception:
            pass