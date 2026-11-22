# Картинки для окна «Жизнь»

Положить в `app/art/` с этими именами (PNG). Окно подхватывает их само: есть файл - рисуется он, нет - простой рисунок CSS.
Перезапуск программы не нужен, достаточно закрыть и снова открыть «Смотреть её жизнь».

## Как генерировать, чтобы всё было в одном стиле

1. Всё в одном чате ChatGPT, по очереди. Первым сообщением приложить образец (скриншот интерфейса, который понравился) и написать:
   `I will ask you for separate game UI assets one by one. All of them must match the style of this reference exactly: same palette, same pixel size, same lighting, same wood and bronze materials. Never add text or watermarks.`
2. Каждый следующий промпт начинать со слов `Same style as before.`
3. Где написано «transparent background» - проверить, что фон действительно прозрачный (в ChatGPT это PNG с прозрачностью; если пришла белая или клетчатая подложка - попросить «real transparent PNG, no checkerboard»).
4. Размер не обязан совпадать точно, важны пропорции.

## Общий стиль (вставлять в начало каждого промпта)

`Cozy fantasy pixel-art game UI asset in the style of Merchant RPG, warm dark brown wood, antique bronze and gold, cream parchment, muted forest green, crisp pixel art, no text, no watermark.`

## Список

| Файл | Размер | Промпт (после общего стиля) |
|---|---|---|
| frame.png | 256x256 | Square wooden UI panel frame, ornate bronze corner pieces and rivets, thick carved wood border about 70 px wide, fully transparent center, transparent background, suitable for 9-slice scaling. |
| wood.png | 512x512 | Seamless tileable dark wooden plank texture, subtle grain, slightly worn. |
| parchment.png | 512x512 | Seamless tileable aged parchment paper texture, soft stains, warm cream color. |
| slot.png | 64x64 | Single inventory slot: dark recessed wooden square with thin bronze rim, transparent background. |
| portrait.png | 160x160 | Ornate portrait frame, carved wood with bronze corners, transparent center and transparent background. |
| banner.png | 400x64 | Horizontal parchment ribbon banner for panel titles, transparent background. |
| icons.png | 512x128 | Sprite sheet of 16 pixel-art RPG icons, 8 columns x 2 rows, each 64x64, transparent background, consistent style, in this exact order: heart, meat drumstick, shield, eye, clock, crossed swords, map, scroll, quill, book, backpack, treasure chest, gem, gold coin, moon, sun. |
| scene_day.png | 1600x900 | 16:9 pixel-art landscape in blocky Minecraft-like style: grassy plains with a dirt path in the middle foreground, a small village of wooden houses and a campfire on the left, forest and hills in the background, daytime. Empty space in the center of the path for a character to stand. No characters, no UI. |
| scene_dusk.png | 1600x900 | То же, но `sunset, warm orange sky`. |
| scene_night.png | 1600x900 | То же, но `night with moon and stars, warm lit windows`. |
| scene_dawn.png | 1600x900 | То же, но `dawn, soft pink sky`. |
| scene_cave.png | 1600x900 | То же построение, но `underground stone cave with torches on the walls and a few ores`. |
| scene_nether.png | 1600x900 | То же построение, но `Nether: netherrack, lava falls, glowstone, red fog`. |
| scene_snow.png | 1600x900 | То же построение, но `snowy plains with spruce trees`. |

Персонажа на фонах быть не должно: на середину тропы встаёт фигурка бота из его настоящего скина.
