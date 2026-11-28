# Голос Edge TTS (нейросетевые голоса Microsoft через интернет, пакет edge-tts) для ботов.
# Держится запущенным, как silero_tts.py. Вход (stdin): строки JSON {"text": "...", "voice": "ru-RU-DmitryNeural",
# "rate": "+0%", "pitch": "+0Hz"}; {"list": true} - список голосов (JSON в stderr не идёт: ответ тем же кадром).
# Выход (stdout): 4 байта длины (little-endian) + PCM 16 бит моно 24 кГц; для списка - JSON в utf-8; длина 0 - ошибка.
# Сервис отдаёт MP3, в PCM переводит miniaudio (без ffmpeg).
import asyncio
import json
import os
import struct
import sys

here = os.path.dirname(os.path.abspath(__file__))
base = os.environ.get('EDGE_DIR') or os.path.join(here, '..', 'local', 'edge')
sys.path.insert(0, os.path.join(base, 'py'))

import edge_tts  # noqa: E402
import miniaudio  # noqa: E402

out = sys.stdout.buffer


async def speak(req):
    text = str(req.get('text', '')).strip()[:900]
    if not text:
        raise ValueError('пустой текст')
    mp3 = b''
    com = edge_tts.Communicate(text, req.get('voice') or 'ru-RU-DmitryNeural', rate=req.get('rate') or '+0%', pitch=req.get('pitch') or '+0Hz')
    async for c in com.stream():
        if c['type'] == 'audio':
            mp3 += c['data']
    d = miniaudio.decode(mp3, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=24000)
    return d.samples.tobytes()


async def main():
    sys.stderr.write('ready\n'); sys.stderr.flush()
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        try:
            req = json.loads(line)
            if req.get('list'):
                vs = await edge_tts.list_voices()
                data = json.dumps([{'id': v['ShortName'], 'gender': v['Gender'], 'locale': v['Locale']} for v in vs]).encode('utf-8')
            else:
                data = await speak(req)
            out.write(struct.pack('<I', len(data)) + data)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write('edge: %s\n' % e); sys.stderr.flush()
            out.write(struct.pack('<I', 0))
        out.flush()


asyncio.run(main())
