"""Нестандартные сценарии: полные пути игрока текстом, ошибки ввода, «хулиганские» данные, игрок заблокировал
бота, RCON недоступен, перезапуск посреди диалога, подделанные кнопки, одновременные нажатия.
Поддельный Telegram отвечает ошибками как настоящий (пустой текст, битая разметка, длина и т.п.).
Запуск: python tests/test_edge.py <временная папка>"""
import collections
import os
import shutil
import sys
import threading
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakes
from fakes import check, sent_to, edited, buttons

WORK = sys.argv[1]
shutil.rmtree(WORK, ignore_errors=True)
MC = os.path.join(WORK, 'mc')
fakes.make_mc(MC)
OWNER, ADMIN, HELPER = 1000, 2000, 3000
EVIL = '<b>Злой & "хакер"</a>'
NAMES = {OWNER: 'Влад', ADMIN: 'Вася <админ>', HELPER: 'Петя & Ко', 7001: EVIL, 7002: 'Игрок2', 7003: 'Игрок3'}
ctx = fakes.start(os.path.join(WORK, 'bot'), MC, owner=OWNER, names=NAMES)
bot, storage = ctx.bot, ctx.bot.storage
bot.RATE_LIMIT = 10 ** 6  # в тесте действия идут без пауз; ограничитель проверяется отдельно
crashes = []


def press(*a, **k):
    try:
        return ctx.press(*a, **k)
    except Exception:
        crashes.append(traceback.format_exc().splitlines()[-1])
        return (None, None), list(ctx.tg_log)


def say(*a, **k):
    try:
        return ctx.say(*a, **k)
    except Exception:
        crashes.append(traceback.format_exc().splitlines()[-1])
        return list(ctx.tg_log)


def texts_to(log, chat):
    return sent_to(log, chat) + [t for c, t in edited(log) if c == chat]


# Команда: админ и помощник с «неудобными» именами
storage.execute("INSERT INTO staff (tg_id, name, role, added_by, added_at) VALUES (?,?,?,?,?)",
                (ADMIN, 'Вася <админ>', 'admin', OWNER, bot.timeutil.now_iso()))
storage.execute("INSERT INTO staff (tg_id, name, role, added_by, added_at) VALUES (?,?,?,?,?)",
                (HELPER, 'Петя & Ко', 'helper', OWNER, bot.timeutil.now_iso()))
bot.load_staff()

print("=== 1. Игрок подаёт заявку текстом, с ошибками ввода ===")
P = 7001
log = say(P, '/start')
check(any('Язык' in t for t in texts_to(log, P)), "/start нового игрока: выбор языка")
_, log = press(P, 'lang_ru')
check(any('Главное меню' in t for t in texts_to(log, P)), "после выбора языка: главное меню игрока")
press(P, 'menu_apply')
log = say(P, 'ab')
check(any('слишком короткий' in t for t in sent_to(log, P)), "короткий ник отклонён с объяснением")
log = say(P, 'Ник<script>')
check(any('недопустимые символы' in t for t in sent_to(log, P)), "ник с < и кириллицей отклонён")
log = say(P, 'Good_Nick1')
check(any('пароль' in t.lower() for t in sent_to(log, P)), "ник принят, бот спрашивает пароль")
log = say(P, '123456')
check(any('Недопустимый пароль' in t for t in sent_to(log, P)), "слабый пароль отклонён")
log = say(P, 'good_nick1')
check(any('Недопустимый пароль' in t for t in sent_to(log, P)), "пароль, совпадающий с ником, отклонён")
say(P, 'Str0ng&Pass<1>')
log = say(P, 'Комментарий с <тегами> & амперсандом ' + 'x' * 300)
conf = [t for t in sent_to(log, P) if 'Проверьте данные' in t]
check(bool(conf), "показ «Проверьте данные» с опасными символами в пароле и комментарии")
removed = [p for m, p in log if m == 'sendMessage' and 'remove_keyboard' in str(p.get('reply_markup'))]
check(bool(removed), "нижние кнопки «Пропустить / Отменить» убраны при подтверждении")
press(P, 'confirm_yes')
(t, _), log = press(P, 'rules_agree')
check(str(P) in bot.pending, "заявка в очереди")
note = sent_to(log, OWNER)
check(note and 'Новая заявка!' in note[0], "уведомление о заявке дошло до владельца")
check(not any(d for m, d in ctx.tg_errors if 'parse entities' in d), "нигде не сломана разметка (имя игрока с тегами)")

