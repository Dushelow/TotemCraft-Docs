// Голос ботов. Три способа озвучки, каждый может подстраховать другой (по порядку, если включено «запасные»):
//  qwen   - кнопка «Read aloud» в Qwen, голос из настроек Qwen (основной);
//  piper  - нейросетевой голос на этом компьютере, без интернета (rhasspy/piper, голоса ru_RU), скачивается по кнопке;
//  system - голоса Windows через движок окна (только в колонки, последний запасной).
// Куда звучит: колонки этого компьютера; Plasmo Voice на сервере - следующий шаг (аддон на сервере).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const PIPER_VOICES = {
  'ru_RU-denis-medium': 'ru/ru_RU/denis/medium',
  'ru_RU-dmitri-medium': 'ru/ru_RU/dmitri/medium',
  'ru_RU-irina-medium': 'ru/ru_RU/irina/medium',
  'ru_RU-ruslan-medium': 'ru/ru_RU/ruslan/medium',
};
const VOICE_URL = (name) => `https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICES[name]}/${name}`;

const ORDER = ['qwen', 'silero', 'edge', 'piper', 'rhvoice', 'system'];
// Silero: русская нейросеть на этом компьютере (Python + torch CPU, модель v4_ru ~ 60 МБ). Голоса: женские xenia,
// baya, kseniya; мужские aidar, eugene. Ставится кнопкой в разделе «Голос» в папку программы local/silero.
const SILERO_VOICES = { xenia: 'Ксения (женский)', baya: 'Байя (женский)', kseniya: 'Ксения 2 (женский)', aidar: 'Айдар (мужской)', eugene: 'Евгений (мужской)' };
const SILERO_MODEL = 'https://models.silero.ai/models/tts/ru/v4_ru.pt';
// Edge TTS: голоса Microsoft через интернет (пакет edge-tts, ставится кнопкой в local/edge). 28.11: русские голоса
// Дмитрий и Светлана русский текст не читают («No audio received», английский читают); русский читают многоязычные:
const EDGE_VOICES = {
  'en-US-BrianMultilingualNeural': 'Брайан (мужской)', 'fr-FR-RemyMultilingualNeural': 'Реми (мужской)',
  'en-US-EmmaMultilingualNeural': 'Эмма (женский)', 'en-US-AvaMultilingualNeural': 'Ава (женский)', 'fr-FR-VivienneMultilingualNeural': 'Вивьен (женский)',
};
// RHVoice: лёгкие русские голоса без интернета, ставятся в Windows (SAPI) их установщиком с GitHub RHVoice
const RH = 'https://github.com/RHVoice';
const RH_VOICES = {
  Aleksandr: { name: 'Александр (мужской)', url: `${RH}/aleksandr-rus/releases/download/4.2/RHVoice-voice-Russian-Aleksandr-v4.2.2017.22-setup.exe` },
  Irina: { name: 'Ирина (женский)', url: `${RH}/irina-rus/releases/download/4.1/RHVoice-voice-Russian-Irina-v4.1.2017.22-setup.exe` },
  Anna: { name: 'Анна (женский)', url: `${RH}/anna-rus/releases/download/4.1/RHVoice-voice-Russian-Anna-v4.1.2017.22-setup.exe` },
  Elena: { name: 'Елена (женский)', url: `${RH}/elena-rus/releases/download/v4.3/RHVoice-voice-Russian-Elena-v4.3.2017.22-setup.exe` },
};
// голоса Windows (SAPI) в файл WAV через System.Speech: так звук уходит и в игру, а не только в колонки
const PS_LIST = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name + '|' + $_.VoiceInfo.Gender }`;
const PS_SAY = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
if ($env:TB_VOICE) { $s.SelectVoice($env:TB_VOICE) }; $s.Rate = [int]$env:TB_RATE;
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);
$s.SetOutputToWaveFile($env:TB_OUT, $f); $s.Speak([IO.File]::ReadAllText($env:TB_IN, [Text.Encoding]::UTF8)); $s.Dispose()`;
// скрипты Python в установленной программе лежат рядом с архивом app.asar (asarUnpack): изнутри архива Python их не прочтёт
const pyScript = (f) => path.join(__dirname, f).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
const PS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Процесс Python, который держится запущенным: строка JSON на вход, кадр «4 байта длины + данные» на выход. */
class PyWorker {
  constructor(script, env, label) { Object.assign(this, { script, env, label }); }
  ask(req, ms = 30000) {
    if (!this.p || this.p.exitCode !== null) {
      this.p = spawn('python', [this.script], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...this.env } });
      this.buf = Buffer.alloc(0); this.wait = []; this.err = '';
      this.p.stderr.on('data', (c) => { this.err = (this.err + c).slice(-500); });
      this.p.stdout.on('data', (c) => {
        this.buf = Buffer.concat([this.buf, c]);
        while (this.buf.length >= 4) {
          const n = this.buf.readUInt32LE(0);
          if (this.buf.length < 4 + n) break;
          const d = Buffer.from(this.buf.subarray(4, 4 + n)); this.buf = this.buf.subarray(4 + n);
          const w = this.wait.shift(); if (w) (n ? w.ok(d) : w.fail(new Error(`${this.label}: ${(this.err.trim().split('\n').pop() || 'не вышло').replace(/^\w+: /, '')}`)));
        }
      });
      this.p.on('error', (e) => { for (const w of this.wait.splice(0)) w.fail(new Error(`${this.label}: нет Python (${e.message})`)); });
      this.p.on('exit', () => { for (const w of this.wait.splice(0)) w.fail(new Error(`${this.label} остановился`)); });
    }
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`${this.label} не ответил за ${ms / 1000} с`)), ms);
      this.wait.push({ ok: (r) => { clearTimeout(t); ok(r); }, fail: (e) => { clearTimeout(t); fail(e); } });
      this.p.stdin.write(JSON.stringify(req) + '\n');
    });
  }
}

