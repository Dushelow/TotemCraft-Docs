import re, datetime, sys
base = "/home/minecraft/server/plugins/AdvancedBanX/data/"
txt = open(base + "storage.script", encoding="utf-8", errors="replace").read() + "\n" + open(base + "storage.log", encoding="utf-8", errors="replace").read()
def dec(s):
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
rx = re.compile(r"VALUES\((\d+),'([^']*)','[^']*','(.*?)','([^']*)','([A-Z_]+)',(\d+),(-?\d+)")
names = [a.lower() for a in sys.argv[1:]]
seen = set()
for line in txt.splitlines():
    low = line.lower()
    for n in names:
        if ",'" + n + "'" in low:
            m = rx.search(line)
            if not m:
                continue
            t = datetime.datetime.fromtimestamp(int(m.group(6)) / 1000).strftime("%d.%m.%Y %H:%M")
            end = "навсегда" if m.group(7) == "-1" else datetime.datetime.fromtimestamp(int(m.group(7)) / 1000).strftime("%d.%m.%Y")
            row = "%s | %s %s до %s | by %s | %s" % (m.group(2), m.group(5), t, end, m.group(4), dec(m.group(3))[:150])
            if row not in seen:
                seen.add(row)
                print(row)