print("\n=== 2. Повторные и лишние действия игрока ===")
(t, _), log = press(P, 'rules_agree')
check(t and 'устарела' in t, "повторное «Согласен» не создаёт вторую заявку")
(t, _), log = press(P, 'menu_apply')
check(any('подождите' in x or 'активная заявка' in x for x in sent_to(log, P)), "вторую заявку подать нельзя")
(t, _), log = press(P, 'menu_support')
check(any('недоступно' in x for x in sent_to(log, P)), "обращение с активной заявкой недоступно, объяснено")
log = say(P, 'когда рассмотрят???')
check(not crashes, "случайный текст игрока не роняет бота")
log = ctx.photo(P, 'скрин')
check(any('Картинки' in x for x in sent_to(log, P)), "фото вне диалога: подсказка игроку")

print("\n=== 3. Решения: коллега уже решил, заявку отозвали ===")
(t, _), log = press(ADMIN, 'admin_menu_applications', mid=300)
press(ADMIN, f'approve_{P}', mid=300)
press(OWNER, f'reject_{P}', mid=301)
check(bot.admin_states.get(OWNER) is None, "владелец не смог взять заявку, которую держит Вася")
log = say(P, '❌ Отменить заявку')
check(str(P) not in bot.pending and ADMIN not in bot.admin_states, "игрок отозвал заявку, у Васи ввод комментария прерван")
check(any('отозвал' in x for x in sent_to(log, ADMIN)), "Васе объяснили, что заявку отозвали")
(t, alert), _ = press(OWNER, f'approve_{P}')
check(alert and 'уже рассмотрена' in (t or ''), "кнопка по отозванной заявке отвечает понятно")
(t, _), log = press(ADMIN, 'pending_page_5', mid=302)
check(any('Нет заявок' in x for _, x in edited(log)) or not crashes, "листание пустой очереди не падает")

print("\n=== 4. Игрок заблокировал бота ===")
bot.last_application.pop(str(P), None)
bot.user_states[P] = {'step': 'rules', 'nick': 'Good_Nick1', 'password': 'Str0ngPass1', 'comment': ''}
press(P, 'rules_agree')
ctx.blocked_chats.add(P)
press(ADMIN, f'approve_{P}', mid=310)
log = say(ADMIN, 'ок')
check(str(P) not in bot.pending and not crashes, "одобрение игроку, который заблокировал бота, прошло без падения")
check(any(r[0] == 'Good_Nick1' for r in storage.query("SELECT nick FROM applications")), "решение записано в историю")
ctx.blocked_chats.discard(P)

print("\n=== 5. Сервер недоступен: регистрация и повтор ===")
Q = 7002
bot.user_states[Q] = {'step': 'rules', 'nick': 'SecondNick', 'password': 'Str0ngPass2', 'comment': ''}
press(Q, 'rules_agree')
bot.rcon_command = lambda cmd: (_ for _ in ()).throw(ConnectionRefusedError("сервер выключен"))
import tcbot.rcon as rcon_mod
press(ADMIN, f'approve_{Q}', mid=320)
log = say(ADMIN, '-')
retry_to = [c for c in (OWNER, ADMIN) if any('Не удалось зарегистрировать' in x for x in sent_to(log, c))]
check(sorted(retry_to) == [OWNER, ADMIN], f"о сбое регистрации узнали решивший и владелец: {retry_to}")
check('SecondNick' in bot.failed_registrations, "пароль для повтора сохранён в памяти")
bot.rcon_command = rcon_mod.rcon_command
n = len(ctx.rcon_log)
(t, _), log = press(ADMIN, 'retry_reg_SecondNick')
check(ctx.rcon_log[n:] == ['authme register SecondNick Str0ngPass2', 'authme register .SecondNick Str0ngPass2']
      and 'SecondNick' not in bot.failed_registrations,
      "повтор регистрации сработал, пароль из памяти стёрт")
(t, alert), _ = press(OWNER, 'retry_reg_SecondNick')
check(alert, "повторное нажатие «Повторить» отвечает понятно")

