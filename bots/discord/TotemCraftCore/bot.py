"""TotemCraftCore: замена закрывшейся Лакуны на сервере TotemCraft.

Пять задач:
1. Галочка в «регистрации» выдаёт роли Verified и «Игрок сервера».
2. Журнал событий Дискорда в «логи-дискорда» (кроме изменений каналов ботами).
3. Личные голосовые комнаты: заход в «войсчат» создаёт комнату игрока.
4. Галерея: тред под постом и реакция 👍.
5. Ивенты: тред под анонсом.
6. Ящик задач: /dushelow, /totemcraft, /adminbot, /admin (одно и то же) в админ-чате записывают задачу в базу.
   Команды скрыты от всех без права «Отправка в тайм-аут», писать могут модератор и выше и владелец.
   Задачи разбирает Claude на утреннем и вечернем обходе и отвечает в админ-чат.
"""
import asyncio
import json
import os
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import tasks
from dotenv import load_dotenv

import logic
from storage import Storage

load_dotenv(os.getenv("TOTEMCRAFTCORE_ENV", "/home/totemcraftcore/.env"))


def _id(name: str) -> int:
    return int(os.environ[name])


BOT_TOKEN          = os.environ["BOT_TOKEN"]
GUILD_ID           = _id("GUILD_ID")
LOG_CHANNEL_ID     = _id("LOG_CHANNEL_ID")
VERIFY_CHANNEL_ID  = _id("VERIFY_CHANNEL_ID")
VERIFY_EMOJI       = os.getenv("VERIFY_EMOJI", "✅")
VERIFY_ROLE_IDS    = [int(x) for x in os.environ["VERIFY_ROLE_IDS"].split(",") if x.strip()]
GALLERY_CHANNEL_ID = _id("GALLERY_CHANNEL_ID")
GALLERY_REACTION   = os.getenv("GALLERY_REACTION", "👍")
EVENTS_CHANNEL_ID  = _id("EVENTS_CHANNEL_ID")
VOICE_HUB_ID       = _id("VOICE_HUB_CHANNEL_ID")
VOICE_CATEGORY_ID  = _id("VOICE_CATEGORY_ID")
DB_PATH            = os.getenv("DB_PATH", "/home/totemcraftcore/totemcraftcore.db")
MESSAGE_KEEP_DAYS  = int(os.getenv("MESSAGE_KEEP_DAYS", "30"))
ADMIN_CHAT_ID      = int(os.getenv("ADMIN_CHAT_ID", "1454170538095153252"))
SERVER_BOT_ID      = int(os.getenv("SERVER_BOT_ID", "1559465125055037540"))  # «TotemCraft | Ванильный сервер»
SERVER_BOT_NAME    = "TotemCraft | Ванильный сервер"
DUTY_DIR           = os.getenv("DUTY_DIR", "/var/lib/tcclaude")  # дежурный Claude (служба tcclaude-duty)

GREEN, RED, ORANGE = 0x43B581, 0xF04747, 0xFAA61A

intents = discord.Intents.default()
intents.members = True
intents.message_content = True


def log(text: str):
    print(f"[TotemCraftCore] {text}", flush=True)


def who(user) -> str:
    if user is None:
        return "неизвестно"
    return f"{user.mention} ({user.name})"


def embed(title: str, color: int, description: str | None = None,
          fields: list[tuple[str, str, bool]] = (), footer: str | None = None) -> discord.Embed:
    e = discord.Embed(title=title, color=color, description=description,
                      timestamp=datetime.now(timezone.utc))
    for name, value, inline in fields:
        e.add_field(name=name, value=logic.truncate(value or "-", logic.FIELD_MAX), inline=inline)
    if footer:
        e.set_footer(text=footer)
    return e


