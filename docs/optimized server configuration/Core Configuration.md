# Конфигурация механик сервера TotemCraft

Это **полный** и **актуальный** документ со всеми настройками ядра и конфигов.  
Для каждого параметра показано:

- **Текущее значение** (то, что стоит на сервере)  
- **Дефолтное значение** (стандарт Paper/Purpur/Spigot/Bukkit/Minecraft 1.21.5+)  
- **Примечание** - почему изменено и что это даёт (оптимизация, безопасность, геймплей, удобство и т.д.)

---

### 1. Файл: `server.properties`

| Ключ настройки                                   | Текущее значение                                           | Дефолтное значение | Примечание / Что даёт                                                         |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| accepts-transfers                                | false                                                      | true               | Отключены трансферы между серверами (Bungee/Velocity). Упрощает управление.   |
| allow-flight                                     | **false**                                                  | false              | Полёты запрещены (даже в креативе/с элитрами). Повышает античит.              |
| broadcast-console-to-ops                         | true                                                       | true               | Без изменений.                                                                |
| broadcast-rcon-to-ops                            | true                                                       | true               | Без изменений.                                                                |
| bug-report-link                                  | (пусто)                                                    | (пусто)            | Без изменений.                                                                |
| debug                                            | false                                                      | false              | Без изменений.                                                                |
| difficulty                                       | **hard**                                                   | easy               | Сложность Hard. Больше мобов, агрессии, лут лучше.                            |
| enable-code-of-conduct                           | false                                                      | false              | Без изменений.                                                                |
| enable-command-block                             | false                                                      | false              | Командные блоки отключены.                                                    |
| enable-jmx-monitoring                            | false                                                      | false              | Без изменений.                                                                |
| enable-query                                     | **true**                                                   | false              | Включён GameSpy4 - внешние мониторинги (например, Discord-боты) видят статус. |
| enable-rcon                                      | false                                                      | false              | RCON выключен.                                                                |
| enable-status                                    | true                                                       | true               | Без изменений.                                                                |
| enforce-secure-profile                           | **false**                                                  | true               | Отключена принудительная проверка профилей → позволяет пиратские аккаунты.    |
| enforce-whitelist                                | false                                                      | false              | Без изменений.                                                                |
| entity-broadcast-range-percentage                | **75**                                                     | 100                | Сильно уменьшен радиус отправки сущностей игрокам → огромная оптимизация TPS. |
| force-gamemode                                   | false                                                      | false              | Без изменений.                                                                |
| function-permission-level                        | 2                                                          | 2                  | Без изменений.                                                                |
| gamemode                                         | survival                                                   | survival           | Без изменений.                                                                |
| generate-structures                              | true                                                       | true               | Без изменений.                                                                |
| generator-settings                               | {}                                                         | {}                 | Без изменений.                                                                |
| hardcore                                         | false                                                      | false              | Без изменений.                                                                |
| hide-online-players                              | false                                                      | false              | Без изменений.                                                                |
| initial-disabled-packs                           | (пусто)                                                    | (пусто)            | Без изменений.                                                                |
| initial-enabled-packs                            | vanilla                                                    | vanilla            | Без изменений.                                                                |
| level-name                                       | **2025**                                                   | world              | Имя мира изменено.                                                            |
| level-seed                                       | (пусто)                                                    | (пусто)            | Без изменений.                                                                |
| level-type                                       | minecraft:normal                                           | minecraft:normal   | Без изменений.                                                                |
| log-ips                                          | true                                                       | true               | Без изменений.                                                                |
| management-server-... (все 6 строк)              | (разные значения)                                          | по умолчанию       | Включён management-сервер (для Spark и мониторинга).                          |
| max-chained-neighbor-updates                     | **10000**                                                  | 1000000            | Сильно уменьшено → защита от лаг-машин и цепных обновлений.                   |
| max-players                                      | **50**                                                     | 20                 | Увеличено до 50 игроков.                                                      |
| max-tick-time                                    | 60000                                                      | 60000              | Без изменений.                                                                |
| max-world-size                                   | **15000**                                                  | 29999984           | Мир ограничен 15000×15000 блоков (защита от дальних полётов).                 |
| motd                                             | **§bВанильный сервер §f\| §aБез доната §f\| §eБез вайпов** | A Minecraft Server | Красивый MOTD с цветами.                                                      |
| network-compression-threshold                    | 256                                                        | 256                | Без изменений.                                                                |
| online-mode                                      | **false**                                                  | true               | Оффлайн-режим (пиратка разрешена).                                            |
| op-permission-level                              | 4                                                          | 4                  | Без изменений.                                                                |
| pause-when-empty-seconds                         | **-1**                                                     | 60                 | Сервер **никогда** не приостанавливается (даже если пустой).                  |
| player-idle-timeout                              | 0                                                          | 0                  | Без AFK-кика.                                                                 |
| prevent-proxy-connections                        | false                                                      | false              | Без изменений.                                                                |
| pvp                                              | true                                                       | true               | Без изменений.                                                                |
| query.port                                       | **20098**                                                  | 25565              | Порт Query изменён.                                                           |
| rate-limit                                       | 0                                                          | 0                  | Без лимита (доверие к игрокам).                                               |
| rcon.password / rcon.port                        | (пусто)                                                    | -                  | RCON отключён.                                                                |
| region-file-compression                          | deflate                                                    | deflate            | Без изменений.                                                                |
| require-resource-pack                            | false                                                      | false              | Без изменений.                                                                |
| resource-pack / resource-pack-id / sha1 / prompt | (пусто)                                                    | -                  | Без изменений.                                                                |
| server-ip                                        | **0.0.0.0**                                                | (пусто)            | Привязка ко всем интерфейсам.                                                 |
| server-name                                      | **TotemCraft**                                             | (отсутствует)      | Кастомное имя сервера.                                                        |
| server-port                                      | **20098**                                                  | 25565              | Порт сервера изменён.                                                         |
| simulation-distance                              | **6**                                                      | 10                 | Сильно уменьшено → оптимизация.                                               |
| spawn-protection                                 | **1**                                                      | 16                 | Зона спавна почти снята.                                                      |
| status-heartbeat-interval                        | 0                                                          | 0                  | Без изменений.                                                                |
| sync-chunk-writes                                | **false**                                                  | true               | Асинхронная запись чанков → +TPS, но небольшой риск потери данных при краше.  |
| text-filtering-config / version                  | 0                                                          | 0                  | Без изменений.                                                                |
| use-native-transport                             | true                                                       | true               | Без изменений.                                                                |
| view-distance                                    | **9**                                                      | 10                 | Чуть уменьшено.                                                               |
| white-list                                       | false                                                      | false              | Без изменений.                                                                |

