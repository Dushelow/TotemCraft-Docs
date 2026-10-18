#!/bin/bash
# Сводка для обхода дежурного: tc snapshot (только чтение, пароли заявок не печатаются).
# Только чтение. Пароли заявок не печатаются (outbox_cli pending их не показывает).
BOT=/home/totembot/totemcraft_bot
LOGS=/home/minecraft/server/logs
since=$(date -u -d '-26 hours' +%Y-%m-%dT%H:%M)
echo "=== сейчас $(date '+%F %T %Z')"
echo "=== службы"; for s in minecraft totemcraftbot totemcraftcore fishbot frpc; do echo "$s: $(systemctl is-active $s)"; done
echo "=== сервер после рестарта"
head -2 $LOGS/latest.log | cut -c1-120
grep -a -E "Done \([0-9.]+s\)! For help|Loading Geyser version|Started Geyser" $LOGS/latest.log | cut -c1-140
echo "ошибок ERROR/SEVERE в latest.log: $(grep -a -c -E '/(ERROR|SEVERE)\]' $LOGS/latest.log)"
grep -a -E "/(ERROR|SEVERE)\]" $LOGS/latest.log | grep -v -i discordsrv | cut -c1-160 | sort | uniq -c | sort -rn | head -5
echo "туннель ru: $(journalctl -u frpc --since '-12 hours' --no-pager | grep -c 'port unavailable') раз port unavailable за 12 ч"
echo "=== заявки в очереди (tg_id | ник | подана UTC | значок | срок | стоп | мелочи | подписка | комментарий)"
cd $BOT && sudo -u totembot venv/bin/python -m tcbot.outbox_cli pending
echo "=== обращения и непрочитанное"
sqlite3 -readonly "file:$BOT/bot.db?mode=ro" "select 'ticket', key, json_extract(value,'$.nick'), json_extract(value,'$.date'), replace(substr(json_extract(value,'$.message'),1,200),char(10),' ') from kv where space='tickets'; select 'unread', key from kv where space='unread';"
echo "=== переписка с игроками за 26 ч"
sqlite3 -readonly "file:$BOT/bot.db?mode=ro" "select substr(created_at,1,16), tg_id, sender, coalesce(staff_name,''), replace(substr(text,1,250),char(10),' ') from messages where created_at > '$since' order by id;"
echo "=== общий чат Telegram за 26 ч (время UTC | кто | номер | ответ на | текст | фото)"
sqlite3 -readonly "file:$BOT/bot.db?mode=ro" "select substr(ts,1,16), from_name, message_id, coalesce(reply_to,''), replace(substr(text,1,250),char(10),' '), case when photo is null then '' else 'фото' end from group_log where ts > '$since' order by id;"
echo "=== ящик задач админ-чата (новые)"
sqlite3 -readonly "file:/home/totemcraftcore/totemcraftcore.db?mode=ro" "select id, datetime(created,'unixepoch','+3 hours'), author_id, author_name, case when (text like '%срочн%' or text like '%Срочн%' or text like '%СРОЧН%') then 'СРОЧНО' else '' end, replace(text,char(10),' ') from inbox where status='new' order by (text like '%срочн%' or text like '%Срочн%' or text like '%СРОЧН%') desc, id;"
echo "=== вход игроков за сутки: входов, Timed out, отказов по паролю, по регистру ника"
for f in $(ls -t $LOGS/*.log.gz | head -3 | tac) $LOGS/latest.log; do
  zcat -f $f | awk -v f=$(basename $f) '/logged in with entity id/{j++} /lost connection: Timed out/{t++} /lost connection: Неправильный пароль/{p++} /lost connection: Неверный никнейм/{c++} END{printf "%s входов=%d timeout=%d пароль=%d регистр=%d\n", f,j,t,p,c}'
done
echo "=== Outdated Bedrock/Geyser за сутки: $(zcat -f $(ls -t $LOGS/*.log.gz | head -2) $LOGS/latest.log | grep -a -c 'Outdated')"
echo "=== наказания AdvancedBanX за 26 ч"
cut -c1-400 /home/minecraft/server/plugins/AdvancedBanX/data/storage.log 2>/dev/null | grep -a "INSERT INTO PUNISHMENTHISTORY" | tail -15
