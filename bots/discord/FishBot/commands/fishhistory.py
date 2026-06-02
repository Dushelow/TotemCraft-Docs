import discord
from discord import app_commands
from database import get_player_fish
from datetime import datetime
import asyncio


def setup(tree: app_commands.CommandTree, guild: discord.Object):
    @tree.command(
        name="fishhistory",
        description="Твой дневник рыбака — личная коллекция мифических рыб",
        guild=guild
    )
    async def fishhistory(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)

        player = interaction.user.name
        fish_list = await get_player_fish(player)

        if not fish_list:
            await interaction.followup.send(
                "У тебя пока нет мифических рыб. Лови больше!"
            )
            return

        total_score = sum(f["rarity_score"] + f.get("combo_bonus", 0) for f in fish_list)

        embed = discord.Embed(
            title=f"📖 Дневник рыбака — {player}",
            color=0xd32ce6
        )
        embed.add_field(
            name="Коллекция",
            value=f"**{len(fish_list)}** рыб • **{total_score}** очков",
            inline=False
        )

        FISH_NAMES = {
            "COD": "Треска",
            "SALMON": "Лосось",
            "PUFFERFISH": "Иглобрюх",
            "TROPICAL_FISH": "Тропическая рыба",
        }

        lines = []
        for fish in fish_list[:10]:
            fish_name = FISH_NAMES.get(fish["fish_type"], fish["fish_type"])
            score = fish["rarity_score"] + fish.get("combo_bonus", 0)
            caught_at = fish["caught_at"]
            try:
                dt = datetime.fromisoformat(caught_at)
                date_str = dt.strftime("%d.%m.%Y")
            except Exception:
                date_str = caught_at
            claimed = "✅" if fish.get("claimed") else "🔓"
            lines.append(
                f"{claimed} `{fish['fish_id']}` — {fish_name} {fish['weight']} кг • {score} очков • {date_str}"
            )

        if len(fish_list) > 10:
            lines.append(f"_...и ещё {len(fish_list) - 10} рыб_")

        embed.add_field(name="Рыбы", value="\n".join(lines), inline=False)
        embed.set_footer(text="TotemCraft Fish NFT • totemcraft.net")
        msg = await interaction.followup.send(embed=embed)
        await asyncio.sleep(90)
        try:
            await msg.delete()
        except Exception:
            pass