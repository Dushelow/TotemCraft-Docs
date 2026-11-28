#!/bin/sh
# Сверка документов TotemBots с кодом. Запуск из папки bots/totembots:
#
#     sh scripts/check_docs.sh
#
# Ловит механическое: документ упоминает файл, которого нет; файл есть, а в PROJECT_STRUCTURE.md его нет;
# у модуля нет заголовка-комментария (из него берётся описание). СМЫСЛ не проверяет: зелёный вывод не значит,
# что документы верны. Код возврата 1, если есть находки.

cd "$(dirname "$0")/.." || exit 2
bad=0
note() { printf '  %s\n' "$*"; bad=1; }

echo "== 1. Упомянутые в docs/ и CLAUDE.md файлы, которых нет"
for p in $(grep -hoE '`(app|test|scripts|docs)/[A-Za-z0-9_./-]+`' docs/*.md CLAUDE.md | tr -d '`' | sort -u); do
  case "$p" in *'*'*|*'<'*) continue ;; esac
  [ -e "$p" ] || note "$p"
done
for p in $(grep -hoE '`\.\./[A-Z_]+\.md`' docs/*.md | tr -d '`' | sed 's:^\.\./::' | sort -u); do
  [ -e "$p" ] || note "$p (корневой документ)"
done

echo "== 2. Файлы app/ и test/, которых нет в docs/PROJECT_STRUCTURE.md"
for f in app/*.js app/*.html test/*.js; do
  grep -q "\`$f\`" docs/PROJECT_STRUCTURE.md || note "$f"
done

echo "== 3. Модули app/ без заголовка-комментария (описание в PROJECT_STRUCTURE берётся из него)"
for f in app/*.js; do
  case "$f" in app/panel-preload.js) continue ;; esac
  grep -qm1 '^// [^ ]' "$f" || note "$f"
done

echo "== 4. Символ «забой» в коде (след правки через Python, ломает регулярки)"
for f in app/*.js; do
  if grep -q "$(printf '\010')" "$f"; then note "$f"; fi
done

[ $bad = 0 ] && echo "находок нет" || echo "есть находки"
exit $bad
