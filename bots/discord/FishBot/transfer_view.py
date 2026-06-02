"""
transfer_view.py
Discord UI (кнопки) для подтверждения/отклонения pending transfers,
и хелпер для отправки уведомления в #chronicle.
"""

import discord
from card import FISH_NAMES
from database import get_pending_transfer, transfer_fish, delete_pending_transfer, get_fish


class TransferConfirmView(discord.ui.View):
    """Embed с кнопками «Принять» / «Отклонить», живёт 1 минуту."""

    def __init__(self, fish_id: str, from_player: str, to_player: str, to_discord_id: str | None):
        super().__init__(timeout=60)
        self.fish_id      = fish_id
        self.from_player  = from_player
        self.to_player    = to_player
        self.to_discord_id = to_discord_id

    async def _check_actor(self, interaction: discord.Interaction) -> bool:
        """Разрешаем кликнуть только получателю (если Discord привязан)."""
        if self.to_discord_id and str(interaction.user.id) != self.to_discord_id:
            await interaction.response.send_message(
                "❌ Это предложение не для тебя.", ephemeral=True
            )
            return False
        if not self.to_discord_id:
            await interaction.response.send_message(
                f"❌ У игрока **{self.to_player}** не привязан Discord. "
                f"Подтверди в игре: `/ftaccept {self.fish_id}`",
                ephemeral=True,
            )
            return False
        return True

    @discord.ui.button(label="✅ Принять", style=discord.ButtonStyle.success)
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await self._check_actor(interaction):
            return

        pending = await get_pending_transfer(self.fish_id)
        if not pending:
            await interaction.response.edit_message(
                embed=discord.Embed(
                    title="⏰ Предложение истекло",
                    color=0xfaa61a,
                ),
                view=None,
            )
            return

        await transfer_fish(self.fish_id, self.from_player, self.to_player)
        await delete_pending_transfer(self.fish_id)

        # Обновить карточку в хронике
        from api import _update_card, _bot_instance
        import asyncio
        if _bot_instance:
            asyncio.ensure_future(_update_card(self.fish_id))

        # Редактируем сообщение с кнопками
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="✅ Передача завершена",
                description=f"Рыба `{self.fish_id}` теперь принадлежит **{self.to_player}**.",
                color=0x57f287,
            ),
            view=None,
        )

        # Отправляем новое сообщение — останется в истории канала
        channel = interaction.channel
        if channel:
            fish = await get_fish(self.fish_id)
            fish_name = FISH_NAMES.get(fish["fish_type"], fish["fish_type"]) if fish else self.fish_id
            announce = discord.Embed(
                title="🤝 Трофей передан",
                description=(
                    f"**{self.from_player}** передал **{fish_name}** (`{self.fish_id}`) "
                    f"игроку **{self.to_player}**."
                ),
                color=0x57f287,
            )
            announce.set_footer(text="NFT • totemcraft.net")
            await channel.send(embed=announce)

    @discord.ui.button(label="❌ Отклонить", style=discord.ButtonStyle.danger)
    async def decline(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await self._check_actor(interaction):
            return

        await delete_pending_transfer(self.fish_id)

        await interaction.response.edit_message(
            embed=discord.Embed(
                title="❌ Передача отклонена",
                description=f"**{self.to_player}** отклонил предложение о передаче `{self.fish_id}`.",
                color=0xed4245,
            ),
            view=None,
        )

# При таймауте View становится неактивным, но сообщение не редактируем
# (бот может быть оффлайн). Expired записи сами удалятся из БД.
    async def on_timeout(self):
        try:      
            if self.message:
                await self.message.edit(
                    embed=discord.Embed(
                        title="⏰ Предложение истекло",
                        description=f"Передача `{self.fish_id}` отменена — время вышло.",
                        color=0xfaa61a,
                    ),
                    view=None,
                )
        except Exception:
            pass


async def notify_transfer_pending(
    bot: discord.Client,
    chronicle_channel_id: int,
    fish_id: str,
    from_player: str,
    to_player: str,
    to_discord_id: str | None,
):
    """Постит уведомление в #chronicle с кнопками подтверждения."""
    channel = bot.get_channel(chronicle_channel_id)
    if not channel:
        return

    fish = await get_fish(fish_id)
    fish_name = FISH_NAMES.get(fish["fish_type"], fish["fish_type"]) if fish else fish_id

    mention = f"<@{to_discord_id}>" if to_discord_id else f"**{to_player}**"

    embed = discord.Embed(
        title="📦 Предложение о передаче трофея",
        description=(
            f"{mention}, игрок **{from_player}** хочет передать тебе:\n"
            f"**{fish_name}** • `{fish_id}`\n\n"
            f"Нажми кнопку ниже или используй в игре:\n"
            f"`/ftaccept {fish_id}` — принять\n"
            f"`/ftdecline {fish_id}` — отклонить\n\n"
            f"⏰ Предложение истекает через **1 минуту**."
        ),
        color=0xd32ce6,
    )
    embed.set_footer(text="TotemCraft Fish NFT • totemcraft.net")

    view = TransferConfirmView(fish_id, from_player, to_player, to_discord_id)
    msg = await channel.send(embed=embed, view=view)
    view.message = msg  # ← добавь эту строку

    # Сохраняем message_id чтобы позже можно было отредактировать
    from database import create_pending_transfer
    from datetime import datetime, timedelta
    expires_at = (datetime.utcnow() + timedelta(minutes=1)).isoformat()
    await create_pending_transfer(fish_id, from_player, to_player, expires_at, str(msg.id))