---

### 2. Файл: `bukkit.yml`

| Ключ настройки                                      | Текущее значение               | Дефолтное значение | Примечание / Что даёт |
|-----------------------------------------------------|--------------------------------|--------------------|-----------------------|
| settings.permissions-file                           | permissions.yml                | permissions.yml    | Стандарт. |
| settings.query-plugins                              | **false**                      | true               | Плагины не видны в query (защита от сканирования). |
| spawn-limits.* (все 7)                              | уменьшены (см. файл)           | выше               | Сильное снижение лимитов спавна мобов → меньше лагов. |
| chunk-gc.period-in-ticks                            | **300**                        | 600                | Частая очистка чанков. |
| ticks-per.* (все 8)                                 | сильно увеличены (см. файл)    | 1                  | Монстры/вода/аксолотли спавнятся намного реже → оптимизация. |

---

### 3. Файл: `spigot.yml`

| Ключ настройки                                                             | Текущее значение                                  | Дефолтное значение | Описание изменения / Что даёт                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| settings.bungeecord                                                        | false                                             | false              | Без изменений.                                                                            |
| settings.save-user-cache-on-stop-only                                      | **true**                                          | false              | Кэш пользователей сохраняется только при остановке сервера → меньше I/O-нагрузки на диск. |
| settings.sample-count                                                      | 12                                                | 12                 | Без изменений.                                                                            |
| settings.timeout-time                                                      | 60                                                | 60                 | Без изменений.                                                                            |
| settings.restart-on-crash                                                  | **false**                                         | true               | Автоматический рестарт при краше отключён (удобнее для отладки).                          |
| settings.restart-script                                                    | ./start.sh                                        | ./start.sh         | Без изменений.                                                                            |
| settings.log-villager-deaths                                               | true                                              | true               | Без изменений.                                                                            |
| settings.log-named-deaths                                                  | true                                              | true               | Без изменений.                                                                            |
| settings.player-shuffle                                                    | 0                                                 | 0                  | Без изменений.                                                                            |
| settings.user-cache-size                                                   | 1000                                              | 1000               | Без изменений.                                                                            |
| settings.moved-wrongly-threshold                                           | 0.0625                                            | 0.0625             | Без изменений.                                                                            |
| settings.moved-too-quickly-multiplier                                      | 10.0                                              | 10.0               | Без изменений.                                                                            |
| settings.netty-threads                                                     | 4                                                 | 4                  | Без изменений.                                                                            |
| settings.attribute.maxAbsorption.max                                       | 2048.0                                            | 2048.0             | Без изменений.                                                                            |
| settings.attribute.maxHealth.max                                           | 1024.0                                            | 1024.0             | Без изменений.                                                                            |
| settings.attribute.movementSpeed.max                                       | 1024.0                                            | 1024.0             | Без изменений.                                                                            |
| settings.attribute.attackDamage.max                                        | 2048.0                                            | 2048.0             | Без изменений.                                                                            |
| settings.debug                                                             | false                                             | false              | Без изменений.                                                                            |
| messages.whitelist                                                         | (кастомный текст с ссылкой на анкету)             | стандартный        | Кастомное сообщение для вайтлиста.                                                        |
| messages.unknown-command                                                   | Unknown command. Type "/help" for help.           | стандартный        | Без изменений.                                                                            |
| messages.server-full                                                       | The server is full!                               | стандартный        | Без изменений.                                                                            |
| messages.outdated-client / outdated-server                                 | стандартные                                       | стандартные        | Без изменений.                                                                            |
| messages.restart                                                           | Server is restarting                              | стандартный        | Без изменений.                                                                            |
| advancements.disable-saving                                                | false                                             | false              | Без изменений.                                                                            |
| advancements.disabled                                                      | - minecraft:story/disabled                        | []                 | Отключён один адвансмент (технический).                                                   |
| world-settings.default.below-zero-generation-in-existing-chunks            | true                                              | true               | Без изменений.                                                                            |
| world-settings.default.view-distance / simulation-distance                 | default                                           | default            | Без изменений.                                                                            |
| world-settings.default.thunder-chance                                      | 100000                                            | 100000             | Без изменений.                                                                            |
| world-settings.default.merge-radius.item                                   | **3.5**                                           | 0.5                | Предметы сливаются на большем расстоянии → меньше сущностей, +TPS.                        |
| world-settings.default.merge-radius.exp                                    | **4.0**                                           | -1                 | Опыт теперь сливается.                                                                    |
| world-settings.default.mob-spawn-range                                     | **4**                                             | 8                  | Мобы спавнятся ближе к игроку → меньше нагрузки.                                          |
| world-settings.default.item-despawn-rate                                   | 6000                                              | 6000               | Без изменений.                                                                            |
| world-settings.default.arrow-despawn-rate                                  | **300**                                           | 1200               | Стрелы исчезают быстрее → меньше лагов от ферм.                                           |
| world-settings.default.trident-despawn-rate                                | **600**                                           | 1200               | Трезубцы исчезают быстрее.                                                                |
| world-settings.default.zombie-aggressive-towards-villager                  | true                                              | true               | Без изменений.                                                                            |
| world-settings.default.nerf-spawner-mobs                                   | true                                              | false              | Мобы из спавнеров нерфятся (меньше лагов).                                                |
| world-settings.default.enable-zombie-pigmen-portal-spawns                  | true                                              | true               | Без изменений.                                                                            |
| world-settings.default.wither-spawn-sound-radius / end-portal-sound-radius | 0                                                 | 0                  | Звуки спавна не распространяются далеко.                                                  |
| world-settings.default.hanging-tick-frequency                              | **250**                                           | 100                | Висячие сущности (картины, таблички) тикают реже.                                         |
| world-settings.default.unload-frozen-chunks                                | false                                             | false              | Без изменений.                                                                            |
| world-settings.default.growth.* (все модификаторы)                         | 100                                               | 100                | Без изменений (рост по умолчанию).                                                        |
| world-settings.default.entity-activation-range.* (все подгруппы)           | сильно уменьшены (animals 12, monsters 28 и т.д.) | выше               | Радиусы активации сильно снижены → огромная оптимизация.                                  |
| world-settings.default.entity-activation-range.wake-up-inactive.*          | уменьшены (max-per-tick 2-4, for 60-120)          | выше               | Пробуждение неактивных сущностей ограничено.                                              |
| world-settings.default.entity-activation-range.tick-inactive-villagers     | **false**                                         | true               | Неактивные жители не тикают.                                                              |
| world-settings.default.entity-activation-range.ignore-spectators           | **true**                                          | false              | Зрители не влияют на активацию.                                                           |
| world-settings.default.entity-tracking-range.*                             | monsters 96, misc 48 и т.д.                       | выше               | Радиусы отслеживания уменьшены.                                                           |
| world-settings.default.ticks-per.hopper-transfer / hopper-check            | 8                                                 | 1                  | Хопперы тикают реже → +TPS.                                                               |
| world-settings.default.hopper-amount                                       | 1                                                 | 1                  | Без изменений.                                                                            |
| world-settings.default.hopper-can-load-chunks                              | false                                             | false              | Хопперы не загружают чанки.                                                               |
| world-settings.default.dragon-death-sound-radius                           | 0                                                 | 0                  | Без изменений.                                                                            |
| world-settings.default.seed-* (все 18 сидов структур)                      | **кастомные** (например, seed-village: 72839104)  | ванильные          | Все сиды структур изменены → защита от сид-хаков и предсказуемой генерации.               |
| world-settings.default.hunger.* (все параметры)                            | стандартные                                       | стандартные        | Без изменений.                                                                            |
| world-settings.default.max-tnt-per-tick                                    | **25**                                            | 100                | Максимум TNT за тик уменьшен (защита от лаг-машин).                                       |
| world-settings.default.max-tick-time.tile / entity                         | 50 / 25                                           | 50 / 25            | Без изменений.                                                                            |
| world-settings.default.verbose                                             | false                                             | false              | Без изменений.                                                                            |
| world-settings.worldeditregentempworld.verbose                             | **false**                                         | (не указано)       | Отключён verbose для временного мира WorldEdit.                                           |
| players.disable-saving                                                     | false                                             | false              | Без изменений.                                                                            |
| config-version                                                             | 12                                                | 12                 | Без изменений.                                                                            |
| stats.disable-saving                                                       | false                                             | false              | Без изменений.                                                                            |
| commands.log                                                               | true                                              | true               | Без изменений.                                                                            |
| commands.tab-complete                                                      | 0                                                 | 0                  | Без изменений.                                                                            |
| commands.send-namespaced                                                   | true                                              | true               | Без изменений.                                                                            |
| commands.spam-exclusions                                                   | **[]**                                            | ["/skill"]         | Исключения из спам-фильтра удалены.                                                       |
| commands.enable-spam-exclusions                                            | false                                             | false              | Без изменений.                                                                            |
| commands.replace-commands                                                  | [setblock, summon, testforblock, tellraw]         | стандартный        | Без изменений.                                                                            |
| commands.silent-commandblock-console                                       | false                                             | false              | Без изменений.                                                                            |

