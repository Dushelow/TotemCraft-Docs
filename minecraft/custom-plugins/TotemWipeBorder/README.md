# TotemWipeBorder

Сообщения на границе центра мира (зоны вайпа) на TotemCraft. Сервер: Paper/Purpur 26.3, только API Paper.

До 14.11.2026 жил в TotemWorldGuardAddon (раньше RegionRules) вместе с правилами мобов; те вынесены в
[TotemMobRules](../TotemMobRules). Как устроены центр мира и зона вайпа: `docs/gameplay/World Core and Wipe Zone.md`.

## Что делает

Центр мира (квадрат ±`radius`) не сбрасывается никогда, за ним территория обновляется с выходом новых
версий игры. Игрок видит заголовок и строку в чате, когда уходит за границу: пешком, на транспорте,
телепортом или входит в игру уже за ней. При возвращении видит строку в чате. Переход в Незер, Энд и
обратно сообщений не даёт, кроме попадания сразу за границу.

Почему не greeting/farewell региона WorldGuard: WorldGuard считает выходом из региона и переход в другой
мир, и «Вы покидаете центр мира» показывалось после каждого портала.

Как устроено: `PlayerMoveEvent` (только при смене блока по X или Z, это дёшево), `VehicleMoveEvent`,
`PlayerTeleportEvent` в пределах мира, `PlayerChangedWorldEvent` и `PlayerJoinEvent`. Центр квадрата -
центр границы мира (`use-world-border-center: true`) или 0, 0.

## Настройка

`config.yml`: `enabled`, раздел `worlds` (ключ - название мира), в нём `radius`, `use-world-border-center`,
тексты `leave-title`, `leave-message`, `enter-message` (цвета через `&`, пустая строка - не показывать).
Название мира, которого нет на сервере, видно в журнале при запуске.

## Команды и права

`/wipeborder status` - какие миры и радиусы, `/wipeborder reload` - перечитать `config.yml` без перезапуска.
Сокращение `/totemwipeborder`. Право `totemwipeborder.admin` (по умолчанию у операторов).

## Сборка

```
docker run --rm -v m2cache:/root/.m2 -v "$PWD:/src" -w /src maven:3.9-eclipse-temurin-25 mvn -q -B package
```

Готовый jar: `target/TotemWipeBorder-<версия>.jar`. Внешних зависимостей нет.

## Проверка на стенде

`testbed/bot/wipe_border.js` (в config стенда `radius: 700`): сообщения при пересечении границы телепортом
в обе стороны, нет сообщений при переходах в Незер и Энд, есть при попадании из Энда сразу за границу.
