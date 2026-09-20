"""Тексты бота для игроков на трёх языках: русский, украинский, английский.

Админка, журнал и Discord остаются на русском, здесь только то, что видит игрок.
Поправить перевод: найти ключ и изменить строку нужного языка. Слова в {фигурных скобках}
бот подставляет сам, их не переводить и не удалять.
"""

LANGS = ('ru', 'uk', 'en')
DEFAULT = 'ru'

# Кнопки выбора языка: флаг и название на самом этом языке
LANG_BUTTONS = {'ru': '🇷🇺 Русский', 'uk': '🇺🇦 Українська', 'en': '🇬🇧 English'}
LANG_PICK = "🌐 Язык · Мова · Language"

T = {
    # ---------- Кнопки ----------
    'btn_main_menu': {'ru': "🏠 Главное меню", 'uk': "🏠 Головне меню", 'en': "🏠 Main menu"},
    'btn_cancel_app': {'ru': "❌ Отменить заявку", 'uk': "❌ Скасувати заявку", 'en': "❌ Cancel application"},
    'btn_cancel': {'ru': "❌ Отменить", 'uk': "❌ Скасувати", 'en': "❌ Cancel"},
    'btn_cancel_inline': {'ru': "❌ Отмена", 'uk': "❌ Скасувати", 'en': "❌ Cancel"},
    'btn_end_dialog': {'ru': "❌ Завершить диалог", 'uk': "❌ Завершити діалог", 'en': "❌ End conversation"},
    'btn_my_tickets': {'ru': "📋 Мои обращения", 'uk': "📋 Мої звернення", 'en': "📋 My requests"},
    'btn_skip': {'ru': "Пропустить", 'uk': "Пропустити", 'en': "Skip"},
    'btn_apply': {'ru': "📝 Подать заявку на сервер", 'uk': "📝 Подати заявку на сервер", 'en': "📝 Apply to the server"},
    'btn_support': {'ru': "🚨 Жалоба / вопрос администратору", 'uk': "🚨 Скарга / питання адміністратору",
                    'en': "🚨 Complaint / question to admins"},
    'btn_handbook': {'ru': "📖 О сервере", 'uk': "📖 Про сервер", 'en': "📖 About the server"},
    'btn_subscribe': {'ru': "📢 Подписаться на группу", 'uk': "📢 Підписатися на групу", 'en': "📢 Join our group"},
    'btn_lang': {'ru': "🌐 Язык", 'uk': "🌐 Мова", 'en': "🌐 Language"},
    'btn_go_group': {'ru': "➡️ Перейти в группу", 'uk': "➡️ Перейти до групи", 'en': "➡️ Open the group"},
    'btn_subscribed': {'ru': "✅ Я подписался", 'uk': "✅ Я підписався", 'en': "✅ I've joined"},
    'btn_close_ticket': {'ru': "❌ Закрыть тикет", 'uk': "❌ Закрити тікет", 'en': "❌ Close ticket"},
    'btn_support_continue': {'ru': "✅ Понимаю, продолжить", 'uk': "✅ Розумію, продовжити", 'en': "✅ I understand, continue"},
    'btn_have_account': {'ru': "✅ Да, есть аккаунт", 'uk': "✅ Так, є акаунт", 'en': "✅ Yes, I have one"},
    'btn_no_account': {'ru': "❌ Нет аккаунта", 'uk': "❌ Немає акаунта", 'en': "❌ No account"},
    'btn_apply_short': {'ru': "📝 Подать заявку", 'uk': "📝 Подати заявку", 'en': "📝 Apply"},
    'btn_just_message': {'ru': "✉️ Просто сообщение", 'uk': "✉️ Просто повідомлення", 'en': "✉️ Just a message"},
    'btn_confirm': {'ru': "✅ Подтвердить", 'uk': "✅ Підтвердити", 'en': "✅ Confirm"},
    'btn_agree': {'ru': "Согласен", 'uk': "Згоден", 'en': "I agree"},
    'btn_disagree': {'ru': "Не согласен", 'uk': "Не згоден", 'en': "I disagree"},
    'btn_hb_back': {'ru': "🔙 К разделам", 'uk': "🔙 До розділів", 'en': "🔙 Back to sections"},

    # ---------- Общие сообщения ----------
    'main_menu': {'ru': "🏠 Главное меню", 'uk': "🏠 Головне меню", 'en': "🏠 Main menu"},
    'blocked_start': {'ru': "🚫 Вы заблокированы и не можете использовать бота.",
                      'uk': "🚫 Вас заблоковано, ви не можете користуватися ботом.",
                      'en': "🚫 You are blocked and cannot use this bot."},
    'blocked_short': {'ru': "🚫 Вы заблокированы.", 'uk': "🚫 Вас заблоковано.", 'en': "🚫 You are blocked."},
    'rate_limit': {'ru': "⚠️ Слишком много запросов. Подождите 10 сек.",
                   'uk': "⚠️ Забагато запитів. Зачекайте 10 сек.",
                   'en': "⚠️ Too many requests. Please wait 10 seconds."},
    'btn_outdated': {'ru': "Кнопка устарела. Откройте меню заново: /start",
                     'uk': "Кнопка застаріла. Відкрийте меню знову: /start",
                     'en': "This button is outdated. Open the menu again: /start"},
    'something_wrong': {'ru': "⚠️ Что-то пошло не так. Попробуйте ещё раз или нажмите /start.",
                        'uk': "⚠️ Щось пішло не так. Спробуйте ще раз або натисніть /start.",
                        'en': "⚠️ Something went wrong. Try again or press /start."},
    'no_access': {'ru': "Нет доступа.", 'uk': "Немає доступу.", 'en': "No access."},
    'your_id': {'ru': "Ваш Telegram ID: <code>{id}</code>", 'uk': "Ваш Telegram ID: <code>{id}</code>",
                'en': "Your Telegram ID: <code>{id}</code>"},
    'in_dialog_warn': {'ru': "⚠️ Сейчас идёт диалог с администратором. Чтобы выйти, нажмите «{btn}».",
                       'uk': "⚠️ Зараз триває діалог з адміністратором. Щоб вийти, натисніть «{btn}».",
                       'en': "⚠️ You are in a conversation with an admin. To leave it, press «{btn}»."},
    'input_interrupted': {'ru': "⚠️ Ввод прерван. Возвращаю в главное меню.",
                          'uk': "⚠️ Введення перервано. Повертаю до головного меню.",
                          'en': "⚠️ Input cancelled. Back to the main menu."},
    'cancelled': {'ru': "❌ Отменено.", 'uk': "❌ Скасовано.", 'en': "❌ Cancelled."},
    'reg_paused': {'ru': "⏸️ Регистрация временно приостановлена.",
                   'uk': "⏸️ Реєстрацію тимчасово призупинено.",
                   'en': "⏸️ Registration is temporarily paused."},

    # ---------- Заявка ----------
    'menu_pending': {
        'ru': "⏳ Ваша заявка от {date} на рассмотрении.\nЗаявки рассматриваются в порядке очереди. Срок рассмотрения - как правило, до 24 часов.",
        'uk': "⏳ Ваша заявка від {date} на розгляді.\nЗаявки розглядаються в порядку черги. Термін розгляду: зазвичай до 24 годин.",
        'en': "⏳ Your application from {date} is under review.\nApplications are reviewed in order, usually within 24 hours."},
    'menu_playing': {
        'ru': "🎮 Вы играете под ником <code>{nick}</code> · <code>play.totemcraft.net</code>",
        'uk': "🎮 Ви граєте під ніком <code>{nick}</code> · <code>play.totemcraft.net</code>",
        'en': "🎮 You play as <code>{nick}</code> · <code>play.totemcraft.net</code>"},
    'app_cancelled': {'ru': "❌ Заявка отменена.", 'uk': "❌ Заявку скасовано.", 'en': "❌ Application cancelled."},
    'no_active_app': {'ru': "У вас нет активной заявки.", 'uk': "У вас немає активної заявки.",
                      'en': "You have no active application."},
    'wait_reapply': {'ru': "⏳ Вы уже подавали заявку. Пожалуйста, подождите {h} ч. {m} мин. перед повторной отправкой.",
                     'uk': "⏳ Ви вже подавали заявку. Будь ласка, зачекайте {h} год. {m} хв. перед повторною подачею.",
                     'en': "⏳ You have already applied. Please wait {h} h {m} min before applying again."},
    'has_pending': {'ru': "⏳ У вас уже есть активная заявка. Дождитесь решения администратора.",
                    'uk': "⏳ У вас уже є активна заявка. Дочекайтеся рішення адміністратора.",
                    'en': "⏳ You already have an active application. Please wait for the admins' decision."},
    'has_pending_short': {'ru': "⏳ У вас уже есть активная заявка.", 'uk': "⏳ У вас уже є активна заявка.",
                          'en': "⏳ You already have an active application."},
    'ask_nick': {
        'ru': "📝 <b>Заявка · шаг 1 из 2</b>\nВведите ваш Minecraft ник (3–16 символов, A-Z, a-z, 0-9, _):\n"
              "<i>Поменять ник потом нельзя.</i>",
        'uk': "📝 <b>Заявка · крок 1 з 2</b>\nВведіть ваш нік у Minecraft (3–16 символів, A-Z, a-z, 0-9, _):\n"
              "<i>Змінити нік потім не можна.</i>",
        'en': "📝 <b>Application · step 1 of 2</b>\nEnter your Minecraft nickname (3–16 characters, A-Z, a-z, 0-9, _):\n"
              "<i>You will not be able to change it later.</i>"},
    'bad_nick': {'ru': "❌ Недопустимый ник.\n{reason}\nПожалуйста, введите другой ник:",
                 'uk': "❌ Недопустимий нік.\n{reason}\nБудь ласка, введіть інший нік:",
                 'en': "❌ Invalid nickname.\n{reason}\nPlease enter another nickname:"},
    'nick_taken': {'ru': "❌ Данный никнейм уже используется на сервере. Пожалуйста, выберите другой ник:",
                   'uk': "❌ Цей нік уже використовується на сервері. Будь ласка, оберіть інший нік:",
                   'en': "❌ This nickname is already taken on the server. Please choose another one:"},
    'ask_password': {
        'ru': "🔑 <b>Заявка · шаг 2 из 2</b>\nВведите пароль (6–30 символов, без пробелов):\n"
              "<i>Он понадобится при каждом заходе на сервер.</i>",
        'uk': "🔑 <b>Заявка · крок 2 з 2</b>\nВведіть пароль (6–30 символів, без пробілів):\n"
              "<i>Він знадобиться під час кожного заходу на сервер.</i>",
        'en': "🔑 <b>Application · step 2 of 2</b>\nEnter a password (6–30 characters, no spaces):\n"
              "<i>You will need it every time you join the server.</i>"},
    'bad_password': {'ru': "❌ Недопустимый пароль.\n{reason}\nПожалуйста, придумайте другой пароль:",
                     'uk': "❌ Недопустимий пароль.\n{reason}\nБудь ласка, придумайте інший пароль:",
                     'en': "❌ Invalid password.\n{reason}\nPlease choose another password:"},
    # Комментарий шагом не считается: иначе игрок думает, что обязан что-то написать
    'ask_comment': {
        'ru': "💬 Хотите оставить комментарий к заявке? Напишите сейчас или нажмите кнопку «{skip}».\n\n"
              "<i>⚠️ Обращения с просьбами ускорить или осуществить регистрацию не рассматриваются и могут повлечь отклонение заявки.</i>",
        'uk': "💬 Бажаєте залишити коментар до заявки? Напишіть зараз або натисніть кнопку «{skip}».\n\n"
              "<i>⚠️ Прохання пришвидшити або провести реєстрацію не розглядаються і можуть призвести до відхилення заявки.</i>",
        'en': "💬 Would you like to add a comment to your application? Write it now or press «{skip}».\n\n"
              "<i>⚠️ Requests to speed up or push through your registration are not considered and may get your application rejected.</i>"},
    'confirm_data': {'ru': "📋 <b>Проверьте данные:</b>\n\n👤 Ник: <code>{nick}</code>\n🔑 Пароль: <code>{password}</code>",
                     'uk': "📋 <b>Перевірте дані:</b>\n\n👤 Нік: <code>{nick}</code>\n🔑 Пароль: <code>{password}</code>",
                     'en': "📋 <b>Check your details:</b>\n\n👤 Nickname: <code>{nick}</code>\n🔑 Password: <code>{password}</code>"},
    'confirm_comment': {'ru': "\n💬 Комментарий: {comment}", 'uk': "\n💬 Коментар: {comment}", 'en': "\n💬 Comment: {comment}"},
    'confirm_q': {'ru': "\n\nВсё верно?", 'uk': "\n\nУсе правильно?", 'en': "\n\nIs everything correct?"},
    'app_outdated': {'ru': "Заявка устарела.", 'uk': "Заявка застаріла.", 'en': "This application is outdated."},
    'already_done': {'ru': "Уже обработана.", 'uk': "Уже оброблено.", 'en': "Already processed."},
    'rules_confirm': {
        'ru': "📜 <b>Правила сервера</b>\n\n"
              "Перед отправкой заявки ознакомьтесь с правилами и подтвердите своё согласие:\n\n"
              "• Запрещено воровать и портить чужое имущество\n"
              "• Запрещены читы\n"
              "• Запрещено PvP без согласия двух сторон\n"
              "• Запрещена реклама\n"
              "• Запрещена политика\n"
              "• Запрещено оскорбление родных\n"
              "• Запрещены механизмы, нагружающие сервер (большое количество воронок)\n\n"
              "<i>Действия, которые могут не входить в список правил, но всё равно портят окружающим людям игровой процесс, могут повлечь за собой наказание — просто будьте вежливыми и не мешайте другим!</i>\n\n"
              "Вы принимаете правила сервера?",
        'uk': "📜 <b>Правила сервера</b>\n\n"
              "Перед надсиланням заявки ознайомтеся з правилами та підтвердьте свою згоду:\n\n"
              "• Заборонено красти та псувати чуже майно\n"
              "• Заборонені чити\n"
              "• Заборонене PvP без згоди обох сторін\n"
              "• Заборонена реклама\n"
              "• Заборонена політика\n"
              "• Заборонено ображати рідних\n"
              "• Заборонені механізми, що навантажують сервер (велика кількість воронок)\n\n"
              "<i>Дії, яких може не бути в списку правил, але які все одно псують гру іншим людям, можуть призвести до покарання. Просто будьте ввічливими й не заважайте іншим!</i>\n\n"
              "Ви приймаєте правила сервера?",
        'en': "📜 <b>Server rules</b>\n\n"
              "Before sending your application, read the rules and confirm that you agree:\n\n"
              "• No stealing or damaging other players' property\n"
              "• No cheats\n"
              "• No PvP without consent from both sides\n"
              "• No advertising\n"
              "• No politics\n"
              "• No insulting other players' family\n"
              "• No contraptions that overload the server (lots of hoppers)\n\n"
              "<i>Actions that are not on this list but still spoil the game for others can also be punished. Just be polite and don't get in other people's way!</i>\n\n"
              "Do you accept the server rules?"},
    'rules_declined': {'ru': "❌ Заявка отменена - вы не приняли правила сервера.",
                       'uk': "❌ Заявку скасовано: ви не прийняли правила сервера.",
                       'en': "❌ Application cancelled: you did not accept the server rules."},
    'app_submitted': {
        'ru': "✅ <b>Ваша заявка принята и отправлена на рассмотрение.</b>\n\n"
              "📋 Заявки рассматриваются в порядке очереди. Срок рассмотрения - <b>как правило, до 24 часов</b>.\n\n"
              "Результат рассмотрения придёт вам автоматически.",
        'uk': "✅ <b>Вашу заявку прийнято й надіслано на розгляд.</b>\n\n"
              "📋 Заявки розглядаються в порядку черги. Термін розгляду: <b>зазвичай до 24 годин</b>.\n\n"
              "Результат розгляду прийде вам автоматично.",
        'en': "✅ <b>Your application has been received and sent for review.</b>\n\n"
              "📋 Applications are reviewed in order. It <b>usually takes up to 24 hours</b>.\n\n"
              "You will get the result here automatically."},
    'sub_wait': {'ru': "📢 Пока ждёте, подпишитесь на нашу группу TotemCraft: там новости и анонсы сервера.",
                 'uk': "📢 Поки чекаєте, підпишіться на нашу групу TotemCraft: там новини та анонси сервера.",
                 'en': "📢 While you wait, join our TotemCraft group: server news and announcements are posted there."},
    'sub_not_seen': {'ru': "Пока не вижу подписки. Подпишитесь и нажмите ещё раз.",
                     'uk': "Поки не бачу підписки. Підпишіться й натисніть ще раз.",
                     'en': "I can't see your subscription yet. Join the group and press again."},
    'sub_thanks': {'ru': "Спасибо за подписку!", 'uk': "Дякуємо за підписку!", 'en': "Thanks for joining!"},
    'subscribe_text': {'ru': "📢 <b>TotemCraft – игровое сообщество</b>\nПрисоединяйтесь к нашей группе!",
                       'uk': "📢 <b>TotemCraft – ігрова спільнота</b>\nПриєднуйтеся до нашої групи!",
                       'en': "📢 <b>TotemCraft – gaming community</b>\nJoin our group!"},

    # ---------- Решение по заявке ----------
    'approved': {
        'ru': "🎉 Ваша заявка одобрена!\n\n"
              "Ник: <code>{nick}</code>\n"
              "Пароль: <code>{password}</code>\n"
              "{bedrock}\n"
              "IP для всех: <code>play.totemcraft.net</code>\n"
              "IP для России: <code>ru.totemcraft.net</code>\n\n"
              "Ждём вас на сервере!\n\n"
              "━━━━━━━━━━━━━━━━━━━━\n"
              "💬 Основной актив сервера в дискорде - более 100 человек. "
              "Общайся с игроками - вступай в Discord:\n"
              "https://discord.gg/MWeUjNWJG3",
        'uk': "🎉 Вашу заявку схвалено!\n\n"
              "Нік: <code>{nick}</code>\n"
              "Пароль: <code>{password}</code>\n"
              "{bedrock}\n"
              "IP для всіх: <code>play.totemcraft.net</code>\n"
              "IP для Росії: <code>ru.totemcraft.net</code>\n\n"
              "Чекаємо на вас на сервері!\n\n"
              "━━━━━━━━━━━━━━━━━━━━\n"
              "💬 Основне життя сервера в Discord, там понад 100 людей. "
              "Спілкуйся з гравцями, приєднуйся до Discord:\n"
              "https://discord.gg/MWeUjNWJG3",
        'en': "🎉 Your application has been approved!\n\n"
              "Nickname: <code>{nick}</code>\n"
              "Password: <code>{password}</code>\n"
              "{bedrock}\n"
              "IP for everyone: <code>play.totemcraft.net</code>\n"
              "IP for Russia: <code>ru.totemcraft.net</code>\n\n"
              "See you on the server!\n\n"
              "━━━━━━━━━━━━━━━━━━━━\n"
              "💬 Most of the community lives on Discord, over 100 people. "
              "Chat with other players, join our Discord:\n"
              "https://discord.gg/MWeUjNWJG3"},
    'approved_bedrock': {'ru': "📱 С телефона или консоли (Bedrock) ваш ник: <code>{nick}</code>, пароль тот же\n",
                         'uk': "📱 З телефона або консолі (Bedrock) ваш нік: <code>{nick}</code>, пароль той самий\n",
                         'en': "📱 On phone or console (Bedrock) your nickname is <code>{nick}</code>, same password\n"},
    'approved_comment': {'ru': "\n\nКомментарий администратора: {comment}", 'uk': "\n\nКоментар адміністратора: {comment}",
                         'en': "\n\nAdmin's comment: {comment}"},
    'rejected': {'ru': "❌ Ваша заявка отклонена администратором.", 'uk': "❌ Вашу заявку відхилено адміністратором.",
                 'en': "❌ Your application has been rejected by the admins."},
    'rejected_comment': {'ru': "\nКомментарий: {comment}", 'uk': "\nКоментар: {comment}", 'en': "\nComment: {comment}"},

    # ---------- Блокировка ----------
    'blocked_by_admin': {'ru': "🚫 Вы были заблокированы администратором.", 'uk': "🚫 Вас заблокував адміністратор.",
                         'en': "🚫 You have been blocked by the admins."},
    'block_reason': {'ru': "\nПричина: {reason}", 'uk': "\nПричина: {reason}", 'en': "\nReason: {reason}"},
    'unblocked': {'ru': "✅ Вы были разблокированы администратором. Можете снова пользоваться ботом.",
                  'uk': "✅ Адміністратор вас розблокував. Можете знову користуватися ботом.",
                  'en': "✅ The admins have unblocked you. You can use the bot again."},

    # ---------- Обращения к администрации ----------
    'support_blocked_by_app': {
        'ru': "⚠️ <b>Обращение к администрации недоступно</b>\n\n"
              "У вас есть активная заявка на регистрацию, которая ожидает рассмотрения.\n\n"
              "Пожалуйста, дождитесь решения по вашей заявке.\n\n"
              "<i>Обратиться к администрации можно только после получения решения по заявке.</i>",
        'uk': "⚠️ <b>Звернення до адміністрації недоступне</b>\n\n"
              "У вас є активна заявка на реєстрацію, яка чекає на розгляд.\n\n"
              "Будь ласка, дочекайтеся рішення щодо вашої заявки.\n\n"
              "<i>Звернутися до адміністрації можна лише після рішення щодо заявки.</i>",
        'en': "⚠️ <b>Contacting the admins is unavailable</b>\n\n"
              "You have an active registration application waiting for review.\n\n"
              "Please wait for the decision on your application.\n\n"
              "<i>You can contact the admins only after your application has been decided.</i>"},
    'support_info': {
        'ru': "📋 <b>Важная информация перед обращением</b>\n\n"
              "Данный канал связи предназначен исключительно для:\n"
              "• технических вопросов и проблем;\n"
              "• жалоб и спорных ситуаций;\n"
              "• сообщений об ошибках и неполадках.\n\n"
              "⛔ <b>Обращения со следующими вопросами не рассматриваются:</b>\n"
              "• «Когда рассмотрят мою заявку?»\n"
              "• «Зарегистрируйте меня быстрее»\n\n"
              "❗ За подобные обращения заявка может быть <b>отклонена без объяснения причин</b>.\n\n"
              "Вы подтверждаете, что ваш вопрос соответствует указанным критериям?",
        'uk': "📋 <b>Важлива інформація перед зверненням</b>\n\n"
              "Цей канал зв'язку призначений виключно для:\n"
              "• технічних питань і проблем;\n"
              "• скарг і спірних ситуацій;\n"
              "• повідомлень про помилки та несправності.\n\n"
              "⛔ <b>Звернення з такими питаннями не розглядаються:</b>\n"
              "• «Коли розглянуть мою заявку?»\n"
              "• «Зареєструйте мене швидше»\n\n"
              "❗ За такі звернення заявку можуть <b>відхилити без пояснення причин</b>.\n\n"
              "Ви підтверджуєте, що ваше питання відповідає цим умовам?",
        'en': "📋 <b>Please read before contacting us</b>\n\n"
              "This channel is only for:\n"
              "• technical questions and problems;\n"
              "• complaints and disputes;\n"
              "• reports of bugs and malfunctions.\n\n"
              "⛔ <b>We do not answer questions like:</b>\n"
              "• “When will my application be reviewed?”\n"
              "• “Please register me faster”\n\n"
              "❗ For such messages an application may be <b>rejected without explanation</b>.\n\n"
              "Do you confirm that your question meets these criteria?"},
    'support_cancelled': {'ru': "Обращение отменено.", 'uk': "Звернення скасовано.", 'en': "Request cancelled."},
    'q_have_account': {'ru': "У вас уже есть аккаунт на сервере?", 'uk': "У вас уже є акаунт на сервері?",
                       'en': "Do you already have an account on the server?"},
    'ask_game_nick': {
        'ru': "📝 <b>Обращение · шаг 1 из 2</b>\nВведите ваш игровой ник на сервере:",
        'uk': "📝 <b>Звернення · крок 1 з 2</b>\nВведіть ваш ігровий нік на сервері:",
        'en': "📝 <b>Request · step 1 of 2</b>\nEnter your in-game nickname on the server:"},
    'q_want_apply': {'ru': "Хотите подать заявку на регистрацию?", 'uk': "Бажаєте подати заявку на реєстрацію?",
                     'en': "Would you like to apply for registration?"},
    'write_message': {'ru': "✍️ Напишите ваше сообщение:", 'uk': "✍️ Напишіть ваше повідомлення:",
                      'en': "✍️ Write your message:"},
    'support_nick_retry': {
        'ru': "Сообщение сохранил. Теперь напишите только игровой ник: латинские буквы, цифры и _, "
              "например <code>Steve_2010</code>.",
        'uk': "Повідомлення збережено. Тепер напишіть лише ігровий нік: латинські літери, цифри та _, "
              "наприклад <code>Steve_2010</code>.",
        'en': "Message saved. Now write only your in-game nickname: Latin letters, digits and _, "
              "for example <code>Steve_2010</code>."},
    'support_describe': {
        'ru': "💬 <b>Обращение · шаг 2 из 2</b>\nОпишите вашу проблему или вопрос:\n"
              "<i>Если это спор или пропажа вещей, напишите время и место.</i>",
        'uk': "💬 <b>Звернення · крок 2 з 2</b>\nОпишіть вашу проблему або питання:\n"
              "<i>Якщо це суперечка або зникнення речей, напишіть час і місце.</i>",
        'en': "💬 <b>Request · step 2 of 2</b>\nDescribe your problem or question:\n"
              "<i>For a dispute or missing items, add the time and place.</i>"},
    'ticket_sent': {'ru': "✅ <b>Обращение #{tid} отправлено</b>\nВаше обращение отправлено администратору. Ожидайте ответа.",
                    'uk': "✅ <b>Звернення #{tid} надіслано</b>\nВаше звернення надіслано адміністратору. Очікуйте на відповідь.",
                    'en': "✅ <b>Request #{tid} sent</b>\nYour request has been sent to the admins. Please wait for a reply."},
    'guest_sent': {'ru': "✅ <b>Обращение #{tid} отправлено</b>\nВаше сообщение отправлено администратору. Ожидайте ответа.",
                   'uk': "✅ <b>Звернення #{tid} надіслано</b>\nВаше повідомлення надіслано адміністратору. Очікуйте на відповідь.",
                   'en': "✅ <b>Request #{tid} sent</b>\nYour message has been sent to the admins. Please wait for a reply."},
    'ticket_already_alert': {'ru': "У вас уже открыт тикет #{id}", 'uk': "У вас уже відкрито тікет #{id}",
                             'en': "You already have ticket #{id} open"},
    'ticket_already': {'ru': "⏳ У вас уже открыт тикет #{id}. Дождитесь ответа или закройте его.",
                       'uk': "⏳ У вас уже відкрито тікет #{id}. Дочекайтеся відповіді або закрийте його.",
                       'en': "⏳ You already have ticket #{id} open. Wait for a reply or close it."},
    'ticket_open_wait': {'ru': "📋 У вас открыт тикет #{id}. Ожидайте ответа администратора.",
                         'uk': "📋 У вас відкрито тікет #{id}. Очікуйте на відповідь адміністратора.",
                         'en': "📋 You have ticket #{id} open. Please wait for the admins' reply."},
    'ticket_card': {'ru': "📋 <b>Тикет #{id}</b>\nСтатус: 🟡 Открыт\n{nick}{date}\n<b>Ваше обращение:</b>\n{text}",
                    'uk': "📋 <b>Тікет #{id}</b>\nСтатус: 🟡 Відкрито\n{nick}{date}\n<b>Ваше звернення:</b>\n{text}",
                    'en': "📋 <b>Ticket #{id}</b>\nStatus: 🟡 Open\n{nick}{date}\n<b>Your request:</b>\n{text}"},
    'ticket_card_nick': {'ru': "🎮 Ник: <code>{nick}</code>\n", 'uk': "🎮 Нік: <code>{nick}</code>\n",
                         'en': "🎮 Nickname: <code>{nick}</code>\n"},
    'ticket_card_date': {'ru': "📅 Дата: {date}\n", 'uk': "📅 Дата: {date}\n", 'en': "📅 Date: {date}\n"},
    'ticket_card_empty': {'ru': "<i>нет текста</i>", 'uk': "<i>немає тексту</i>", 'en': "<i>no text</i>"},
    'no_tickets': {'ru': "У вас нет открытых обращений.", 'uk': "У вас немає відкритих звернень.",
                   'en': "You have no open requests."},
    'ticket_closed': {'ru': "✅ Тикет закрыт.", 'uk': "✅ Тікет закрито.", 'en': "✅ Ticket closed."},
    'ticket_closed_n': {'ru': "✅ Обращение #{id} закрыто.", 'uk': "✅ Звернення #{id} закрито.", 'en': "✅ Request #{id} closed."},
    'ticket_not_found': {'ru': "Тикет не найден.", 'uk': "Тікет не знайдено.", 'en': "Ticket not found."},
    'ticket_closed_by_admin': {'ru': "✅ Ваш тикет #{id} закрыт администратором.",
                               'uk': "✅ Адміністратор закрив ваш тікет #{id}.",
                               'en': "✅ The admins have closed your ticket #{id}."},
    'followup_added': {'ru': "✉️ Добавлено к обращению #{id}. Администратор ответит здесь.",
                       'uk': "✉️ Додано до звернення #{id}. Адміністратор відповість тут.",
                       'en': "✉️ Added to request #{id}. The admins will reply here."},
    'no_dialog': {'ru': "Нет активного диалога.", 'uk': "Немає активного діалогу.", 'en': "No active conversation."},
    'dialog_started': {'ru': "📨 Администратор начал с вами диалог.", 'uk': "📨 Адміністратор розпочав з вами діалог.",
                       'en': "📨 An admin has started a conversation with you."},
    'dialog_ended': {'ru': "🔇 Диалог с администратором завершён.", 'uk': "🔇 Діалог з адміністратором завершено.",
                     'en': "🔇 The conversation with the admins has ended."},
    'msg_from_admins': {'ru': "📨 <b>Сообщение от администрации:</b>\n\n{text}",
                        'uk': "📨 <b>Повідомлення від адміністрації:</b>\n\n{text}",
                        'en': "📨 <b>Message from the admins:</b>\n\n{text}"},
    'photo_from_admins': {'ru': "📨 Фото от администрации", 'uk': "📨 Фото від адміністрації", 'en': "📨 Photo from the admins"},
    'photo_only_dialog': {
        'ru': "📷 Картинки можно отправлять только во время активного диалога с администратором. Напишите ваше сообщение:",
        'uk': "📷 Зображення можна надсилати лише під час активного діалогу з адміністратором. Напишіть ваше повідомлення:",
        'en': "📷 Pictures can only be sent during an active conversation with an admin. Write your message:"},

    # ---------- Справочник ----------
    'handbook_index': {'ru': "📖 <b>Справочник TotemCraft</b>\n\nВыберите раздел:",
                       'uk': "📖 <b>Довідник TotemCraft</b>\n\nОберіть розділ:",
                       'en': "📖 <b>TotemCraft guide</b>\n\nChoose a section:"},

    # ---------- Проверка ника и пароля (правила AuthMe) ----------
    'nick_empty': {'ru': "Ник не может быть пустым.", 'uk': "Нік не може бути порожнім.", 'en': "Nickname cannot be empty."},
    'nick_short': {'ru': "Ник слишком короткий ({n} симв.). Минимум - 3 символа.",
                   'uk': "Нік занадто короткий ({n} симв.). Мінімум 3 символи.",
                   'en': "Nickname is too short ({n} characters). Minimum is 3."},
    'nick_long': {'ru': "Ник слишком длинный ({n} симв.). Максимум - 16 символов.",
                  'uk': "Нік занадто довгий ({n} симв.). Максимум 16 символів.",
                  'en': "Nickname is too long ({n} characters). Maximum is 16."},
    'nick_chars': {'ru': "Ник содержит недопустимые символы: {chars}.\nРазрешены только латинские буквы, цифры и знак подчёркивания (_).",
                   'uk': "Нік містить недопустимі символи: {chars}.\nДозволені лише латинські літери, цифри та знак підкреслення (_).",
                   'en': "Nickname contains invalid characters: {chars}.\nOnly Latin letters, digits and underscore (_) are allowed."},
    'pw_empty': {'ru': "Пароль не может быть пустым.", 'uk': "Пароль не може бути порожнім.", 'en': "Password cannot be empty."},
    'pw_short': {'ru': "Пароль слишком короткий ({n} симв.). Минимум - 6 символов.",
                 'uk': "Пароль занадто короткий ({n} симв.). Мінімум 6 символів.",
                 'en': "Password is too short ({n} characters). Minimum is 6."},
    'pw_long': {'ru': "Пароль слишком длинный ({n} симв.). Максимум - 30 символов.",
                'uk': "Пароль занадто довгий ({n} симв.). Максимум 30 символів.",
                'en': "Password is too long ({n} characters). Maximum is 30."},
    'pw_cyrillic': {'ru': "Пароль не может содержать кириллицу. Используйте только латинские буквы, цифры и спецсимволы.",
                    'uk': "Пароль не може містити кирилицю. Використовуйте лише латинські літери, цифри та спецсимволи.",
                    'en': "Password cannot contain Cyrillic letters. Use only Latin letters, digits and symbols."},
    'pw_space': {'ru': "Пароль не может содержать пробелы.", 'uk': "Пароль не може містити пробіли.",
                 'en': "Password cannot contain spaces."},
    'pw_is_nick': {'ru': "Пароль не должен совпадать с ником. Придумайте другой пароль.",
                   'uk': "Пароль не повинен збігатися з ніком. Придумайте інший пароль.",
                   'en': "Password must not be the same as your nickname. Choose another password."},
    'pw_weak': {'ru': "Этот пароль слишком простой и не принимается сервером. Придумайте более надёжный пароль.",
                'uk': "Цей пароль занадто простий, сервер його не приймає. Придумайте надійніший пароль.",
                'en': "This password is too simple and the server won't accept it. Choose a stronger one."},
    'pw_repeated': {'ru': "Пароль состоит из повторяющихся символов или блоков. Придумайте более надёжный пароль.",
                    'uk': "Пароль складається з однакових символів або блоків, що повторюються. Придумайте надійніший пароль.",
                    'en': "Password consists of repeating characters or blocks. Choose a stronger one."},
    'pw_sequence': {'ru': "Пароль является простой последовательностью символов. Придумайте более надёжный пароль.",
                    'uk': "Пароль є простою послідовністю символів. Придумайте надійніший пароль.",
                    'en': "Password is a simple sequence of characters. Choose a stronger one."},
    'pw_digits': {'ru': "Пароль не может состоять только из цифр. Добавьте буквы или спецсимволы.",
                  'uk': "Пароль не може складатися лише з цифр. Додайте літери або спецсимволи.",
                  'en': "Password cannot be digits only. Add letters or symbols."},
}


