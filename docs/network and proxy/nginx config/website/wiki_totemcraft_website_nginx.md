file name: `wiki.totemcraft.net`
path: `/etc/nginx/sites-available/`

content:
```nginx
server {
    listen 80;
    listen [::]:80;

    server_name wiki.totemcraft.net;

    # редирект на https
    return 301 https://wiki.totemcraft.net$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name wiki.totemcraft.net;

    ssl_certificate /etc/nginx/ssl/totemcraft.pem;
    ssl_certificate_key /etc/nginx/ssl/totemcraft.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;

        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # для WebSocket (wiki.js использует)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

```
