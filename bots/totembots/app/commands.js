// Команды бота (как в Mindcraft): нейросеть пишет их прямо в ответе, например «иду! !goTo(0, 64, 0)».
// Один список на всё: разбор ответа, синонимы (move -> goTo, drop -> discard), руководство для нейросети.
// Каждая команда превращается в действие тела (act для TotemBot.run) или в действие мозга (look, цель, память).

const C = [
  // [имя, синонимы, аргументы, описание, act(args) -> действие тела]
  // --- передвижение
  ['goTo', 'move,walk,go,goto,moveTo,walkTo,goToCoordinates', 'x, y, z', 'дойти до точки (копает природное и подставляет блоки, если надо)', (a) => ({ act: 'goto', x: a[0], y: a[1], z: a[2] })],
  ['goToPlayer', 'come,comeTo,approach', 'игрок', 'подойти к игроку', (a) => ({ act: 'come', who: a[0] })],
  ['follow', 'followPlayer,followMe', 'игрок', 'идти за игроком, пока не скажут !stop', (a) => ({ act: 'follow', who: a[0] })],
  ['stop', 'stay,halt,cancel', '', 'бросить текущее дело и стоять', () => ({ act: 'stop' })],
  ['travel', 'travelTo,goFar,navigate', 'x, z[, измерение]', 'дальний путь: сам выберу пешком или через Незер по порталам', (a) => ({ act: 'travel', x: a[0], z: a[1], dim: a[2] })],
  ['goToPlace', 'goToRememberedPlace,gotoPlace', 'место', 'пойти к месту из памяти (далеко или в другом измерении - сам через порталы)', (a) => ({ act: 'goto_place', name: a[0] })],
  ['enterPortal', 'portal,usePortal', '[x, y, z]', 'войти в портал (без координат - в ближайший)', (a) => ({ act: 'portal', x: a[0], y: a[1], z: a[2] })],
  ['stroll', 'walkAround,lookAround,chill,promenade', '[радиус, минут]', 'погулять рядом прогулочным шагом, поглядывая по сторонам (как житель): не по прямой, с остановками', (a) => ({ act: 'stroll', radius: a[0], ms: a[1] ? a[1] * 60000 : undefined })],
  ['loadout', 'kit,gearFor,prepareFight,class', 'класс или противник', 'собраться к бою из своих сундуков и надеть: мечник (меч+щит), лучник, топорщик, универсал, война (против игроков: всё, яблоки, зелья, жемчуг), разведчик; или противник (скелеты, криперы, игроки) - класс подберу; скажу, чего не хватает и как добыть', (a) => ({ act: 'loadout', kit: a[0] })],
  ['learnRoute', 'teachRoute,recordRoute,showMeRoute', 'название', 'хозяин покажет дорогу: идти за ним и записать путь (с порталами) под этим названием; «пришли» - сохранить', (a) => ({ act: 'teach', name: a.join(' ') })],
  ['routeDone', 'stopRecording,arrived', '', 'закончить запись показанной дороги', () => ({ act: 'teachStop' })],
  ['route', 'followRoute,goRoute,useRoute', 'название[, back]', 'пройти показанную дорогу самому (back - обратно)', (a) => ({ act: 'route', name: a[0], back: a[1] === 'back' || a[1] === 'обратно' })],
  ['survey', 'explore,scout,investigate,lookAroundArea', '[радиус]', 'обследовать окрестность: пройти по видимым проходам до развилок и рассказать, что тут: куда ведут проходы, порталы, постройки, жители, опасности (на «найди сам», «изучи», «догадайся»)', (a) => ({ act: 'survey', radius: a[0] })],
  ['link', 'connect,linkPlaces', 'место A, место B, как', 'записать связь мест: «незерхаб, замок, по северной ледяной ветке»', (a) => ({ act: 'link', a: a[0], b: a[1], how: a.slice(2).join(', ') })],
  ['howTo', 'howToGet,routeTo,wayTo', 'куда[, откуда]', 'как пройти: показанная дорога, связи мест, порталы, дорога в ту сторону - всё, что тело знает', (a) => ({ act: 'howTo', to: a[0], from: a[1] })],
  ['prepare', 'getReady,prepareFor,gearUpFor', 'цель (место, координаты, поход, Незер, война)', 'собраться к делу: еда, блоки, лодка для льда и воды, оружие и броня, вещи для квеста; скажу, чего не хватает', (a) => ({ act: 'prepare', goal: a.join(' ') })],
  ['findEntity', 'findMob,whereIs,findPlayer', 'кто[, радиус]', 'где ближайшие существа вида: житель, корова, игрок (или ник), враги', (a) => ({ act: 'findEntity', who: a[0], radius: a[1] })],
  ['scan', 'scanBlocks,countBlocks', 'блок[, радиус]', 'сколько таких блоков рядом и где ближайшие: руда, сундуки, кровати, портал, что угодно', (a) => ({ act: 'scanBlocks', block: a[0], radius: a[1] })],
  ['fly', 'elytra,glide,flyTo', 'x, z', 'элитры - В РАЗРАБОТКЕ, сейчас не работают: не использовать', (a) => ({ act: 'fly', x: a[0], z: a[1] })],
  ['rail', 'minecart,rideRail,cart', '[x, z]', 'поехать на вагонетке по рельсам (сесть в ближайшую; выйти у точки или когда встанет)', (a) => ({ act: 'rail', x: a[0], z: a[1] })],
  ['brew', 'brewPotion,potion', 'зелье[, сколько до 3]', 'сварить любое зелье: лечение, сила, скорость, огнестойкость, регенерация, ночное зрение, подводное дыхание, медленное падение, прыгучесть, яд, черепашья мощь, невидимость, замедление, урон, слабость; можно «долгое», «сильное», «взрывное», «оседающее» (например: взрывное сильное лечение). Чего не хватает - скажу, где взять', (a) => ({ act: 'brew', potion: a.filter((x) => typeof x !== 'number').join(' '), count: a.find((x) => typeof x === 'number') })],
  ['stonecut', 'stonecutter', 'что сделать[, из чего]', 'камнерез: ступени, плиты, стены, кирпичи из камня (экономнее верстака)', (a) => ({ act: 'stonecut', item: a[0], from: a[1] })],
  ['loom', 'bannerPattern', 'узор, краситель', 'ткацкий станок: узор на флаг. Пиши игровыми названиями (их понимает тело, на каком бы языке ни просил человек): stripe_bottom, stripe_top, stripe_left, stripe_right, stripe_center, stripe_middle, stripe_downright, stripe_downleft, small_stripes, cross, straight_cross, diagonal_left, diagonal_right, diagonal_up_left, diagonal_up_right, half_vertical, half_vertical_right, half_horizontal, half_horizontal_bottom, square_bottom_left, square_bottom_right, square_top_left, square_top_right, triangle_bottom, triangle_top, triangles_bottom, triangles_top, circle, rhombus, border, curly_border, gradient, gradient_up, bricks; краситель - red, blue...', (a) => ({ act: 'loom', pattern: a[0], dye: a[1] })],
  ['trim', 'armorTrim', '[броня, материал]', 'отделка брони на кузнечном столе (шаблон + броня + материал), только вид', (a) => ({ act: 'trim', item: a[0], material: a[1] })],
  ['smith', 'upgradeNetherite,netherite', '[предмет]', 'кузнечный стол: алмазную вещь улучшить до незеритовой (шаблон + слиток)', (a) => ({ act: 'smith', item: a[0] })],
  ['wander', 'explore_far,wanderFar', '[сторона света]', 'прогуляться, поисследовать (без стороны - где ещё не был)', (a) => ({ act: 'wander', dir: a[0] })],
  ['surface', 'goUp,toSurface', '', 'подняться на поверхность из пещеры или шахты', () => ({ act: 'surface' })],
  ['boardBoat', 'mount,ride,board,getIn,enterBoat,mountHorse', '[boat|horse или ник хозяина лодки]', 'сесть в лодку или на лошадь рядом; с ником - в лодку, где сидит или у которой стоит этот игрок (на самих игроков сесть нельзя); лодки нет, а в инвентаре есть - поставлю на воду или лёд', (a) => (a[0] && /^[A-Za-z0-9_]{3,16}$/.test(String(a[0])) && !/^(boat|horse|donkey|mule|camel|pig|minecart|raft|llama|strider)$/i.test(String(a[0])) ? { act: 'mount', who: a[0] } : { act: 'mount', what: a[0] })],
  ['dismount', 'getOut,leaveBoat,unmount', '', 'слезть с лошади, выйти из лодки', () => ({ act: 'dismount' })],
  ['drive', 'row,steer,rideTo,sail', 'x, z', 'сидишь в лодке или на лошади за рулём - плыть/ехать к точке', (a) => ({ act: 'drive', x: a[0], z: a[1] })],
  // --- работа
  ['collect', 'collectBlocks,gather,chop,mineBlock,dig', 'блок, сколько', 'добыть блоки рядом: oak_log, stone, dirt, sand... (лут подбирается)', (a) => ({ act: 'gather', block: a[0], count: a[1] })],
  ['mine', 'mineOre,minerals', 'руда, сколько', 'шахта: iron, coal, diamond, gold, redstone, lapis, copper (спущусь и прокопаю туннель)', (a) => ({ act: 'mine', block: a[0], count: a[1] })],
  ['craft', 'craftRecipe,make', 'предмет, сколько', 'скрафтить (верстак найду или поставлю свой); если не хватает - скажу чего', (a) => ({ act: 'craft', item: a[0], count: a[1] })],
  ['smelt', 'smeltItem,cook', 'предмет, сколько', 'переплавить в своей печи (нет печи - сделаю)', (a) => ({ act: 'smelt', item: a[0], count: a[1] })],
  ['place', 'placeHere,placeBlock,put_block', 'блок[, x, y, z]', 'поставить блок (без координат - рядом с собой)', (a) => ({ act: 'place', block: a[0], x: a[1], y: a[2], z: a[3] })],
  ['breakBlock', 'break,destroy', 'x, y, z', 'сломать блок (природный или свой)', (a) => ({ act: 'break', x: a[0], y: a[1], z: a[2] })],
  ['harvest', 'gatherCrops', '[растение, сколько]', 'собрать спелый урожай рядом и посадить обратно (сколько нужно: на 1 хлеб - 3 пшеницы; без числа - всё спелое рядом)', (a) => ({ act: 'harvest', crop: a[0], count: a[1] })],
  ['sowEmpty', 'fillEmpty,replantEmpty', '[растение]', 'засеять ПУСТЫЕ грядки рядом, ничего не собирая (wheat, carrots, potatoes, beetroots; без названия - чем растёт по соседству). Просят «засей пустое» - это, не harvest', (a) => ({ act: 'harvest', crop: a[0], sowOnly: true })],
  ['climb', 'climbLadder,ladder', '[up|down]', 'лезть по лестнице рядом вверх (или вниз) до конца: люки по пути открою, наверху выйду на пол. Просят «лезь наверх по лестнице» - это, не goto', (a) => ({ act: 'climb', dir: a[0] })],
  ['till', 'hoe,plow', '[x, y, z]', 'вспахать землю мотыгой (без координат - ближайшую)', (a) => ({ act: 'till', x: a[0], y: a[1], z: a[2] })],
  ['plant', 'sow,seed', 'семена[, x, y, z]', 'посадить на вспаханную грядку: wheat_seeds, carrot, potato, beetroot_seeds', (a) => ({ act: 'plant', item: a[0], x: a[1], y: a[2], z: a[3] })],
  ['farm', 'makeFarm,garden', 'семена, сколько', 'огород: вспахать и засадить несколько клеток рядом', (a) => ({ act: 'farm', item: a[0], count: a[1] })],
  ['fish', 'fishing', '[сколько раз]', 'порыбачить (нужна удочка, рядом вода)', (a) => ({ act: 'fish', count: a[0] })],
  ['hunt', 'killAnimal', 'животное, сколько', 'охота на диких животных: cow, pig, sheep, chicken...', (a) => ({ act: 'hunt', animal: a[0], count: a[1] })],
  ['attack', 'kill,fight,attackMob', 'моб', 'напасть на моба рядом (зомби, ведьма, скелет...)', (a) => ({ act: 'attack', mob: a[0] })],
  ['combat', 'fightMode,mobs,setCombat', 'defend|flee|off', 'режим боя: defend - защищать себя и хозяина, flee - убегать к хозяину, off - не трогать мобов', (a) => ({ act: 'combat', mode: a[0] })],
  ['hold', 'waitHere,stayHere,standStill', '', 'стоять на месте и ждать, пока не позовут (своих дел не начинать)', () => ({ act: 'hold' })],
  ['readSigns', 'signs,readSign', '', 'прочитать таблички рядом (8 блоков)', () => ({ act: 'signs' })],
  ['use', 'useBlock,interact,activate,open', 'x, y, z', 'использовать предмет: кровать - лечь, сундук - посмотреть что внутри, дверь/люк/калитка - открыть или закрыть, рычаг - только по просьбе хозяина', (a) => ({ act: 'use', x: a[0], y: a[1], z: a[2] })],
  ['where', 'nearest,findNearest', 'что (chest, crafting_table, furnace, bed, nether_portal...)', 'где ближайший такой блок из тех, что видела (сундук, верстак, печь, кровать, портал...) - мгновенно, по памяти', (a) => ({ act: 'where', what: a[0] })],
  ['portalFix', 'fixPortal,lightPortal', '', 'найти рамку портала рядом: достроить недостающий обсидиан и зажечь огнивом', () => ({ act: 'portalFix' })],
  ['portalBuild', 'buildPortal', '', 'построить портал в Незер рядом (нужно 10 обсидиана, 4 любых блока на углы и огниво)', () => ({ act: 'portalBuild' })],
  ['portalBreak', 'breakPortal', '', 'сломать портал рядом: свой - сама, чужой - только по слову хозяина (нужна алмазная кирка)', () => ({ act: 'portalBreak' })],
  ['gesture', 'emote,jest', 'вид', 'показать жест без слов: привет (присед дважды), кивок, нет, радость (прыжки), кружится, спасибо, поклон, грусть, эй (поднять взгляд)', (a) => ({ act: 'gesture', kind: a[0] })],
  ['sit', 'sitDown', '', 'сесть (/sit): рядом на ступеньку или полублок, если есть, или где стоишь; подушка - щелчком; встать - !stand', () => ({ act: 'sit' })],
  ['stand', 'standUp,getUp', '', 'встать (если сидишь)', () => ({ act: 'stand' })],
  ['obtain', 'getItem,need,fetchItem', 'предмет, сколько', 'достать вещь с умом: свои сундуки (дома и где сама клала), потом купить у жителей; нигде нет - скажет, где смотрела (тогда попроси хозяина или добудь сама)', (a) => ({ act: 'obtain', item: a[0], count: a[1] })],
  ['trades', 'villagerTrades,lookTrades', '', 'обойти жителей рядом и посмотреть, кто чем торгует (запоминается для всех ботов)', () => ({ act: 'trades' })],
  ['trade', 'buy,sell,villagerTrade', 'что получить, сколько раз', 'поменяться с жителем рядом: получить предмет (emerald, bread, book...), отдав то, что он просит (тело проверит, хватает ли)', (a) => ({ act: 'trade', want: a[0], times: a[1] })],
  ['errand', 'quest,task,job,roadmap', '"шаг; шаг; ..."', 'квест: просьба хозяина из нескольких дел - план по шагам, тело делает сам, проверяет каждый шаг, при неудаче повторяет и пишет хозяину. Шаг - любая команда (!harvest(wheat); !craft(bread, 5); !trade(emerald, 4); !obtain(bread, 5); !sleep) или: come ник | give ник предмет сколько | goto x y z | place название | home | night (поспать, если ночь) | wait предмет сколько | say ник текст', (a) => ({ act: 'errand', plan: a.join(',') })],
  ['errandStop', 'cancelErrand', '', 'отменить поручение', () => ({ act: 'errandStop' })],
  ['errandGo', 'resumeErrand', '', 'продолжить поручение после остановки', () => ({ act: 'errandGo' })],
  ['undoPut', 'takeBack,undo', '', 'забрать обратно то, что сама положила в сундуки за последние 10 минут (если хозяин сказал «верни»)', () => ({ act: 'undoPut' })],
  ['stash', 'storeAll,putAway,depositAll', '[что ещё оставить]', 'выложить лишнее в сундуки дома (тело само найдёт сундуки на любом этаже; оставит инструменты, броню, еду)', (a) => ({ act: 'stash', keep: a.join(',') })],
  ['duel', 'pvp,fightPlayer', 'игрок', 'дуэль с игроком - только если хозяин попросил и игрок согласен (60 с, сдаюсь при 6 здоровья)', (a) => ({ act: 'duel', who: a[0] })],
  ['takeBoat', 'breakBoat,grabBoat', '[ник хозяина или x, z]', 'выбить и забрать лодку (кто в ней - выйдет). Только по прямой просьбе хозяина: животных и мобов в лодки сажают нарочно, это чужое', (a) => (a.length >= 2 && !isNaN(+a[0]) ? { act: 'takeBoat', x: a[0], z: a[1] } : { act: 'takeBoat', who: a[0] })],
  ['breed', 'feedAnimals,breedAnimals', '[животное, пар]', 'развести животных кормом (только если просили; в стаде до 12 - больше не надо)', (a) => ({ act: 'breed', animal: a[0], count: a[1] })],
  ['bonemeal', 'fertilize,boneMeal', '[растение, сколько]', 'костной мукой ускорить неспелое рядом (по просьбе или когда урожай нужен срочно)', (a) => ({ act: 'bonemeal', crop: a[0], count: a[1] })],
  ['cocoa', 'cocoaBeans,plantCocoa', '[сколько посадить]', 'собрать спелое какао; посадить - только сколько попросили, на бок ствола джунглей', (a) => ({ act: 'cocoa', count: a[0] })],
  ['shear', 'shearSheep', '[сколько]', 'постричь диких овец (нужны ножницы)', (a) => ({ act: 'shear', count: a[0] })],
  ['pickup', 'pickUp,collectItems,loot', '[радиус]', 'подобрать вещи с земли рядом', (a) => ({ act: 'pickup', radius: a[0] })],
  ['sleep', 'goToBed,bed', '', 'лечь спать в кровать рядом', () => ({ act: 'sleep' })],
  // --- вещи
  ['equip', 'hold,wear,wield', 'предмет', 'взять в руку или надеть (броня, щит, тотем - куда надо)', (a) => ({ act: 'equip', item: a[0] })],
  ['eat', 'consume,food', '[еда]', 'поесть (без названия - лучшее, что есть)', (a) => ({ act: 'eat', item: a[0] })],
  ['discard', 'drop,toss,throw,throwAway', 'предмет[, сколько]', 'выбросить из инвентаря', (a) => ({ act: 'toss', item: a[0], count: a[1] })],
  ['discardAll', 'dropAll,tossAll,emptyInventory', '[что оставить]', 'выбросить вообще всё, и броню (по просьбе хозяина «выкинь всё»)', (a) => ({ act: 'discardAll', keep: a.join(',') })],
  ['give', 'givePlayer,giveItem', 'игрок, предмет, сколько', 'подойти и отдать игроку', (a) => ({ act: 'give', who: a[0], item: a[1], count: a[2] })],
  ['takeFromChest', 'take,takeItem', 'x, y, z, предмет, сколько', 'взять из сундука (только по просьбе хозяина или из своего)', (a) => ({ act: 'take', x: a[0], y: a[1], z: a[2], item: a[3], count: a[4] })],
  ['putInChest', 'put,store,deposit', 'x, y, z, предмет, сколько', 'положить в сундук', (a) => ({ act: 'put', x: a[0], y: a[1], z: a[2], item: a[3], count: a[4] })],
  // --- сервер
  ['command', 'cmd,serverCommand,run', '"/команда"', 'команда сервера как у обычного игрока: /home, /spawn, /tpa ник, /sethome...', (a) => ({ act: 'cmd', text: a[0] })],
  ['wait', 'pause,sleepSeconds', 'секунд', 'подождать', (a) => ({ act: 'wait', seconds: a[0] })],
  // --- знание мира и опыт
  ['plan', 'craftPlan,getCraftingPlan,howToMake,recipe', 'предмет[, сколько]', 'полный план: что добыть и что скрафтить по порядку, с учётом инвентаря', (a) => ({ act: 'plan', item: a[0], count: a[1] })],
  ['craftable', 'whatCanICraft,canCraft', '', 'что можно скрафтить прямо сейчас', () => ({ act: 'craftable' })],
  ['findSpot', 'freeSpot,emptyPlace,findPlace', '', 'свободные места без построек по карте (для своего дома, верстака, фермы)', () => ({ act: 'findSpot' })],
  ['goToFreeSpot', 'goFree', '', 'дойти до ближайшего места без построек', () => ({ act: 'goFree' })],
  ['lesson', 'learn,lessonLearned', 'текст', 'запомнить урок из опыта («у базы брёвна чужие - рубить в лесу на севере»)', (a) => ({ act: 'lesson', text: a[0] })],
  ['saveSkill', 'rememberSkill', 'название', 'сохранить последнюю удачную цепочку команд как свой навык', (a) => ({ act: 'saveSkill', name: a[0] })],
  ['skill', 'useSkill,doSkill', 'название', 'выполнить свой сохранённый навык', (a) => ({ act: 'skill', name: a[0] })],
  ['defineSkill', 'newSkill,makeSkill,teachSkill', 'название, "!команда1; !команда2; ..."', 'создать себе новый навык из команд (не выполняя сейчас): когда упёрся, придумай способ и сохрани', (a) => ({ act: 'defineSkill', name: a[0], body: a.slice(1).join(', ') })],
  ['rule', 'myRule,selfInstruction,instruction', 'текст', 'добавить себе постоянное правило поведения (видно в каждой [память]): чему научился, как поступать', (a) => ({ act: 'rule', text: a.join(', ') })],
  ['forgetRule', 'dropRule', 'часть текста', 'убрать своё правило', (a) => ({ act: 'forgetRule', text: a.join(', ') })],
  // --- мозг: смотреть, помнить, цели
  ['look', 'inspect,view,see,check', 'что', 'посмотреть подробно: inventory, around, map, players, portals, online, memory', (a) => ({ act: 'look', what: a[0] || 'around' })],
  ['see', 'vision,watch,lookPicture', '[вопрос]', 'посмотреть глазами: картинка того, что видишь, и карта сверху -> описание словами (дорого, не чаще нужного)', (a) => ({ act: 'see', q: a[0] })],
  ['find', 'search,searchForBlock,locate', 'блок', 'просканировать чанки вокруг: где ближайшие такие блоки', (a) => ({ act: 'look', what: 'find', block: a[0] })],
  ['rememberHere', 'remember,savePlace,setWaypoint', 'название[, заметка]', 'запомнить место: где стоит хозяин или куда он смотрит под ноги (если он рядом), иначе где стоишь', (a) => ({ act: 'remember', kind: 'place', name: a[0], note: a[1] })],
  ['rememberAt', 'savePlaceAt,markAt', 'название, x, y, z', 'запомнить место по координатам («незерхаб на нулях» - !rememberAt(незерхаб, 0, 32, 0))', (a) => ({ act: 'remember', kind: 'place', name: a[0], x: a[1], y: a[2], z: a[3] })],
  ['rememberPerson', 'person,aboutPlayer', 'ник, заметка', 'запомнить про человека', (a) => ({ act: 'remember', kind: 'person', name: a[0], note: a[1] })],
  ['note', 'fact,memo', 'текст', 'запомнить факт о сервере или мире', (a) => ({ act: 'remember', kind: 'fact', text: a[0] })],
  ['journal', 'diary,log', 'текст', 'записать в свой дневник', (a) => ({ act: 'remember', kind: 'journal', text: a[0] })],
  ['forget', 'forgetPlace', 'место', 'забыть место', (a) => ({ act: 'forget', kind: 'place', name: a[0] })],
  ['forbidArea', 'noGo,forbid,dangerZone', 'название[, радиус]', 'запретная зона там, где стоит хозяин (он сказал «сюда не ходи»): путь туда больше не ведёт', (a) => ({ act: 'zone', on: true, name: a[0], radius: a[1] })],
  ['allowArea', 'allow,unforbid', 'название', 'снять запретную зону (только по слову хозяина)', (a) => ({ act: 'zone', on: false, name: a[0] })],
  ['setGoal', 'goal,newGoal', 'текст', 'поставить себе цель (видна в [я], между делами продолжай её)', (a) => ({ act: 'goal', text: a[0] })],
  ['endGoal', 'goalDone,finishGoal', '', 'цель достигнута', () => ({ act: 'goal', done: true })],
];

