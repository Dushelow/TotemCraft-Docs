# Голос Silero (русская нейросеть, работает на этом компьютере без интернета). Держится запущенным: модель
# грузится один раз (~2 с), дальше фраза - доли секунды.
# Вход (stdin): строки JSON {"text": "...", "speaker": "xenia"}.
# Выход (stdout): 4 байта длины (little-endian) + PCM 16 бит моно 24 кГц; длина 0 - ошибка (текст в stderr).
import json
import os
import struct
import sys

here = os.path.dirname(os.path.abspath(__file__))
base = os.environ.get('SILERO_DIR') or os.path.join(here, '..', 'local', 'silero')
sys.path.insert(0, os.path.join(base, 'py'))

import torch  # noqa: E402

torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
model = torch.package.PackageImporter(os.path.join(base, 'v4_ru.pt')).load_pickle('tts_models', 'model')
model.to(torch.device('cpu'))
out = sys.stdout.buffer
sys.stderr.write('ready\n'); sys.stderr.flush()
for line in sys.stdin:
    try:
        req = json.loads(line)
        text = str(req.get('text', '')).strip()[:900]
        if not text:
            raise ValueError('пустой текст')
        audio = model.apply_tts(text=text, speaker=req.get('speaker') or 'xenia', sample_rate=24000)
        pcm = (audio.clamp(-1, 1) * 32767).to(torch.int16).numpy().tobytes()
        out.write(struct.pack('<I', len(pcm)) + pcm)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write('silero: %s\n' % e); sys.stderr.flush()
        out.write(struct.pack('<I', 0))
    out.flush()
