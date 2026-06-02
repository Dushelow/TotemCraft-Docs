import discord
from discord import app_commands
from database import get_fish, claim_fish, get_transfers
from card import build_card, FishDetailsView


def setup(tree: app_commands.CommandTree, guild: discord.Object):
    @tree.command(
        name="claim",
        description="Заклеймить рыбу на свой Discord аккаунт",
        guild=guild
    )
    @app_commands.describe(fish_id="ID рыбы (например SAL-A3F7C2)")
    async def claim(interaction: discord.Interaction, fish_id: str):
        await interaction.response.defer(ephemeral=True)
        fish = await get_fish(fish_id.upper())

        if not fish:
            await interaction.followup.send(f"❌ Рыба `{fish_id}` не найдена.", ephemeral=True)
            return

        if fish.get("claimed"):
            await interaction.followup.send(
                f"❌ Рыба `{fish_id}` уже заклеймлена.", ephemeral=True
            )
            return

        discord_id = str(interaction.user.id)
        await claim_fish(fish_id.upper(), discord_id)

        updated_fish = await get_fish(fish_id.upper())
        transfers = await get_transfers(fish_id.upper())

        await interaction.followup.send(
            f"✅ Рыба `{fish_id}` заклеймлена на твой аккаунт!", ephemeral=True
        )

        try:
            chronicle_channel_id = int(interaction.client.chronicle_channel_id)
            channel = interaction.client.get_channel(chronicle_channel_id)
            if channel and updated_fish.get("discord_message_id"):
                msg = await channel.fetch_message(int(updated_fish["discord_message_id"]))
                embed = build_card(updated_fish, transfers)
                view = FishDetailsView(fish_id.upper())
                interaction.client.add_view(view)  # регистрируем persistent view
                await msg.edit(embed=embed, view=view)
        except Exception as e:
            print(f"[claim] Не удалось обновить карточку: {e}")
