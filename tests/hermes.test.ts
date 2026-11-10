import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { discussionArgs, parseDiscussionReply } from '../electron/discussion';
import { hermesWindows } from '../electron/provider-parsing';
import { skillRoots } from '../electron/skill-install';
import { InstallerManager, cliCatalog, validateInstallerUrl } from '../electron/installers';
import { defaultSettings, paneIds } from '../electron/contracts';

const line = (value: unknown) => JSON.stringify(value);
test('Hermes is the default agent and has an official installer', () => {
  assert.equal(paneIds[0], 'hermes');
  assert.equal(defaultSettings().agent, 'hermes');
  assert.deepEqual(defaultSettings().commands.hermes, { executable: 'hermes', args: [] });
  assert.equal(validateInstallerUrl(cliCatalog.hermes.mac).hostname, 'hermes-agent.nousresearch.com');
});
test('Hermes discussion turns read stdin, answer once and keep only the todo toolset', () => {
  const args = discussionArgs('hermes', '');
  assert.deepEqual(args.slice(0, 3), ['chat', '--query-file', '-']);
  for (const flag of ['--oneshot', '--format', 'stream-json', '--source', 'tool']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--toolsets') + 1], 'todo');
  assert.deepEqual(discussionArgs('hermes', 'anthropic/claude-sonnet-4.6').slice(-2), ['--model', 'anthropic/claude-sonnet-4.6']);
});
test('Hermes stream-json replies use the final result record and fail closed', () => {
  const ok = [line({ type: 'system', subtype: 'init', model: 'x', session_id: 's' }), line({ type: 'text', text: '部分' }), line({ type: 'result', exit_code: 0, text: '完整回覆\n[[TRINITY_OPEN]]' })].join('\n');
  assert.equal(parseDiscussionReply('hermes', ok), '完整回覆\n[[TRINITY_OPEN]]');
  assert.throws(() => parseDiscussionReply('hermes', line({ type: 'text', text: '只有片段' })), /完成訊號/);
  assert.throws(() => parseDiscussionReply('hermes', line({ type: 'result', exit_code: 1, text: '', error: 'rate limited' })), /rate limited/);
  assert.throws(() => parseDiscussionReply('hermes', line({ type: 'result', exit_code: 130, text: '' })), /130/);
});
test('hermes usage --json windows become percentages with reset times', () => {
  const windows = hermesWindows({ provider: 'openai-codex', plan: 'Plus', windows: [
    { label: 'Session', used_percent: 37, resets_at: '2026-09-19T21:00:00+00:00' },
    { label: 'Weekly', used_percent: null, resets_at: null },
    { label: 'Over', used_percent: 140, resets_at: 'not a date' }
  ] });
  assert.deepEqual(windows[0], { label: 'openai-codex · Plus · Session', usedPercent: 37, remainingPercent: 63, resetsAt: Date.parse('2026-09-19T21:00:00Z') / 1000 });
  assert.equal(windows.length, 2);
  assert.equal(windows[1].usedPercent, 100);
  assert.equal(windows[1].resetsAt, undefined);
  assert.deepEqual(hermesWindows({}), []);
});
test('Hermes skills install into ~/.hermes/skills', () => {
  assert.equal(skillRoots('/home/me').hermes, path.join('/home/me', '.hermes', 'skills'));
});
test('Hermes auto-install is not attempted on Windows', async () => {
  const manager = new InstallerManager(defaultSettings, {}, os.tmpdir(), () => {}, 'win32', { resolve: async () => null, download: async () => { throw new Error('should not download'); } });
  manager.request(['hermes']);
  while (manager.active) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(manager.snapshot[0].status, 'error');
  assert.match(manager.snapshot[0].message, /手動安裝/);
  await manager.shutdown();
});
