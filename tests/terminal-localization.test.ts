import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalLocalization, translateRun } from '../src/localization/terminal';
import table from '../src/localization/codex.json';

test('localized output preserves control sequences, cell widths and unknown text', () => {
  const pair = Object.entries(table).find(([en, zh]) => /^[a-z ]+$/i.test(en) && translateRun('codex', en) !== en && zh !== en);
  assert.ok(pair);
  const [en] = pair, translated = translateRun('codex', en);
  const width = (s: string) => [...s].reduce((n, c) => n + (c.codePointAt(0)! > 0xff ? 2 : 1), 0);
  assert.equal(width(translated), en.length);
  const stream = new TerminalLocalization('codex');
  assert.equal(stream.feed('\x1b[3', true) + stream.feed('1m' + en + '\x1b[0m', true), '\x1b[31m' + translated + '\x1b[0m');
  assert.equal(stream.feed('\x1b]0;', true) + stream.feed(en + '\x07', true), '\x1b]0;' + en + '\x07');
  assert.equal(stream.feed(en, false), en);
  assert.equal(stream.feed('user code `not-a-ui-phrase`', true), 'user code `not-a-ui-phrase`');
  assert.equal(translateRun('antigravity', en), en);
});

test('Codex prompt and status lines translate within longer terminal runs', () => {
  const examples: [string, string][] = [
    ['› Ask Codex to do anything', '詢問 Codex 任務'],
    ['? for shortcuts   100% context left', '快捷鍵'],
    ['model: gpt-example', '模型：'],
    ['directory: C:\\example', '目錄：'],
    ['• Working… · esc to interrupt', '工作中']
  ];
  for (const [source, expected] of examples) assert.ok(translateRun('codex', source).includes(expected), source);
  assert.equal(translateRun('codex', 'echo `model: gpt-example`'), 'echo `model: gpt-example`');
  const stream = new TerminalLocalization('codex');
  assert.equal(stream.feed('› Ask Cod', true) + stream.feed('ex to do anything\r\n', true), translateRun('codex', '› Ask Codex to do anything') + '\r\n');
});

test('Claude status fragments next to symbols and counters are localized without changing terminal width', () => {
  const examples: [string, string[]][] = [
    ['▶▶ auto mode on (shift+tab to cycle) · esc to interrupt', ['自動模式', '切換', '中斷']],
    ['✻ Spinning… (9s · ↓ 247 tokens)', ['處理中']],
    ['  (ctrl+b to run in background)', ['背景執行']]
  ];
  for (const [source, expected] of examples) {
    const out = translateRun('claude', source);
    for (const word of expected) assert.ok(out.includes(word), `${source}: ${word}`);
    const cells = (text: string) => [...text].reduce((n, ch) => n + (/\p{Script=Han}/u.test(ch) ? 2 : 1), 0);
    assert.equal(cells(out), cells(source));
  }
  const stream = new TerminalLocalization('claude');
  const frame = '\x1b[33m▶▶ auto mode on\x1b[0m (shift+tab to cycle) · esc to interrupt\r\n';
  const output = stream.feed(frame, true);
  assert.match(output, /自動模式/); assert.match(output, /切換/); assert.match(output, /中斷/);
  assert.ok(output.startsWith('\x1b[33m')); assert.ok(output.includes('\x1b[0m'));
  assert.equal(translateRun('claude', '`auto mode on`'), '`auto mode on`');
  assert.equal(translateRun('claude', 'git --auto mode on'), 'git --auto mode on');
  assert.equal(translateRun('claude', 'my-auto mode one'), 'my-auto mode one');
  const split = new TerminalLocalization('claude');
  assert.equal(split.feed('▶▶ auto mo', true) + split.feed('de on\r\n', true), translateRun('claude', '▶▶ auto mode on') + '\r\n');
  assert.equal(split.feed('Spinn', true), '');
  assert.equal(split.drain(), 'Spinn');
});
