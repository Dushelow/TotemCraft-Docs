# Онлайн-карта (Overviewer)

Изометрическая карта обычного мира на странице `https://totemcraft.net/map` (кнопка «Онлайн-карта» в меню сайта). Вид как у emeraldcubes.top: один слой с простыми тенями (rendermode lighting), JPG, тёмный фон, без маркеров. Север в правом верхнем углу. Показывается только квадрат ±10000 (граница вайпа).

Overviewer не плагин: это отдельная программа, она только читает файлы регионов мира и в сервер Minecraft не вмешивается.

## Схема

```
игрок → Cloudflare → сервер сайта (nginx)
          /map          → map.php: шапка сайта + iframe /livemap/
          /livemap/...  → proxy_pass http://YOUR_MAIN_IP:8123/
                                   ↓
основной сервер: nginx :8123 (только для IP_сервера_сайта) → /home/mapper/out
                 tc-map.timer 05:30 МСК → Overviewer дорисовывает изменённые чанки
```

ru.totemcraft.net проксирует весь сайт, поэтому карта работает и там.

## Основной сервер

| Что | Где |
|---|---|
| Пользователь | `mapper` (системный, без входа, только чтение мира) |
| Программа | `/home/mapper/overviewer`: форк GregoryAM-SP, PR #118 (поддержка 26.3), коммит `707d4a4` + наша правка `invisible_blocks.patch` |
| Python | `/home/mapper/venv` (pillow, numpy), заголовки Pillow для сборки в `/home/mapper/pillow-src` |
| Текстуры | `/home/mapper/client/26.3.jar` (клиент Mojang) |
| Мир | `/home/mapper/world`: копия `level.dat` (делает таймер от root) и ссылка на живую папку `region` |
| Настройки | `/home/mapper/config.py` (копия: `system/online-map/config.py`) |
| Картинки | `/home/mapper/out` (~20-30 ГБ) |
| Журнал | `/home/mapper/render.log` |
| Таймер | `tc-map.timer` 05:30 МСК (после рестарта 04:30 и бэкапа 05:00) → `tc-map.service` |
| Веб | nginx, сайт `/etc/nginx/sites-available/tc-map`, порт 8123, `allow` только сервер сайта |
| Файрвол | `ufw allow from IP_сервера_сайта to any port 8123 proto tcp` |

Ограничения службы: `Nice=19`, `IOSchedulingClass=idle`, `CPUQuota=200%` (из 4 ядер), `MemoryMax=2G`, 2 процесса. Каждый процесс Overviewer берёт ~450 МБ памяти, больше 2-3 процессов на сервере не ставить.

Замеры 09.11.2026: квадрат 512x512 у спавна = 609 картинок за 48 с; полная карта ±10000 = 537 тыс. картинок. Ежедневно рисуются только изменённые чанки.

## Правка `invisible_blocks.patch`

В форке барьер, блок света, `moving_piston` и `structure_void` записаны номером 99999. С numpy 2 это переполнение `uint16`, и весь чанк с таким блоком пропадает с карты. Правка рисует их воздухом (в игре они тоже не видны).

Новые блоки 26.3 (тополь, подушка, соломенный коврик, статуя медного голема) пока рисуются воздухом: их добавляет PR #130 форка. Когда его примут, обновить `/home/mapper/overviewer` и пересобрать.

## Сервер сайта

- `/var/www/totemcraft/map.php` (копия: `system/online-map/site/map.php`).
- Кнопка в `lib/module/inc-menu.php`, в шапке и в мобильном меню (копия: `system/online-map/site/inc-menu.php`).
- Блок `location /livemap/` в `/etc/nginx/sites-available/default` (см. `nginx config/website/totemcraft_website_nginx.md`).
- Копии до правки: `/root/site_backups/2026-11-09-map/`.

## Команды

Где: основной сервер (SSH).

- Запустить дорисовку сейчас: `systemctl start --no-block tc-map.service`
- Ход отрисовки: `grep complete /home/mapper/render.log | tail -1`
- Остановить: `systemctl stop tc-map.service`
- Перерисовать всё с нуля: остановить, `rm -rf /home/mapper/out/*`, запустить.

## Откат

- Сайт: вернуть `inc-menu.php` и `nginx-default` из `/root/site_backups/2026-11-09-map/`, удалить `map.php`, `nginx -t && systemctl reload nginx`.
- Основной сервер: `systemctl disable --now tc-map.timer`, `rm /etc/systemd/system/tc-map.*`, `apt remove nginx`, `ufw delete allow from IP_сервера_сайта to any port 8123 proto tcp`, `userdel -r mapper`.
