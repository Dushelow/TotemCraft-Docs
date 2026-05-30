# Ручной бэкап TotemCraft на Mega.nz

**Когда использовать:** перед крупными обновлениями, переездом сервера, или когда нужна полная копия всего.  
**Что бэкапится:** `/home/minecraft/`, `/home/totembot/`, системные конфиги. 

---

## Подготовка (выполняется один раз)

```bash
apt update && apt install -y pigz pv screen

# Установка MEGAcmd (Ubuntu 24.04)
wget https://mega.nz/linux/repo/xUbuntu_24.04/amd64/megacmd-xUbuntu_24.04_amd64.deb
sudo apt install "$PWD/megacmd-xUbuntu_24.04_amd64.deb" -y
```

---

## Шаг 1: Логин в Mega.nz

```bash
mega-cmd
login <твой_email>
# введи пароль
exit
```

---

## Шаг 2: Остановить Minecraft-сервер

Для чистого архива сервер нужно остановить (иначе файлы мира могут быть в несогласованном состоянии):

```bash
screen -r minecraft
# внутри консоли сервера:
stop
# дождись полного выключения, затем:
Ctrl+A → D
```

---

## Шаг 3: Создать архивы

```bash
cd /home
```

**3.1 Minecraft (самый большой):**

```bash
screen -S tar-minecraft
tar -cf - minecraft/ | pv -s $(du -sb minecraft/ | awk '{print $1}') | pigz -p 8 > minecraft_backup_$(date +%Y-%m-%d).tar.gz
# Ctrl+A → D
```

**3.2 Totembot:**

```bash
screen -S tar-totembot
tar -cf - totembot/ | pv -s $(du -sb totembot/ | awk '{print $1}') | pigz -p 8 > totembot_backup_$(date +%Y-%m-%d).tar.gz
# Ctrl+A → D
```

**3.3 Системные конфиги:**

```bash
screen -S tar-system
tar -cf - \
  /etc/systemd/system/minecraft.service \
  /etc/sysctl.d/99-minecraft.conf \
  /etc/security/limits.conf \
  /etc/udev/rules.d/ \
  /home/minecraft/backup.sh \
  /home/minecraft/server/start.sh \
  /home/minecraft/*.sh 2>/dev/null | \
  pigz -p 8 > system_configs_backup_$(date +%Y-%m-%d).tar.gz
# Ctrl+A → D
```

---

## Шаг 4: Проверить что архивы готовы

```bash
ls -lh /home/*backup_*.tar.gz
```

Все три файла должны присутствовать и иметь ненулевой размер.

---

## Шаг 5: Загрузить на Mega.nz

```bash
# Создать папку
mega-mkdir -p /TotemCraft_Backup/$(date +%Y-%m-%d)

# Загрузка каждого архива в отдельном screen
screen -S mega-minecraft
mega-put -c minecraft_backup_$(date +%Y-%m-%d).tar.gz /TotemCraft_Backup/$(date +%Y-%m-%d)/
# Ctrl+A → D

screen -S mega-totembot
mega-put -c totembot_backup_$(date +%Y-%m-%d).tar.gz /TotemCraft_Backup/$(date +%Y-%m-%d)/
# Ctrl+A → D

screen -S mega-system
mega-put -c system_configs_backup_$(date +%Y-%m-%d).tar.gz /TotemCraft_Backup/$(date +%Y-%m-%d)/
# Ctrl+A → D
```

---

## Шаг 6: Проверить статус загрузок

```bash
mega-transfers
```

Ждём пока все три загрузки завершатся.

---

## Шаг 7: Запустить сервер обратно

```bash
sudo systemctl start minecraft
# или через screen, если не используешь systemd:
screen -r minecraft
```

---

## Шаг 8: Удалить локальные архивы

После успешной загрузки архивы на сервере больше не нужны — они занимают место:

```bash
rm /home/*backup_*.tar.gz
```

---

## Полезные команды

|Действие|Команда|
|---|---|
|Список всех screen-сессий|`screen -ls`|
|Зайти в сессию|`screen -r имя`|
|Отсоединиться|`Ctrl+A → D`|
|Статус загрузок Mega|`mega-transfers`|
|Отменить все загрузки|`mega-transfers -c -a`|
|Список файлов на Mega|`mega-ls /TotemCraft_Backup/`|
|Удалить старый бэкап с Mega|`mega-rm -r /TotemCraft_Backup/YYYY-MM-DD`|
