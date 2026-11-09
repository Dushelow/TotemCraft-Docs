# Свои плагины TotemCraft

Каждая папка - самостоятельный проект Maven со своим `README.md`, `config.yml` и `.gitignore`:
его можно вынести в отдельный репозиторий как есть. Аддон - наше дополнение к одному базовому
плагину; внутри механики, которые к нему относятся, каждая включается отдельно в `config.yml`.

| Плагин | Дополняет | Что делает |
|---|---|---|
| [TotemLWCAddon](TotemLWCAddon) | LWC | `/autolock`; сообщение у чужого «защищенного от кражи» |
| [TotemSimpleClansAddon](TotemSimpleClansAddon) | SimpleClans | теги кланов в чате видят только клановые и админы |
| [TotemEssentialsAddon](TotemEssentialsAddon) | EssentialsChat | ближний чат `!`, `/l`, `/g`; «Рядом никого нет»; ближнее не уходит в Discord; строка слежки |
| [TotemWorldGuardAddon](TotemWorldGuardAddon) | WorldGuard | без огня от огненных шаров; мобы без урона от шипов; граница зоны вайпа |
| [TotemPacketEventsAddon](TotemPacketEventsAddon) | PacketEvents | принтер Litematica без кика за лишние пакеты движения |
| [TotemVulcanAddon](TotemVulcanAddon) | Vulcan | наказание по экспериментальным проверкам при устойчиво высоком VL |
| [TotemFishClaim](TotemFishClaim) | свой | рыбалка: мифические рыбы (Fish NFT) |

Общее для всех: Java 21, только стабильный API Paper (без NMS), группа `net.totemcraft`, версия в
`pom.xml` подставляется в `plugin.yml`. Команды и права сохранены от прежних плагинов, чтобы ничего
не перевыдавать в LuckPerms.

## История

До 09.11.2026 были: ClanTagView (теги кланов и ближний чат), AutoLock, RegionRules, TotemGuard, FishClaim.
Переход - скрипт [tools/migrate-to-totem-addons.sh](tools/migrate-to-totem-addons.sh): старые jar и папки
данных уходят в копию, данные (`players.txt` /autolock, журнал TotemGuard, адрес бота рыбалки) переносятся.
