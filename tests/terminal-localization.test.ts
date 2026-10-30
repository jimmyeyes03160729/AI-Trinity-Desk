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
  assert.equal(stream.feed('\x1b[3', true) + stream.feed('1m' + en + '\x1b[0m', true) + stream.drain(), '\x1b[31m' + translated + '\x1b[0m');
  assert.equal(stream.feed('\x1b]0;', true) + stream.feed(en + '\x07', true), '\x1b]0;' + en + '\x07');
  assert.equal(stream.feed(en, false) + stream.drain(), en);
  assert.equal(stream.feed('user code `not-a-ui-phrase`', true) + stream.drain(), 'user code `not-a-ui-phrase`');
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
  const conpty = new TerminalLocalization('claude');
  assert.equal(conpty.feed('Dark\x1b[1Cmo', true) + conpty.feed('de\x1b[25;8H', true), '深色模式 \x1b[25;8H');
  assert.match(conpty.feed('▶▶\x1b[1Cauto\x1b[1Cmode\x1b[1Con\x1b[1C(shift+tab\x1b[1Cto\x1b[1Ccycle)\r\n', true), /自動模式.*切換/);
  assert.match(conpty.feed('\x1b[31mBlanching…\x1b[0m\r\n', true), /處理中/);
  assert.match(conpty.feed('✻\x1b[1CBlanching…\x1b[1C(6s · ↓ 298 tokens)\r\n', true), /處理中/);
  assert.match(conpty.feed('Reading\x1b[1CC:\\example\\document.md\r\n', true), /讀取/);
  assert.equal(translateRun('claude', 'The AI is Blanching… the vegetables'), 'The AI is Blanching… the vegetables');
  const unchanged = '\x1b[31munknown\x1b[3Ctext\x1b[0m\x1b[4;2Hnext\r\n';
  const pass = new TerminalLocalization('claude');
  let passed = '';
  for (const ch of unchanged) passed += pass.feed(ch, true);
  assert.equal(passed + pass.drain(), unchanged);
  const disabled = new TerminalLocalization('claude');
  let original = '';
  for (const ch of unchanged) original += disabled.feed(ch, false);
  assert.equal(original + disabled.drain(), unchanged);
  const styled = new TerminalLocalization('claude');
  const styledOutput = styled.feed('\x1b[33mauto\x1b[0m\x1b[1Cmode\x1b[1Con\r\n', true);
  assert.match(styledOutput, /自動模式/);
  assert.ok(styledOutput.includes('\x1b[33m') && styledOutput.includes('\x1b[0m'));
});
