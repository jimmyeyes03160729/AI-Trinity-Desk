import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSettings, settingsSchema, inputSchema, startSchema } from '../electron/contracts';
import { launchSpec, quotePowerShell, resolveExecutable } from '../electron/commands';
import { SettingsStore } from '../electron/settings';

test('untrusted IPC payloads, unknown panes, unbounded sizes and extra fields are rejected', () => {
  assert.equal(startSchema.safeParse({ id: 'other', cols: 80, rows: 24 }).success, false);
  assert.equal(startSchema.safeParse({ id: 'codex', cols: 1001, rows: 24 }).success, false);
  assert.equal(startSchema.safeParse({ id: 'codex', cols: 80, rows: 24, executable: 'evil' }).success, false);
  assert.equal(inputSchema.safeParse({ id: 'codex', session: 'wrong', data: 'x' }).success, false);
  assert.equal(inputSchema.safeParse({ id: 'codex', session: '32df07ba-ac8e-4522-8a3d-37d886dadb5f', data: 'x'.repeat(65537) }).success, false);
});
test('settings preserve valid arguments but reject invalid layouts and executable NUL', () => {
  const settings = defaultSettings(); settings.commands.codex.args = ['a b', "it's", '$HOME', '; echo test'];
  assert.deepEqual(settingsSchema.parse(settings), settings);
  assert.equal(settingsSchema.safeParse({ ...settings, sizes: [70,70,70] }).success, false);
  settings.commands.codex.executable = 'x\0y'; assert.equal(settingsSchema.safeParse(settings).success, false);
});
test('PowerShell shims quote literal arguments; executable programs bypass shell expansion', () => {
  assert.equal(quotePowerShell("it's $HOME;"), "'it''s $HOME;'");
  const args = ["a b", "it's", '$(bad)', '&bad'];
  const spec = launchSpec('C:\\Program Files\\demo.cmd', { executable: 'demo', args }, 'win32');
  const script = Buffer.from(spec.args.at(-1)!, 'base64').toString('utf16le');
  assert.ok(script.includes("& 'C:\\Program Files\\demo.cmd' 'a b' 'it''s' '$(bad)' '&bad'"));
  assert.deepEqual(launchSpec('/bin/demo', { executable: 'demo', args }, 'darwin'), { file: '/bin/demo', args });
});
test('resolver ignores current-directory and relative PATH entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trinity-resolution-'));
  await writeFile(path.join(dir, 'example.cmd'), '@echo hi');
  assert.equal(await resolveExecutable('.\\example.cmd', { PATH: dir }, 'win32'), null);
  assert.equal(await resolveExecutable('example', { PATH: '.' }, 'win32'), null);
  if (process.platform === 'win32') assert.equal(await resolveExecutable('example', { Path: dir }, 'win32'), path.join(dir,'example.cmd'));
  assert.equal(await resolveExecutable(process.execPath, process.env), process.execPath);
});
test('settings writes are serialized, survive reload, and corruption is preserved until an explicit save', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'trinity-store-'));
  const filename = path.join(dir,'settings.json'); const store = new SettingsStore(filename);
  assert.deepEqual((await store.load()).settings, defaultSettings());
  const first = { ...defaultSettings(), fontSize: 16 }; const second = { ...defaultSettings(), fontSize: 18 };
  await Promise.all([store.save(first), store.save(second)]);
  assert.equal((await new SettingsStore(filename).load()).settings.fontSize,18);
  await writeFile(filename, '{invalid');
  const result = await store.load(); assert.ok(result.warning); assert.deepEqual(result.settings, defaultSettings());
  assert.equal(await readFile(filename,'utf8'),'{invalid');
});
