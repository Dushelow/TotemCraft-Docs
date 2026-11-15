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

const ORDER = ['qwen', 'piper', 'system'];

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
    return { enabled: false, provider: 'qwen', fallback: true, local: true, plasmo: false, volume: 0.9, piperVoice: 'ru_RU-denis-medium', ...(this.cfg().voice || {}) };
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
  async speak(text, botCfg) {
    const s = this.settings();
    if (!s.enabled || !text) return;
    // голос Windows - только если выбран сам; запасным не включается (звучит плохо - владелец 15.11)
    const order = s.fallback ? [s.provider, ...ORDER.filter((x) => x !== s.provider && x !== 'system')] : [s.provider];
    for (const how of order) {
      try {
        if (how === 'qwen') {
          // номер чата у бота - логический (router.js); читать вслух нужно в настоящем чате Qwen, и только ответ Qwen
          const qid = this.qwenChat ? this.qwenChat(botCfg.chatId) : botCfg.chatId;
          if (!qid) throw new Error('этот ответ дал не Qwen - озвучить нечем');
          const a = await this.bridge.readAloud(qid);
          if (!a.pcm.length) throw new Error('Qwen вернул пустой звук');
          this.play(a, botCfg.name, how);
        } else if (how === 'piper') {
          this.play(await this.piper(text), botCfg.name, how);
        } else if (how === 'system') {
          if (!s.local) throw new Error('голоса Windows звучат только в колонках (в Plasmo Voice их не передать), а колонки выключены');
          this.toPanel('voice-system', { text, volume: s.volume });
          this.log(botCfg.name, `голос (Windows): ${text}`);
        }
        return;
      } catch (e) {
        this.log(botCfg.name, `голос ${how} не сработал: ${e.message}`);
      }
    }
  }

  play({ pcm, rate }, name, how) {
    const s = this.settings();
    this.log(name, `голос (${how}): ${(pcm.length / 2 / rate).toFixed(1)} с`);
    if (s.local) this.toPanel('voice-pcm', { pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length), rate, volume: s.volume });
    if (s.plasmo && this.emitPcm) this.emitPcm(name, pcm, rate);   // в Plasmo Voice на сервере (аддон TotemVoiceAddon)
  }
}

module.exports = { Voice, PIPER_VOICES };
