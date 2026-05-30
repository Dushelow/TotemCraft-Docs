# Консольные команды администратора

*Используются для ручного отката, напр. гриф или утрата мобов с ферм игроков в следствие багов сервера или ошибок со стороны администрации*

Команда выдачи 1 бирки с именем `text`
```
/minecraft:give @p minecraft:name_tag[minecraft:custom_name='text'] 1
```

**Создание моба с именем и видимой биркой**
```
/summon minecraft:armadillo ~ ~ ~ {CustomName:'Имя',CustomNameVisible:1b}
```

**Создание моба с именем и невидимой биркой**
```
/summon minecraft:armadillo ~ ~ ~ {CustomName:'Имя',CustomNameVisible:0b}
```

**Создание моба защищенного от clearlag и невидимой биркой**
```
/summon minecraft:armadillo ~ ~ ~ {CustomName:'clearlag_exclude',CustomNameVisible:0b}
```

Меч на бесконечный урон
```
/give Steve netherite_sword 1 [enchantments={sharpness:255}]
```

Невидимость на 1 час
```
/effect give @p minecraft:invisibility 3600 1 true
```

Убить мобов определенного типа (Броненосец) в радиусе 10 блоков
```
/minecraft:kill @e[type=minecraft:armadillo,distance=..10]
```

Заспавнить слизня с размером самым маленьким
```
/summon minecraft:slime ~ ~ ~ {Size:0}
```

- Заспавнить 23 броненосцев без физики (не расползаются)
```
/execute as @e[limit=23] run summon minecraft:armadillo ~ ~1 ~ {NoAI:1b,PersistenceRequired:1b,NoGravity:1b}
```
- Включить броненосцам (команда выше) физику (расползаются)
```
/execute as @e[type=minecraft:armadillo,distance=..5] run data merge entity @s {NoAI:0b,NoGravity:0b}
```

Назвать всех броненосцев в радиусе как биркой с именем Text
```
/execute as @e[type=minecraft:armadillo,distance=..30] run data merge entity @s {CustomName:'Text',CustomNameVisible:0b}
```

Вылечить всех броненосцев разом
```
/execute as @e[type=minecraft:armadillo,distance=..30] run data merge entity @s {Health:12.0f}
```

Запретить спавн враждебных мобов в регионе
```
/rg flag -w "2025" -h 3 safezone_1 deny-spawn pillager,skeleton,illusioner,witch,husk,ravager,cave_spider,stray,vindicator,breeze,creaking,spider,vex,zombie,creeper,drowned,zombie_villager,evoker,enderman
```

Спавн библиотекаря:
```
/summon minecraft:villager ~ ~ ~ {VillagerData:{profession:"minecraft:librarian",level:1,type:"minecraft:plains"}}
```

Cмена торгового предложения жителя (2 слот на эф. 5 книгу):
```
/data modify entity @e[type=minecraft:villager, sort=nearest, limit=1] Offers.Recipes[1].sell set value {id:"minecraft:enchanted_book",Count:1b,components:{"minecraft:stored_enchantments":{"minecraft:efficiency":5}}}
```

Cмена торгового предложения жителя (1 слот на эф. 5 книгу):
```
/data modify entity @e[type=minecraft:villager, sort=nearest, limit=1] Offers.Recipes[0].sell set value {id:"minecraft:enchanted_book",Count:1b,components:{"minecraft:stored_enchantments":{"minecraft:efficiency":5}}}
```
