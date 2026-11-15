# TotemVoiceAddon

Аддон TotemCraft к Plasmo Voice: голос ботов TotemBots (`repo/bots/totembots`) звучит в мире у бота.

Базовый плагин: Plasmo Voice 2.1.17 (API `su.plo.voice.api`). Сервер: Paper/Purpur 26.3, только стабильный API Paper.

## Как работает

Программа TotemBots озвучивает реплику бота (Qwen «Read aloud», Piper или другой способ) и отправляет звук
обычными пакетами игры по каналу `totem:voice`: `[1]` начало, `[2]` + кусок PCM 48 кГц моно 16 бит (little-endian,
до 30 КБ), `[3]` конец. По концу фразы аддон кодирует звук в Opus средствами Plasmo Voice
(`ArrayAudioFrameProvider`) и проигрывает его у бота как звук от сущности (`ServerEntitySource`, `AudioSender`):
игроки рядом слышат бота, как игрока с микрофоном. У игроков в настройках Plasmo Voice своя громкость «Боты».

Новых портов и служб нет. Говорить через канал могут только ники из `bots` в `config.yml`; фраза не длиннее 30 с.

## Настройка

`config.yml`: `bots` (ники ботов), `distance` (на сколько блоков слышно, по умолчанию 24), `log` (писать каждую фразу
в журнал: длина и сколько игроков с Plasmo Voice рядом). После правки нужен перезапуск сервера.

## Сборка

`lib/plasmovoice.jar` скопировать с сервера (`plugins/PlasmoVoice-Paper-2.1.17.jar`, в git не кладём), затем:

```
docker run --rm -v m2cache:/root/.m2 -v "$PWD:/src" -w /src maven:3.9-eclipse-temurin-25 mvn -q -B package
```

Готовый jar: `target/TotemVoiceAddon-<версия>.jar`. Установка: положить в `plugins/`, перезапустить сервер.

## Проверка на стенде (15.11.2026)

Бот TbAlex прислал 2 с тона 440 Гц (24 кГц, как у Qwen): в журнале `TbAlex: фраза 2.0 с, слушателей ... 0`,
ошибок и отметок Vulcan нет. Слышимость проверяется только живым игроком с клиентом Plasmo Voice рядом с ботом.

Дальше: бот слышит игроков (`PlayerSpeakEvent` → речь рядом с ботом пересылается боту, распознавание в программе).
