# Оформление окна «Жизнь»: картинки

## Как это устроено (принято в геймдеве)

```
app/assets/
  ui/
    frames/      ui_frame_panel_9s.png      рамка панели, 9-slice (углы не тянутся, стороны повторяются)
                 ui_frame_portrait.png      рамка портрета, прозрачная середина
                 ui_banner_title.png        лента заголовка
                 ui_slot.png                ячейка инвентаря
    icons/       ui_icons_atlas.png         атлас значков 8x2, ячейка 64 px
  textures/      tex_wood_tile.png          бесшовная (tileable) текстура дерева
                 tex_parchment_tile.png     бесшовная текстура пергамента
  scenes/        bg_scene_overworld_day.png       фоны сцены 16:9, без персонажей
                 bg_scene_overworld_dusk.png
                 bg_scene_overworld_night.png
                 bg_scene_overworld_dawn.png
                 bg_scene_cave.png
                 bg_scene_nether.png
                 bg_scene_snow.png
```

- Имена: строчные латинские, слова через `_`, префикс по типу (`ui_` элемент интерфейса, `tex_` текстура-заливка, `bg_` фон), суффикс `_9s` - рамка для 9-slice, `_tile` - бесшовная, `_atlas` - лист значков.
- Формат: PNG-32 с альфа-каналом (прозрачность) для `ui_`; PNG для `tex_` и `bg_`.
- Пиксель-арт: рисуется крупными «пикселями», в программе масштабируется без сглаживания (nearest neighbor), поэтому точный размер не важен, важны пропорции.
- Окно подхватывает файлы само: есть файл - рисуется он, нет - простой рисунок CSS.

## Как генерировать (владельцу)

Генерировать по номерам в одном чате ChatGPT, скачивать в «Загрузки» как `1.png`, `2.png` и так далее - Claude сам переименует и разложит.

Первым сообщением в чат приложить скриншот интерфейса-образца и написать:

> I will ask you for separate game UI assets one by one for the same game. Every asset must match this reference exactly: same palette (warm dark brown wood, antique bronze and gold, cream parchment, muted forest green), same pixel size and crisp pixel-art rendering, same lighting from the top-left. No text, no letters, no watermarks, no signatures. When I say "transparent background", output a real transparent PNG (alpha channel), never a white or checkerboard background.

Каждый следующий промпт начинать с `Same style as before.`

## Список (по порядку)

| № | Файл | Промпт |
|---|---|---|
| 1 | scenes/bg_scene_overworld_day.png | Same style as before. A 16:9 pixel-art game background, 1600x900: blocky Minecraft-like grassy plains, a dirt path running left to right across the lower third, a small village of wooden houses with a campfire on the left, a forest and gentle hills in the back, daytime, soft clouds. Leave the middle of the path empty for a character. No characters, no animals, no UI. |
| 2 | scenes/bg_scene_overworld_night.png | Same style as before. Exactly the same scene and composition as the previous background, but at night: dark blue sky with a moon and stars, warm lit windows, the campfire glowing. No characters, no UI. |
| 3 | ui/frames/ui_frame_panel_9s.png | Same style as before. A square wooden UI panel frame, 256x256: thick carved wood border about 64 px wide, ornate bronze corner pieces with rivets, the whole center fully transparent, transparent background. It must be usable for 9-slice scaling: corners self-contained, the four sides plain and repeatable. |
| 4 | textures/tex_wood_tile.png | Same style as before. A seamless tileable dark wooden plank texture, 512x512, subtle grain, slightly worn, no frame, edges must tile perfectly. |
| 5 | ui/icons/ui_icons_atlas.png | Same style as before. A sprite sheet, 512x128, 8 columns by 2 rows, each cell exactly 64x64, transparent background, one centered icon per cell, in this exact order: row 1: red heart, roasted meat drumstick, iron shield, eye, brass clock, two crossed swords, folded map, rolled scroll; row 2: quill pen, closed book, leather backpack, treasure chest, green gem, gold coin, crescent moon, sun. |
| 6 | ui/frames/ui_slot.png | Same style as before. A single inventory slot, 64x64: a dark recessed wooden square with a thin bronze rim and slight inner shadow, transparent background outside the square. |
| 7 | textures/tex_parchment_tile.png | Same style as before. A seamless tileable aged parchment paper texture, 512x512, warm cream color with soft stains, edges must tile perfectly. |
| 8 | ui/frames/ui_frame_portrait.png | Same style as before. An ornate square portrait frame, 160x160: carved wood with bronze corners, the center fully transparent, transparent background. |
| 9 | ui/frames/ui_banner_title.png | Same style as before. A horizontal parchment ribbon banner for panel titles, 400x64, with small folded ends, empty middle (no text), transparent background. |
| 10 | scenes/bg_scene_overworld_dusk.png | Same style as before. Exactly the same scene as background 1, but at sunset: warm orange and pink sky, long shadows. No characters, no UI. |
| 11 | scenes/bg_scene_overworld_dawn.png | Same style as before. Exactly the same scene as background 1, but at dawn: soft pink and pale blue sky, light mist. No characters, no UI. |
| 12 | scenes/bg_scene_cave.png | Same style as before. A 16:9 pixel-art background, 1600x900, same layout as background 1 (path across the lower third, empty middle), but underground: a stone cave with torches on the walls, a few ores, dark depths. No characters, no UI. |
| 13 | scenes/bg_scene_nether.png | Same style as before. A 16:9 pixel-art background, 1600x900, same layout (path across the lower third, empty middle), but in the Minecraft-like Nether: netherrack, lava falls, glowstone, red fog. No characters, no UI. |
| 14 | scenes/bg_scene_snow.png | Same style as before. A 16:9 pixel-art background, 1600x900, same layout as background 1, but snowy plains with spruce trees and falling snow, daytime. No characters, no UI. |

Первые шесть дают основной эффект, остальные можно потом.
