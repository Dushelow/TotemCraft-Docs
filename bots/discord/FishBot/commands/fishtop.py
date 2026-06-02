import discord
from discord import app_commands
from database import get_leaderboard
import asyncio


def setup(tree: app_commands.CommandTree, guild: discord.Object):
    @tree.command(
        name="fishtop",
        description="Топ рыбаков по очкам коллекции",
        guild=guild
    )
    async def fishtop(interaction: discord.Interaction):
        await interaction.response.defer()
        rows = await get_leaderboard(10)
        if not rows:
            await interaction.followup.send("Пока никто не поймал трофейную рыбу.", ephemeral=True)
            return

        embed = discord.Embed(
            title="🏆 Топ рыбаков ТотемКрафта",
            color=0xd32ce6
        )
        place_labels = ["🥇 1 место: ", "🥈 2 место: ", "🥉 3 место: "]
        lines = []
        for i, row in enumerate(rows):
            place = place_labels[i] if i < 3 else f"{i+1}."

            total = row.get("total_catches", 0)

            catches_parts = []
            if row.get("mythic_count"):    catches_parts.append(f"мифических: {row['mythic_count']}")
            if row.get("legendary_count"): catches_parts.append(f"легендарных: {row['legendary_count']}")
            if row.get("rare_count"):      catches_parts.append(f"редких: {row['rare_count']}")
            if row.get("good_count"):      catches_parts.append(f"хороших: {row['good_count']}")
            if row.get("common_count"):    catches_parts.append(f"обычных: {row['common_count']}")
            catches_str = ", ".join(catches_parts) if catches_parts else "трофейных уловов нет"

            owned_parts = []
            if row.get("owned_mythic"):    owned_parts.append(f"{row['owned_mythic']} мифические трофеи")
            if row.get("owned_legendary"): owned_parts.append(f"{row['owned_legendary']} легендарные трофеи")
            owned_str = f"\n  {', '.join(owned_parts)}" if owned_parts else ""

            score_fmt = f"{row['total_score']:,}".replace(",", " ")

            lines.append(
                f"**{place} {row['player']}** — {score_fmt} очков\n"
                f"   Всего поймано рыб: {total}"
                + (f"\n   Трофеи: {owned_str.strip()}" if owned_str else "")
            )

        embed.description = "\n\n".join(lines)
        embed.set_footer(text="Очки за трофеи привязаны к текущему владельцу · TotemCraft")
        msg = await interaction.followup.send(embed=embed)
        await asyncio.sleep(90)
        try:
            await msg.delete()
        except Exception:
            pass
