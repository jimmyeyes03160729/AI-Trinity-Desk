import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, stat, utimes, writeFile, readdir } from 'node:fs/promises';
import { imageExtension, pruneUploads, saveUpload, maxUploadBytes } from '../electron/uploads';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
test('image type comes from the file signature, not the declared type', () => {
  assert.equal(imageExtension(png), 'png');
  assert.equal(imageExtension(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageExtension(new TextEncoder().encode('GIF89a....')), 'gif');
  assert.equal(imageExtension(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageExtension(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined);
  assert.equal(imageExtension(new TextEncoder().encode('#!/bin/sh\nrm -rf /')), undefined);
});
test('uploads are saved privately with a generated name and limits are enforced', async () => {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'trinity-upload-')), 'uploads');
  const file = await saveUpload(dir, png);
  assert.equal(path.dirname(file), dir);
  assert.match(path.basename(file), /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.png$/);
  assert.deepEqual(new Uint8Array(await readFile(file)), png);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o077, 0);
  await assert.rejects(saveUpload(dir, new Uint8Array()), /空/);
  await assert.rejects(saveUpload(dir, new TextEncoder().encode('not an image')), /只支援/);
  const big = new Uint8Array(maxUploadBytes + 1); big.set(png);
  await assert.rejects(saveUpload(dir, big), /20 MB/);
});
test('old uploads are pruned and unrelated files are left alone', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trinity-prune-'));
  const old = await saveUpload(dir, png), fresh = await saveUpload(dir, png);
  const other = path.join(dir, 'notes.txt'); await writeFile(other, 'keep');
  const past = new Date(Date.now() - 30 * 86400000);
  await utimes(old, past, past); await utimes(other, past, past);
  await pruneUploads(dir);
  assert.deepEqual((await readdir(dir)).sort(), [path.basename(fresh), 'notes.txt'].sort());
});
