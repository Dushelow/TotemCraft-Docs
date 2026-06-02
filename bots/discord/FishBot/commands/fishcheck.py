import discord
from discord import app_commands
from database import get_fish, get_transfers
from card import build_full_card
import asyncio


def setup(tree: app_commands.CommandTree, guild: discord.Object):
    @tree.command(
        name="fishcheck",
        description="Показать карточку рыбы по ID",
        guild=guild
    )
    @app_commands.describe(fish_id="ID рыбы (например SAL-A3F7C2)")
    async def fishcheck(interaction: discord.Interaction, fish_id: str):
        await interaction.response.defer(ephemeral=False)
        fish = await get_fish(fish_id.upper())
        if not fish:
            await interaction.followup.send(
                f"❌ Рыба с ID `{fish_id}` не найдена.", ephemeral=True
            )
            return
        transfers = await get_transfers(fish_id.upper())
        embed = build_full_card(fish, transfers)
        msg = await interaction.followup.send(embed=embed)
        await asyncio.sleep(90)
        try:
            await msg.delete()
        except Exception:
            pass
