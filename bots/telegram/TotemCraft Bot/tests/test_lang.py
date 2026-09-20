"""Языки игрока: выбор при первом /start, смена в меню, анкета и ответы на украинском и английском.
Админка остаётся на русском. Запуск: python tests/test_lang.py <временная папка>"""
import json
import os
import shutil
import string
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check, sent_to, edited, buttons

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
OWNER, UA, EN, RU, DE, OLD = 1000, 8001, 8002, 8003, 8004, 8005
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER,
                  names={OWNER: 'Влад', UA: 'Тарас', EN: 'John', RU: 'Ваня', DE: 'Hans', OLD: 'Старожил'})
bot, press, say = ctx.bot, ctx.press, ctx.say
i18n = bot.i18n
bot.RATE_LIMIT = 10 ** 6


def texts_to(log, chat):
    return sent_to(log, chat) + [t for c, t in edited(log) if c == chat]


def reply_buttons(log, chat):
    out = []
    for m, p in log:
        mk = p.get('reply_markup')
        if str(p.get('chat_id')) == str(chat) and mk and 'keyboard' in str(mk) and 'inline_keyboard' not in str(mk):
            out.append(json.dumps(json.loads(mk) if isinstance(mk, str) else mk, ensure_ascii=False))
    return " ".join(out)


print("=== 0. Файл переводов ===")
bad = [k for k, v in i18n.T.items() if set(v) != set(i18n.LANGS)]
check(not bad, f"у каждой строки три языка: {bad[:3]}")
fields = lambda t: {f[1] for f in string.Formatter().parse(t) if f[1]}
bad = [k for k, v in i18n.T.items() if len({frozenset(fields(t)) for t in v.values()}) != 1]
check(not bad, f"подстановки {{...}} одинаковы во всех языках: {bad[:3]}")
check(all(set(i18n.HANDBOOK[l]) == set(i18n.CHAPTER_ORDER) for l in i18n.LANGS), "справочник полный на трёх языках")
problems = [(l, k) for l in i18n.LANGS for k in i18n.CHAPTER_ORDER if fakes.html_problem(i18n.HANDBOOK[l][k][1])]
problems += [(k, l) for k, v in i18n.T.items() for l, t in v.items() if fakes.html_problem(t.replace('{', '').replace('}', ''))]
check(not problems, f"разметка HTML в переводах цела: {problems[:3]}")
check(all(len(t) <= 512 for t in i18n.DESCRIPTION.values()), "описание бота не длиннее 512 знаков")
check(all(len(t) <= 120 for t in i18n.SHORT_DESCRIPTION.values()), "короткое описание не длиннее 120 знаков")

print("\n=== 1. Первый /start: язык по языку Telegram ===")
log = say(UA, '/start', lang='uk')
check(any('Головне меню' in t for t in sent_to(log, UA)), "украинский Telegram: сразу меню по-украински")
check(not any('Choose your language' in t for t in sent_to(log, UA)), "экрана с тремя языками больше нет")
check(bot.user_lang.get(str(UA)) == 'uk', "язык сохранён в базе")
check('📝 Подати заявку на сервер' in buttons(log, UA) and '🇺🇦 Українська' in buttons(log, UA),
      "меню по-украински, кнопка языка с флагом текущего")
check(bot.storage.query("SELECT value FROM kv WHERE space='lang' AND key=?", (str(UA),))[0][0] == '"uk"',
      "язык записан в таблицу kv, новых таблиц не нужно")
log = say(DE, '/start', lang='de')
check(any('Main menu' in t for t in sent_to(log, DE)) and bot.user_lang.get(str(DE)) == 'en',
      "немецкий Telegram: английский, а не русский")
check(bot.detect_lang(type('U', (), {'language_code': 'kk'})) == 'en'
      and bot.detect_lang(type('U', (), {'language_code': ''})) == 'ru',
      "язык не из трёх даёт английский, пустой язык даёт русский")
log = say(RU, '/start', lang='ru')
check(any('Главное меню' in t for t in sent_to(log, RU)) and bot.user_lang.get(str(RU)) == 'ru',
      "русский Telegram: русский")
bot.storage.execute("INSERT INTO applications (created_at, tg_id, nick, status) VALUES (?,?,?,?)",
                    (bot.timeutil.now_iso(), OLD, 'OldPlayer', 'Одобрено'))
log = say(OLD, '/start', lang='en')
check(any('Главное меню' in t for t in sent_to(log, OLD)) and bot.user_lang.get(str(OLD)) == 'ru',
      "давний игрок с английским Telegram остаётся на русском")

