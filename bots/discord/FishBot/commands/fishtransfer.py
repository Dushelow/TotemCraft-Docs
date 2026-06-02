import discord
from discord import app_commands
from database import get_fish, get_pending_transfer
from transfer_view import notify_transfer_pending


def setup(tree: app_commands.CommandTree, guild: discord.Object):

    @tree.command(
        name="fishtransfer",
        description="Предложить рыбу другому игроку",
        guild=guild
    )
    @app_commands.describe(
        recipient="Minecraft-ник получателя",
        fish_id="ID рыбы (укажи явно если у тебя несколько трофеев)",
    )
    async def fishtransfer(
        interaction: discord.Interaction,
        recipient: str,
        fish_id: str | None = None,
    ):
        await interaction.response.defer(ephemeral=True)

        discord_id = str(interaction.user.id)

        from api import check_discord_link

        # Если fish_id не указан — ищем единственную рыбу игрока
        if not fish_id:
            from database import get_player_fish
            owned = await get_player_fish(interaction.user.name)
            owned = [f for f in owned if f.get("discord_id") == discord_id]
            if not owned:
                await interaction.followup.send(
                    "❌ У тебя нет заклеймленных рыб. Укажи ID явно: `/fishtransfer <получатель> <ID>`",
                    ephemeral=True,
                )
                return
            if len(owned) > 1:
                ids = ", ".join(f"`{f['fish_id']}`" for f in owned[:5])
                await interaction.followup.send(
                    f"❌ У тебя несколько рыб — укажи ID явно: `/fishtransfer <получатель> <ID>`\n"
                    f"Твои рыбы: {ids}",
                    ephemeral=True,
                )
                return
            fish_id = owned[0]["fish_id"]

        fish_id = fish_id.upper()
        fish = await get_fish(fish_id)

        if not fish:
            await interaction.followup.send(f"❌ Рыба `{fish_id}` не найдена.", ephemeral=True)
            return

        # Проверяем что рыба заклеймлена
        if not fish.get("claimed"):
            await interaction.followup.send(
                f"❌ Рыба `{fish_id}` не заклеймлена. Сначала заклейми её командой `/claim {fish_id}`.",
                ephemeral=True,
            )
            return

        if fish.get("discord_id") != discord_id:
            await interaction.followup.send("❌ Ты не являешься владельцем этой рыбы.", ephemeral=True)
            return

        if fish["current_owner"].lower() == recipient.lower():
            await interaction.followup.send("❌ Нельзя передать рыбу самому себе.", ephemeral=True)
            return

        existing = await get_pending_transfer(fish_id)
        if existing:
            await interaction.followup.send(
                f"❌ Уже есть активное предложение передать `{fish_id}` игроку **{existing['to_player']}**.\n"
                f"Оно истекает автоматически через 1 минуту.",
                ephemeral=True,
            )
            return

        to_discord_id = check_discord_link(recipient)

        await notify_transfer_pending(
            interaction.client,
            interaction.client.chronicle_channel_id,
            fish_id,
            fish["current_owner"],
            recipient,
            to_discord_id,
        )

        recipient_mention = f"<@{to_discord_id}>" if to_discord_id else f"**{recipient}**"
        await interaction.followup.send(
            f"📦 Предложение отправлено {recipient_mention}.\n"
            f"Рыба `{fish_id}` будет передана после подтверждения (1 минута).",
            ephemeral=True,
        )