const BY = new Map();
for (const c of C) { BY.set(c[0].toLowerCase(), c); for (const s of c[1].split(',').filter(Boolean)) BY.set(s.toLowerCase(), c); }

// аргументы: числа - числами, строки - без кавычек; запятые внутри кавычек не делят
function splitArgs(s) {
  const out = []; let cur = '', q = '';
  for (const ch of String(s || '')) {
    if (q) { if (ch === q) q = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  // «200 -8125» одним аргументом (без запятой) - это два числа (23.11: !travel(200 -8125) - «не принимает координаты»)
  const flat = []; for (const x of out) { if (/^-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?)+$/.test(x)) flat.push(...x.split(/\s+/)); else flat.push(x); }
  return flat.map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? +x : x)).filter((x) => x !== '');
}

// Частые ошибки нейросети - исправить по смыслу, а не отказывать
const ORE = /^(coal|iron|gold|copper|diamond|redstone|lapis|emerald|quartz|nether_gold|ancient_debris|debris)(_ore)?$/;
function fixAct(name, a) {
  const num = (v) => typeof v === 'number';
  if (a.act === 'mine' && a.block && !ORE.test(String(a.block))) return { act: 'gather', block: a.block, count: a.count };   // !mine(log) - рубить
  if (a.act === 'break' && a.x !== undefined && !num(a.x)) return { act: 'gather', block: a.x, count: 1 };                   // !breakBlock(бревно)
  if ((a.act === 'take' || a.act === 'put') && a.x !== undefined && !num(a.x)) return { act: a.act, item: a.x, count: num(a.y) ? a.y : undefined, nearest: true };
  if (a.act === 'goto' && a.x !== undefined && !num(a.x)) return { act: 'goto_place', name: a.x };                        // !goTo(склад)
  if (a.act === 'goto' && !num(a.x)) return null;
  if (a.act === 'pickup' && a.radius !== undefined && !num(a.radius)) delete a.radius;
  if (a.act === 'place' && /_boat$|_raft$|^boat$|лодк/.test(String(a.block || ''))) return { act: 'mount', what: 'boat' };   // !place(spruce_boat) - поставить лодку и сесть (23.11)
  if (a.act === 'give' && num(a.who)) return null;
  return a;
}