print("\n=== 2. Анкета на украинском ===")
_, log = press(UA, 'menu_apply')
check(any('Введіть ваш нік' in t for t in sent_to(log, UA)), "вопрос про ник по-украински")
check('Скасувати заявку' in reply_buttons(log, UA), "нижняя кнопка отмены по-украински")
log = say(UA, 'ab')
check(any('Нік занадто короткий' in t for t in sent_to(log, UA)), "ошибка ника по-украински")
log = say(UA, 'Taras_UA')
check(any('Введіть пароль' in t for t in sent_to(log, UA)), "вопрос про пароль по-украински")
log = say(UA, '123456')
check(any('Недопустимий пароль' in t for t in sent_to(log, UA)), "ошибка пароля по-украински")
log = say(UA, '❌ Скасувати заявку')
check(any('Заявку скасовано' in t for t in sent_to(log, UA)) and UA not in bot.user_states,
      "украинская кнопка «Скасувати заявку» отменяет анкету")

print("\n=== 3. Английский: вся заявка до одобрения ===")
say(EN, '/start', lang='en-US')
check(bot.user_lang.get(str(EN)) == 'en', "en-US понят как английский")
_, log = press(EN, 'menu_apply')
check(any('Enter your Minecraft nickname' in t for t in sent_to(log, EN)), "вопрос про ник по-английски")
say(EN, 'JohnCraft')
log = say(EN, 'bananas12345')
check('Skip' in reply_buttons(log, EN), "кнопка Skip")
log = say(EN, 'Skip')
check(bot.user_states[EN].get('comment') == '' and any('Check your details' in t for t in sent_to(log, EN)),
      "Skip пропускает комментарий, проверка данных по-английски")
_, log = press(EN, 'confirm_yes')
check(any('Server rules' in t for t in sent_to(log, EN)) and 'I agree' in buttons(log, EN), "правила по-английски")
_, log = press(EN, 'rules_agree')
check(any('Your application has been received' in t for t in sent_to(log, EN)), "заявка принята, ответ по-английски")
note = sent_to(log, OWNER)
check(any('JohnCraft' in x and 'Новая заявка' in x for x in note), f"админу уведомление по-русски: {note[:1]}")
press(OWNER, f'approve_{EN}', mid=90)
log = say(OWNER, '-')
pm = sent_to(log, EN)
check(any('Your application has been approved' in x and 'JohnCraft' in x and 'IP for everyone' in x for x in pm),
      "одобрение пришло по-английски с ником и IP")
check(any('Bedrock' in x and '.JohnCraft' in x for x in pm), "подсказка про Bedrock по-английски")

print("\n=== 4. Смена языка в меню, справочник ===")
_, log = press(EN, 'menu_lang')
check(any('Choose your language' in t for t in texts_to(log, EN)), "кнопка с флагом открывает выбор языка")
check(buttons(log, EN) == ['🇷🇺 Русский', '🇺🇦 Українська', '🇬🇧 English'], "в выборе три кнопки с флагами")
_, log = press(EN, 'lang_ru')
check(bot.user_lang.get(str(EN)) == 'ru' and any('Главное меню' in t for t in texts_to(log, EN)), "сменил на русский")
press(EN, 'lang_en')
_, log = press(EN, 'menu_handbook')
check(any('TotemCraft guide' in t for t in texts_to(log, EN)) and '🛡 Rules' in buttons(log, EN), "справочник по-английски")
_, log = press(EN, 'hb_life')
check(any('Main world wipe: never' in t for t in texts_to(log, EN)), "глава справочника по-английски")
_, log = press(EN, 'lang_de')
check(bot.user_lang.get(str(EN)) == 'en', "подделанная кнопка lang_de язык не меняет")

print("\n=== 5. Обращение и диалог на украинском ===")
_, log = press(UA, 'menu_support')
check(any('Важлива інформація' in t for t in sent_to(log, UA)), "предупреждение перед обращением по-украински")
press(UA, 'support_confirmed')
press(UA, 'support_no_account')
press(UA, 'support_guest')
log = say(UA, 'Привіт, питання про сервер')
check(any('Ваше повідомлення надіслано' in t for t in sent_to(log, UA)), "сообщение принято, ответ по-украински")
press(OWNER, f'reply_{UA}')
log = say(OWNER, 'Добрый день')
check(any('Повідомлення від адміністрації' in t and 'Добрый день' in t for t in sent_to(log, UA)),
      "ответ админа приходит с украинской подписью, текст как написал админ")
log = say(UA, '❌ Завершити діалог')
check(any('Діалог з адміністратором завершено' in t for t in sent_to(log, UA)), "украинская кнопка завершает диалог")

print("\n=== 6. Игроки без языка и админы ===")
bot.last_application.pop(str(RU), None)
bot.user_lang.pop(str(RU), None)  # нажал кнопку в старом сообщении, ни разу не открыв бота заново
_, log = press(RU, 'menu_apply')
check(any('Введите ваш Minecraft ник' in t for t in sent_to(log, RU)), "игрок без выбранного языка видит русский")
log = say(RU, '🏠 Главное меню')
check(any('Главное меню' in t for t in texts_to(log, RU)), "русская нижняя кнопка работает как раньше")
log = say(OWNER, '/start', lang='en')
check(any('Панель администратора' in t for t in sent_to(log, OWNER)) and str(OWNER) not in bot.user_lang,
      "админу панель по-русски, язык ему не назначается")

fakes.finish()