/** WAV-файл -> { pcm, rate } (кусок data, 16 бит моно). */
function readWav(file) {
  const b = fs.readFileSync(file);
  let rate = 24000, off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), n = b.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
    if (id === 'data') return { pcm: b.subarray(off + 8, off + 8 + n), rate };
    off += 8 + n + (n & 1);
  }
  throw new Error('пустой звук');
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`скачивание ${url}: HTTP ${res.status}`);
  const tmp = file + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
}

class Voice {
  /** cfg() - настройки, bridge - мост Qwen, toPanel(channel, data) - в окно, log(text) */
  constructor({ cfg, bridge, dir, toPanel, log }) {
    Object.assign(this, { cfg, bridge, dir, toPanel, log });
    this.piperDir = path.join(dir, 'piper');
  }

  settings() {
    return { enabled: false, provider: 'qwen', fallback: true, local: true, plasmo: false, volume: 0.9, piperVoice: 'ru_RU-denis-medium', sileroVoice: 'xenia', echo: true, edgeVoice: 'en-US-BrianMultilingualNeural', edgeRate: 0, edgePitch: 0, rhVoice: 'Aleksandr', systemVoice: '', sapiRate: 0, ...(this.cfg().voice || {}) };
  }

  // --- Silero
  sileroDir() { return path.join(process.env.TOTEMBOTS_LOCAL || path.join(__dirname, '..', 'local'), 'silero'); }
  sileroState() {
    const d = this.sileroDir();
    return { program: fs.existsSync(path.join(d, 'py', 'torch')), voice: fs.existsSync(path.join(d, 'v4_ru.pt')), voices: SILERO_VOICES };
  }

