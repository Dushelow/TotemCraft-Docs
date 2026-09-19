"""Словарь для ников, паролей и комментариев: мат, оскорбления, запрещённая символика, политика.

Как проверяется:
- текст приводится к латинице (кириллица транслитом), обходы заменяются буквами (0->o, 1->i, 3->e, 4->ch и 4->a,
  6->b, 9->ya, @->a, $->s), повторы букв схлопываются (huuuy -> huy);
- КОРНИ ищутся внутри ника целиком, даже через разделители (p_i_d_o_r), а в тексте с пробелами — внутри каждого
  слова отдельно (чтобы «хочу играть» не склеилось в «...hui...»);
- обычные слова, внутри которых случайно есть корень (Technoblade, Mandarin, Lebanon), вырезаются до поиска (ALLOW);
- СЛОВА (короткие, часто часть обычных слов) — только целым словом ника: loh, sex, svo...;
- ЧИСЛА — по исходному тексту (1488, 14/88).
Основа: корни из словаря русского мата (бзд, бля, еб, говн, жоп, манд, муд, пизд, хуй, шлюх и др.),
подборки фильтров мата для Minecraft-серверов; проверено на 1069 настоящих никах и 127 комментариях TotemCraft.
Пополнение без правки кода: владелец добавляет слова кнопкой в «Управлении» (хранятся в базе).
"""
import re

# Корни: ищутся внутри текста. Категория — для подписи в досье.
ROOTS = {
    'мат': [
        'huy', 'hui', 'huj', 'huya', 'xuy', 'xui', 'xuj', 'xyi', 'xyu', 'hyi', 'hyu', 'xyes', 'huesos', 'hueplet',
        'pizd', 'pisd', 'pezd', 'pesd',
        'eban', 'ebal', 'ebat', 'ebut', 'ebuch', 'yeban', 'yebal', 'jeban', 'uebok', 'uebis', 'zaeb', 'doeb',
        'vyeb', 'vieb', 'naeb', 'poeb', 'razeb', 'dolboeb', 'dolbaeb', 'dolboyob', 'eblan', 'ebla',
        'blya', 'blyat', 'blyad', 'bliat', 'bliad', 'blja',
        'suka', 'cyka', 'syka', 'suchk', 'suchar',
        'mudak', 'mudil', 'mudoz',
        'pidor', 'pidar', 'pidr', 'pedik', 'pederast',
        'gandon', 'gondon', 'zalup', 'shluh', 'shlyuh', 'shalav', 'mandavosh', 'droch',
        'govno', 'govnyuk', 'govnuk', 'gavno', 'zhopa', 'zhopu', 'jopa', 'jopu', 'perdet', 'perdun',
    ],
    'оскорбление': [
        'debil', 'dauny', 'idiot', 'kretin', 'dibil', 'chmosh', 'chmyr', 'uebish', 'tupor',
        'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'faggot', 'nigger', 'nigga', 'retard',
        'pussy', 'penis', 'vagina', 'porn', 'rape', 'dildo',
    ],
    'символика': [
        'hitler', 'gitler', 'gytler', 'nazi', 'natsi', 'siegheil', 'zighail', 'heilhit', 'swastik', 'svastik',
        'reichsf', 'waffen', 'gestapo', 'auschwitz', 'osvencim', 'kukluks', 'igil', 'jihad', 'dzhihad',
        'taliban', 'alkaid', 'alqaed', 'columbine', 'kolumbain', 'skulshut',
    ],
    'политика': [
        'putin', 'zelensk', 'navaln', 'lukashenk', 'khohol', 'hohol', 'hohlo', 'katsap', 'kacap',
        'moskal', 'rusnya', 'rusnia', 'ukrop', 'vatnik', 'slavaukrain', 'azovst', 'wagner', 'vagner', 'prigozh',
        'kadyrov', 'trump', 'biden', 'stalin', 'bandera',
    ],
}

# Короткие слова: только целым словом ника (loh внутри lohmatiy не считается)
TOKENS = {
    'мат': ['ebi', 'ebu', 'bly', 'blia', 'manda'],
    'оскорбление': ['loh', 'lox', 'chmo', 'daun', 'sex', 'anal', 'dick', 'cock', 'gay', 'gey', 'lesbi', 'urod'],
    'символика': ['nsdap', 'kkk', 'rahowa', 'isis'],
    'политика': ['svo', 'zov', 'hamas', 'putler'],
}

