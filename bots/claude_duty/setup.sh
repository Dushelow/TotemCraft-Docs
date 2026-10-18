#!/bin/bash
# Установка дежурного Claude на игровой сервер. Запуск от root из папки с файлами: bash setup.sh
# Повторный запуск безопасен: обновляет файлы, ничего не удаляет.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

# 1. Учётная запись без root и общая группа с ботом Core
getent group tcclaude >/dev/null || groupadd tcclaude
id claudebot >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin --gid tcclaude claudebot
usermod -aG tcclaude totemcraftcore

# 2. Инструмент и обработчик: владелец root, claudebot менять не может
install -d -o root -g root -m 755 /opt/tcclaude
install -o root -g root -m 755 "$SRC/tc.py" /opt/tcclaude/tc
install -o root -g root -m 644 "$SRC/abx_history.py" "$SRC/worker.py" "$SRC/RULES.md" "$SRC/templates.txt" "$SRC/snapshot.sh" "$SRC/routine.md" /opt/tcclaude/
install -d -o root -g root -m 700 /var/lib/tcclaude-root
install -d -o root -g root -m 755 /var/log/tcclaude

# 3. Очередь: inbox и files пишет Core, outbox и work пишет claudebot
install -d -o root -g tcclaude -m 2770 /var/lib/tcclaude
for d in inbox files outbox work; do install -d -o root -g tcclaude -m 2770 /var/lib/tcclaude/$d; done
chown claudebot:tcclaude /var/lib/tcclaude/work

# 4. sudo только на инструмент
cat > /etc/sudoers.d/tcclaude <<'EOF'
claudebot ALL=(root) NOPASSWD: /opt/tcclaude/tc, /opt/tcclaude/tc *
EOF
chmod 440 /etc/sudoers.d/tcclaude
visudo -cf /etc/sudoers.d/tcclaude

# 5. Claude Code для claudebot (официальный установщик)
if [ ! -x /home/claudebot/.local/bin/claude ]; then
  sudo -u claudebot -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi
sudo -u claudebot -H /home/claudebot/.local/bin/claude --version

# 5б. Модель и усилие дежурного: Sonnet, среднее усилие (дешевле, но не тупой)
install -d -o claudebot -g tcclaude -m 700 /home/claudebot/.claude
printf '%s
' '{"model": "sonnet", "effortLevel": "medium"}' > /home/claudebot/.claude/settings.json
chown claudebot:tcclaude /home/claudebot/.claude/settings.json

# 6. Ключ Claude кладёт владелец: /etc/tcclaude/token.env (CLAUDE_CODE_OAUTH_TOKEN=...), права 600 root
install -d -o root -g root -m 700 /etc/tcclaude

# 7. Служба: работает только при наличии ключа, не больше 1 ГБ памяти
install -o root -g root -m 644 "$SRC/tcclaude-duty.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable tcclaude-duty
systemctl restart totemcraftcore  # Core получает группу tcclaude
if [ -s /etc/tcclaude/token.env ]; then systemctl restart tcclaude-duty; fi
systemctl --no-pager status tcclaude-duty | head -5 || true
echo "Готово. Журнал действий дежурного: /var/log/tcclaude/actions.log"