def text(lang, key, **kw):
    """Строка на языке игрока; если перевода нет, берётся русская."""
    row = T[key]
    s = row.get(lang) or row[DEFAULT]
    return s.format(**kw) if kw else s


def variants(key):
    """Все переводы кнопки: нижние кнопки бот узнаёт по тексту, а он у каждого языка свой."""
    return set(T[key].values())


# ---------- Справочник «О сервере» ----------
CHAPTER_ORDER = ['rules', 'start', 'life', 'clans', 'commands', 'links']
CHAPTER_EMOJI = {'rules': '🛡', 'start': '🚢', 'life': '🌍', 'clans': '⚔️', 'commands': '⌨️', 'links': '🔗'}

HANDBOOK = {
    'ru': {
        'rules': ('Правила',
            "🛡 <b>Правила сервера</b>\n\n"
            "<b>Запрещено и наказуемо баном:</b>\n"
            "• Порча чужих построек\n"
            "• Воровство\n"
            "• PvP без согласия\n"
            "• Оскорбление родных\n"
            "• Агрессивное обсуждение политики\n\n"
            "Если вы стали жертвой — узнайте ник нарушителя командой <code>/co i</code> "
            "и отправьте жалобу в Discord. Администрация откатит ущерб и вернёт лут.\n\n"
            "<i>Действия, которые могут не входить в список правил, но всё равно портят окружающим людям игровой процесс, могут повлечь за собой наказание — просто будьте вежливыми и не мешайте другим!</i>"),
        'start': ('Начало игры',
            "🚢 <b>Начало игры</b>\n\n"
            "При первом заходе вы появляетесь на корабле — это общий мир.\n\n"
            "🚣 Возьмите лодку и плывите в любом направлении, пока не попадёте на берег.\n\n"
            "🏗 Стройте, творите и развивайтесь!\n\n"
            "По пути вы можете встретить дома, селения и города — просим не разрушать "
            "и не брать чужих ресурсов без спроса."),
        'life': ('Жизнь игроков',
            "🌍 <b>Жизнь игроков</b>\n\n"
            "<b>Идея и геймплей:</b>\n"
            "Основная идея — застройка мира красивыми проектами в выживании и история, "
            "которую игроки создают сами.\n\n"
            "Популярные занятия: ивенты, настолки на редстоуне, написание истории на вики, "
            "отыгрыш политики и общение.\n\n"
            "📌 <b>Важные факты:</b>\n"
            "• Вайп основного мира — никогда\n"
            "• Вайп Края и Незера — раз в полгода\n"
            "• Границы расширяются со временем\n"
            "• Точка возрождения — кровать\n"
            "• Телепортов нет — метро в незере или элитры\n"
            "• Незер-хаб: координаты <code>0, 0</code>\n\n"
            "🏪 Торговая зона — нулевые координаты. В радиусе 500 блоков можно ставить "
            "магазины после разрешения администрации."),
        'clans': ('Кланы и PvP',
            "⚔️ <b>Кланы и PvP</b>\n\n"
            "В игре нет принудительного PvP и фракционных режимов. Для RolePlay политики "
            "организована система кланов — объединений игроков с общей идеей и историей.\n\n"
            "<b>Главное преимущество клана</b> — возможность проводить PvP-сражения.\n\n"
            "<b>⚔️ Правила войн:</b>\n"
            "• Лидеры фиксируют условия конфликта книгой и пером\n"
            "• Оба лидера подписывают свой экземпляр и обмениваются им\n"
            "• Проигравшая сторона выполняет условия победителя\n"
            "• PvP вне войны — запрещено\n\n"
            "<b>Требования для создания клана:</b>\n"
            "• 3 участника\n"
            "• Клановая база\n"
            "• Баннер (флаг)\n"
            "• Стабильный онлайн\n\n"
            "Для создания клана обратитесь к администрации."),
        'commands': ('Команды',
            "⌨️ <b>Команды (плагины)</b>\n\n"
            "<b>Скин и внешность:</b>\n"
            "• <code>/skin &lt;название&gt;</code> — смена скина по нику\n\n"
            "<b>Проверка и приват:</b>\n"
            "• <code>/co i</code> — история блока (выявление гриферов)\n"
            "• <code>/lock</code> — приват сундука\n"
            "• <code>/unlock</code> — снять приват с сундука\n"
            "• <code>/cmodify &lt;ник&gt;</code> — дать доступ к сундуку\n"
            "• <code>/cpassword</code> — пароль на сундук\n"
            "• <code>/cpersist</code> — спам команд (для приватки множества сундуков)\n"
            "• <code>/cremoveall</code> — удалить все приваты сундуков\n"
            "• <code>/chopper on</code> — открыть сундук для воронки\n\n"
            "<b>Чат:</b>\n"
            "• <code>/tell &lt;ник&gt;</code> — личное сообщение\n"
            "• <code>/r</code> — быстрый ответ\n"
            "• <code>/ignore &lt;ник&gt;</code> — скрыть сообщения\n"
            "• <code>/me</code> — РП описание действия\n"
            "• <code>/toggleshout</code> — переключить глобальный чат\n\n"
            "<b>Прочее:</b>\n"
            "• <code>/sit</code> или ПКМ по ступенькам — сесть (анимация)"),
        'links': ('Ссылки',
            "🔗 <b>Ссылки</b>\n\n"
            "💬 <b>Discord:</b> <a href=\"https://discord.gg/MWeUjNWJG3\">discord.gg/MWeUjNWJG3</a>\n\n"
            "📘 <b>ВКонтакте:</b> <a href=\"https://vk.com/totemcraftnet\">vk.com/totemcraftnet</a>\n\n"
            "🌐 <b>Сайт:</b> <a href=\"https://totemcraft.net\">totemcraft.net</a>\n\n"
            "📚 <b>Вики:</b> <a href=\"https://wiki.totemcraft.net\">wiki.totemcraft.net</a>"),
    },
    'uk': {
        'rules': ('Правила',
            "🛡 <b>Правила сервера</b>\n\n"
            "<b>Заборонено, карається баном:</b>\n"
            "• Псування чужих будівель\n"
            "• Крадіжки\n"
            "• PvP без згоди\n"
            "• Образи рідних\n"
            "• Агресивне обговорення політики\n\n"
            "Якщо ви стали жертвою, дізнайтеся нік порушника командою <code>/co i</code> "
            "і надішліть скаргу в Discord. Адміністрація відкотить шкоду й поверне лут.\n\n"
            "<i>Дії, яких може не бути в списку правил, але які все одно псують гру іншим людям, можуть призвести до покарання. Просто будьте ввічливими й не заважайте іншим!</i>"),
        'start': ('Початок гри',
            "🚢 <b>Початок гри</b>\n\n"
            "Під час першого входу ви з'являєтеся на кораблі, це спільний світ.\n\n"
            "🚣 Візьміть човен і пливіть у будь-якому напрямку, доки не дістанетеся берега.\n\n"
            "🏗 Будуйте, творіть і розвивайтеся!\n\n"
            "Дорогою ви можете зустріти будинки, поселення та міста. Просимо не руйнувати їх "
            "і не брати чужих ресурсів без дозволу."),
        'life': ('Життя гравців',
            "🌍 <b>Життя гравців</b>\n\n"
            "<b>Ідея та геймплей:</b>\n"
            "Головна ідея: забудова світу красивими проєктами у виживанні та історія, "
            "яку гравці створюють самі.\n\n"
            "Популярні заняття: івенти, настільні ігри на редстоуні, написання історії на вікі, "
            "відіграш політики та спілкування.\n\n"
            "📌 <b>Важливі факти:</b>\n"
            "• Вайп основного світу: ніколи\n"
            "• Вайп Енду й Незеру: раз на пів року\n"
            "• Кордони світу з часом розширюються\n"
            "• Точка відродження: ліжко\n"
            "• Телепортів немає: метро в Незері або елітри\n"
            "• Незер-хаб: координати <code>0, 0</code>\n\n"
            "🏪 Торгова зона на нульових координатах. У радіусі 500 блоків можна ставити "
            "магазини з дозволу адміністрації."),
        'clans': ('Клани та PvP',
            "⚔️ <b>Клани та PvP</b>\n\n"
            "У грі немає примусового PvP і фракційних режимів. Для рольової політики "
            "є система кланів: об'єднань гравців зі спільною ідеєю та історією.\n\n"
            "<b>Головна перевага клану</b>: можливість проводити PvP-битви.\n\n"
            "<b>⚔️ Правила воєн:</b>\n"
            "• Лідери записують умови конфлікту в книгу з пером\n"
            "• Обидва лідери підписують свій примірник і обмінюються ним\n"
            "• Сторона, що програла, виконує умови переможця\n"
            "• PvP поза війною заборонене\n\n"
            "<b>Вимоги для створення клану:</b>\n"
            "• 3 учасники\n"
            "• Кланова база\n"
            "• Банер (прапор)\n"
            "• Стабільний онлайн\n\n"
            "Щоб створити клан, зверніться до адміністрації."),
        'commands': ('Команди',
            "⌨️ <b>Команди (плагіни)</b>\n\n"
            "<b>Скін і зовнішність:</b>\n"
            "• <code>/skin &lt;назва&gt;</code>: зміна скіна за ніком\n\n"
            "<b>Перевірка та приват:</b>\n"
            "• <code>/co i</code>: історія блока (пошук гриферів)\n"
            "• <code>/lock</code>: приват скрині\n"
            "• <code>/unlock</code>: зняти приват зі скрині\n"
            "• <code>/cmodify &lt;нік&gt;</code>: дати доступ до скрині\n"
            "• <code>/cpassword</code>: пароль на скриню\n"
            "• <code>/cpersist</code>: повтор команди (щоб приватити багато скринь)\n"
            "• <code>/cremoveall</code>: зняти всі привати скринь\n"
            "• <code>/chopper on</code>: відкрити скриню для воронки\n\n"
            "<b>Чат:</b>\n"
            "• <code>/tell &lt;нік&gt;</code>: особисте повідомлення\n"
            "• <code>/r</code>: швидка відповідь\n"
            "• <code>/ignore &lt;нік&gt;</code>: приховати повідомлення\n"
            "• <code>/me</code>: РП-опис дії\n"
            "• <code>/toggleshout</code>: перемкнути глобальний чат\n\n"
            "<b>Інше:</b>\n"
            "• <code>/sit</code> або ПКМ по сходинках: сісти (анімація)"),
        'links': ('Посилання',
            "🔗 <b>Посилання</b>\n\n"
            "💬 <b>Discord:</b> <a href=\"https://discord.gg/MWeUjNWJG3\">discord.gg/MWeUjNWJG3</a>\n\n"
            "📘 <b>ВКонтакте:</b> <a href=\"https://vk.com/totemcraftnet\">vk.com/totemcraftnet</a>\n\n"
            "🌐 <b>Сайт:</b> <a href=\"https://totemcraft.net\">totemcraft.net</a>\n\n"
            "📚 <b>Вікі:</b> <a href=\"https://wiki.totemcraft.net\">wiki.totemcraft.net</a>"),
    },
    'en': {
        'rules': ('Rules',
            "🛡 <b>Server rules</b>\n\n"
            "<b>Forbidden, punished with a ban:</b>\n"
            "• Damaging other players' builds\n"
            "• Stealing\n"
            "• PvP without consent\n"
            "• Insulting other players' family\n"
            "• Aggressive political discussions\n\n"
            "If you become a victim, find out the offender's nickname with <code>/co i</code> "
            "and send a complaint on Discord. The admins will roll back the damage and return your loot.\n\n"
            "<i>Actions that are not on this list but still spoil the game for others can also be punished. Just be polite and don't get in other people's way!</i>"),
        'start': ('Getting started',
            "🚢 <b>Getting started</b>\n\n"
            "When you join for the first time, you appear on a ship. This is the shared world.\n\n"
            "🚣 Take a boat and sail in any direction until you reach the shore.\n\n"
            "🏗 Build, create and grow!\n\n"
            "On the way you may come across houses, villages and towns. Please do not destroy them "
            "or take other players' resources without asking."),
        'life': ('Life on the server',
            "🌍 <b>Life on the server</b>\n\n"
            "<b>Idea and gameplay:</b>\n"
            "The main idea is filling the world with beautiful survival builds and a story "
            "that the players write themselves.\n\n"
            "Popular activities: events, redstone board games, writing history on the wiki, "
            "political roleplay and hanging out.\n\n"
            "📌 <b>Key facts:</b>\n"
            "• Main world wipe: never\n"
            "• End and Nether wipe: every six months\n"
            "• The world border expands over time\n"
            "• Respawn point: your bed\n"
            "• No teleports: use the Nether subway or elytra\n"
            "• Nether hub: coordinates <code>0, 0</code>\n\n"
            "🏪 The trade zone is at zero coordinates. Within 500 blocks you can set up "
            "shops with the admins' permission."),
        'clans': ('Clans and PvP',
            "⚔️ <b>Clans and PvP</b>\n\n"
            "There is no forced PvP and no faction modes. For political roleplay "
            "there is a clan system: groups of players with a shared idea and history.\n\n"
            "<b>The main clan perk</b> is the ability to hold PvP battles.\n\n"
            "<b>⚔️ War rules:</b>\n"
            "• Leaders write down the terms of the conflict in a book and quill\n"
            "• Both leaders sign their copy and exchange them\n"
            "• The losing side fulfils the winner's terms\n"
            "• PvP outside of war is forbidden\n\n"
            "<b>To create a clan you need:</b>\n"
            "• 3 members\n"
            "• A clan base\n"
            "• A banner (flag)\n"
            "• Regular activity\n\n"
            "To create a clan, contact the admins."),
        'commands': ('Commands',
            "⌨️ <b>Commands (plugins)</b>\n\n"
            "<b>Skin and look:</b>\n"
            "• <code>/skin &lt;name&gt;</code>: change your skin to another player's\n\n"
            "<b>Inspection and protection:</b>\n"
            "• <code>/co i</code>: block history (find griefers)\n"
            "• <code>/lock</code>: lock a chest\n"
            "• <code>/unlock</code>: unlock a chest\n"
            "• <code>/cmodify &lt;nick&gt;</code>: give access to a chest\n"
            "• <code>/cpassword</code>: password-protect a chest\n"
            "• <code>/cpersist</code>: repeat a command (to lock many chests)\n"
            "• <code>/cremoveall</code>: remove all your chest locks\n"
            "• <code>/chopper on</code>: let hoppers use a chest\n\n"
            "<b>Chat:</b>\n"
            "• <code>/tell &lt;nick&gt;</code>: private message\n"
            "• <code>/r</code>: quick reply\n"
            "• <code>/ignore &lt;nick&gt;</code>: hide someone's messages\n"
            "• <code>/me</code>: roleplay action\n"
            "• <code>/toggleshout</code>: toggle global chat\n\n"
            "<b>Other:</b>\n"
            "• <code>/sit</code> or right-click on stairs: sit down (animation)"),
        'links': ('Links',
            "🔗 <b>Links</b>\n\n"
            "💬 <b>Discord:</b> <a href=\"https://discord.gg/MWeUjNWJG3\">discord.gg/MWeUjNWJG3</a>\n\n"
            "📘 <b>VK:</b> <a href=\"https://vk.com/totemcraftnet\">vk.com/totemcraftnet</a>\n\n"
            "🌐 <b>Website:</b> <a href=\"https://totemcraft.net\">totemcraft.net</a>\n\n"
            "📚 <b>Wiki:</b> <a href=\"https://wiki.totemcraft.net\">wiki.totemcraft.net</a>"),
    },
}


