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

const ORDER = ['qwen', 'silero', 'piper', 'system'];
// Silero: русская нейросеть на этом компьютере (Python + torch CPU, модель v4_ru ~ 60 МБ). Голоса: женские xenia,
// baya, kseniya; мужские aidar, eugene. Ставится кнопкой в разделе «Голос» в папку программы local/silero.
const SILERO_VOICES = { xenia: 'Ксения (женский)', baya: 'Байя (женский)', kseniya: 'Ксения 2 (женский)', aidar: 'Айдар (мужской)', eugene: 'Евгений (мужской)' };
const SILERO_MODEL = 'https://models.silero.ai/models/tts/ru/v4_ru.pt';

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
    return { enabled: false, provider: 'qwen', fallback: true, local: true, plasmo: false, volume: 0.9, piperVoice: 'ru_RU-denis-medium', sileroVoice: 'xenia', echo: true, ...(this.cfg().voice || {}) };
  }

  // --- Silero
  sileroDir() { return path.join(__dirname, '..', 'local', 'silero'); }
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
      this.sp = spawn('python', [path.join(__dirname, 'silero_tts.py')], { windowsHide: true, env: { ...process.env, SILERO_DIR: this.sileroDir(), PYTHONIOENCODING: 'utf-8' } });
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
          const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/^\s*!\w+\(.*\)\s*$/gm, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
          const same = !o.raw || plain(o.raw) === plain(text);
          let qid = !same ? null : this.qwenChat ? this.qwenChat(botCfg.chatId) : botCfg.chatId;
          if (!qid && !same && this.bridge.ask && !this.bridge.resting && !this.bridge.captcha) qid = await this.echo(text, botCfg);
          // ответ дала другая нейросеть (DeepSeek...): голосом Qwen через «голосовой» чат - Qwen повторяет фразу слово
          // в слово, её и озвучиваем. Тратит один короткий запрос Qwen на фразу, задержка несколько секунд (галочка)
          if (!qid && s.echo && this.bridge.ask && !this.bridge.resting && !this.bridge.captcha) qid = await this.echo(text, botCfg);
          if (!qid) throw new Error('этот ответ дал не Qwen - озвучить нечем (включите «голос Qwen и для других нейросетей»)');
          const a = await this.bridge.readAloud(qid);
          if (!a.pcm.length) throw new Error('Qwen вернул пустой звук');
          this.play(a, botCfg.name, how);
        } else if (how === 'silero') {
          this.play(await this.silero(text), botCfg.name, how);
        } else if (how === 'piper') {
          this.play(await this.piper(text), botCfg.name, how);
        } else if (how === 'system') {
          if (!s.local) throw new Error('голоса Windows звучат только в колонках (в Plasmo Voice их не передать), а колонки выключены');
          this.toPanel('voice-system', { text, volume: s.volume });
          this.log(botCfg.name, `голос (Windows): ${text}`);
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

module.exports = { Voice, PIPER_VOICES, SILERO_VOICES };