class TotemCraftCore(discord.Client):
    def __init__(self):
        super().__init__(intents=intents)
        self.store = Storage(DB_PATH)
        self._room_lock = asyncio.Lock()
        self.tree = app_commands.CommandTree(self)

    # ── служебное ────────────────────────────────────────────────
    async def setup_hook(self):
        self._prune_loop.start()
        if os.path.isdir(os.path.join(DUTY_DIR, "outbox")):
            self._duty_loop.start()
        for name in logic.TASK_COMMANDS:
            cmd = app_commands.Command(name=name, description="Задача для Claude: разберёт на ближайшем обходе",
                                       callback=self._task_command)
            cmd.default_permissions = discord.Permissions(moderate_members=True)  # игрокам команды не видны
            cmd.guild_only = True
            self.tree.add_command(cmd, guild=discord.Object(id=GUILD_ID))
        await self.tree.sync(guild=discord.Object(id=GUILD_ID))

    async def on_ready(self):
        log(f"Запущен как {self.user}")
        await self._cleanup_rooms()

    @tasks.loop(hours=6)
    async def _prune_loop(self):
        removed = self.store.prune_messages(MESSAGE_KEEP_DAYS)
        if removed:
            log(f"Забыто старых сообщений: {removed}")

    # ── 6. ящик задач ────────────────────────────────────────────
    @app_commands.describe(задача="Что сделать; можно ссылки на темы и сообщения")
    async def _task_command(self, interaction: discord.Interaction, задача: str):
        user = interaction.user
        role_ids = [r.id for r in getattr(user, "roles", [])]
        if not logic.may_give_task(role_ids, user.id, interaction.guild.owner_id if interaction.guild else 0):
            await interaction.response.send_message("Команда для модераторов, администрации и владельца.", ephemeral=True)
            return
        if interaction.channel_id != ADMIN_CHAT_ID:
            await interaction.response.send_message(f"Команда работает только в <#{ADMIN_CHAT_ID}>.", ephemeral=True)
            return
        task_id = self.store.add_task(user.id, user.display_name, interaction.channel_id, задача)
        waiting = self.store.open_tasks()
        await interaction.response.send_message(logic.task_ack(task_id, задача, waiting), ephemeral=True)
        # саму задачу видят все в админ-чате: карточка от «TotemCraft | Ванильный сервер»
        urgent = logic.is_urgent(задача)
        duty = urgent and os.path.isdir(os.path.join(DUTY_DIR, "inbox"))
        who = logic.author_label(user.id, interaction.guild.owner_id)
        await self._as_server(interaction.channel, embed=logic.task_card(task_id, who, задача, duty))
        if urgent:
            if duty:
                try:
                    await self._to_duty(task_id, user, задача, interaction.channel)
                except Exception as ex:  # дежурный недоступен: задача остаётся в ящике на обход
                    log(f"Срочная задача #{task_id} дежурному не передана: {ex}")

    async def _to_duty(self, task_id, user, text, channel):
        """Задача дежурному: текст, последние сообщения админ-чата и темы по ссылкам (картинки отдельно)."""
        pics = os.path.join(DUTY_DIR, "files", str(task_id))
        os.makedirs(pics, exist_ok=True)
        parts, saved = [], 0

        async def dump(ch, limit, title):
            nonlocal saved
            lines = []
            async for m in ch.history(limit=limit):
                line = f"[{m.created_at:%Y-%m-%d %H:%M} UTC] {m.author.display_name}: {m.content}"
                for a in m.attachments:
                    if a.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and saved < 6 and a.size < 8_000_000:
                        saved += 1
                        name = f"{saved}_{os.path.basename(a.filename)}"
                        await a.save(os.path.join(pics, name))
                        line += f" [картинка {name}]"
                    else:
                        line += f" [вложение {a.filename}]"
                lines.append(line)
            parts.append(f"== {title}\n" + "\n".join(reversed(lines)))

        await dump(channel, 10, "последние сообщения админ-чата")
        for ch_id in logic.linked_channels(text, GUILD_ID):
            ch = self.get_channel(ch_id) or await self.fetch_channel(ch_id)
            await dump(ch, 100, f"#{getattr(ch, 'name', ch_id)}")
        task = {"id": task_id, "author_id": user.id, "author_name": user.display_name, "text": text,
                "when": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"), "context": "\n\n".join(parts)}
        tmp = os.path.join(DUTY_DIR, "inbox", f".{task_id}.json")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(task, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(DUTY_DIR, "inbox", f"{task_id}.json"))

    @tasks.loop(seconds=10)
    async def _duty_loop(self):
        """Готовые ответы дежурного: публикуем в админ-чат от имени бота сервера и закрываем задачу."""
        folder = os.path.join(DUTY_DIR, "outbox")
        for name in sorted(n for n in os.listdir(folder) if n.endswith(".json") and not n.startswith(".")):
            path = os.path.join(folder, name)
            try:
                with open(path, encoding="utf-8") as f:
                    res = json.load(f)
                if res.get("kind") == "routine":  # итог обхода по расписанию
                    channel = self.get_channel(ADMIN_CHAT_ID)
                    if channel is not None:
                        await self._as_server(channel, embed=logic.routine_card(res.get("title"), res.get("ok"), res.get("answer")))
                    continue
                if res.get("kind") == "app":  # заявка Telegram, которую дежурный оставил людям
                    channel = self.get_channel(ADMIN_CHAT_ID)
                    if channel is not None:
                        await self._as_server(channel, embed=logic.app_card(res.get("nick") or "?", res.get("answer")))
                    continue
                task = self.store.get_task(int(res["id"])) or {}
                guild = self.get_guild(GUILD_ID)
                who = logic.author_label(task["author_id"], guild.owner_id if guild else 0) if task.get("author_id") else "?"
                channel = self.get_channel(ADMIN_CHAT_ID)
                if channel is not None:
                    await self._as_server(channel, embed=logic.answer_card(int(res["id"]), who, res.get("ok"), res.get("answer")))
                if res.get("ok"):
                    self.store.set_task_status(int(res["id"]), "done")
            except Exception as ex:
                log(f"Ответ дежурного {name} не опубликован: {ex}")
            finally:
                os.remove(path)

    @_duty_loop.before_loop
    async def _before_duty_loop(self):
        await self.wait_until_ready()

    async def _as_server(self, channel, text: str | None = None, embed: dict | None = None):
        """Сообщение в канал под именем и аватаркой бота «TotemCraft | Ванильный сервер» (вебхук Core)."""
        try:
            hook = next((h for h in await channel.webhooks() if h.name == SERVER_BOT_NAME and h.user == self.user), None)
            if hook is None:
                server_bot = await self.fetch_user(SERVER_BOT_ID)
                hook = await channel.create_webhook(name=SERVER_BOT_NAME, avatar=await server_bot.display_avatar.read(),
                                                    reason="Ответы ящика задач от имени бота сервера")
            await hook.send(text or discord.utils.MISSING, embed=discord.Embed.from_dict(embed) if embed else discord.utils.MISSING,
                            allowed_mentions=discord.AllowedMentions.none())
        except discord.HTTPException as ex:
            log(f"Не удалось написать от имени бота сервера: {ex}")

    def _ours(self, guild) -> bool:
        return guild is not None and guild.id == GUILD_ID

    async def send_log(self, e: discord.Embed):
        channel = self.get_channel(LOG_CHANNEL_ID)
        if channel is None:
            log("Канал журнала не найден")
            return
        try:
            await channel.send(embed=e)
        except discord.HTTPException as ex:
            log(f"Не удалось записать в журнал: {ex}")

    async def audit(self, guild: discord.Guild, action: discord.AuditLogAction, target_id: int):
        """Запись журнала аудита про это действие: кто сделал и почему.

        Дискорд пишет аудит с небольшой задержкой, поэтому ждём секунду.
        """
        await asyncio.sleep(1.0)
        now = datetime.now(timezone.utc)
        try:
            async for entry in guild.audit_logs(limit=10, action=action):
                if getattr(entry.target, "id", None) == target_id and (now - entry.created_at).total_seconds() < 30:
                    return entry
        except discord.Forbidden:
            log("Нет права на просмотр журнала аудита")
        return None

    # ── 1. роли по галочке ───────────────────────────────────────
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        if payload.guild_id != GUILD_ID or payload.channel_id != VERIFY_CHANNEL_ID:
            return
        if str(payload.emoji) != VERIFY_EMOJI or payload.member is None or payload.member.bot:
            return
        member = payload.member
        have = {r.id for r in member.roles}
        roles = [member.guild.get_role(rid) for rid in VERIFY_ROLE_IDS if rid not in have]
        roles = [r for r in roles if r is not None]
        if not roles:
            return
        try:
            await member.add_roles(*roles, reason="Подтвердил правила в регистрации")
            log(f"Выданы роли {', '.join(r.name for r in roles)} игроку {member}")
        except discord.HTTPException as ex:
            log(f"Не удалось выдать роли {member}: {ex}")

    # ── 4, 5. галерея и ивенты; память сообщений ─────────────────
    async def on_message(self, message: discord.Message):
        if not self._ours(message.guild) or message.author.bot:
            return
        if message.channel.id != LOG_CHANNEL_ID:
            self.store.save_message(message.id, message.channel.id, message.author.id,
                                    message.author.name, message.content, len(message.attachments))
        if message.channel.id == GALLERY_CHANNEL_ID and (message.attachments or message.embeds):
            await self._thread_for(message, "Комментарии", GALLERY_REACTION)
        elif message.channel.id == EVENTS_CHANNEL_ID:
            await self._thread_for(message, "Обсуждение ивента", None)

    async def _thread_for(self, message: discord.Message, fallback: str, reaction: str | None):
        try:
            await message.create_thread(name=logic.thread_title(message.content, fallback))
            if reaction:
                await message.add_reaction(reaction)
        except discord.HTTPException as ex:
            log(f"Не удалось создать тред в #{message.channel}: {ex}")

    # ── 2. журнал: сообщения ─────────────────────────────────────
    async def on_raw_message_delete(self, payload: discord.RawMessageDeleteEvent):
        if payload.guild_id != GUILD_ID or payload.channel_id == LOG_CHANNEL_ID:
            return
        saved = self.store.get_message(payload.message_id)
        if saved is None:
            return  # сообщение бота или слишком старое: показать нечего
        self.store.forget_message(payload.message_id)
        await self.send_log(embed("Сообщение удалено", RED, fields=[
            ("Автор сообщения", f"<@{saved['author_id']}> ({saved['author_name']})", True),
            ("Канал", f"<#{payload.channel_id}>", True),
            ("Содержимое сообщения", logic.message_body(saved["content"], saved["attachments"]), False),
        ], footer=f"MID: {payload.message_id}"))

    async def on_raw_bulk_message_delete(self, payload: discord.RawBulkMessageDeleteEvent):
        if payload.guild_id != GUILD_ID or payload.channel_id == LOG_CHANNEL_ID:
            return
        lines = []
        for mid in sorted(payload.message_ids):
            saved = self.store.get_message(mid)
            if saved:
                self.store.forget_message(mid)
                body = logic.message_body(saved["content"], saved["attachments"]).replace("\n", " ")
                lines.append(f"{saved['author_name']}: {logic.truncate(body, 150)}")
        await self.send_log(embed("Массовое удаление сообщений", RED, fields=[
            ("Количество сообщений", str(len(payload.message_ids)), True),
            ("Канал", f"<#{payload.channel_id}>", True),
            ("Сообщения", "\n".join(lines) or "нет в памяти", False),
        ]))

    async def on_raw_message_edit(self, payload: discord.RawMessageUpdateEvent):
        if payload.guild_id != GUILD_ID or payload.channel_id == LOG_CHANNEL_ID:
            return
        data = payload.data
        if "content" not in data or data.get("author", {}).get("bot"):
            return
        saved = self.store.get_message(payload.message_id)
        new = data["content"]
        if saved is not None and saved["content"] == new:
            return  # поменялось только превью ссылки
        author = data.get("author", {})
        if saved is not None:
            self.store.update_content(payload.message_id, new)
        await self.send_log(embed("Сообщение изменено", ORANGE, fields=[
            ("Автор сообщения", f"<@{author.get('id')}> ({author.get('username', '?')})", True),
            ("Канал", f"<#{payload.channel_id}>", True),
            ("До изменения", saved["content"] if saved else "нет в памяти", False),
            ("После изменения", new or "-", False),
        ], footer=f"MID: {payload.message_id}"))

    # ── 2. журнал: ветки ─────────────────────────────────────────
    async def on_thread_create(self, thread: discord.Thread):
        if not self._ours(thread.guild) or thread.owner_id == self.user.id:
            return
        await self.send_log(embed("Ветка создана", GREEN,
            description=f"<@{thread.owner_id}> создаёт ветку {thread.mention}",
            fields=[("Канал", thread.parent.mention if thread.parent else "-", True),
                    ("Время автоархивации", logic.format_archive(thread.auto_archive_duration), True)],
            footer=f"TID: {thread.id}"))

    async def on_raw_thread_delete(self, payload: discord.RawThreadDeleteEvent):
        if payload.guild_id != GUILD_ID:
            return
        guild = self.get_guild(GUILD_ID)
        name = payload.thread.name if payload.thread else str(payload.thread_id)
        entry = await self.audit(guild, discord.AuditLogAction.thread_delete, payload.thread_id)
        await self.send_log(embed("Ветка удалена", RED,
            description=f"{who(entry.user) if entry else 'Кто-то'} удаляет ветку **{name}**",
            footer=f"TID: {payload.thread_id}"))

    async def on_thread_update(self, before: discord.Thread, after: discord.Thread):
        if not self._ours(after.guild) or before.name == after.name:
            return
        entry = await self.audit(after.guild, discord.AuditLogAction.thread_update, after.id)
        await self.send_log(embed("Ветка изменена", ORANGE,
            description=f"{who(entry.user) if entry else 'Кто-то'} изменяет название ветки {after.mention}",
            fields=[("До изменения", before.name, True), ("После изменения", after.name, True)],
            footer=f"TID: {after.id}"))

    # ── 2. журнал: каналы ────────────────────────────────────────
    async def on_guild_channel_create(self, channel):
        if not self._ours(channel.guild):
            return
        entry = await self.audit(channel.guild, discord.AuditLogAction.channel_create, channel.id)
        await self.send_log(embed("Канал создан", GREEN,
            description=f"{who(entry.user) if entry else 'Кто-то'} создаёт канал {channel.mention}",
            fields=[("Категория канала", channel.category.name if channel.category else "-", True),
                    ("Позиция канала", str(channel.position), True)],
            footer=f"CID: {channel.id}"))

    async def on_guild_channel_delete(self, channel):
        if not self._ours(channel.guild):
            return
        self.store.remove_room(channel.id)  # хозяин мог удалить комнату сам
        entry = await self.audit(channel.guild, discord.AuditLogAction.channel_delete, channel.id)
        await self.send_log(embed("Канал удалён", RED,
            description=f"{who(entry.user) if entry else 'Кто-то'} удаляет канал **#{channel.name}**",
            footer=f"CID: {channel.id}"))

    async def on_guild_channel_update(self, before, after):
        if not self._ours(after.guild):
            return
        fields = ("name", "topic", "user_limit", "slowmode_delay", "nsfw", "bitrate")
        changes = logic.channel_changes({f: getattr(before, f, None) for f in fields},
                                        {f: getattr(after, f, None) for f in fields})
        if not changes:
            return
        entry = await self.audit(after.guild, discord.AuditLogAction.channel_update, after.id)
        if entry is not None and entry.user is not None and entry.user.bot:
            return  # изменения от ботов (например, счётчик онлайна) не пишем
        out = []
        for label, b, a in changes:
            out += [(f"{label}: до", b, True), (f"{label}: после", a, True)]
        await self.send_log(embed("Канал изменён", ORANGE,
            description=f"{who(entry.user) if entry else 'Кто-то'} изменяет канал {after.mention}",
            fields=out, footer=f"CID: {after.id}"))

    # ── 2. журнал: участники ─────────────────────────────────────
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if not self._ours(after.guild):
            return
        added, removed = logic.role_diff({r.id for r in before.roles}, {r.id for r in after.roles})
        if added or removed:
            entry = await self.audit(after.guild, discord.AuditLogAction.member_role_update, after.id)
            actor = who(entry.user) if entry else "Кто-то"
            if added:
                await self.send_log(embed("Роль добавлена", GREEN,
                    description=f"{actor} добавляет роли пользователю {who(after)}",
                    fields=[("Роли", ", ".join(f"<@&{r}>" for r in added), False)],
                    footer=f"UID: {after.id}"))
            if removed:
                await self.send_log(embed("Роль убрана", RED,
                    description=f"{actor} убирает роли пользователя {who(after)}",
                    fields=[("Роли", ", ".join(f"<@&{r}>" for r in removed), False)],
                    footer=f"UID: {after.id}"))
        if before.nick != after.nick:
            entry = await self.audit(after.guild, discord.AuditLogAction.member_update, after.id)
            await self.send_log(embed("Участник изменён", ORANGE,
                description=f"{who(entry.user) if entry else 'Кто-то'} изменяет отображаемое имя участника {who(after)}",
                fields=[("До изменения", before.nick or "-", True), ("После изменения", after.nick or "-", True)],
                footer=f"UID: {after.id}"))
        change = logic.timeout_change(before.timed_out_until, after.timed_out_until, datetime.now(timezone.utc))
        if change:
            entry = await self.audit(after.guild, discord.AuditLogAction.member_update, after.id)
            fields = [("Пользователь", who(after), True),
                      ("Модератор", who(entry.user) if entry else "неизвестно", True),
                      ("Причина", (entry.reason if entry else None) or "-", False)]
            if change == "given":
                fields.insert(2, ("До", discord.utils.format_dt(after.timed_out_until, "f"), True))
            await self.send_log(embed("Заглушение выдано" if change == "given" else "Заглушение убрано",
                                      RED if change == "given" else GREEN, fields=fields,
                                      footer=f"UID: {after.id}"))

    async def on_user_update(self, before: discord.User, after: discord.User):
        if before.name == after.name:
            return
        guild = self.get_guild(GUILD_ID)
        if guild is None or guild.get_member(after.id) is None:
            return
        await self.send_log(embed("Пользователь изменён", ORANGE,
            description=f"{who(after)} изменяет своё имя пользователя",
            fields=[("До изменения", before.name, True), ("После изменения", after.name, True)],
            footer=f"UID: {after.id}"))

    async def on_member_ban(self, guild: discord.Guild, user):
        if not self._ours(guild):
            return
        entry = await self.audit(guild, discord.AuditLogAction.ban, user.id)
        await self.send_log(embed("Блокировка выдана", RED, fields=[
            ("Пользователь", who(user), True),
            ("Модератор", who(entry.user) if entry else "неизвестно", True),
            ("Причина", (entry.reason if entry else None) or "-", False),
        ], footer=f"UID: {user.id}"))

    async def on_member_unban(self, guild: discord.Guild, user):
        if not self._ours(guild):
            return
        entry = await self.audit(guild, discord.AuditLogAction.unban, user.id)
        await self.send_log(embed("Блокировка убрана", GREEN, fields=[
            ("Пользователь", who(user), True),
            ("Модератор", who(entry.user) if entry else "неизвестно", True),
            ("Причина", (entry.reason if entry else None) or "-", False),
        ], footer=f"UID: {user.id}"))

    # ── 2. журнал: роли сервера ──────────────────────────────────
    async def on_guild_role_create(self, role: discord.Role):
        if not self._ours(role.guild):
            return
        entry = await self.audit(role.guild, discord.AuditLogAction.role_create, role.id)
        await self.send_log(embed("Роль создана", GREEN,
            description=f"{who(entry.user) if entry else 'Кто-то'} создаёт роль {role.mention}",
            fields=[("Цвет роли", f"`{role.color}`", True), ("Позиция роли", str(role.position), True)],
            footer=f"RID: {role.id}"))

    async def on_guild_role_delete(self, role: discord.Role):
        if not self._ours(role.guild):
            return
        entry = await self.audit(role.guild, discord.AuditLogAction.role_delete, role.id)
        await self.send_log(embed("Роль удалена", RED,
            description=f"{who(entry.user) if entry else 'Кто-то'} удаляет роль **@{role.name}**",
            footer=f"RID: {role.id}"))

    async def on_guild_role_update(self, before: discord.Role, after: discord.Role):
        if not self._ours(after.guild):
            return
        changes = []
        if before.name != after.name:
            changes.append(("название", before.name, after.name))
        if before.color != after.color:
            changes.append(("цвет", str(before.color), str(after.color)))
        if before.permissions != after.permissions:
            changes.append(("права", "изменены", "см. настройки роли"))
        if not changes:
            return  # сдвиг позиции при создании другой роли не пишем
        entry = await self.audit(after.guild, discord.AuditLogAction.role_update, after.id)
        out = []
        for label, b, a in changes:
            out += [(f"{label}: до", b, True), (f"{label}: после", a, True)]
        await self.send_log(embed("Роль изменена", ORANGE,
            description=f"{who(entry.user) if entry else 'Кто-то'} изменяет роль {after.mention}",
            fields=out, footer=f"RID: {after.id}"))

    # ── 3. голосовые комнаты ─────────────────────────────────────
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState,
                                    after: discord.VoiceState):
        if not self._ours(member.guild):
            return
        if after.channel is not None and after.channel.id == VOICE_HUB_ID and not member.bot:
            await self._open_room(member)
        if before.channel is not None and before.channel != after.channel:
            await self._close_if_empty(before.channel)

    async def _open_room(self, member: discord.Member):
        async with self._room_lock:
            rooms = self.store.rooms()
            # у игрока уже есть комната: возвращаем его туда
            for channel_id, (owner_id, _) in rooms.items():
                channel = member.guild.get_channel(channel_id)
                if owner_id == member.id and channel is not None:
                    await member.move_to(channel)
                    return
            category = member.guild.get_channel(VOICE_CATEGORY_ID)
            number = logic.next_room_number({n for _, n in rooms.values()})
            overwrites = dict(category.overwrites) if category else {}
            overwrites[member] = discord.PermissionOverwrite(
                connect=True, manage_channels=True, move_members=True)
            try:
                channel = await member.guild.create_voice_channel(
                    logic.room_name(number, member.name), category=category,
                    overwrites=overwrites, reason=f"Комната игрока {member.name}")
                self.store.add_room(channel.id, member.id, number)
                await member.move_to(channel)
                log(f"Создана комната #{number} для {member}")
            except discord.HTTPException as ex:
                log(f"Не удалось создать комнату для {member}: {ex}")

    async def _close_if_empty(self, channel):
        if channel.id not in self.store.rooms() or channel.members:
            return
        self.store.remove_room(channel.id)
        try:
            await channel.delete(reason="Комната опустела")
        except discord.NotFound:
            pass
        except discord.HTTPException as ex:
            log(f"Не удалось удалить комнату {channel}: {ex}")

    async def _cleanup_rooms(self):
        """После перезапуска удаляем пустые комнаты и забываем удалённые вручную."""
        guild = self.get_guild(GUILD_ID)
        if guild is None:
            return
        for channel_id in list(self.store.rooms()):
            channel = guild.get_channel(channel_id)
            if channel is None:
                self.store.remove_room(channel_id)
            else:
                await self._close_if_empty(channel)


if __name__ == "__main__":
    TotemCraftCore().run(BOT_TOKEN)