print("\n=== 6. Обращения: длинные тексты и опасные символы ===")
R = 7003
press(R, 'menu_support'); press(R, 'support_confirmed'); press(R, 'support_existing')
say(R, 'SomeNick')
long_text = ('Очень длинная жалоба <с тегами> & «кавычками». ' * 200)[:5000]
log = say(R, long_text)
check(not any(d for m, d in ctx.tg_errors if 'too long' in d or 'parse' in d), "длинное обращение с тегами дошло до админов без ошибок Telegram")
(t, _), log = press(ADMIN, f'reply_{R}')
check(bot.dialogs.get(ADMIN) == R, "Вася открыл диалог")
log = say(R, '<b>жирный?</b> & ещё')
check(any('жирный' in x for x in sent_to(log, ADMIN)), "сообщение игрока с тегами пришло админу")
log = say(ADMIN, 'Ответ <i>курсив</i> & символы')
check(any('Сообщение от администрации' in x for x in sent_to(log, R)), "ответ админа с символами дошёл игроку")
(t, _), log = press(OWNER, f'user_profile_{R}')
check(edited(log) and not any(d for m, d in ctx.tg_errors if 'parse' in d or 'too long' in d), "профиль с длинной перепиской открылся")
(t, _), log = press(OWNER, f'hist_{R}')
check(not crashes, "вся переписка открылась")
log = ctx.photo(R, 'вот скрин')
check(any(m == 'sendPhoto' and str(p.get('chat_id')) == str(ADMIN) for m, p in log), "фото игрока в диалоге ушло Васе")

print("\n=== 7. Перезапуск бота посреди диалога ===")
import importlib.util
spec = importlib.util.spec_from_file_location('bot2', os.path.join(fakes.BOT_DIR, 'bot.py'))
bot2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot2)
check(bot2.dialogs.get(ADMIN) == R, "после перезапуска диалог Васи с игроком сохранился")
check(str(R) in bot2.active_tickets and bot2.storage.message_count(R) >= 3, "тикет и переписка на месте")
check(bot2.registration_paused == bot.registration_paused, "пауза регистрации на месте")

print("\n=== 8. Подделанные и сломанные кнопки ===")
for data in ['approve_', 'reject_abc', 'user_profile_xyz', 'pending_page_-1', 'apphistory_view_999999', 'jr_p_notanumber_0',
             'staff_card_1', 'tz_set_999', 'staff_new_5_superadmin', 'hist_', 'block_abc', 'unblock_',
             'admin_close_ticket_zz', 'msg_cat_x', 'retry_reg_', 'noop', 'totally_unknown']:
    before = len(crashes)
    (t, alert), _ = press(OWNER, data)
    if len(crashes) > before:
        print(f"      кнопка {data!r}: {crashes[-1][:100]}")
    elif t is None and data not in ('noop', 'totally_unknown', 'pending_page_-1', 'apphistory_view_999999',
                                     'staff_card_1', 'staff_new_5_superadmin', 'approve_', 'reject_abc', 'retry_reg_'):
        print(f"      кнопка {data!r}: нажавший не получил ответа")
check(not crashes, f"сломанные данные кнопок не роняют бота ({len(crashes)} падений)")
crashes.clear()
(t, alert), _ = press(7002, 'staff_new_7002_admin')
check(7002 not in bot.staff, "игрок не может выдать себе доступ поддельной кнопкой")
(t, alert), _ = press(HELPER, 'staff_delok_2000')
check(ADMIN in bot.staff, "помощник не может снять доступ у админа")

print("\n=== 9. Команды текстом ===")
log = say(ADMIN, '/block 7002 спам')
check(7002 in bot.blocked_users, "/block работает у админа")
log = say(7002, 'привет')
check(not sent_to(log, 7002), "заблокированному игроку бот молчит")
say(ADMIN, '/unblock 7002')
check(7002 not in bot.blocked_users, "/unblock работает")
log = say(HELPER, '/block 7002')
check(7002 not in bot.blocked_users, "у помощника /block не работает")
log = say(ADMIN, '/block 1000')
check(1000 not in bot.blocked_users, "члена команды заблокировать нельзя")
log = say(OWNER, '/pause')
check(bot.registration_paused, "/pause у владельца")
(t, _), log = press(7002, 'menu_apply')
check(any('приостановлена' in x for x in sent_to(log, 7002)), "при паузе игрок видит объяснение")
say(OWNER, '/resume')
log = say(7002, '/id')
check(any('7002' in x for x in sent_to(log, 7002)), "/id показывает ID")
log = say(OWNER, '/status')
check(any('Регистрация' in x for x in sent_to(log, OWNER)), "/status работает")

