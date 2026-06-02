# FishClaim - Система рыбалки на TotemCraft

**Версия плагина:** 1.0.0  
**API Minecraft:** 1.21  
**Python:** 3.11+  
**База данных:** SQLite (aiosqlite)

---

## Содержание

1. [Обзор системы](#1-обзор-системы)
2. [Архитектура](#2-архитектура)
3. [Файловая структура](#3-файловая-структура)
4. [Конфигурация и окружение](#4-конфигурация-и-окружение)
5. [База данных](#5-база-данных)
6. [Python-бот](#6-python-бот)
7. [Flask REST API](#7-flask-rest-api)
8. [Java-плагин FishClaim](#8-java-плагин-fishclaim)
9. [DiscordSRV и alerts.yml](#9-discordsrv-и-alertsyml)
10. [Система генерации трофеев](#10-система-генерации-трофеев)
11. [Очки и комбо](#11-очки-и-комбо)
12. [Жизненный цикл трофея](#12-жизненный-цикл-трофея)
13. [Система передачи трофеев](#13-система-передачи-трофеев)
14. [Discord slash-команды](#14-discord-slash-команды)
15. [Minecraft-команды](#15-minecraft-команды)
16. [Граничные случаи и известные особенности](#16-граничные-случаи-и-известные-особенности)

---

## 1. Обзор системы

Fish NFT - система трофейных рыб для Minecraft-сервера TotemCraft. При поимке легендарной или мифической рыбы генерируется уникальный трофей с набором атрибутов, который:

- сохраняется в SQLite-базе на сервере;
- публикует карточку в Discord-канал `#chronicle`;
- привязывается к Discord-аккаунту игрока (клейм);
- может быть передан другому игроку;
- может быть выпущен живым в мир (ведро с рыбой) и пойман обратно;
- приносит очки в таблицу лидеров.

Обычные, хорошие и редкие уловы также фиксируются и дают очки, но трофеев не создают.

---

## 2. Архитектура

```
Minecraft Server (Purpur 1.21)
│
├── DiscordSRV           ← слушает PlayerFishEvent, постит embed в #chronicle
│
└── FishClaim (Java)     ← слушает те же события, управляет предметами
        │
        └── HTTP (127.0.0.1:7842) ──► Python FishBot
                                           │
                                           ├── discord.py bot   ← slash-команды, карточки
                                           ├── Flask API        ← эндпоинты для Java-плагина
                                           └── SQLite DB        ← fish.db
```

**Поток данных при поимке трофея:**

```
PlayerFishEvent
    ├── DiscordSRV → embed в #chronicle
    └── FishCatchListener
            ├── scheduleLookupsAsync → GET /fish_lookup_latest  (ждёт записи в БД)
            └── applyLoreToInventory → POST /set_lore_applied

Discord #chronicle (новый embed)
    └── bot.on_message → process_catch → process_trophy_catch
            ├── generate_fish_card()   (генератор атрибутов)
            ├── save_fish()            (запись в БД)
            ├── claim_fish()           (авто-клейм, если Discord привязан)
            └── channel.send(embed)   (карточка трофея)
```

**Два независимых потока** (`DiscordSRV` и `FishCatchListener`) работают параллельно: DiscordSRV генерирует публичный embed с тиром, бот его парсит и создаёт трофей; плагин параллельно ищет созданный трофей через API и накладывает lore на предмет.

---

## 3. Файловая структура

```
/home/fishbot/
├── .env                        # токены и ID (не в репозитории)
├── fish.db                     # SQLite база
│
└── fishbot/                    # Python-проект
    ├── bot.py                  # точка входа, discord.py Bot
    ├── api.py                  # Flask REST API
    ├── database.py             # все запросы к БД
    ├── generator.py            # генерация атрибутов и fish_id
    ├── parser.py               # парсинг embed-сообщений DiscordSRV
    ├── card.py                 # построение Discord embed-карточек
    ├── transfer_view.py        # Discord UI для подтверждения передачи
    │
    ├── commands/
    │   ├── claim.py
    │   ├── fishcheck.py
    │   ├── fishhistory.py
    │   ├── fishstats.py
    │   ├── fishtop.py
    │   └── fishtransfer.py
    │
    └── data/
        ├── traits.json         # атрибуты, пулы, веса
        └── combos.json         # комбо-бонусы

/home/minecraft/server/plugins/FishClaim/
├── FishClaim.jar
└── config.yml                  # fishbot-url

/home/minecraft/server/plugins/DiscordSRV/
├── alerts.yml                  # правила публикации событий в Discord
├── accounts.aof                # UUID → Discord ID (DiscordSRV link)
└── assets/
    └── ru_ru.json              # переводы биомов и достижений
```

---

## 4. Конфигурация и окружение

### `/home/fishbot/.env`

```env
BOT_TOKEN=<Discord bot token>
CHRONICLE_CHANNEL_ID=<ID канала #chronicle>
FISH_CHANNEL_ID=<ID канала рыбалки (не используется активно)>
GUILD_ID=<ID сервера Discord>
```

### `plugins/FishClaim/config.yml`

```yaml
fishbot-url: "http://127.0.0.1:7842"
```

Flask API слушает только на `127.0.0.1` - не открывать наружу.

### Зависимости Python

```
discord.py
flask
aiosqlite
python-dotenv
```

### Запуск бота

```bash
cd /home/fishbot/fishbot
python3 bot.py
```

Бот сам запускает Flask API в фоновом потоке через `run_api_thread()` при старте.

---

## 5. База данных

Файл: `/home/fishbot/fish.db`  
Движок: SQLite через `aiosqlite` (async).

### Таблица `fish` - трофеи

| Колонка | Тип | Описание |
|---|---|---|
| `fish_id` | TEXT PK | Уникальный ID, формат `PFX-XXXXXX` (напр. `SAL-A3F7C2`) |
| `fish_type` | TEXT | `COD`, `SALMON`, `PUFFERFISH`, `TROPICAL_FISH` |
| `tier` | TEXT | `legendary` или `mythic` |
| `caught_by` | TEXT | Minecraft-ник поймавшего |
| `caught_at` | DATETIME | UTC, ISO-формат |
| `weight` | REAL | Вес в кг |
| `biome` | TEXT | Переведённое название биома (может быть NULL для легендарных) |
| `weather` | TEXT | `Ясно`, `Дождь`, `Гроза` (может быть NULL) |
| `time_of_day` | TEXT | `Утро`, `День`, `Вечер`, `Ночь`, etc. (может быть NULL) |
| `attributes` | TEXT | JSON: `{"character": "chr_wise", "appearance": "app_golden", ...}` |
| `rarity_score` | INTEGER | Базовые очки за атрибуты |
| `combo_id` | TEXT | ID комбо из `combos.json` (NULL если нет) |
| `combo_bonus` | INTEGER | Бонус за комбо (0 если нет) |
| `current_owner` | TEXT | Minecraft-ник текущего владельца |
| `discord_id` | TEXT | Discord ID текущего владельца (NULL если не заклеймлена) |
| `claimed` | INTEGER | `0` / `1` |
| `claimed_at` | DATETIME | Дата клейма |
| `discord_message_id` | TEXT | ID сообщения-карточки в #chronicle |
| `raw_embed` | TEXT | Сырой dict embed от DiscordSRV (для отладки) |
| `is_released` | INTEGER | `0` / `1` - выпущена ли в мир (ведро) |
| `lore_applied` | INTEGER | `0` / `1` - наложен ли lore на предмет в игре |

**Важно:** `attributes` хранится как JSON-строка. При `get_fish()` автоматически десериализуется в dict.

**Сброс флагов:**
- `lore_applied → 0` при `is_released → 1` (рыба стала ведром - предмет исчез)
- `lore_applied → 0`, `discord_id → NULL`, `claimed → 0` при `transfer_fish()` (новый владелец ещё не клеймил)

---

### Таблица `catches` - все уловы

| Колонка | Тип | Описание |
|---|---|---|
| `id` | INTEGER PK | Автоинкремент |
| `player` | TEXT | Minecraft-ник |
| `tier` | TEXT | `common`, `good`, `rare`, `legendary`, `mythic` |
| `fish_type` | TEXT | Тип рыбы |
| `weight` | REAL | Вес |
| `caught_at` | DATETIME | Время поимки |
| `points` | INTEGER | Очки за этот улов |

Очки за улов (`TIER_POINTS`):

| Тир | Очки |
|---|---|
| common | 1 |
| good | 3 |
| rare | 12 |
| legendary | 0 (учитываются через `fish`) |
| mythic | 0 (учитываются через `fish`) |

---

### Таблица `transfers` - история передач

| Колонка | Тип | Описание |
|---|---|---|
| `id` | INTEGER PK | Автоинкремент |
| `fish_id` | TEXT FK | Ссылка на `fish.fish_id` |
| `from_owner` | TEXT | Кто передал |
| `to_owner` | TEXT | Кому передали |
| `transferred_at` | DATETIME | Время передачи |

---

### Таблица `pending_transfers` - ожидающие подтверждения передачи

| Колонка | Тип | Описание |
|---|---|---|
| `fish_id` | TEXT PK | Одна активная передача на рыбу |
| `from_player` | TEXT | Отправитель |
| `to_player` | TEXT | Получатель |
| `created_at` | DATETIME | Время создания |
| `expires_at` | DATETIME | Время истечения (created_at + 1 минута) |
| `discord_message_id` | TEXT | ID Discord-сообщения с кнопками (для редактирования после ответа) |

Просроченные записи удаляются задачей `_expire_loop` (раз в минуту) в боте.

---

### Логика лидерборда

```sql
total_score = catch_score + fish_score

catch_score  -- SUM(points) из catches, все тиры кроме legendary/mythic
fish_score   -- SUM(rarity_score + combo_bonus) из fish WHERE claimed = 1
             -- привязан к current_owner, а не caught_by
             -- при передаче очки переходят к новому владельцу
```

---

## 6. Python-бот

### `bot.py` - основной класс `FishBot`

Наследует `commands.Bot`. Ключевые атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `chronicle_channel_id` | int | ID канала #chronicle |
| `fish_channel_id` | int | ID канала рыбалки |
| `guild_id` | int | ID Discord-сервера |
| `_recent_catches` | dict | Дедупликация: `"игрок:тип" → (timestamp, tier)` |
| `DEDUP_WINDOW` | float | Окно дедупликации = 5.0 сек |

**`setup_hook()`** - выполняется до `on_ready`:
1. `init_db()` - создаёт таблицы если не существуют
2. Регистрирует все slash-команды для гильдии
3. Синхронизирует команды: `tree.sync(guild=guild)`
4. Регистрирует persistent views для всех `claimed=1` рыб (`add_view(FishDetailsView(fish_id))`)
5. Запускает Flask API в фоновом потоке
6. Запускает `_expire_loop`

**`on_message()`** - слушает сообщения в `#chronicle`:
- Если автор - бот и это embed улова (`is_any_catch`) → `process_catch()`

**`process_catch()`:**
1. Парсит embed (`parse_catch_embed`)
2. Дедупликация двойных событий Purpur (одна поклёвка → два события с разными тирами)
3. `save_catch()` - фиксирует в `catches`
4. Если тир `legendary` или `mythic` → `process_trophy_catch()`

**`process_trophy_catch()`:**
1. Генерирует карточку: `generate_fish_card()`
2. Ищет Discord-аккаунт: `get_discord_id_by_nick()`
3. `save_fish()`
4. Если Discord привязан - авто-клейм: `claim_fish()`
5. Постит embed в #chronicle: `channel.send(embed, view)`
6. `update_message_id()` - сохраняет ID поста

#### Дедупликация

Purpur иногда стреляет 2+ `PlayerFishEvent CAUGHT_FISH` на одну поклёвку с разными тирами. Логика:

```
Если в течение DEDUP_WINDOW секунд пришёл второй улов от того же игрока того же типа:
  - новый тир ≤ старого тира → это дубль, пропускаем
  - новый тир > старого тира → апгрейд, обрабатываем
```

---

### `parser.py` - разбор embed-сообщений DiscordSRV

**Определение тира** (`get_catch_tier`): сначала по `footer.text` (ключевые слова вида `"мифический улов"`), затем по `embed.color`.

| Цвет | Тир |
|---|---|
| `#2f3136` | common |
| `#b2b2b2` | good |
| `#4b69ff` | rare |
| `#8847ff` | legendary |
| `#d32ce6` | mythic |

**`parse_catch_embed()`** извлекает из embed:
- `caught_by` - из `embed.author.name` (regex: `"^\S+\s+поймал"`)
- `fish_type_raw` - из `embed.title` или `embed.description`
- `weight` - из `embed.description` (regex: `"Вес:\*\*\s*([\d.]+)\s*кг"`)
- `biome`, `weather`, `time_of_day` - из `embed.description` (только у legendary/mythic)

> **Ограничение:** у легендарных рыб `alerts.yml` передаёт биом/погоду/время, у остальных тиров - нет. Для тех тиров эти поля будут `None`.

---

### `card.py` - построение embed-карточек

**`build_card(fish_data, transfers)`** - короткая карточка для #chronicle:
- Если не заклеймлена: подсказка с `/claim <id>` или `/discord link`
- Если заклеймлена: показывает только ID
- Кнопка `FishDetailsView` (если заклеймлена)

**`build_full_card(fish_data, transfers)`** - полная карточка:
- Тип, вес, дата, поймал
- Условия поимки (биом/погода/время)
- Атрибуты с символами тиров
- Очки редкости + комбо
- Владелец + Discord mention
- История владения

**`FishDetailsView`** - persistent view с кнопкой "Открыть карточку рыбы":
- `custom_id = "fish_details:<fish_id>"` - содержит fish_id чтобы пережить рестарт бота
- При нажатии: показывает `build_full_card` на 60 секунд, затем возвращает `build_card`
- Должен быть зарегистрирован через `bot.add_view()` при старте и при создании новой рыбы

---

### `generator.py` - генерация трофеев

**`generate_fish_card()`** - точка входа, возвращает dict со всеми полями рыбы.

**`make_seed()`** - детерминированный seed:
```python
SHA256(f"{caught_by}:{fish_type}:{weight}:{caught_at}")
```
Один и тот же улов всегда даёт одни и те же атрибуты.

**`generate_fish_id()`** - ID из prefix + 6 hex-символов SHA256 seed, без коллизий с `existing_ids`.

Префиксы: `COD`, `SAL`, `PUF`, `TRP`.

**`generate_attributes()`** - перебирает все группы из `traits.json`, для каждой вызывает `pick_trait_with_context()`.

**`pick_trait_with_context()`** - выбор трейта с учётом контекста (приоритет: биом → погода → время → базовый пул).

**`calculate_rarity_score()`** - `BASE_TROPHY_SCORE[tier] + Σ ATTR_TIER_BONUS[trait.tier]` по всем 5 атрибутам.

**`find_combo()`** - проверяет все комбо из `combos.json`, возвращает первое совпавшее.

**`translate_biome()`** - переводит raw-название биома через `ru_ru.json`.

---

## 7. Flask REST API

Слушает на `127.0.0.1:7842`. Все эндпоинты доступны только с локальной машины.

---

### `POST /claim`

Клейм рыбы через игру (в обход Discord-команды).

**Тело запроса:**
```json
{ "fish_id": "SAL-A3F7C2", "player": "Steve" }
```

**Проверки:**
1. Рыба существует
2. Не заклеймлена
3. `current_owner == player` (регистронезависимо)
4. Discord привязан (`check_discord_link`)

**Ответы:**
| Код | Тело | Причина |
|---|---|---|
| 200 | `{"ok": true}` | Успешно |
| 400 | `{"error": "..."}` | Не переданы поля |
| 403 | `{"error": "no_discord_link"}` | Discord не привязан |
| 403 | `{"error": "this is not your fish"}` | Не владелец |
| 404 | `{"error": "fish not found"}` | Нет рыбы |
| 409 | `{"error": "fish already claimed"}` | Уже заклеймлена |

После успешного клейма запускает `_update_card_and_register_view()` асинхронно.

---

### `GET /fishcheck/<fish_id>`

Текстовое описание рыбы (используется Java-плагином для парсинга).

**Ответ 200** - plain text, строки вида:
```
Тип: Мифический трофейный лосось • Вес: 15.5 кг
Поймал: Steve • 2026-01-01
Биом: Тёплый океан
Владелец: Alex
Очки: 890
Статус: Заклеймлена
Передач: 2
Внешность: Золотистый
Аура: Буря
Воды: Коралловый риф
```

> Парсится в `FishCheckCommand.java` и `FishTransferCommand.java` построчно по префиксу (`"Тип:"`, `"Статус:"` и т.д.).

---

### `GET /fwhere/<fish_id>`

Статус и местонахождение рыбы.

**Ответ 200:**
```json
{
  "status": "claimed",
  "current_owner": "Steve",
  "fish_type": "SALMON",
  "weight": 15.5,
  "tier": "mythic",
  "lore_applied": 1
}
```

`status`: `"unclaimed"` / `"claimed"` / `"released"`

---

### `GET /fish_lookup`

Поиск рыбы по игроку, типу и весу.

**Query params:** `player`, `type` (uppercase), `weight` (float)

**Ответ 200:** `{"fish_id": "SAL-A3F7C2"}`

---

### `GET /fish_lookup_latest`

Последний трофей игрока данного типа.

**Query params:** `player`, `type`, `recent=1` (опционально)

С `recent=1` - только рыба, пойманная за последние 90 секунд. Используется `FishCatchListener` для защиты от применения lore старого трофея к новому улову.

**Ответ 200:** `{"fish_id": "SAL-A3F7C2", "tier": "mythic", "weight": 15.5}`

---

### `GET /check_discord`

Проверка привязки Discord для Minecraft-ника.

**Query params:** `player`

**Ответы:** `200 {"discord_id": "..."}` или `404 {"error": "not linked"}`

---

### `POST /fconvert`

Конвертация трофея: рыба ↔ ведро.

**Тело:**
```json
{ "fish_id": "SAL-A3F7C2", "player": "Steve", "action": "release" }
```

`action`: `"release"` (рыба → ведро) или `"restore"` (ведро → рыба).

**Проверки для release:** рыба не выпущена, `current_owner == player`  
**Проверки для restore:** рыба выпущена, `current_owner == player`

При `release` сбрасывается `lore_applied = 0`.  
При `restore` - `lore_applied` не меняется здесь, выставляется отдельным `POST /set_lore_applied` из Java после `applyTrophyLore`.

---

### `POST /set_lore_applied`

Помечает трофей как «lore наложен».

**Тело:** `{ "fish_id": "SAL-A3F7C2", "player": "Steve" }`

Выставляет `lore_applied = 1`. Вызывается из `FishCatchListener` и `ClaimCommand` после успешного `applyTrophyLore`.

---

### `POST /ftpending`

Создание pending transfer + уведомление в Discord.

**Тело:** `{ "fish_id": "SAL-A3F7C2", "from": "Steve", "to": "Alex" }`

Проверяет владение, отсутствие активного pending. Если бот запущен - вызывает `_do_notify_transfer()` (постит embed с кнопками в #chronicle). Истечение - 1 минута.

---

### `POST /ftaccept`

Принять передачу.

**Тело:** `{ "fish_id": "SAL-A3F7C2", "player": "Alex" }`

Проверяет `to_player == player`. Выполняет `transfer_fish()` + `delete_pending_transfer()`. Обновляет карточку и постит анонс в #chronicle.

**Ответ 200:** `{"ok": true, "from": "Steve"}`

---

### `POST /ftdecline`

Отклонить передачу.

**Тело:** `{ "fish_id": "SAL-A3F7C2", "player": "Alex" }`

Аналогично ftaccept, но удаляет pending без transfer. Редактирует Discord-сообщение с кнопками.

---

### `GET /fishstats`

Полная статистика игрока в plain text (для Java-плагина).

**Query params:** `player`

Формат: секции разделены пустыми строками, заголовки секций - без отступа, данные - с двумя пробелами.

---

### `GET /fishtop`

Топ-10 игроков в plain text с Minecraft color codes (`§d`, `§f`, `§7`, `§r`).

---

## 8. Java-плагин FishClaim

### `FishClaimPlugin.java`

Точка входа. В `onEnable()`:
- Читает `fishbot-url` из `config.yml`
- Регистрирует все командные executor-ы
- Регистрирует `FishCatchListener`

---

### `FishCatchListener.java`

Ключевой компонент. Слушает три события:

#### `onBucketEmpty` (PlayerBucketEmptyEvent)

При выпуске ведра с трофейной рыбой:
1. Извлекает `fish_id` из lore/display-name ведра
2. Определяет тир (по цвету display-name: `§d` = mythic, `§6` = legendary)
3. Записывает в `pendingReleaseMap`: `UUID игрока → "fishId|tier"`
4. Ждёт EntitySpawn в течение 5 секунд

#### `onEntitySpawn` (EntitySpawnEvent)

При спавне `Fish`-entity рядом с игроком из `pendingReleaseMap`:
1. Проставляет `CustomName` на entity: `"§d<Название> §8[<ID>]"`
2. Записывает в `entityFishIdMap`: `UUID entity → "fishId|fishType"`
3. Очищает через 10 минут

#### `onFish` (PlayerFishEvent, state = CAUGHT_FISH)

При поимке рыбы удочкой:
1. **Путь 1 - Restore:** ищет именованную Fish-entity рядом через `findAndConsumeNearbyFishId()`. Если нашёл - вызывает `POST /fconvert (action=restore)`, накладывает lore, `POST /set_lore_applied`.
2. **Путь 2 - Новый трофей:** `scheduleLookupsAsync()` - до 5 попыток с задержкой 40 тиков (2 сек) опросить `GET /fish_lookup_latest?recent=1`. При нахождении:
   - Проверяет `lore_applied` через `GET /fwhere` - если `1`, пропускает (защита от дубля)
   - `applyLoreToInventory()` - накладывает lore на первый подходящий предмет без lore-ID в инвентаре
   - `POST /set_lore_applied`

#### `applyTrophyLore()` - статический хелпер

Устанавливает на `ItemStack`:
- `displayName`: `§d<Название>` (mythic) или `§6<Название>` (legendary)
- `lore[0]`: `§8<fish_id>` - главный идентификатор предмета
- `lore[1]`: `§7Поймал: §f<ник>`
- `lore[2]`: `§7Вес: §f<вес> кг`
- Enchant `LUCK_OF_THE_SEA` (скрытый) для мифических - визуальный эффект

#### `extractFishIdFromMeta()` / `extractFishIdFromItem()` - статические хелперы

Извлекают `fish_id` из `ItemMeta`:
1. Из `lore.get(0)` - regex `[A-Z]{2,3}-[A-Z0-9]{6}`
2. Из `displayName` - regex `\[([A-Z]{2,3}-[A-Z0-9]{6})\]` (для вёдер)

---

### `ClaimCommand.java` (`/claim`, `/fclaim`)

Алгоритм:
1. `GET /fishcheck/<id>` - проверяет существование, статус, тип
2. Проверяет наличие рыбы в инвентаре (обычная без lore или уже трофей с этим ID)
3. `POST /claim` - клейм через API
4. `giveTrophy()` - создаёт трофей в инвентаре (или подтверждает существующий)
5. `POST /set_lore_applied`

**Защита от дубля:** если предмет с этим `fish_id` уже есть в инвентаре - не создаёт второй, просто сообщает об успехе.

---

### `FishTransferCommand.java` (`/ft`, `/fishtransfer`, `/ftransfer`)

Двухэтапная передача с подтверждением:

1. Асинхронная проверка:
   - `GET /check_discord?player=<sender>` - отправитель привязан?
   - `GET /check_discord?player=<recipient>` - получатель привязан?
   - `GET /fishcheck/<id>` - рыба существует, принадлежит отправителю, заклеймлена?
2. На главном потоке - UI подтверждения с кликабельными кнопками
3. `/ftconfirm <id> <ник>` → `FishTransferConfirmCommand` → `FishTransferCommand.executePending()` → `POST /ftpending`

**Если получатель онлайн** - `sendTransferNotification()` (кнопки в чате через `ClickEvent.runCommand`).

---

### `FishConvertCommand.java` (`/fconvert`)

Определяет направление по типу предмета в руке:

**Рыба → Ведро:**
1. Проверяет lore (наличие `fish_id`)
2. Проверяет наличие `WATER_BUCKET` в инвентаре
3. `POST /fconvert (action=release)` 
4. Заменяет рыбу на ведро с сохранённым lore и display name

**Ведро → Рыба:**
1. Пытается извлечь `fish_id` из lore ведра
2. Если lore пустой (поймал ведро заново) - `GET /fish_lookup_latest` без `recent`
3. `POST /fconvert (action=restore)`
4. Заменяет ведро на рыбу + возвращает `WATER_BUCKET`
5. `POST /set_lore_applied`

---

### `FishCheckCommand.java` (`/fc`, `/fcheck`, `/fishcheck`)

1. Без аргументов - читает `fish_id` из `lore.get(0)` предмета в руке
2. `GET /fishcheck/<id>` - парсит построчно
3. Выводит форматированные сообщения с цветами

---

### `FishWhereCommand.java` (`/fwhere`)

`GET /fwhere/<id>` → парсит JSON вручную (без Gson-зависимости), выводит владельца, вес, статус.

---

### `FishStatsCommand.java` (`/fishstats`, `/fstats`)

`GET /fishstats?player=<ник>` → парсит plain text по секциям, форматирует с цветами.

---

### `FishTopCommand.java` (`/fishtop`, `/ftop`)

`GET /fishtop` → выводит строки с Minecraft color codes напрямую.

---

## 9. DiscordSRV и alerts.yml

DiscordSRV слушает игровые события и публикует embed-сообщения в канал `#chronicle` (alias `chronicle` в конфиге DiscordSRV).

### Тиры рыбалки

Тир определяется через hash события: `(#event.hashCode() % 4000 + 4000) % 4000`

| Диапазон | Тир | Шанс | Цвет embed |
|---|---|---|---|
| 0–2588 | common | ~64.7% | `#2f3136` |
| 2589–3588 | good | 25.0% | `#b2b2b2` |
| 3589–3988 | rare | 10.0% | `#4b69ff` |
| 3989–3998 | legendary | 0.25% | `#FFD700` |
| 3999 | mythic | 0.025% | `#d32ce6` |

> Вес рыбы тоже генерируется через `hashCode()`: `(hash % N + M) / 10.0`. Это означает, что у каждого конкретного броска удочки вес и тир детерминированы. Purpur может выдать несколько событий на одну поклёвку - отсюда дедупликация в боте.

### Легендарные и мифические embed

Содержат в `Description`:
```
**Вес:** X кг
**Биом:** <название из ru_ru.json>
**Погода:** Гроза / Дождь / Ясно
**Время:** Утро / День / Вечер / Ночь
```

Бот (`parser.py`) парсит именно эти поля для генерации атрибутов.

### Остальные события в alerts.yml

- **Первый вход** игрока
- **PvP** смерти (5 вариантов текста через `hashCode() % 5`)
- **Редкие смерти** (молния, яд, костёр, пустота, элитры и др.) - 15 типов
- **Достижения** - с переводом через `ru_ru.json`
- **Боссы** (Визер, Дракон, Хранитель)
- **Тотем** бессмертия
- **Зачарование**
- **Элитры** (подобрал)
- **Яйцо дракона**
- **Приручение**
- **Сокровища** (зачарованная книга, сердце моря)

---

## 10. Система генерации трофеев

### Файл `data/traits.json` (version 4)

Содержит 5 групп атрибутов и справочник тиров.

#### Группы атрибутов

| Группа | Ключ | На что влияет контекст |
|---|---|---|
| Характер | `character` | Время суток |
| Внешность | `appearance` | Биом |
| Особая примета | `feature` | Биом, Погода |
| Аура | `aura` | Погода, Биом |
| Происхождение | `origin` | Биом, Погода, Время |

Каждая группа содержит:
- `traits` - базовый пул (всегда присутствует, fallback)
- `biome_traits` - словарь `biome_key → [трейты]` (опционально)
- `weather_traits` - словарь `"Гроза"/"Дождь" → [трейты]` (опционально)
- `time_traits` - словарь `"Ночь"/"Глубокая ночь"/"Рассвет" → [трейты]` (опционально)
- `default_traits` - только у `origin`, используется как fallback вместо `traits`

#### Структура трейта

```json
{
  "id": "chr_wise",
  "label": "Мудрый",
  "tier": "legendary",
  "weight": 8
}
```

Выбор трейта взвешен по `weight`: чем выше вес, тем чаще выпадает.

#### Ключи биомов (`BIOME_KEY_MAP`)

Маппинг русского названия биома (из `ru_ru.json`) в ключ для `biome_traits`:

| Подстрока | Ключ |
|---|---|
| `холодный океан` | `cold_ocean` |
| `тёплый океан` / `слегка тёплый` | `warm_ocean` |
| `океан` | `ocean` |
| `река` | `river` |
| `мангров` | `mangrove` |
| `болото` | `swamp` |
| `бамбуков*` / `бамбуковые джунгли` | `bamboo_jungle` |
| `джунгли` | `jungle` |
| `вишнёвый` / `сакура` | `cherry` |
| `разрушенн*` / `разрушенные бэдлэндс` | `eroded_badlands` |
| `бэдлэндс` | `badlands` |
| `ледяные шипы` / `заснеженн*` / `снежн*` | `frozen` |
| `замёрзшая река` | `frozen` |
| `глубокая тьма` | `deep_dark` |
| `грибной` | `mushroom` |
| `край` | `end` |

Поиск - по первому совпадению подстроки, порядок в `BIOME_KEY_MAP` важен.

### Файл `data/combos.json` (version 1)

| ID | Название | Трейты | Бонус |
|---|---|---|---|
| `combo_crystal_mythic` | Кристалл Вечности | `app_crystal` + `chr_mythic` | +1000 |
| `combo_mark_chaos` | Печать Хаоса | `fea_mark` + `aur_chaos` | +750 |
| `combo_void_ancient` | Реликвия Первого Мира | `chr_ancient` + `aur_void` | +500 |
| `combo_gem_ocean` | Сокровище Океана | `fea_gem` + `aur_ocean` | +500 |
| `combo_ancient_pearls` | Страж Глубин | `app_ancient` + `fea_pearls` | +450 |
| `combo_wise_ancient_aura` | Мудрец Веков | `chr_wise` + `aur_ancient` | +400 |
| `combo_golden_glow` | Золото Глубин | `app_golden` + `fea_glow` | +400 |
| `combo_storm_fearless` | Дитя Шторма | `chr_fearless` + `aur_storm` | +350 |
| `combo_dark_void` | Тень Бездны | `app_dark` + `aur_dark` | +350 |
| `combo_rainbow_light` | Радуга Морей | `app_rainbow` + `aur_light` | +300 |

Комбо проверяется через `find_combo()`: перебирает все комбо, возвращает первое, у которого все `required_traits` входят в набор атрибутов рыбы. Срабатывает максимум одно комбо.

---

## 11. Очки и комбо

### Формула итоговых очков трофея

```
rarity_score = BASE_TROPHY_SCORE[tier] + Σ ATTR_TIER_BONUS[attr.tier] (по 5 атрибутам)
total         = rarity_score + combo_bonus
```

### Тир → бонус атрибута

| Тир атрибута | Бонус |
|---|---|
| common | 0 |
| uncommon | +5 |
| rare | +15 |
| epic | +30 |
| legendary | +60 |
| mythic | +100 |

### Максимально возможный балл

Мифический трофей, все 5 атрибутов мифического тира, лучшее комбо:
```
600 + 5 × 100 + 1000 = 2100
```

### Очки обычных уловов (таблица `catches`)

| Тир | Очки за улов |
|---|---|
| common | 1 |
| good | 3 |
| rare | 12 |
| legendary | 0 |
| mythic | 0 |

Легендарные и мифические уловы не дают очков сразу - их очки привязаны к трофею и учитываются только когда трофей `claimed = 1` (у текущего владельца).

---

## 12. Жизненный цикл трофея

```
1. ПОИМКА
   PlayerFishEvent (Purpur)
   ├── DiscordSRV → embed #chronicle (тир, вес, биом, погода, время)
   └── FishCatchListener → scheduleLookupsAsync (ждёт /fish_lookup_latest)

2. РЕГИСТРАЦИЯ (бот)
   on_message → process_trophy_catch
   ├── generate_fish_card()          → атрибуты + rarity_score + combo
   ├── save_fish()                   → fish.db, claimed=0, lore_applied=0
   ├── claim_fish() [если Discord привязан] → claimed=1, discord_id=...
   └── channel.send(embed+view)      → карточка в #chronicle

3. LORE (плагин)
   fish_lookup_latest вернул fish_id
   ├── isLoreAlreadyApplied() → GET /fwhere → lore_applied==0?
   ├── applyLoreToInventory() → ставит lore на предмет в инвентаре
   └── POST /set_lore_applied → lore_applied=1

4. КЛЕЙМ [если Discord не был привязан]
   /claim <id> (игра или Discord)
   ├── Проверка владельца и Discord-привязки
   ├── POST /claim → claimed=1, discord_id=...
   ├── giveTrophy() → предмет с lore в инвентаре
   └── POST /set_lore_applied

5. ПЕРЕДАЧА (опционально)
   /ft <ник> [id] → /ftconfirm → POST /ftpending
   ├── Discord: TransferConfirmView (кнопки, 60 сек)
   └── Игра: /ftaccept / /ftdecline
   
   При принятии:
   ├── transfer_fish() → current_owner=to, claimed=0, discord_id=NULL, lore_applied=0
   ├── Обновление карточки #chronicle
   └── Анонс передачи в #chronicle

6. ВЫПУСК В МИР (опционально)
   /fconvert (рыба в руке + ведро с водой)
   ├── POST /fconvert (release) → is_released=1, lore_applied=0
   └── Предмет заменяется ведром с рыбой

7. ПОИМКА ОБРАТНО (опционально)
   FishCatchListener (путь Restore): именованная entity → findAndConsumeNearbyFishId
   ├── callRestoreApi() → POST /fconvert (restore) → is_released=0
   └── applyTrophyLore + POST /set_lore_applied

   Или /fconvert (ведро в руке):
   ├── POST /fconvert (restore)
   └── Предмет заменяется рыбой с lore + WATER_BUCKET
```

---

## 13. Система передачи трофеев

### Инициация

**Через Discord:** `/fishtransfer <получатель> <id>`  
**Через игру:** `/ft <ник>` (fish_id из руки) или `/ft <ник> <id>`

Предварительные проверки перед `POST /ftpending`:
1. Отправитель имеет Discord
2. Получатель имеет Discord
3. Рыба существует
4. `current_owner == отправитель`
5. Рыба заклеймлена

### Discord UI (`TransferConfirmView`)

Класс `TransferConfirmView(discord.ui.View, timeout=60)`:
- Кнопка **✅ Принять** - только для `to_discord_id`
- Кнопка **❌ Отклонить** - только для `to_discord_id`
- `on_timeout()` - редактирует сообщение, помечает как истёкшее

`view.message` устанавливается после отправки - нужно для `on_timeout`.

### Game UI (кнопки в чате)

`FishTransferCommand.sendTransferNotification()` - если получатель онлайн, выводит кликабельные кнопки через `ClickEvent.runCommand("/ftaccept ...")`.

### Expire

Задача `_expire_loop` (каждую минуту) вызывает `expire_pending_transfers()` - DELETE WHERE `expires_at <= now()`.

---

## 14. Discord slash-команды

Все команды зарегистрированы для конкретной гильдии (`guild_id`), не глобально.

### `/claim <fish_id>`

Заклеймить рыбу на свой Discord-аккаунт.

- Проверяет существование рыбы и что она не заклеймлена
- `claim_fish(fish_id, discord_id)`
- Обновляет карточку в #chronicle

---

### `/fishcheck <fish_id>`

Показать полную карточку рыбы (`build_full_card`).

- Видна всем (ephemeral=False)
- Удаляется через 90 секунд

---

### `/fishhistory`

Личная коллекция рыб пользователя.

- Последние 10 рыб с сортировкой по `rarity_score DESC`
- Суммарные очки коллекции
- Видна всем, удаляется через 90 секунд

---

### `/fishstats [player]`

Полная статистика рыбака.

- Без аргумента - статистика вызывающего
- С аргументом - любого игрока по Minecraft-нику
- Источники: таблицы `catches` + `fish` + `transfers`
- Удаляется через 90 секунд

---

### `/fishtop`

Топ-10 игроков по очкам.

- Очки = catch_score + trophy_score (только claimed трофеи)
- Удаляется через 90 секунд

---

### `/fishtransfer <recipient> [fish_id]`

Предложить трофей другому игроку.

- `recipient` - Minecraft-ник
- `fish_id` - опционально; без него ищет единственную рыбу у игрока
- Создаёт pending transfer через `notify_transfer_pending()`
- Ответ ephemeral (только вызвавшему)

---

## 15. Minecraft-команды

Все команды требуют permission `fishclaim.use` (default: true).

### `/claim <id>` | `/fclaim <id>`

Заклеймить трофей в игре.

Алгоритм: проверка через API → проверка инвентаря → `POST /claim` → `giveTrophy()`.

Требует наличия рыбы (обычной, без lore) в инвентаре или уже существующего трофея с этим ID.

---

### `/fc [id]` | `/fcheck [id]` | `/fishcheck [id]`

Карточка рыбы.

Без аргумента - читает `fish_id` из lore предмета в руке.

---

### `/fwhere <id>`

Где находится рыба: владелец, вес, статус (заклеймлена / не заклеймлена / выпущена).

---

### `/fishstats [ник]` | `/fstats [ник]`

Статистика рыбака. Без аргумента - своя статистика.

---

### `/fishtop` | `/ftop`

Топ-10 рыбаков с очками.

---

### `/ft <ник> [id]` | `/ftransfer <ник> [id]` | `/fishtransfer <ник> [id]`

Предложить трофей другому игроку.

1. Асинхронные проверки Discord обоих игроков и владения
2. UI подтверждения с кнопками в чате
3. `/ftconfirm <id> <ник>` - внутренняя команда (вызывается кнопкой)

---

### `/ftaccept [id]` 

Принять входящее предложение. Без аргумента - из lore предмета в руке.  
`POST /ftaccept` → уведомляет обоих участников.

---

### `/ftdecline [id]`

Отклонить входящее предложение. Без аргумента - из lore предмета в руке.  
`POST /ftdecline` → уведомляет отправителя если онлайн.

---

### `/ftconfirm <id> <ник>`

Внутренняя команда. Вызывается только через `ClickEvent.runCommand` из UI подтверждения. Не предназначена для ручного использования.

---

### `/ftcancel`

Отмена со стороны отправителя. Вызывается кнопкой "Отмена" в UI. Только выводит сообщение - pending transfer не создаётся до нажатия "Подтвердить".

---

### `/fconvert`

Конвертация трофея ↔ ведро с рыбой.

**Рыба в руке:** нужно ведро с водой в инвентаре → рыба становится ведром.  
**Ведро в руке:** ведро становится рыбой + возвращается ведро с водой.

Без `fish_id` в lore ведра - ищет последний трофей игрока данного типа через `GET /fish_lookup_latest` (без `recent`).

---

### `/fishelp` | `/fhelp`

Справка по всем командам. Статичный текст, не обращается к API.

---

## 16. Граничные случаи и известные особенности

### Двойные события Purpur

Purpur (и Spigot) может стрелять несколько `PlayerFishEvent CAUGHT_FISH` на одну поклёвку с разными `hashCode()` → разными тирами и весами в embed. Бот обрабатывает это через `_recent_catches` (окно 5 сек), принимая только самый редкий тир.

### lore_applied и защита от дублирования

Флаг `lore_applied = 1` означает, что предмет с lore **существует в игре** у текущего владельца. `FishCatchListener.scheduleLookupsAsync` пропускает обработку если флаг поднят. Флаг сбрасывается только при:
- `transfer_fish()` - новый владелец ещё не получил предмет
- `set_fish_released(True)` - предмет стал ведром, рыбы нет

Без этого механизма: игрок выбрасывает трофей, ловит рыбу того же вида → `FishCatchListener` находит старый незаклеймленный трофей в БД и накладывает его lore на новую рыбу.

### Легендарные рыбы без биома/погоды/времени

Alerts.yml для легендарных (и ниже) тиров не включает биом/погоду/время в `Description`. Эти поля будут `None` - `generate_origin_trait` упадёт в `default_traits`. Если расширить `alerts.yml` - парсер подхватит автоматически.

### Привязка Discord через accounts.aof

Формат файла DiscordSRV:
```
<discord_id> <uuid_без_дефисов>
```
Функция `check_discord_link()` читает файл синхронно (Flask-поток). UUID берётся из `usercache.json` → очищается от дефисов → ищется в `accounts.aof`.

### Persistent views после рестарта

Discord.py требует `add_view()` **до `on_ready`**. Поэтому в `setup_hook()` (не `on_ready`!) грузятся все `claimed=1` рыбы и регистрируются `FishDetailsView`. Новые рыбы регистрируются в момент отправки карточки.

`custom_id` кнопки: `"fish_details:<fish_id>"`. При клике `fish_id` извлекается из `button.custom_id.split(":", 1)[1]`, не из `self.fish_id` - потому что после рестарта `self.fish_id` может быть устаревшим (placeholder из декоратора).

### Передача без Discord у получателя

Через Discord-команду `/fishtransfer` - `fishtransfer.py` проверяет Discord-аккаунт через `check_discord_link()` и сообщает об ошибке.  
Через игровую команду `/ft` - `FishTransferCommand.java` тоже проверяет обоих через `GET /check_discord`. Если у получателя нет Discord - отказ ещё до создания pending.  
Через API напрямую (`POST /ftpending`) - pending создаётся, `to_discord_id = None`. В `TransferConfirmView._check_actor()` проверяется: если `to_discord_id is None` - сообщает использовать `/ftaccept` в игре.

### Авто-клейм

При поимке трофея, если Discord привязан - `claim_fish()` вызывается автоматически ботом без участия игрока. Игрок получает полностью готовый трофей с lore и привязкой. Если Discord не привязан - рыба сохраняется без клейма, игрок видит подсказку.

### Передача сбрасывает клейм

`transfer_fish()` устанавливает `claimed=0, discord_id=NULL, lore_applied=0`. Новый владелец должен сделать `/claim <id>` чтобы привязать рыбу к своему Discord и получить очки в лидерборде.

---

*TotemCraft Fish NFT · totemcraft.net*