  /** Поставить Silero: torch для процессора и numpy в local/silero/py, модель v4_ru.pt. Запускает владелец кнопкой. */
  async installSilero(status = () => {}) {
    const d = this.sileroDir();
    fs.mkdirSync(path.join(d, 'py'), { recursive: true });
    if (!fs.existsSync(path.join(d, 'py', 'torch'))) {
      status('ставлю Python-библиотеки для Silero (torch для процессора, ~200 МБ, несколько минут)...');
      await new Promise((ok, fail) => {
        const p = spawn('python', ['-m', 'pip', 'install', '--quiet', '--target', path.join(d, 'py'), 'torch', 'numpy', '--index-url', 'https://download.pytorch.org/whl/cpu', '--extra-index-url', 'https://pypi.org/simple'], { windowsHide: true });
        let err = ''; p.stderr.on('data', (c) => { err += c; });
        p.on('error', (e) => fail(new Error('нет Python на компьютере: ' + e.message)));
        p.on('close', (code) => (code === 0 ? ok() : fail(new Error('pip: ' + (err.trim().split('\n').pop() || 'код ' + code)))));
      });
    }
    if (!fs.existsSync(path.join(d, 'v4_ru.pt'))) { status('скачиваю голосовую модель Silero (~60 МБ)...'); await download(SILERO_MODEL, path.join(d, 'v4_ru.pt')); }
    status('Silero готов');
    return this.sileroState();
  }