print("\n=== 10. Одновременные нажатия из разных потоков ===")
errors = []
def worker(k):
    try:
        for _ in range(20):
            ctx.press(OWNER, 'admin_menu_stats', mid=500 + k)
            ctx.press(ADMIN, 'admin_menu_messages', mid=600 + k)
            bot.audit(ADMIN, 'paused')
            bot.add_to_history(7003, f'поток {k}', from_user=True)
    except Exception:
        errors.append(traceback.format_exc().splitlines()[-1])
threads = [threading.Thread(target=worker, args=(k,)) for k in range(8)]
[t.start() for t in threads]; [t.join() for t in threads]
check(not errors, f"8 потоков по 20 действий: без ошибок базы ({errors[:2]})")
check(storage.query("PRAGMA integrity_check")[0][0] == 'ok', "база цела после одновременной записи")

print("\n=== 9а. Бот в группе (админ ради проверки подписки) ===")
GROUP = -1001234567890
states_before = dict(bot.user_states)
for who, text in [(7002, 'Мне надо ник написать'), (7002, '📝 Подать заявку на сервер'), (OWNER, '1'), (7002, '/start')]:
    log = say(who, text, chat_id=GROUP, chat_type='supergroup')
    check(not [p for m, p in log if m.startswith('send')], f"в группе бот молчит на «{text}»")
check(str(GROUP) not in bot.pending and GROUP not in bot.user_states and bot.user_states == states_before,
      "сообщения из группы не создают заявок и состояний")
call = ctx.types.CallbackQuery.de_json({'id': 'grp1', 'from': {'id': 7002, 'is_bot': False, 'first_name': 'X'},
                                        'chat_instance': 'x', 'data': 'menu_apply',
                                        'message': {'message_id': 1, 'date': 0, 'chat': {'id': GROUP, 'type': 'supergroup'}, 'text': 'меню'}})
ctx.tg_log.clear(); bot.callback_handler(call)
check(not [p for m, p in ctx.tg_log if m.startswith('send')], "кнопка под сообщением в группе ничего не запускает")

print("\n=== 10а. Ограничитель частоты ===")
bot.RATE_LIMIT = 5
SPAM = 7777
logs = [say(SPAM, f'спам {i}') for i in range(8)]
warned = [t for log in logs for t in sent_to(log, SPAM) if 'Слишком много' in t]
check(len(warned) == 1, f"спамер получил одно предупреждение «Слишком много запросов» ({len(warned)})")
check(not sent_to(logs[-1], SPAM), "дальше в течение 10 секунд бот его не слушает")
log = say(OWNER, '/status'); log = say(OWNER, '/status'); log = say(OWNER, '/status')
log = say(OWNER, '/status'); log = say(OWNER, '/status'); log = say(OWNER, '/status')
check(any('Регистрация' in t for t in sent_to(log, OWNER)), "на команду ограничитель не действует")
bot.RATE_LIMIT = 10 ** 6

print("\n=== 10б. Разметка Discord ===")
check(bot.md_escape('_Tt_') == '\\_Tt\\_', "ник _Tt_ в Discord не станет курсивом")
check(bot.md_escape('a*b~c`d|e>f') == 'a\\*b\\~c\\`d\\|e\\>f', "звёздочки и прочая разметка тоже экранируются")
check(bot.md_escape('Nick123') == 'Nick123', "ник без разметки не меняется")
v = bot.auto_line({'auto': {'manual': True, 'stop': ['твинк: был аккаунт (A_1)', 'раньше отклоняли (1)'], 'minor': []}}, html=False)
check(v == 'только вручную\n• твинк: был аккаунт (A_1)\n• раньше отклоняли (1)', f"вердикт в Discord: итог и причины списком, без эмодзи ({v!r})")

print("\n=== 10в. Обращение: игрок написал текст вместо ника ===")
SUP = 9101
bot.user_states[SUP] = {'step': 'support_nick'}
n = len(ctx.webhook_log)
log = say(SUP, 'Здравствуйте может я что-то не так ввела свой ник но я не могу зайти')
check(any('только игровой ник' in x for x in sent_to(log, SUP)) and not ctx.webhook_log[n:], "текст сохранён, бот спросил ник, в Discord пока ничего")
log = say(SUP, 'Olivye_9656')
check(any('обращение отправлено' in x for x in sent_to(log, SUP)), "после ника обращение ушло без повторного вопроса")
d = [j['embeds'][0]['description'] for u, j in ctx.webhook_log[n:] if j and 'embeds' in j]
check(d and '`Olivye_9656`' in d[-1] and 'Здравствуйте' not in d[-1], "в Discord в поле ника только ник")
t = bot.active_tickets.get(str(SUP)) or {}
check('Здравствуйте' in str(t) or bot.storage.message_count(SUP) >= 1, "текст обращения дошёл до админов")