/**
 * Разбор ответа: реплика (текст без команд) и команды по порядку. Неизвестные команды - в unknown,
 * чтобы сразу сказать нейросети, как правильно.
 */
function parseCommands(text) {
  const raw = String(text || '');
  const acts = [], unknown = [];
  const re = /!([A-Za-z_]+)\s*(\(((?:[^()]|\([^()]*\))*)\))?/g;   // одна вложенная пара скобок: !defineSkill(x, "!collect(a, 1)")
  let m;
  while ((m = re.exec(raw))) {
    const c = BY.get(m[1].toLowerCase());
    if (!c) { unknown.push(m[1]); continue; }
    // упоминание в тексте («попробую !mine») - не команда: без скобок выполняются только команды без обязательных аргументов
    if (!m[2] && c[2] && !c[2].startsWith('[')) continue;
    const args = splitArgs(m[3]);
    // !collect() без аргументов - не выполнять пустым («не знаю руду «»», 15.11), а сказать, что нужно
    if (c[2] && !c[2].startsWith('[') && !args.length) { unknown.push(`${c[0]} без аргументов (нужно: ${c[2]})`); continue; }
    const act = fixAct(c[0], c[4](args));
    if (!act) continue;
    for (const k of Object.keys(act)) if (act[k] === undefined) delete act[k];
    act._cmd = c[0];
    acts.push(act);
  }
  // ```json {"actions":[...]} - старый вид тоже понимаем
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) { try { const j = JSON.parse(fence[1].slice(fence[1].indexOf('{'), fence[1].lastIndexOf('}') + 1)); for (const a of j.actions || []) if (a && a.act) acts.push(a); } catch {} }
  // в чат - только реплика персонажа: без мыслей в скобках, разметки и отчётов «команда сработала»
  // подписи кнопок блока кода со страницы (text / Copy / Download / Скопировать...) - не текст
  let say = raw.replace(/```[\s\S]*?```/g, '').replace(/(^|\s)(plaintext|text|json|bash|Copy|Download|Copied|Скопировать|Скачать|Скопировано)(?=\s|$)/g, ' ').replace(re, '').replace(/\([^()]*\)/g, '').replace(/[*_`#>]+/g, '')
    .replace(/\s+([,.!?])/g, '$1').split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
  const META = /команд|систем|итог|сработал|инвентар|позици|координат|задани|выполнен|не работа|^отлично|^понял|давайте|попробую|возможно|я вижу|теперь я|я дошёл|я переместил|я всё ещё/i;
  say = say.split(/(?<=[.!?])\s+/).filter((x) => x && !META.test(x)).slice(0, 2).join(' ').slice(0, 200);
  // реплику модель иногда кладёт в блок кода («общий: Вилор, привет!») - тогда она не уходила в чат (19.11)
  if (!say) {
    const inFence = [...raw.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)].map((m) => m[1]).join('\n').split('\n')
      .map((l) => l.replace(/^\s*\d+\s+/, '').trim()).filter((l) => l && !l.startsWith('!') && !l.startsWith('//') && !l.startsWith('{') && !/^(text|json|plaintext|Copy|Download)$/i.test(l));
    if (inFence.length) say = inFence.slice(0, 2).join(' ').slice(0, 200);
  }
  // строка с каналом («общий: ...») в блоке кода - это и есть реплика, она важнее слов вокруг
  { const ch = [...raw.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)].map((m) => m[1]).join('\n').split('\n').map((l) => l.replace(/^\s*\d+\s+/, '').trim()).find((l) => /^(общий|рядом|лс\s+[A-Za-z0-9_]{3,16})\s*:/i.test(l));
    if (ch) say = ch.slice(0, 220); }
  return { say, acts, unknown };
}

/** Руководство по командам для нейросети (строится из списка - всегда совпадает с тем, что тело умеет). */
function manual() {
  return C.map((c) => `!${c[0]}(${c[2]}) - ${c[3]}`).join('\n');
}

const NAMES = C.map((c) => c[0]);
module.exports = { parseCommands, manual, NAMES };
