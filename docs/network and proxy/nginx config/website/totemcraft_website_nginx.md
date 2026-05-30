file name: `default`
path: `/etc/nginx/sites-available/`


content:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name totemcraft.net www.totemcraft.net ru.totemcraft.net ru.wiki.totemcraft.net;

    # Редирект HTTP на HTTPS (опционально, но рекомендую)
    # return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name totemcraft.net www.totemcraft.net ru.totemcraft.net ru.wiki.totemcraft.net;

    root /var/www/totemcraft;
    index index.php index.html index.htm;

    ssl_certificate /etc/nginx/ssl/totemcraft.pem;
    ssl_certificate_key /etc/nginx/ssl/totemcraft.key;

    # Опционально: лучшие настройки SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        try_files $uri $uri/ $uri.php$is_args$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.ht {
        deny all;
    }
}
```
