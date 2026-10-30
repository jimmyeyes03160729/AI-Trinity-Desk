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
