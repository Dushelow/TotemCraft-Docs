# Защита серверов TotemCraft - GeoIP Blacklist

**Цель:** Блокировка наиболее агрессивных источников бот-атак (Китай, Бангладеш, Южная Корея) на уровне firewall.

**Применяется к двум серверам:**
- **Основной сервер** (Hetzner, Финляндия, IP `[MAIN_SERVER_IP]`)
- **Российский Reverse Proxy** (RU Proxy, IP `[RU_PROXY_IP]`)

---

## 1. Инструкция для ОСНОВНОГО сервера (Hetzner)

```bash
# 1. Установка пакетов
sudo apt update
sudo apt install -y \
    xtables-addons-common xtables-addons-dkms \
    linux-headers-$(uname -r) \
    perl libtext-csv-xs-perl curl unzip plocate \
    iptables-persistent

# 2. Скачивание и сборка GeoIP-базы
sudo mkdir -p /usr/share/xt_geoip
cd /usr/share/xt_geoip

sudo curl -L -O https://download.db-ip.com/free/dbip-country-lite-2026-04.csv.gz
sudo gunzip dbip-country-lite-2026-04.csv.gz
sudo mv dbip-country-lite-2026-04.csv dbip-country-lite.csv

sudo /usr/libexec/xtables-addons/xt_geoip_build -D /usr/share/xt_geoip dbip-country-lite.csv

# 3. Добавление правил Blacklist
sudo iptables -I INPUT -p tcp --dport 20098 -m geoip --src-cc CN,BD,KR -j DROP
sudo iptables -I INPUT -p udp --dport 19132 -m geoip --src-cc CN,BD,KR -j DROP
sudo iptables -I INPUT -p udp --dport 60606 -m geoip --src-cc CN,BD,KR -j DROP

# 4. Сохранение правил
sudo netfilter-persistent save
sudo ufw reload

# 5. Проверка
sudo iptables -vnL | grep -E "geoip|DROP|20098|19132|60606"
```

---

## 2. Инструкция для РОССИЙСКОГО PROXY (RU Proxy)

```bash
# 1. Установка пакетов (без iptables-persistent - чтобы избежать конфликта с UFW)
sudo apt update
sudo apt install -y \
    xtables-addons-common xtables-addons-dkms \
    linux-headers-$(uname -r) \
    perl libtext-csv-xs-perl curl unzip plocate

# 2. Скачивание и сборка GeoIP-базы
sudo mkdir -p /usr/share/xt_geoip
cd /usr/share/xt_geoip

sudo curl -L -O https://download.db-ip.com/free/dbip-country-lite-2026-04.csv.gz
sudo gunzip dbip-country-lite-2026-04.csv.gz
sudo mv dbip-country-lite-2026-04.csv dbip-country-lite.csv

sudo /usr/libexec/xtables-addons/xt_geoip_build -D /usr/share/xt_geoip dbip-country-lite.csv

# 3. Добавление правил Blacklist
sudo iptables -I INPUT -p tcp --dport 20098 -m geoip --src-cc CN,BD,KR -j DROP
sudo iptables -I INPUT -p udp --dport 19132 -m geoip --src-cc CN,BD,KR -j DROP
sudo iptables -I INPUT -p udp --dport 60606 -m geoip --src-cc CN,BD,KR -j DROP

# 4. Сохранение правил навсегда + автозагрузка
sudo mkdir -p /etc/iptables
sudo iptables-save > /etc/iptables/rules.v4

cat > /etc/systemd/system/restore-iptables.service << 'EOF'
[Unit]
Description=Restore iptables rules
After=network.target

[Service]
Type=oneshot
ExecStart=/sbin/iptables-restore /etc/iptables/rules.v4
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now restore-iptables.service

# 5. Перезагрузка UFW и проверка
sudo ufw reload

sudo iptables -vnL | grep -E "geoip|DROP|20098|19132|60606"
```

---

## 3. Мониторинг заблокированных ботов (общий для обоих серверов)

```bash
# Текущая статистика
sudo iptables -vnL INPUT | grep geoip

# Мониторинг в реальном времени
watch -n 3 "sudo iptables -vnL INPUT | grep geoip"

# Обнуление счётчиков
sudo iptables -Z INPUT
```

---

## 4. Обновление GeoIP-базы (рекомендуется раз в месяц)

Повторите только **Шаг 2** и **Шаг 4** соответствующей инструкции (основной сервер или RU Proxy).

```bash
cd /usr/share/xt_geoip
sudo curl -L -O https://download.db-ip.com/free/dbip-country-lite-2026-04.csv.gz
sudo gunzip dbip-country-lite-2026-04.csv.gz
sudo mv dbip-country-lite-2026-04.csv dbip-country-lite.csv

sudo /usr/libexec/xtables-addons/xt_geoip_build -D /usr/share/xt_geoip dbip-country-lite.csv
```

Затем выполните сохранение правил (Шаг 4).

---

## 5. Дополнительная защита: Rate Limit (рекомендуется включить)

Добавьте эти правила **после** geoip-правил (выполните на обоих серверах):

```bash
# Ограничение новых подключений (6 попыток в минуту на IP)
sudo iptables -I INPUT -p tcp --dport 20098 -m state --state NEW -m recent --set
sudo iptables -I INPUT -p tcp --dport 20098 -m state --state NEW -m recent --update --seconds 60 --hitcount 6 -j DROP

# Ограничение UDP-трафика (Geyser и PlasmoVoice)
sudo iptables -I INPUT -p udp --dport 19132 -m limit --limit 10/s --limit-burst 20 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 60606 -m limit --limit 15/s --limit-burst 30 -j ACCEPT
```

После добавления не забудьте выполнить сохранение правил (Шаг 4).