def chapter(lang, key):
    """(заголовок кнопки, текст главы) справочника на языке игрока."""
    return (HANDBOOK.get(lang) or HANDBOOK[DEFAULT])[key]


# ---------- Описание бота в Telegram ----------
# Русское описание задаётся в BotFather и видно всем остальным. Эти два бот ставит сам при запуске:
# Telegram показывает их тем, у кого приложение на украинском или английском.
DESCRIPTION = {
    'uk': "Ласкаво просимо!\n\n"
          "📋 Щоб отримати доступ на сервер, надішліть заявку. Зазвичай розгляд займає не більше 24 годин. Команда /start\n\n"
          "⚠️ Скарги та питання також пишіть тут!\n\n"
          "IP-адреса:\n"
          "🌐 Основна → play.totemcraft.net\n"
          "🚩 Проксі для Росії → ru.totemcraft.net",
    'en': "Welcome!\n\n"
          "📋 To get access to the server, send an application. It usually takes no more than 24 hours. Command /start\n\n"
          "⚠️ Complaints and questions go here too!\n\n"
          "IP address:\n"
          "🌐 Main → play.totemcraft.net\n"
          "🚩 Proxy for Russia → ru.totemcraft.net",
}
SHORT_DESCRIPTION = {
    'uk': "Доступ на сервер TotemCraft",
    'en': "Access to the TotemCraft server",
}
