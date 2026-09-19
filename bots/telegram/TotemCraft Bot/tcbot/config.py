"""Настройки из переменных окружения (.env или EnvironmentFile в systemd)."""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # На сервере переменные берутся из systemd EnvironmentFile


def _require_env(name):
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Переменная окружения {name!r} не задана. Проверьте файл .env или EnvironmentFile в systemd.")
    return val


TOKEN = _require_env('BOT_TOKEN')
ADMIN_ID = int(_require_env('ADMIN_ID'))
DISCORD_WEBHOOK_URL = _require_env('DISCORD_WEBHOOK_URL')
CONSOLE_WEBHOOK_URL = _require_env('CONSOLE_WEBHOOK_URL')

# RCON сервера Minecraft: регистрация идёт напрямую, без пароля в Discord
RCON_HOST = os.environ.get('RCON_HOST', '127.0.0.1')
RCON_PORT = int(os.environ.get('RCON_PORT', '25575'))
RCON_PASSWORD = os.environ.get('RCON_PASSWORD', '')

# Префикс Bedrock-игроков в Floodgate (username-prefix): бот регистрирует и «.ник»; пусто — не регистрировать
BEDROCK_PREFIX = os.environ.get('BEDROCK_PREFIX', '.')

# Папка сервера Minecraft: бот только читает оттуда баны и базу AuthMe
MC_SERVER_DIR = os.environ.get('MC_SERVER_DIR', '/home/minecraft/server')

# Пояс по умолчанию для показа времени (каждый админ может выбрать свой)
DEFAULT_TZ = os.environ.get('DEFAULT_TZ', 'Europe/Moscow')
# В каком поясе записаны старые файлы бота (до перехода на базу время писалось по часам сервера)
LEGACY_TZ = os.environ.get('LEGACY_TZ', 'Europe/Moscow')

DB_FILE = 'bot.db'
BACKUP_DIR = 'backups'
BACKUP_KEEP_DAYS = 14
ERROR_LOG = 'bot_errors.log'