---

### 4. Файл: `purpur.yml`

| Ключ настройки (группа)                                                                 | Текущее значение                                      | Дефолтное значение                          | Описание изменения / Что даёт |
|-----------------------------------------------------------------------------------------|-------------------------------------------------------|---------------------------------------------|-------------------------------|
| verbose                                                                                 | false                                                 | false                                       | Без изменений. |
| settings.register-minecraft-debug-commands                                              | false                                                 | false                                       | Без изменений. |
| settings.register-minecraft-disabled-commands                                           | false                                                 | false                                       | Без изменений. |
| settings.messages.* (afk-broadcast-away, afk-broadcast-back и др.)                     | **все на русском**                                    | английские                                  | Полная локализация сообщений на русский. |
| settings.server-mod-name                                                                | Purpur                                                | Purpur                                      | Без изменений. |
| settings.use-alternate-keepalive                                                        | **true**                                              | false                                       | Альтернативный keepalive (стабильнее пинг). |
| settings.disable-give-dropping                                                          | **true**                                              | false                                       | /give не дропает предметы при полном инвентаре. |
| settings.bee-count-payload                                                              | false                                                 | false                                       | Без изменений. |
| settings.tps-catchup                                                                    | true                                                  | true                                        | Без изменений. |
| settings.fix-projectile-looting-transfer                                                | **true**                                              | false                                       | Фикс лутинга на снарядах (MC-3304). |
| settings.clamp-attributes / limit-armor                                                 | true                                                  | true                                        | Без изменений. |
| settings.player-deaths-always-show-item                                                 | false                                                 | false                                       | Без изменений. |
| settings.startup-commands                                                               | []                                                    | []                                          | Без изменений. |
| settings.broadcasts.*                                                                   | only-broadcast-to-affected-player: false              | false                                       | Без изменений. |
| settings.lagging-threshold                                                              | **17.0**                                              | 19.0                                        | Порог лагов снижен (раньше реагирует). |
| settings.command.* (rambar, tpsbar, compass и др.)                                     | кастомные цвета и форматы                             | дефолтные                                   | Кастомные боссбары и команды. |
| settings.blocks.* (barrel, ender_chest, crying_obsidian, beehive, anvil, snow и т.д.)  | все перечисленные значения                            | дефолтные                                   | Мелкие твики блоков (например, max-bees-inside 3). |
| settings.enchantment.anvil.*                                                            | allow-inapplicable-enchants: false и т.д.            | стандартные                                 | Запрет несовместимых/неприменимых зачарований. |
| settings.entity.enderman.short-height                                                   | false                                                 | false                                       | Без изменений. |
| settings.allow-water-placement-in-the-end                                               | **true**                                              | false                                       | В Энде можно ставить воду. |
| settings.logger.suppress-* (все 4)                                                      | **true** (кроме setblock)                             | false                                       | Подавление ненужных логов. |
| settings.network.upnp-port-forwarding                                                   | false                                                 | false                                       | Без изменений. |
| settings.network.max-joins-per-second                                                   | **true**                                              | false                                       | Ограничение джойнов в секунду (анти-бот). |
| settings.network.kick-for-out-of-order-chat                                             | **true**                                              | false                                       | Кик за чат вне очереди (защита от эксплойтов). |
| settings.username-valid-characters                                                      | ^[a-zA-Z0-9_.]*$                                      | стандартный                                 | Без изменений. |
| settings.blast-resistance-overrides                                                     | {}                                                    | {}                                          | Без изменений. |
| settings.block-fall-multipliers.* (все кровати + hay_block)                            | distance: 0.5 / damage: 0.2                           | нет в дефолте                               | Меньше отдачи от падения на кровати и сено. |
| world-settings.default.blocks.* (observer, anvil, azalea, beacon, bed, big_dripleaf, cactus, sugar_cane, nether_wart, campfire, chest, composter, coral, dispenser, door, dragon_egg, end-crystal, farmland, flowering_azalea, furnace, packed_ice, blue_ice, lava, piston, magma-block, powder_snow, powered-rail, respawn_anchor, sculk_shrieker, sign, slab, spawner, sponge, stonecutter, turtle_egg, water, enchantment-table, conduit, cauldron) | **много отключено/изменено** (growth-chance 0.0, affected-by-bonemeal false, explode-on-villager-sleep false, cramming-amount 0 и т.д.) | дефолтные                                   | Отключены многие ванильные механики роста и взрывов для производительности и удобства. |
| world-settings.default.tools.axe.strippables / waxables                                | полный список                                         | дефолтный                                   | Без изменений (все возможные). |
| world-settings.default.entity.* (все мобы: ridable, ridable-in-water, controllable, attributes, breeding-delay-ticks и т.д.) | **controllable: true почти у всех**, ridable-in-water: true, кастомные health/scale | ridable false, controllable false           | Почти все мобы управляемые и ездящие по воде. |
| world-settings.default.hunger.starvation-damage                                        | 1.0                                                   | 1.0                                         | Без изменений. |
| world-settings.default.settings.entity.shared-random                                    | **true**                                              | false                                       | Общий random для сущностей. |
| world-settings.default.gameplay-mechanics.* (arrow, use-better-mending, milk-cures-bad-omen, trident-loyalty-void-return-height, raid-cooldown-seconds, animal-breeding-cooldown-seconds, note-block-ignore-above, milk-clears-beneficial-effects, item.shears.damage-if-sprinting, item.ender-pearl.damage, item.snowball.extinguish.fire, player.netherite-fire-resistance.duration, player.idle-timeout.*, player.teleport-if-outside-border, player.totem-of-undying-works-in-inventory, player.sleep-ignore-nearby-mobs, player.burp-when-full, player.ridable-in-water, silk-touch.enabled, projectile-damage.snowball, minecart.controllable.enabled) | **много false / 0 / кастом**                          | дефолтные                                   | Отключены/изменены почти все «удобные» механики (тотем в инвентаре, better mending, кулдауны и т.д.). |

