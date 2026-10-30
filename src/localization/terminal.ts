import claude from './claude.json';
import codex from './codex.json';
import type { PaneId } from '../../electron/contracts';

const tables: Partial<Record<PaneId, Record<string, string>>> = { claude, codex };
// Return undefined for complicated graphemes rather than guessing their width.
function width(text: string): number | undefined {
  let result = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) result++;
    else if ((cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60)) result += 2;
    else return undefined;
  }
  return result;
}
export function translateRun(id: PaneId, text: string): string {
  const match = text.match(/^( *)(.*?)( *)$/);
  if (!match || !/^[\x20-\x7e]+$/.test(match[2])) return text;
  const translated = tables[id]?.[match[2]];
  if (!translated) return text;
  const target = width(translated), original = match[2].length;
  if (target === undefined || target > original) return text;
  return match[1] + translated + ' '.repeat(original - target) + match[3];
}

// Parse control sequences across PTY chunks. Only whole printable runs are
// eligible; terminal controls and input are forwarded without modification.
export class TerminalLocalization {
  private state: 'text' | 'esc' | 'inter' | 'csi' | 'osc' | 'osc-esc' | 'string' | 'string-esc' = 'text';
  constructor(private id: PaneId) {}
  feed(chunk: string, enabled: boolean): string {
    let output = '', run = '';
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
    flush();
    return output;
  }
}
