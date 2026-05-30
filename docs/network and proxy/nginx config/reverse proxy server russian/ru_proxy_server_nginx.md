Прокси сайтов - ru.totemcraft.net и ru.wiki.totemcraft.net

file name: `ru.conf`
path: `/etc/nginx/sites-available/`


content:
```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server http2;
    server_name _;

    ssl_certificate /etc/letsencrypt/live/ru.totemcraft.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ru.totemcraft.net/privkey.pem;
    return 444;
}

# HTTP → HTTPS редирект
server {
    listen 80;
    server_name ru.totemcraft.net ru.wiki.totemcraft.net;
    return 301 https://$host$request_uri;
}

# ru.totemcraft.net - основной сайт
server {
    listen 443 ssl http2;
    server_name ru.totemcraft.net;

    ssl_certificate /etc/letsencrypt/live/ru.totemcraft.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ru.totemcraft.net/privkey.pem;

    location / {
        # ПРЯМО ПО IP — обходим Cloudflare
        proxy_pass https://YOUR_WEBSITE_IP;

        proxy_set_header Host totemcraft.net;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # На всякий случай (если сертификат на бэкенде строгий)
        proxy_ssl_server_name on;
        proxy_ssl_name totemcraft.net;
        proxy_ssl_verify off;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 90s;
    }
}

# ru.wiki.totemcraft.net - вики
server {
    listen 443 ssl http2;
    server_name ru.wiki.totemcraft.net;

    ssl_certificate /etc/letsencrypt/live/ru.totemcraft.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ru.totemcraft.net/privkey.pem;

    location / {
        proxy_pass https://YOUR_WEBSITE_IP;

        proxy_set_header Host wiki.totemcraft.net;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_ssl_server_name on;
        proxy_ssl_name totemcraft.net;
        proxy_ssl_verify off;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```
