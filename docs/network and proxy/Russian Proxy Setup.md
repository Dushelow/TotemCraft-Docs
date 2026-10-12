*Мы сделали для российских игроков вход на сервер, который стоит в европе, в обход блокировок -  **Reverse Proxy (frp + nginx)*** 

---

# Гайд: Русский вход для Minecraft-сервера + поддомены (ru.totemcraft.net)

**Цель:**  
Российские игроки заходят по русскому IP без VPN, а сайт и вики доступны по красивым поддоменам `https://ru.totemcraft.net` и `https://ru.wiki.totemcraft.net`.

**Используем:**
- **frp** - для Minecraft (Java + Bedrock + PlasmoVoice)
- **nginx** - для сайта и вики (reverse proxy)
- **Cloudflare** - DNS + HTTPS
- Существующие сертификаты с основного сервера (`totemcraft.pem` + `totemcraft.key`)

---

### 1. Подготовка русского VPS (VDSina / SprintHost и т.п.)

1. Арендуй самый дешёвый VPS в Москве (1 ядро, 512 МБ или 1 ГБ RAM).
2. Установи Ubuntu 22.04 или 24.04.
3. Зайди по SSH под `root`.

```bash
apt update && apt upgrade -y
apt install ufw nginx -y
```

### 2. Настройка frp (Minecraft-туннель)

**На русском VPS (frps):**

```bash
cd /root
wget https://github.com/fatedier/frp/releases/download/v0.68.0/frp_0.68.0_linux_amd64.tar.gz
tar -xzf frp_0.68.0_linux_amd64.tar.gz
cd frp_0.68.0_linux_amd64

cat > frps.toml << 'EOF'
[common]
bindPort = 7000
token = "ТВОЙ_СИЛЬНЫЙ_ТОКЕН_ЗДЕСЬ"
EOF

ufw allow 7000/tcp
ufw allow 20098/tcp
ufw allow 19132/udp
ufw allow 60606/udp
ufw enable
```

Создай сервис:

```bash
cat > /etc/systemd/system/frps.service << 'EOF'
[Unit]
Description=frp Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/frp_0.68.0_linux_amd64
ExecStart=/root/frp_0.68.0_linux_amd64/frps -c /root/frp_0.68.0_linux_amd64/frps.toml
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now frps
```

**На основном сервере (Hetzner):**

Скопируй frp в папку сервера, создай `frpc.ini` (не toml!):

```ini
[common]
server_addr = IP_адрес_российского_vds_сервера_под_прокси
server_port = 7000
token = ТВОЙ_СИЛЬНЫЙ_ТОКЕН_ЗДЕСЬ

[minecraft-java]
type = tcp
local_ip = 127.0.0.1
local_port = 20098
remote_port = 20098

[geyser-bedrock]
type = udp
local_ip = 127.0.0.1
local_port = 19132
remote_port = 19132

[plasmovoice]
type = udp
local_ip = 127.0.0.1
local_port = 60606
remote_port = 60606
```

Создай сервис и запусти.

### 3. Настройка веб-прокси (nginx на русском VPS)

```bash
mkdir -p /etc/nginx/ssl

# Скопируй сертификаты с основного сервера через WinSCP или scp
# totemcraft.pem и totemcraft.key → /etc/nginx/ssl/
```

Создай **один** чистый конфиг:

```bash
cat > /etc/nginx/sites-available/ru.conf << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ru.totemcraft.net ru.wiki.totemcraft.net;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name ru.totemcraft.net ru.wiki.totemcraft.net;

    ssl_certificate /etc/nginx/ssl/totemcraft.pem;
    ssl_certificate_key /etc/nginx/ssl/totemcraft.key;

    # Основной сайт
    location / {
        proxy_pass http://IP_основного_сайта; #с основного хостинга не РФ
        proxy_http_version 1.1;
        proxy_set_header Host totemcraft.net;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Вики
    location ^~ / {
        proxy_pass http://IP_вики_с_сайта:3000; #вики с основного хостинга не РФ
        proxy_http_version 1.1;
        proxy_set_header Host wiki.totemcraft.net;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sf /etc/nginx/sites-available/ru.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx
```

