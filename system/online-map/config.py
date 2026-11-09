# Карта TotemCraft (как у EmeraldCubes): только обычный мир, один слой, JPG, тёмный фон
worlds["2025"] = "/home/mapper/world"
texturepath = "/home/mapper/client/26.3.jar"
outputdir = "/home/mapper/out"
processes = 2
renders["totemcraft"] = {
    "world": "2025",
    "title": "TotemCraft",
    "dimension": "overworld",
    "rendermode": "normal",
    "northdirection": "upper-right",
    "imgformat": "jpg",
    "imgquality": 85,
    "bgcolor": "#1a1a1a",
    # только зона до 10000 (граница вайпа), дальше карту не показываем
    "crop": (-10000, -10000, 10000, 10000),
}
