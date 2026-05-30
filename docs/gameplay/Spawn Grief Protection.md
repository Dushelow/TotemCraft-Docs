# Скрипт на авто-предупреждение за поломку спавна

*При поломке блоков в регионе WG с определенным названием запускался триггер и отправлялось от имени консоли сообщение игроку. Но также можно заменить его при желании на бан или любое другое наказание.*

*Реализовано посредством плагина Skript и библиотек к нему*

___

### 1. Какие плагины нужны

- **WorldGuard** (основной)
- **Skript** (2.14.x или новее)
- **SkBee-Continued** (аддон для работы с регионами WG)

*P.S. Сервер должен быть на Paper (или Purpur). На чистом Spigot Skript часто не работает.*
### 2. Где лежит скрипт

plugins/Skript/scripts/spawn-grief-warn.sk

### 3. Полный актуальный код скрипта

spawn-grief-warn.sk:
```bash
on break:
    set {_rg} to "%region at event-block%"

    # Вытаскиваем чистое имя региона для отображения уведомления в консоли
    set {_parts::*} to {_rg} split at " in world"
    set {_name} to {_parts::1}

    # === Список регионов ===
    # Далее указываем какие названия регионов должны мониториться скриптом ===
    set {_protected} to false

    if {_name} is "spawn_board":
        set {_protected} to true
    if {_name} is "spawn_board_0":
        set {_protected} to true
    if {_name} is "spawn_board_1":
        set {_protected} to true
    if {_name} is "spawn_board_2":
        set {_protected} to true
    if {_name} is "trap1":
        set {_protected} to true
    if {_name} is "trap2":
        set {_protected} to true
    if {_name} is "trap3":
        set {_protected} to true
    if {_name} is "trap4":
        set {_protected} to true
    if {_name} is "trap5":
        set {_protected} to true

    if {_protected} is false:
        stop

    # === Debug (отправка уведомлений в консоль) ===
    send "DEBUG: %player% ломает блок в защищённой зоне! Регион: %{_name}%" to console

    # Сообщение в консоль о действиях пропускаемых скриптом игроков в регионе
    if player has permission "worldguard.region.bypass.*":
        send "DEBUG: bypass - пропускаем" to console
        stop
    if player is op:
        send "DEBUG: op - пропускаем" to console
        stop
    if player has permission "group.moderator":
        send "DEBUG: moderator - пропускаем" to console
        stop

    # Скрипт не реагирует на админов, модераторов и авторизированных участников региона
    set {_allowed} to false
    if player is member of region {_name}:
        set {_allowed} to true
    if player is owner of region {_name}:
        set {_allowed} to true

    if {_allowed} is true:
        send "DEBUG: игрок член/owner - пропускаем" to console
        stop

    # === Блок с текстом предупреждения и командами ===
    # cancel event - команда чтобы отменить поломку сразу
    make console execute command "/tell %player% ❕❕❕ ВНИМАНИЕ ❕❕❕"
    make console execute command "/tell %player% Пожалуйста, верните  украденные блоки на место!"
    make console execute command "/tell %player% Проводится проверка истории блоков ➝ вы получите бан, если не восстановите поломку."
    make console execute command "/tell %player% %player%"
    send "DEBUG: Выдано предупреждение!" to console
```


### 4. Настройка WorldGuard (обязательна)

Для каждого защищённого региона включи флаг, разрешающий разрушение блоков:

text

```
/rg flag spawn_board block-break allow
/rg flag spawn_board_0 block-break allow
/rg flag spawn_board_1 block-break allow
/rg flag spawn_board_2 block-break allow
/rg flag trap1 block-break allow
... и так далее
```

Без этого флага WorldGuard сам технически не допускает разрушения блоков неавторизированных в регионе игроков, в следствии чего скрипт даже не видит события.

### 5. Как добавить новый регион

Просто добавь в блок `# === Список регионов ===` новую строку:

skript

`if {_name} is "trap6": set {_protected} to true`

И перезагрузи скрипт.

### 6. Как перезагрузить скрипт

Команда на сервере или в консоли: `/sk reload spawn-grief-ban`

### 7. Важные замечания и возможные проблемы

- Регистр имени региона важен.
- Если в имени региона есть пробелы или подчёркивания - скрипт их учитывает.
- Debug в консоль выводит уведомления только когда ломают в сканируемых скриптом регионах.
- Скрипт не откатывает разрушение блока (в прошлых версиях откалтывало - сейчас в скрипте cancel event закомментирован) - игрок может сломать постройку, но получает предупреждение.
- Опционально можно сделать бан и откат грифа вместо устного предупреждения - для этого нужно просто раскомментировать cancel event и добавить команду `/tempban` (или аналогичную).

___
### Памятка по Skript

**Skript** - это упрощённый скриптовый язык для Minecraft-серверов. Выглядит как английский текст.

**Основная структура:**
```yaml
on break:                    # событие
    if player is op:         # условие
        stop

    cancel event             # действие
    send "Текст" to player
```

**Главные правила:**
- После `:` обязателен отступ (4 пробела)
- `%player%`, `%region at event-block%` - переменные
- `{_local}` - локальная переменная
- `{global}` - глобальная переменная

**Полезные команды:**
- `/sk reload <имя>` - перезагрузить конкретный скрипт (по имени файла из папки со скриптами плагина `.../plugins/Sktipt/scripts/`)
- `/sk reload all` - перезагрузить все скрипты

**Ссылки:**
- Документация: https://docs.skriptlang.org/
- Удобный поиск: https://docs.skunity.com/
