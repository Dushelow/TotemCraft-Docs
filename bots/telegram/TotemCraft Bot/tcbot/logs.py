"""Журнал ошибок: файл с ограничением размера, без ожидаемого шума от Telegram."""
import logging
import re
import traceback
from logging.handlers import RotatingFileHandler

from . import config

logger = logging.getLogger('tcbot')
if not logger.handlers:
    _handler = RotatingFileHandler(config.ERROR_LOG, maxBytes=1_000_000, backupCount=3, encoding='utf-8')
    _handler.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s %(message)s'))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)

# Ответы Telegram, которые не ошибка бота: игрок заблокировал бота, то же меню нажали дважды и т.п.
_EXPECTED = (
    'message is not modified',
    'bot was blocked by the user',
    'user is deactivated',
    'chat not found',
    'message to delete not found',
    'message to edit not found',
    "message can't be deleted",
)


_TOKEN = re.compile(r'bot\d{5,}:[A-Za-z0-9_-]{20,}')


def scrub(text):
    """Сетевые ошибки содержат адрес запроса вместе с ключом бота: убираем его."""
    return _TOKEN.sub('bot***', text)


class _Scrub(logging.Filter):
    def filter(self, record):
        record.msg = scrub(record.getMessage())
        record.args = ()
        return True


logger.addFilter(_Scrub())


def log_error(e=None):
    """Пишет ошибку с трассировкой. Ожидаемые ответы Telegram пишет одной строкой или пропускает."""
    text = str(e) if e is not None else ''
    if 'message is not modified' in text:
        return
    if any(x in text for x in _EXPECTED):
        logger.info(text.splitlines()[-1] if text else 'telegram')
        return
    logger.error(traceback.format_exc() if e is not None else text)


def log_warning(text):
    logger.warning(text)
