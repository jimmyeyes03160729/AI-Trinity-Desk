import claude from './claude.json';
import codex from './codex.json';
import type { PaneId } from '../../electron/contracts';

const tables: Partial<Record<PaneId, Record<string, string>>> = { claude, codex };
// These are stable UI fragments, not arbitrary dictionary substrings. They
// can appear next to icons, counters and other text in one terminal run.
const fragments: Partial<Record<PaneId, ReadonlyArray<readonly [string, string]>>> = {
  claude: [
    ['(ctrl+b to run in background)', '(Ctrl+B 背景執行)'],
    ['(shift+tab to cycle)', '(Shift+Tab 切換)'],
    ['esc to interrupt', 'Esc 中斷'],
    ['auto mode on', '自動模式'],
    ['Spinning…', '處理中…'],
    ['Spinning...', '處理中...']
  ],
  codex: [
    ['Ask Codex to do anything', '詢問 Codex 任務'],
    ['? for shortcuts', '? 快捷鍵'],
    ['100% context left', '剩餘上下文 100%'],
    ['Working…', '工作中…'],
    ['Thinking…', '思考中…'],
    ['esc to interrupt', 'Esc 中斷'],
    ['directory:', '目錄：'],
    ['model:', '模型：'],
    ['to change', '切換'],
    ['to continue', '繼續']
  ]
};
// Return undefined for complicated graphemes rather than guessing their width.
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
export function translateRun(id: PaneId, text: string): string {
  const match = text.match(/^( *)(.*?)( *)$/);
  if (!match) return text;
  // Preserve command and code-looking output, even if it matches a dictionary entry.
  if (/`|--|(?:^|\s)\/(?!\/)/.test(text)) return text;
  if (/^[\x20-\x7e]+$/.test(match[2])) {
    const translated = tables[id]?.[match[2]];
    if (translated) {
      const target = width(translated), original = match[2].length;
      if (target !== undefined && target <= original) return match[1] + translated + ' '.repeat(original - target) + match[3];
    }
  }
  // Never rewrite a command or code-looking run. Exact, reviewed UI fragments
  // are replaced only at word boundaries, preserving their display width.
  let output = text;
  for (const [english, chinese] of fragments[id] || []) {
    const originalWidth = width(english), translatedWidth = width(chinese);
    if (originalWidth === undefined || translatedWidth === undefined || translatedWidth > originalWidth) continue;
    let offset = 0;
    while (true) {
      const at = output.indexOf(english, offset);
      if (at < 0) break;
      const before = output[at - 1] || '', after = output[at + english.length] || '';
      if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) { offset = at + english.length; continue; }
      const replacement = chinese + ' '.repeat(originalWidth - translatedWidth);
      output = output.slice(0, at) + replacement + output.slice(at + english.length);
      offset = at + replacement.length;
    }
  }
  return output;
}

// Parse control sequences across PTY chunks. Only whole printable runs are
// eligible; terminal controls and input are forwarded without modification.
export class TerminalLocalization {
  private state: 'text' | 'esc' | 'inter' | 'csi' | 'osc' | 'osc-esc' | 'string' | 'string-esc' = 'text';
  private pending = '';
  constructor(private id: PaneId) {}
  drain(): string { const result = this.pending; this.pending = ''; return result; }
  feed(chunk: string, enabled: boolean): string {
    let output = '', run = this.pending;
    this.pending = '';
    const flush = () => { if (run) output += enabled ? translateRun(this.id, run) : run; run = ''; };
    for (const ch of chunk) {
      const cp = ch.codePointAt(0)!;
      if (this.state === 'text') {
        if (ch === '\x1b') { flush(); output += ch; this.state = 'esc'; }
        else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) { flush(); output += ch; }
        else run += ch;
        continue;
      }
      output += ch;
      switch (this.state) {
        case 'esc': this.state = ch === '[' ? 'csi' : ch === ']' ? 'osc' : ['P','X','^','_'].includes(ch) ? 'string' : cp >= 0x20 && cp <= 0x2f ? 'inter' : 'text'; break;
        case 'inter': this.state = 'text'; break;
        case 'csi': if (cp >= 0x40 && cp <= 0x7e) this.state = 'text'; break;
        case 'osc': if (ch === '\x07') this.state = 'text'; else if (ch === '\x1b') this.state = 'osc-esc'; break;
        case 'osc-esc': this.state = ch === '\\' || ch === '\x07' ? 'text' : ch === '\x1b' ? 'osc-esc' : 'osc'; break;
        case 'string': if (ch === '\x1b') this.state = 'string-esc'; break;
        case 'string-esc': this.state = ch === '\\' ? 'text' : ch === '\x1b' ? 'string-esc' : 'string'; break;
      }
    }
    // Hold only a suffix that could be the start of a known UI fragment.
    // The caller drains it promptly if no more terminal data arrives.
    if (enabled && this.state === 'text' && run) {
      let hold = 0;
      for (const [phrase] of fragments[this.id] || []) {
        for (let size = Math.min(run.length, phrase.length - 1); size > hold; size--) {
          if (phrase.startsWith(run.slice(-size))) { hold = size; break; }
        }
      }
      if (hold) { this.pending = run.slice(-hold); run = run.slice(0, -hold); }
    }
    flush();
    return output;
  }
}
