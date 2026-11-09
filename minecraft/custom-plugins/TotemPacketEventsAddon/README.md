# TotemPacketEventsAddon

Аддон TotemCraft к PacketEvents 2.14. Сервер: Paper/Purpur 26.3.

## Механики

**Один пакет с координатами за тик клиента** (`one-position-per-tick`). Ядро 26.x принимает не больше одного
пакета движения с координатами между пакетами «конец тика клиента», за второй кикает
«Invalid move player packet received». Принтер Litematica шлёт несколько, когда поворачивает игрока к блоку.
Лишние пакеты превращаются в пакет поворота (блоки встают правильной стороной), пакеты «только координаты»
отбрасываются. Раз в `log-summary-minutes` в журнал пишется, у кого сколько исправлено.

## Сборка

`lib/packetevents.jar` скопировать с сервера, затем `mvn -q -B package`. Jar: `target/TotemPacketEventsAddon-<версия>.jar`.