(В purpur.yml ещё ~200 строк entity-настроек - все они перечислены выше в группе entity; никаких других изменений нет.)

---

### 5. Файл: `eula.txt`

| Ключ настройки | Текущее значение | Дефолтное значение | Описание изменения |
|----------------|------------------|--------------------|--------------------|
| eula           | true             | false              | EULA принята (стандартно после первого запуска). |

---

### 6. Файл: `paper-world-defaults.yml` (применяется ко всем мирам)

| Раздел / Ключ                                                                             | Текущее значение      | Дефолт Paper    | Описание изменения / Что даёт                                                                                                              |
| ----------------------------------------------------------------------------------------- | --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| anticheat.anti-xray.enabled                                                               | **true**              | false           | Встроенный Anti-Xray включён.                                                                                                              |
| anticheat.anti-xray.engine-mode                                                           | **3**                 | 1               | Самый агрессивный режим (гибрид).                                                                                                          |
| anticheat.anti-xray.lava-obscures                                                         | false                 | false           | Без изменений.                                                                                                                             |
| anticheat.anti-xray.max-block-height                                                      | 64                    | 64              | Без изменений.                                                                                                                             |
| chunks.delay-chunk-unloads-by                                                             | **7s**                | 10s             | Чанки выгружаются быстрее.                                                                                                                 |
| chunks.entity-per-chunk-save-limit.* (arrow, ender_pearl, experience_orb и все остальные) | **8**                 | -1 (без лимита) | Жёсткий лимит сущностей на чанк при сохранении.                                                                                            |
| chunks.max-auto-save-chunks-per-tick                                                      | 8                     | 8               | Без изменений.                                                                                                                             |
| chunks.prevent-moving-into-unloaded-chunks                                                | **false**             | false           | Запрет движения сущностей (пёрлы в том числе) в невыгруженные чанки (фикс эксплойтов).<br><br>Выключено чтобы работали прогрузчики чанков. |
| collisions.allow-player-cramming-damage                                                   | false                 | false           | Без изменений.                                                                                                                             |
| collisions.max-entity-collisions                                                          | **2**                 | 8               | Сильнейшая оптимизация коллизий.                                                                                                           |
| entities.behavior.disable-chest-cat-detection                                             | **true**              | false           | Кошки не блокируют сундуки.                                                                                                                |
| entities.behavior.phantoms-spawn-attempt-*                                                | 119 / 60              | 119 / 60        | Без изменений.                                                                                                                             |
| entities.spawning.creative-arrow-despawn-rate / non-player-arrow-despawn-rate             | **50 / 100**          | 1200            | Стрелы исчезают очень быстро.                                                                                                              |
| entities.spawning.per-player-mob-spawns                                                   | true                  | true            | Без изменений.                                                                                                                             |
| hopper.cooldown-when-full                                                                 | true                  | true            | Без изменений.                                                                                                                             |
| misc.disable-relative-projectile-velocity                                                 | **true**              | false           | Снаряды не учитывают скорость стрелка.                                                                                                     |
| misc.redstone-implementation                                                              | **ALTERNATE_CURRENT** | VANILLA         | Самая быстрая редстоун-реализация.                                                                                                         |
| misc.update-pathfinding-on-block-update                                                   | **false**             | true            | Огромный прирост TPS на редстоуне/фермах.                                                                                                  |
| tick-rates.behavior.villager.validatenearbypoi                                            | **60**                | -1              | Жители проверяют POI реже.                                                                                                                 |
| tick-rates.grass-spread                                                                   | **4**                 | 1               | Трава растёт медленнее.                                                                                                                    |
| tick-rates.mob-spawner                                                                    | **4**                 | 1               | Спавнеры тикают реже.                                                                                                                      |
| unsupported-settings.fix-invulnerable-end-crystal-exploit                                 | true                  | true            | Без изменений.                                                                                                                             |

