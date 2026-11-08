#!/bin/bash
# Разовый переход 09.11.2026 со старых своих плагинов на аддоны Totem*.
# Запускать при ОСТАНОВЛЕННОМ сервере или сразу перед перезапуском: старые jar уходят в копию,
# новые кладутся рядом, данные переносятся. Ничего не удаляется, всё старое лежит в $BACKUP.
#
#   migrate-to-totem-addons.sh <папка сервера> <папка с новыми jar> <папка копии> [владелец файлов]
#
# Старое -> новое:
#   clantagview-*.jar   -> TotemSimpleClansAddon (теги кланов) + TotemEssentialsAddon (ближний чат)
#   autolock-*.jar      -> TotemLWCAddon         (AutoLock/players.txt -> TotemLWCAddon/autolock-players.txt)
#   regionrules-*.jar   -> TotemWorldGuardAddon
#   totemguard-*.jar    -> TotemVulcanAddon      (TotemGuard/config.yml и journal.log переносятся)
#   fishclaim-*.jar     -> TotemFishClaim        (FishClaim/config.yml переносится: там адрес бота)
set -euo pipefail
SERVER="$1"; NEW="$2"; BACKUP="$3"; OWNER="${4:-}"
P="$SERVER/plugins"
mkdir -p "$BACKUP"
echo "Копия старого: $BACKUP"
for jar in clantagview autolock regionrules totemguard fishclaim; do
  for f in "$P"/$jar-*.jar; do [ -e "$f" ] && mv -v "$f" "$BACKUP/"; done
done
for dir in ClanTagView AutoLock RegionRules TotemGuard FishClaim; do
  [ -d "$P/$dir" ] && cp -a "$P/$dir" "$BACKUP/"
done
for f in "$NEW"/Totem*.jar; do cp -v "$f" "$P/"; done

mkdir -p "$P/TotemLWCAddon" "$P/TotemVulcanAddon" "$P/TotemFishClaim"
[ -f "$P/AutoLock/players.txt" ] && cp -v "$P/AutoLock/players.txt" "$P/TotemLWCAddon/autolock-players.txt"
[ -f "$P/TotemGuard/config.yml" ] && cp -v "$P/TotemGuard/config.yml" "$BACKUP/totemguard-config-was.yml"
[ -f "$P/TotemGuard/journal.log" ] && cp -v "$P/TotemGuard/journal.log" "$P/TotemVulcanAddon/journal.log"
[ -f "$P/FishClaim/config.yml" ] && cp -v "$P/FishClaim/config.yml" "$P/TotemFishClaim/config.yml"
# Старые папки данных убираем в копию, чтобы не путали
for dir in ClanTagView AutoLock RegionRules TotemGuard FishClaim; do
  [ -d "$P/$dir" ] && rm -rf "$P/$dir"
done
if [ -n "$OWNER" ]; then
  chown -R "$OWNER" "$P"/Totem*.jar "$P/TotemLWCAddon" "$P/TotemVulcanAddon" "$P/TotemFishClaim"
fi
echo "Готово. В plugins:"; ls "$P" | grep -E "^Totem" || true
