import claude from './claude.json';
import codex from './codex.json';
import type { PaneId } from '../../electron/contracts';

const tables: Partial<Record<PaneId, Record<string, string>>> = { claude, codex };
const fragments: Partial<Record<PaneId, ReadonlyArray<readonly [string, string]>>> = {
  claude: [
    ['(ctrl+b to run in background)', '(Ctrl+B 背景執行)'], ['(shift+tab to cycle)', '(Shift+Tab 切換)'],
    ['esc to interrupt', 'Esc 中斷'], ['auto mode on', '自動模式'], ['Spinning…', '處理中…'], ['Spinning...', '處理中...'],
    ['Dark mode', '深色模式'], ['Light mode', '淺色模式']
  ],
  codex: [
    ['Ask Codex to do anything', '詢問 Codex 任務'], ['? for shortcuts', '? 快捷鍵'], ['100% context left', '剩餘上下文 100%'],
    ['Working…', '工作中…'], ['Thinking…', '思考中…'], ['esc to interrupt', 'Esc 中斷'],
    ['directory:', '目錄：'], ['model:', '模型：'], ['to change', '切換'], ['to continue', '繼續']
  ]
};

// Only substitute text when its display width is known and cannot grow.
function width(text: string): number | undefined {
  let result = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || cp === 0x2026) result++;
    else if ((cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60)) result += 2;
    else return undefined;
  }
  return result;
}
type Edit = { start: number; end: number; replacement: string };
function edits(id: PaneId, text: string): Edit[] {
  if (/`|--|(?:^|\s)\/(?!\/)/.test(text)) return [];
  const found: Edit[] = [];
  const add = (start: number, english: string, chinese: string) => {
    const a = width(english), b = width(chinese), end = start + english.length;
    if (a === undefined || b === undefined || b > a || found.some(edit => start < edit.end && end > edit.start)) return;
    found.push({ start, end, replacement: chinese + ' '.repeat(a - b) });
  };
  const trimmed = text.trim();
  if (/^[\x20-\x7e]+$/.test(trimmed)) {
    const translation = tables[id]?.[trimmed];
    if (translation) add(text.indexOf(trimmed), trimmed, translation);
  }
  // Claude varies its spinner verb; recognize a standalone verb or one
  // immediately following a spinner glyph, without translating sentences.
  if (id === 'claude') {
    const reading = text.match(/^\s*Reading(?= +[A-Za-z]:\\)/);
    if (reading) add(reading[0].lastIndexOf('Reading'), 'Reading', '讀取');
    for (const match of text.matchAll(/[A-Z][a-z]{2,26}ing(?:…|\.\.\.)/g)) {
      const word = match[0], at = match.index;
      if (trimmed === word || /[✻✶✢✽*]\s{0,3}$/.test(text.slice(Math.max(0, at - 5), at))) add(at, word, word.endsWith('…') ? '處理中…' : '處理中...');
    }
  }
  for (const [english, chinese] of fragments[id] || []) {
    let offset = 0;
    while (true) {
      const at = text.indexOf(english, offset); if (at < 0) break;
      const before = text[at - 1] || '', after = text[at + english.length] || '';
      if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) add(at, english, chinese);
      offset = at + english.length;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
export function translateRun(id: PaneId, text: string): string {
  const changes = edits(id, text);
  let result = '', position = 0;
  for (const edit of changes) { result += text.slice(position, edit.start) + edit.replacement; position = edit.end; }
  return result + text.slice(position);
}

// Windows ConPTY often represents spaces as CSI n C (cursor forward). Treat
// those as visible spaces for matching, while keeping all unmatched bytes and
// preserving the total cell width of each replacement.
function translateSegment(id: PaneId, raw: string): string {
  type Token = { raw: string; start: number; end: number; style: boolean };
  const tokens: Token[] = []; let visible = '';
  const parts = raw.match(/\x1b\[(?:[0-9;:]*)m|\x1b\[\d*C|[^\x1b]/gu) || [];
  if (parts.join('') !== raw) return raw;
  for (const part of parts) {
    const start = visible.length;
    const cursor = part.match(/^\x1b\[(\d*)C$/);
    if (cursor) visible += ' '.repeat(Math.max(1, Number(cursor[1] || 1)));
    else if (!part.startsWith('\x1b')) visible += part;
    tokens.push({ raw: part, start, end: visible.length, style: part.startsWith('\x1b') && !cursor });
  }
  const boundaries = new Set(tokens.flatMap(token => [token.start, token.end]));
  const changes = edits(id, visible).filter(edit => boundaries.has(edit.start) && boundaries.has(edit.end));
  if (!changes.length) return raw;
  let output = '', index = 0;
  for (const edit of changes) {
    while (index < tokens.length && (tokens[index].end <= edit.start || (tokens[index].style && tokens[index].start === edit.start))) output += tokens[index++].raw;
    output += edit.replacement;
    while (index < tokens.length && tokens[index].start < edit.end) { if (tokens[index].style) output += tokens[index].raw; index++; }
  }
  return output + tokens.slice(index).map(token => token.raw).join('');
}

// Delay a short, bounded run to allow a phrase to span PTY chunks and safe
// SGR / cursor-forward sequences. All other controls terminate the run.
export class TerminalLocalization {
  private state: 'text' | 'esc' | 'inter' | 'csi' | 'osc' | 'osc-esc' | 'string' | 'string-esc' = 'text';
  private pending = '';
  private sequence = '';
  private enabled = false;
  constructor(private id: PaneId) {}
  drain(): string { const result = this.enabled ? translateSegment(this.id, this.pending) : this.pending; this.pending = ''; return result; }
  feed(chunk: string, enabled: boolean): string {
    this.enabled = enabled; let output = '';
    const flush = () => { output += this.drain(); };
    for (const ch of chunk) {
      const cp = ch.codePointAt(0)!;
      if (this.state === 'text') {
        if (ch === '\x1b') { this.sequence = ch; this.state = 'esc'; }
        else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) { flush(); output += ch; }
        else { this.pending += ch; if (this.pending.length > 4096) flush(); }
        continue;
      }
      if (this.state === 'esc' || this.state === 'inter' || this.state === 'csi') {
        this.sequence += ch;
        if (this.state === 'esc') {
          if (ch === '[') this.state = 'csi';
          else if (cp >= 0x20 && cp <= 0x2f) this.state = 'inter';
          else { flush(); output += this.sequence; this.sequence = ''; this.state = ch === ']' ? 'osc' : ['P','X','^','_'].includes(ch) ? 'string' : 'text'; }
        } else if (this.state === 'inter') { flush(); output += this.sequence; this.sequence = ''; this.state = 'text'; }
        else if (cp >= 0x40 && cp <= 0x7e) {
          const safe = /^\x1b\[[0-9;:]*m$/.test(this.sequence) || /^\x1b\[(?:\d{0,2})C$/.test(this.sequence);
          if (safe) { this.pending += this.sequence; if (this.pending.length > 4096) flush(); } else { flush(); output += this.sequence; }
          this.sequence = ''; this.state = 'text';
        }
        continue;
      }
      output += ch;
      if (this.state === 'osc') { if (ch === '\x07') this.state = 'text'; else if (ch === '\x1b') this.state = 'osc-esc'; }
      else if (this.state === 'osc-esc') this.state = ch === '\\' || ch === '\x07' ? 'text' : ch === '\x1b' ? 'osc-esc' : 'osc';
      else if (this.state === 'string') { if (ch === '\x1b') this.state = 'string-esc'; }
      else if (this.state === 'string-esc') this.state = ch === '\\' ? 'text' : ch === '\x1b' ? 'string-esc' : 'string';
    }
    return output;
  }
}
