# TotemFishClaim

Рыбалка TotemCraft (до 09.11.2026 называлась FishClaim): мифические рыбы как уникальные предметы (Fish NFT).

Сервер: Paper/Purpur 26.3, только стабильный API Paper (без NMS).

## Механики

Поимка мифической рыбы, клейм, карточка рыбы, передача другому игроку, топ и статистика. Данные рыб хранит
бот рыбалки (служба `fishbot`), плагин обращается к нему по HTTP. Рыба держится на описании предмета,
ключей с именем плагина нет, поэтому переименование её не затронуло.

Подробно о механике: `docs/gameplay/Custom fishing system.md`.

## Команды и права

`/claim`, `/fishtop`, `/fishcheck`, `/fishtransfer` (и `/ftaccept`, `/ftdecline`, `/ftcancel`),
`/fconvert`, `/fwhere`, `/fishstats`, `/fishelp` с сокращениями. Право `fishclaim.use`, по умолчанию все.

## Настройка

`config.yml`: `fishbot-url` - адрес бота рыбалки.

## Сборка

Нужны JDK 21+ и Maven, либо Docker:

```
docker run --rm -v m2cache:/root/.m2 -v "$PWD:/src" -w /src maven:3.9-eclipse-temurin-25 mvn -q -B package
```

Готовый jar: `target/TotemFishClaim-<версия>.jar`.

## Установка

Положить jar в `plugins/`, старую версию убрать из папки (не держать рядом), перезапустить сервер.
Перезагрузка плагина на лету не поддерживается. При первом запуске создаётся `plugins/TotemFishClaim/config.yml`.