### 4. Cloudflare

- Для записей `ru` и `ru.wiki` поставь **DNS only** (серое облачко).

### 5. Проверка

- https://ru.totemcraft.net/
- https://ru.wiki.totemcraft.net/
- Minecraft: `IP_РУ_сервера:20098`
- Туннель на основном сервере: `journalctl -u frpc --since "-5 min"` должен показывать `[minecraft-java] start proxy success`, а не `port unavailable`.
- На русском VPS порт 20098 должен держать frps: `ss -ltnp | grep 20098` показывает `frps`, а не `nginx`.

### 6. Порт 20098 только для frp

nginx на русском VPS обслуживает **только** сайт и вики (порты 80 и 443). Никаких блоков `stream` с `listen 20098` в nginx быть не должно: если nginx займёт игровой порт, frp не сможет его открыть, и вход для РФ сломается.

**Случай 02.10.2026.** На русском VPS был файл `/etc/nginx/stream.conf` (подключён в `nginx.conf` строкой `include /etc/nginx/stream.conf;`). Он слушал 20098 и пересылал игроков на `IP_сервера_сайта:20098`, то есть на сервер сайта, где Minecraft нет. Пока порт держал frp, файл ничем не мешал. 02.10.2026 в 04:52 связь frpc с frps на секунду оборвалась, frp отпустил порт, и его занял nginx. С этого момента frpc писал `[minecraft-java] start error: port unavailable`, а игроки по `ru.totemcraft.net` не могли зайти. Перезапуск frpc не помогает: порт держит nginx.

Починка (12.10.2026): все строки `stream.conf` закомментированы, копия лежит в `/root/stream.conf.bak-2026-10-12`.

```bash
cp /etc/nginx/stream.conf /root/stream.conf.bak-2026-10-12
sed -i 's/^/#/' /etc/nginx/stream.conf
nginx -t && systemctl reload nginx
```

frpc сам повторяет попытку каждые ~30 секунд и занимает порт после `reload`.


### 7. Сертификат ru.totemcraft.net (Let's Encrypt)

Сертификат на `ru.totemcraft.net` и `ru.wiki.totemcraft.net` выпущен certbot с плагином nginx (`authenticator = nginx` в `/etc/letsencrypt/renewal/ru.totemcraft.net.conf`) и продлевается сам по `certbot.timer`. Для этого на русском VPS должен стоять пакет `python3-certbot-nginx`:

```bash
apt install -y python3-certbot-nginx
certbot renew
certbot certificates   # срок действия
```

**Случай 02.07-12.10.2026.** Плагина nginx на сервере не было, продление падало каждую ночь (`journalctl -u certbot`: `All renewals failed`), и с 02.07.2026 сертификат был просрочен: браузеры показывали предупреждение на ru-сайте и ru-вики. 12.10.2026 плагин поставлен, сертификат продлён до 10.01.2027, копия старых настроек в `/root/letsencrypt.bak-2026-10-12`.

___
Примечание:

То, что мы сделали, называется **Reverse Proxy** (обратный прокси).
### Простыми словами:

Мы поставили **промежуточный сервер в России**, который:

- Принимает запросы от российских игроков и посетителей сайта
- Перекидывает их дальше на твой основной сервер в Финляндии

Это как "посредник" или "входная дверь" только для РФ.

### Как это правильно называется в нашем случае:

- Для **Minecraft** (Java + Bedrock + PlasmoVoice) - **frp (Fast Reverse Proxy)** / TCP+UDP tunnel
- Для **сайта и вики** (ru.totemcraft.net и ru.wiki.totemcraft.net) - **Nginx Reverse Proxy**

Вместе это часто называют:

- **Русский вход / RU Proxy**
- **Reverse Proxy для обхода блокировок**
- **Двухуровневый прокси (frp + nginx)**
