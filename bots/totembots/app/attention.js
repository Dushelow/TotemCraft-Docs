// Внимание бота к чату (CHAT.md): что будит мозг, что идёт фоном рядом, что - в общий журнал фона.
//  address - обращение: в главный чат Qwen сразу;
//  near    - слышно рядом, но не ему: копится и прикладывается к следующему обращению строкой [вокруг];
//  background - остальной общий чат: в журнал фона, его сжимает служебный чат.

const CONVO_MS = 3 * 60 * 1000;       // окно разговора после ответа игроку
const MENTION_MS = 2 * 60 * 1000;     // «недавно упоминали» в общем чате
const NEAR_BLOCKS = 48;               // «рядом» для общего чата
const LOCAL_ADDRESS_BLOCKS = 16;      // ближний чат в этих блоках - точно к нам (дальше - если разговор или имя)
const MASTER_BLOCKS = 24;
const GLOBAL_REPLY_MS = 20 * 1000;    // не чаще реплики в общий чат

// формы имени и прозвища: имя бота латиницей и кириллицей с падежами, «бот» отдельным словом в начале/с запятой
function aliasRegex(name, extra = []) {
  const n = name.toLowerCase();
  const ru = { alex: 'алекс' }[n] || '';
  const words = [n, ...(ru ? [ru + '(?:а|у|ом|е|ик|ичек|андр)?'] : []), ...extra.map((x) => x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
  return new RegExp(`(^|[^a-zа-яё0-9_])@?(${words.join('|')})($|[^a-zа-яё0-9_])`, 'i');
}
const BOT_WORD = /(^|[\s,!?])бот(ик|яра)?[\s,!?]|^бот(ик)?$/i;
const AD = /(https?:\/\/|discord\.gg|t\.me\/|\.(ru|com|net|gg)\b.*(сервер|заход|ip))/i;

class Attention {
  constructor(name, opts = {}) {
    this.name = name;
    this.mode = opts.mode || 'normal';          // quiet | normal | social
    this.re = aliasRegex(name, opts.aliases || []);
    this.convo = new Map();                     // ник -> до какого времени разговор открыт
    this.mentionedUntil = 0;
    this.lastGlobalReply = 0;
    this.near = [];                             // последние реплики «рядом»
    this.lastBy = new Map();                    // ник -> последний текст (флуд)
    this.count = { address: 0, near: 0, background: 0 };
  }

  mentioned(text) { return this.re.test(text) || BOT_WORD.test(text); }

  /**
   * m: { from, text, channel: 'global'|'local'|'whisper', dist (блоков или null), master (bool) }
   * Возвращает 'address' | 'near' | 'background' | 'drop'.
   */
  classify(m) {
    const now = Date.now();
    const t = String(m.text || '').trim();
    if (!t) return 'drop';
    // флуд: то же самое от того же игрока подряд
    if (this.lastBy.get(m.from) === t) return 'drop';
    this.lastBy.set(m.from, t);
    const near = m.dist !== null && m.dist !== undefined && m.dist <= NEAR_BLOCKS;
    const mention = this.mentioned(t);
    if (mention && m.channel === 'global') this.mentionedUntil = now + MENTION_MS;
    const inConvo = (this.convo.get(m.from) || 0) > now && (near || m.channel === 'whisper');
    let kind;
    if (m.channel === 'whisper') kind = 'address';
    else if (mention) kind = 'address';
    else if (this.mode === 'quiet') kind = near ? 'near' : 'background';
    else if (inConvo) kind = 'address';
    else if (m.master && m.dist !== null && m.dist <= MASTER_BLOCKS) kind = 'address';
    else if (m.channel === 'local' && (m.dist === null || m.dist <= LOCAL_ADDRESS_BLOCKS || this.mode === 'social')) kind = 'address';
    else if (m.channel === 'global' && this.mentionedUntil > now && /\?/.test(t)) kind = 'address';
    else if (near || m.channel === 'local') kind = 'near';
    else kind = AD.test(t) ? 'drop' : 'background';
    if (kind !== 'drop') this.count[kind]++;
    if (kind === 'near') {
      this.near.push(`${m.from}${m.channel === 'local' ? ' [рядом]' : ''}: ${t}`);
      if (this.near.length > 8) this.near.shift();
    }
    return kind;
  }

  /** Забрать накопленное «вокруг» (для приложения к обращению). */
  takeNear() { const n = this.near.splice(0); return n; }

  /** Бот ответил этим игрокам - открыть окно разговора. */
  answered(names) { const until = Date.now() + CONVO_MS; for (const n of names) if (n) this.convo.set(n, until); }

  /** Канал ответа: личка - туда же; ближний - ближний; общий - общий, но не чаще раза в 20 с (иначе ближний). */
  replyChannel(channels, to) {
    if (channels.includes('whisper') && to) return { channel: 'whisper', to };
    if (channels.includes('local')) return { channel: 'local' };
    if (channels.includes('global')) {
      if (Date.now() - this.lastGlobalReply < GLOBAL_REPLY_MS) return { channel: 'local' };
      this.lastGlobalReply = Date.now();
      return { channel: 'global' };
    }
    // сам заговорил (приказ из панели, событие, тишина): рядом есть люди - ближний; никого рядом - молчим в игре
    // (говорить в общий чат в пустоту выглядит как разговор с самим собой; в общий - только если Qwen решил явно)
    return this.someoneNear ? { channel: 'local' } : { channel: 'none' };
  }
}

module.exports = { Attention, aliasRegex };