print("\n=== 10г. Экран диалога ===")
bot.storage.add_application({'user_id': SUP, 'nick': 'SakuraVirus6310', 'date': '2026-09-19T10:00:00+00:00'},
                            'Одобрено', '', OWNER, 'Владелец')
bot.add_to_history(SUP, 'и ещё пишет что неверный пароль')
(t, _), log = press(ADMIN, f'reply_{SUP}')
msgs = sent_to(log, ADMIN)
check(len(msgs) == 1 and 'Панель администратора' not in msgs[0], f"одно сообщение, панель заново не присылается ({len(msgs)})")
intro = msgs[0] if msgs else ''
check('Вы отвечаете' in intro and 'SakuraVirus6310' in intro, "заголовок «Вы отвечаете: ник»")
check('Сообщения игрока (2)' in intro and 'Проблема:' in intro and 'неверный пароль' in intro, "все неотвеченные сообщения, ник и проблема раздельно")
check('Указал другой ник' in intro and 'Olivye_9656' in intro, "пометка: в обращении не тот ник, что в заявке")
b = buttons(log, ADMIN)
check('✅ Ответил, закрыть' in b and '🏠 Меню' in b and not any('Завершить' in x for x in b), f"кнопки понятные, завершение одно ({b})")
log = say(ADMIN, 'проверьте ник')
(t, _), log = press(ADMIN, f'reply_{SUP}')
check('Сообщени' not in (sent_to(log, ADMIN) or [''])[0], "после ответа админа старые сообщения не повторяются")

print("\n=== 10д. Отойти от диалога, тикет открыт ===")
(t, _), log = press(ADMIN, 'pause_dialog')
check(ADMIN not in bot.dialogs and bot.get_ticket(SUP), "админ отошёл: диалога нет, тикет открыт")
check(not sent_to(log, SUP), "игроку об этом ничего не пишется")
log = say(ADMIN, 'случайный текст')
check(not sent_to(log, SUP), "текст админа после «Отойти» игроку не уходит")
log = say(SUP, 'С планшета с тем же ником')
check(any('Добавлено к обращению' in x for x in sent_to(log, SUP)), "игрок дописал: ему подтвердили")
check(any('Дописал' in x and 'С планшета' in x for x in sent_to(log, ADMIN)), "команде пришло уведомление с текстом")
check('💬 Ответить' in buttons(log, ADMIN), "в уведомлении кнопка «Ответить»")
(t, _), log = press(ADMIN, f'reply_{SUP}')
check(bot.dialogs.get(ADMIN) == SUP and any('С планшета' in x for x in sent_to(log, ADMIN)), "вернулся в диалог, новое сообщение видно")
press(ADMIN, 'pause_dialog')
log = say(SUP, '❌ Завершить диалог')
check(not bot.get_ticket(SUP) and any('закрыто' in x for x in sent_to(log, SUP)), "старая кнопка игрока закрывает обращение")

print("\n=== 11. Ошибки Telegram за весь прогон ===")
counts = collections.Counter(d[:70] for m, d in ctx.tg_errors)
for d, n in counts.most_common():
    print(f"      {n} × {d}")
bad = {d: n for d, n in counts.items() if 'parse' in d or 'too long' in d or 'non-empty' in d or 'inline keyboard' in d}
check(not bad, "нет ошибок разметки, длины, пустого текста и неподходящих кнопок")
with open(os.path.join(WORK, 'bot', 'bot_errors.log'), encoding='utf-8') as f:
    # сбой RCON в разделе 5 вызван нарочно, его не считаем
    errs = [e for e in f.read().split('\n[') if ' ERROR ' in e and 'сервер выключен' not in e]
check(not errs, f"в журнале ошибок бота нет неожиданных ошибок ({len(errs)})")
for l in errs[:5]:
    print("      ", l.strip()[:150])
check(not crashes, f"обработчики не падали ({crashes[:3]})")

fakes.finish()
