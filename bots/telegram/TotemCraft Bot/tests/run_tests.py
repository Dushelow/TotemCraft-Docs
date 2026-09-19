"""Запуск всех тестов бота. Каждый тест в своём процессе и своей временной папке.
Нужны библиотеки бота: pip install pyTelegramBotAPI requests schedule pytz
Запуск из папки бота: python tests/run_tests.py"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = ['test_migration.py', 'test_scenarios.py', 'test_edge.py', 'test_load.py']

failed = []
with tempfile.TemporaryDirectory() as tmp:
    for name in TESTS:
        print(f"\n########## {name}")
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        r = subprocess.run([sys.executable, os.path.join(HERE, name), os.path.join(tmp, name[:-3])], env=env)
        if r.returncode != 0:
            failed.append(name)
print("\n##########", "ВСЕ ТЕСТЫ ПРОШЛИ" if not failed else f"УПАЛИ: {', '.join(failed)}")
sys.exit(1 if failed else 0)