  /** Озвучить через Silero: процесс держится запущенным, фразы - по очереди. */
  silero(text) {
    const st = this.sileroState();
    if (!st.program || !st.voice) throw new Error('Silero не установлен (кнопка «Скачать Silero» в разделе «Голос»)');
    if (!this.sp || this.sp.exitCode !== null) {
      this.sp = spawn('python', [pyScript('silero_tts.py')], { windowsHide: true, env: { ...process.env, SILERO_DIR: this.sileroDir(), PYTHONIOENCODING: 'utf-8' } });
      this.spBuf = Buffer.alloc(0); this.spWait = [];
      this.sp.stdout.on('data', (c) => {
        this.spBuf = Buffer.concat([this.spBuf, c]);
        while (this.spBuf.length >= 4) {
          const n = this.spBuf.readUInt32LE(0);
          if (this.spBuf.length < 4 + n) break;
          const pcm = this.spBuf.subarray(4, 4 + n); this.spBuf = this.spBuf.subarray(4 + n);
          const w = this.spWait.shift(); if (w) (n ? w.ok({ pcm: Buffer.from(pcm), rate: 24000 }) : w.fail(new Error('Silero не смог озвучить')));
        }
      });
      this.sp.on('exit', () => { for (const w of this.spWait.splice(0)) w.fail(new Error('Silero остановился')); });
    }
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('Silero не ответил за 30 с')), 30000);
      this.spWait.push({ ok: (r) => { clearTimeout(t); ok(r); }, fail: (e) => { clearTimeout(t); fail(e); } });
      this.sp.stdin.write(JSON.stringify({ text: String(text).replace(/\s+/g, ' '), speaker: this.settings().sileroVoice || 'xenia' }) + '\n');
    });
  }

  // --- Piper
  piperExe() { return path.join(this.piperDir, 'piper', 'piper.exe'); }
  voiceFile(name) { return path.join(this.piperDir, 'voices', name + '.onnx'); }
  piperState() {
    const v = this.settings().piperVoice;
    return { program: fs.existsSync(this.piperExe()), voice: fs.existsSync(this.voiceFile(v)), voiceName: v, voices: Object.keys(PIPER_VOICES) };
  }

  async installPiper(status = () => {}) {
    fs.mkdirSync(path.join(this.piperDir, 'voices'), { recursive: true });
    if (!fs.existsSync(this.piperExe())) {
      status('скачиваю Piper (22 МБ)...');
      const zip = path.join(this.piperDir, 'piper.zip');
      await download(PIPER_ZIP, zip);
      status('распаковываю Piper...');
      // tar в Windows 10+ распаковывает zip
      await new Promise((ok, fail) => execFile('tar', ['-xf', zip, '-C', this.piperDir], (e) => (e ? fail(e) : ok())));
      fs.unlinkSync(zip);
    }
    const v = this.settings().piperVoice;
    if (!fs.existsSync(this.voiceFile(v))) {
      status(`скачиваю голос ${v} (63 МБ)...`);
      await download(VOICE_URL(v) + '.onnx.json', this.voiceFile(v) + '.json');
      await download(VOICE_URL(v) + '.onnx', this.voiceFile(v));
    }
    status('Piper готов');
    return this.piperState();
  }

  piper(text) {
    const v = this.settings().piperVoice;
    if (!fs.existsSync(this.piperExe()) || !fs.existsSync(this.voiceFile(v))) throw new Error('Piper не скачан (кнопка в настройках голоса)');
    const meta = JSON.parse(fs.readFileSync(this.voiceFile(v) + '.json', 'utf8'));
    const rate = (meta.audio && meta.audio.sample_rate) || 22050;
    return new Promise((ok, fail) => {
      const p = spawn(this.piperExe(), ['--model', this.voiceFile(v), '--output-raw', '--quiet'], { cwd: path.dirname(this.piperExe()), windowsHide: true });
      const out = [];
      let err = '';
      p.stdout.on('data', (c) => out.push(c));
      p.stderr.on('data', (c) => { err += c; });
      p.on('error', fail);
      p.on('close', (code) => (code === 0 ? ok({ pcm: Buffer.concat(out), rate }) : fail(new Error('Piper: ' + (err.trim().split('\n').pop() || 'код ' + code)))));
      p.stdin.end(text.replace(/\s+/g, ' ') + '\n', 'utf8');
    });
  }

  // --- Edge TTS
  edgeDir() { return path.join(process.env.TOTEMBOTS_LOCAL || path.join(__dirname, '..', 'local'), 'edge'); }
  edgeState() { return { program: fs.existsSync(path.join(this.edgeDir(), 'py', 'edge_tts')), voices: EDGE_VOICES }; }
  async installEdge(status = () => {}) {
    const d = path.join(this.edgeDir(), 'py');
    fs.mkdirSync(d, { recursive: true });
    status('ставлю Edge TTS (пакеты edge-tts и miniaudio, ~10 МБ)...');
    await new Promise((ok, fail) => {
      // --upgrade: Microsoft меняет подпись запросов, свежий edge-tts за этим следит - кнопка же и обновляет
      const p = spawn('python', ['-m', 'pip', 'install', '--quiet', '--upgrade', '--target', d, 'edge-tts', 'miniaudio'], { windowsHide: true });
      let err = ''; p.stderr.on('data', (c) => { err += c; });
      p.on('error', (e) => fail(new Error('нет Python на компьютере: ' + e.message)));
      p.on('close', (code) => (code === 0 ? ok() : fail(new Error('pip: ' + (err.trim().split('\n').filter((l) => !/notice|WARNING/.test(l)).pop() || 'код ' + code)))));
    });
    if (this.ew) { try { this.ew.p.kill(); } catch {} this.ew = null; }
    status('Edge TTS готов');
    return this.edgeState();
  }
  async edge(text) {
    if (!this.edgeState().program) throw new Error('Edge TTS не установлен (кнопка «Скачать» у Edge в разделе «Голос»)');
    this.ew = this.ew || new PyWorker(pyScript('edge_tts_pcm.py'), { EDGE_DIR: this.edgeDir() }, 'Edge TTS');
    const s = this.settings();
    const pct = (v, unit) => `${v >= 0 ? '+' : ''}${Math.round(v)}${unit}`;
    return { pcm: await this.ew.ask({ text: String(text).replace(/\s+/g, ' '), voice: s.edgeVoice, rate: pct(+s.edgeRate || 0, '%'), pitch: pct(+s.edgePitch || 0, 'Hz') }), rate: 24000 };
  }

  // --- голоса Windows (SAPI): свои голоса Windows и RHVoice
  /** Установленные голоса Windows: [{ name, lang, gender, x86 }] (RHVoice бывает только в 32-битной части). */
  async sapiVoices() {
    const run = (exe) => new Promise((ok) => execFile(exe, ['-NoProfile', '-Command', PS_LIST], { windowsHide: true, timeout: 20000 }, (e, out) => ok(e ? [] : String(out).split(/\r?\n/).filter(Boolean).map((l) => { const [name, lang, gender] = l.split('|'); return { name, lang, gender }; }))));
    const a = await run('powershell.exe');
    const b = fs.existsSync(PS32) ? await run(PS32) : [];
    return [...a, ...b.filter((x) => !a.some((y) => y.name === x.name)).map((x) => ({ ...x, x86: true }))];
  }
  async sapi(text, voiceName) {
    const list = this.sapiList || (this.sapiList = await this.sapiVoices());
    // «по умолчанию» - первый русский голос: голос Windows по умолчанию бывает английским и русский текст не читает (28.11)
    if (!voiceName) voiceName = (list.find((x) => /^ru/i.test(x.lang)) || {}).name || '';
    const v = voiceName ? list.find((x) => x.name === voiceName) : null;
    if (voiceName && !v) { this.sapiList = null; throw new Error(`голос «${voiceName}» не установлен в Windows`); }
    const tmp = path.join(require('os').tmpdir(), `tb-say-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp + '.txt', String(text), 'utf8');
    try {
      await new Promise((ok, fail) => execFile(v && v.x86 ? PS32 : 'powershell.exe', ['-NoProfile', '-Command', PS_SAY], { windowsHide: true, timeout: 30000,
        env: { ...process.env, TB_VOICE: voiceName || '', TB_RATE: String(Math.max(-10, Math.min(10, Math.round(+this.settings().sapiRate || 0)))), TB_IN: tmp + '.txt', TB_OUT: tmp + '.wav' } },
      (e, _o, err) => (e ? fail(new Error('голос Windows: ' + (String(err).trim().split('\n')[0] || e.message))) : ok())));
      const a = readWav(tmp + '.wav');
      if (a.pcm.length < 4800) throw new Error(`голос Windows «${voiceName || 'по умолчанию'}» не прочёл текст (не русский голос?)`);
      return a;
    } finally { for (const x of ['.txt', '.wav']) try { fs.unlinkSync(tmp + x); } catch {} }
  }
  // голос RHVoice в списке Windows: «Aleksandr», а не «Microsoft Irina Desktop» (свой голос Windows с тем же именем)
  rhFind(list, k) { return (list || []).find((v) => !/microsoft/i.test(v.name) && new RegExp(`(^|\W)${k}(\W|$)`, 'i').test(v.name)); }
  rhState(list) { return { voices: Object.fromEntries(Object.entries(RH_VOICES).map(([k, x]) => [k, { name: x.name, installed: !!this.rhFind(list, k) }])) }; }
  /** Скачать установщик голоса RHVoice с GitHub RHVoice и открыть его: дальше «Далее» нажимает владелец. */
  async installRh(name, status = () => {}) {
    const r = RH_VOICES[name];
    if (!r) throw new Error('нет такого голоса RHVoice');
    const dir = path.join(this.dir, 'rhvoice'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(r.url));
    if (!fs.existsSync(file)) { status(`скачиваю голос RHVoice ${r.name}...`); await download(r.url, file); }
    status(`открыт установщик RHVoice (${r.name}): нажмите в нём «Далее» и «Установить», потом здесь «Обновить список»`);
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    this.sapiList = null;
    return true;
  }

  // --- озвучить реплику бота
  async speak(text, botCfg, o = {}) {
    const s = this.settings();
    if (!s.enabled || !text) return;
    // голос Windows - только если выбран сам; запасным не включается (звучит плохо - владелец 15.11)
    // Запасной голос - только если выбранный не работает несколько раз подряд: одна осечка - фраза без звука (текст
    // и так в чате), иначе бот говорит то своим голосом, то чужим (22.11: «сначала не тот голос»)
    this.fails = this.fails || {};
    const useFallback = s.fallback && (this.fails[s.provider] || 0) >= 2;
    const order = useFallback ? [s.provider, ...ORDER.filter((x) => x !== s.provider && x !== 'system')] : [s.provider];
    for (const how of order) {
      try {
        if (how === 'qwen') {
          // номер чата у бота - логический (router.js); читать вслух нужно в настоящем чате Qwen, и только ответ Qwen
          // «Прочитать вслух» у Qwen читает весь его ответ: с приставкой «рядом:», лишними словами. Ответ дословно
          // не та фраза, что ушла в игру, - озвучить через «дикторский» чат ровно её (22.11: «рядом» в начале фраз)
          // Отдельный «дикторский» чат на каждую фразу убран (22.11, владелец: лишний чат и трата запросов, и он держал
          // очередь Qwen по несколько секунд - бот дольше отвечал). Ответ Qwen не ровно та фраза (приставка «рядом:»,
          // лишние слова) - эта фраза без голоса Qwen: «Прочитать вслух» прочёл бы и приставку. Текст в чате есть.
          const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/^\s*!\w+\(.*\)\s*$/gm, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
          const same = !o.raw || plain(o.raw) === plain(text);
          let qid = !same ? null : this.qwenChat ? this.qwenChat(botCfg.chatId) : botCfg.chatId;
          if (!same) throw new Error('ответ Qwen длиннее сказанной фразы - эту фразу без голоса (дикторский чат отключён)');
          // ответ дала другая нейросеть (DeepSeek...): голосом Qwen через «голосовой» чат - Qwen повторяет фразу слово
          // в слово, её и озвучиваем. Тратит один короткий запрос Qwen на фразу, задержка несколько секунд (галочка)
          if (!qid && s.echo && this.bridge.ask && !this.bridge.resting && !this.bridge.captcha) qid = await this.echo(text, botCfg);
          if (!qid) throw new Error('этот ответ дал не Qwen - озвучить нечем (включите «голос Qwen и для других нейросетей»)');
          const a = await this.bridge.readAloud(qid);
          if (!a.pcm.length) throw new Error('Qwen вернул пустой звук');
          this.play(a, botCfg.name, how);
        } else if (how === 'silero') {
          this.play(await this.silero(text), botCfg.name, how);
        } else if (how === 'edge') {
          this.play(await this.edge(text), botCfg.name, how);
        } else if (how === 'rhvoice') {
          const list = this.sapiList || (this.sapiList = await this.sapiVoices());
          const v = this.rhFind(list, s.rhVoice || 'Aleksandr');
          if (!v) throw new Error(`RHVoice ${s.rhVoice} не установлен (кнопка «Установить» у RHVoice в разделе «Голос»)`);
          this.play(await this.sapi(text, v.name), botCfg.name, how);
        } else if (how === 'piper') {
          this.play(await this.piper(text), botCfg.name, how);
        } else if (how === 'system') {
          this.play(await this.sapi(text, s.systemVoice || ''), botCfg.name, how);
        }
        if (how === s.provider) this.fails[how] = 0;
        return;
      } catch (e) {
        if (how === s.provider) this.fails[how] = (this.fails[how] || 0) + 1;
        this.log(botCfg.name, `голос ${how} не сработал: ${e.message}${how === s.provider && !useFallback && s.fallback ? ' - эту фразу без звука, запасной голос - если не выйдет ещё раз' : ''}`);
      }
    }
  }

  /** Голосовой чат Qwen: попросить повторить фразу дословно, вернуть номер чата для «прочитать вслух». */
  async echo(text, botCfg) {
    const ask = (id, t) => this.bridge.ask(id, t, { mode: 'fast' });
    const intro = 'Ты - диктор. На каждое моё сообщение отвечай только его текстом, слово в слово, без кавычек, пояснений и добавлений. Ответь: ок';
    if (!botCfg.voiceChat) { const r = await ask('', intro); botCfg.voiceChat = r.chatId; }
    try { await ask(botCfg.voiceChat, String(text).slice(0, 300)); }
    catch (e) { if (!/PARENT_NOT_FOUND|CHAT_IN_PROGRESS/.test(e.message)) throw e; const r = await ask('', intro); botCfg.voiceChat = r.chatId; await ask(botCfg.voiceChat, String(text).slice(0, 300)); }
    return botCfg.voiceChat;
  }

  play({ pcm, rate }, name, how) {
    const s = this.settings();
    this.log(name, `голос (${how}): ${(pcm.length / 2 / rate).toFixed(1)} с`);
    if (s.local) this.toPanel('voice-pcm', { pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length), rate, volume: s.volume });
    if (s.plasmo && this.emitPcm) this.emitPcm(name, pcm, rate);   // в Plasmo Voice на сервере (аддон TotemVoiceAddon)
  }
}

module.exports = { Voice, PIPER_VOICES, SILERO_VOICES, EDGE_VOICES, RH_VOICES };