# Русские корни для текста на кириллице (комментарии): без перевода в латиницу,
# иначе «существующую» -> suschestvuyuschuyu и «чуйка» -> chuyka дают ложное «huy»
CYR_ROOTS = {
    'мат': ['хуй', 'хуе', 'хуя', 'хуи', 'пизд', 'ебан', 'ебал', 'ебат', 'ебуч', 'ебл', 'уеб', 'заеб',
            'доеб', 'выеб', 'наеб', 'проеб', 'долбоеб', 'долбаеб', 'бля', 'сука', 'суки', 'сучк', 'сучар',
            'мудак', 'мудил', 'пидор', 'пидар', 'пидр', 'педик', 'гандон', 'гондон', 'залуп', 'шлюх', 'шалав',
            'манда', 'дроч', 'говн', 'жопа', 'жопу', 'жопе'],
    'оскорбление': ['дебил', 'идиот', 'кретин', 'даун', 'чмо', 'урод', 'дегенерат', 'уебищ'],
    'символика': ['гитлер', 'нацист', 'свастик', 'зиг хайль', 'зигхайль', 'игил', 'джихад', 'колумбайн', 'скулшут'],
    'политика': ['путин', 'зеленск', 'навальн', 'лукашенк', 'хохол', 'хохл', 'кацап', 'москал', 'русня', 'укроп',
                 'ватник', 'слава украин', 'вагнер', 'пригож', 'кадыров', 'сво ', ' zov', 'бандер'],
}
# Обычные русские слова с корнем внутри: вырезаются до поиска
CYR_ALLOW = ['мандарин', 'мандат', 'команда', 'командир', 'скипидар', 'требля', 'употребля', 'истребля',
             'оскорбля', 'колебля', 'сукно', 'сукон', 'застрахуй', 'подстрахуй']

# Числа по исходному тексту: 1488 и вариации 14/88
NUMBERS = {'символика': [r'14\D{0,2}88', r'88\D{0,2}14']}

# Обычные слова, внутри которых случайно есть корень: вырезаются до поиска
ALLOW = ['leban', 'rebane', 'mandarin', 'technoblade', 'blade', 'hancock', 'cockatoo', 'shitake', 'scunthorp',
         'sukany', 'huyen', 'analy', 'analog', 'essex', 'sussex', 'hitchcock', 'peacock', 'dickens', 'dickson',
         'cockpit', 'stalingrad', 'stalinist', 'shuey', 'ebay', 'debilit']

_TRANSLIT = str.maketrans({
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
})
_LEET = str.maketrans({'0': 'o', '1': 'i', '3': 'e', '6': 'b', '9': 'ya', '@': 'a', '$': 's', '|': 'i',
                       '!': 'i', '+': 't', '5': 's', '7': 't'})
_SEPARATORS = re.compile(r'[^a-z]+')
_REPEATS = re.compile(r'(.)\1+')


def _normalize(text):
    return text.lower().translate(_TRANSLIT)


def _squash(text, four='ch'):
    """Строка без разделителей и повторов, с заменой обходов и вырезанными обычными словами."""
    t = _normalize(text).replace('4', four).translate(_LEET)
    t = _REPEATS.sub(r'\1', _SEPARATORS.sub('', t))
    for w in ALLOW:
        t = t.replace(w, '#')
    return t


_CYR = re.compile(r'[а-яё]')


def _chunks(text):
    """Куски для поиска латинских корней: ник целиком, текст с пробелами — по словам, русские слова пропускаются
    (для них CYR_ROOTS). Цифра 4 бывает «ч» и «а»."""
    words = text.split()
    parts = [w for w in (words if len(words) > 1 else [text]) if not _CYR.search(w.lower())]
    return [_squash(p, four) for p in parts for four in ('ch', 'a')]


def _cyr_text(text):
    """Русский текст для CYR_ROOTS: нижний регистр, латинские двойники букв -> кириллица, без повторов."""
    t = text.lower().translate(str.maketrans({'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р', 'c': 'с', 'x': 'х', 'y': 'у',
                                               'k': 'к', 'm': 'м', '3': 'з', '0': 'о', '6': 'б', '@': 'а', 'ё': 'е'}))
    t = _REPEATS.sub(r'\1', t)
    for w in CYR_ALLOW:
        t = t.replace(w, '#')
    return ' ' + t + ' '



def _tokens(text):
    """Слова ника: по разделителям, цифрам и смене регистра (MrPidor -> mr, pidor)."""
    parts = re.findall(r'[A-ZА-ЯЁ]?[a-zа-яё]+|[A-ZА-ЯЁ]+(?![a-zа-яё])', text)
    return {_REPEATS.sub(r'\1', _normalize(p).translate(_LEET)) for p in parts}


def find(text, extra_words=()):
    """Что нашлось: список (категория, слово), по одной находке на категорию.
    extra_words — слова, добавленные владельцем (ищутся как корни)."""
    if not text:
        return []
    hits = []
    chunks = _chunks(text)
    for cat, roots in ROOTS.items():
        for root in roots:
            if any(root in c for c in chunks):
                hits.append((cat, root))
    if _CYR.search(text.lower()):
        cyr = _cyr_text(text)
        for cat, roots in CYR_ROOTS.items():
            for root in roots:
                if root in cyr:
                    hits.append((cat, root.strip()))
    tokens = _tokens(text)
    for cat, words in TOKENS.items():
        for w in words:
            if w in tokens:
                hits.append((cat, w))
    for cat, patterns in NUMBERS.items():
        for p in patterns:
            if re.search(p, text):
                hits.append((cat, '14/88'))
                break
    for w in extra_words:
        w2 = _squash(w)
        if w2 and any(w2 in c for c in chunks):
            hits.append(('словарь владельца', w))
    seen, out = set(), []
    for h in hits:
        if h[0] not in seen:
            seen.add(h[0])
            out.append(h)
    return out