---

### 7. Файл: `paper-global.yml`

| Раздел / Ключ                                                  | Текущее значение                                      | Дефолт Paper            | Описание изменения / Что даёт |
|----------------------------------------------------------------|-------------------------------------------------------|-------------------------|-------------------------------|
| anticheat.obfuscation.enable-item-obfuscation                  | false                                                 | false                   | Без изменений. |
| chunk-loading-basic.player-max-chunk-load-rate / send-rate    | 100.0 / 75.0                                          | 100.0 / 75.0            | Без изменений. |
| chunk-system.io-threads                                        | **4**                                                 | -1 (авто)               | Фиксировано под ваш хост. |
| chunk-system.worker-threads                                    | **12**                                                | -1 (авто)               | Фиксировано под многопоток. |
| misc.max-joins-per-tick                                        | **1**                                                 | 5                       | Защита от бот-флуда. |
| packet-limiter.all-packets.*                                   | 500.0                                                 | 500.0                   | Без изменений. |
| packet-limiter.overrides.minecraft:place_recipe                | DROP, 4.0, 5.0                                       | KICK, 7.0, 500          | Строже лимит крафта. |
| player-auto-save.rate                                          | -1                                                    | -1                      | Без изменений. |
| spark.enabled                                                  | **true**                                              | false                   | Профилировщик Spark включён. |
| unsupported-settings.allow-headless-pistons                    | **true**                                              | false                   | Разрешены headless-поршни. |
| unsupported-settings.allow-permanent-block-break-exploits      | **true**                                              | false                   | Разрешены перманентные дюпы блоков. |
| unsupported-settings.allow-piston-duplication                  | **true**                                              | false                   | Классический piston-dup разрешён. |
| unsupported-settings.allow-unsafe-end-portal-teleportation     | **true**                                              | false                   | Небезопасная телепортация через эндер-портал разрешена. |

---

### 8. Конфигурации игровых миров

**Overworld (2025)**  
Все `feature-seeds.features` (≈150 штук) - **полностью рандомные** (пример: acacia: -8696095872319834450). Защита от сид-хаков. Anti-Xray включён.

**Nether (2025_nether)**  
- Anti-Xray включён + кастомный список hidden/replacement блоков.  
- Все feature-seeds - полностью рандомные.

**The End (2025_the_end)**  
- Anti-Xray **выключен**.  
- Все feature-seeds - полностью рандомные.

---
