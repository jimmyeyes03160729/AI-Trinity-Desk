import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Images sent from a browser or the desktop window are saved on this machine
// and their path is typed into the CLI, which reads the file itself. The
// folder sits outside any project so uploads never end up in a repository.
export const maxUploadBytes = 20 * 1024 * 1024;
const keepDays = 14;
export const uploadDir = (home: string) => path.join(home, '.ai-trinity-desk', 'uploads');

// The declared type is ignored; only these file signatures are accepted.
export function imageExtension(bytes: Uint8Array) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  return undefined;
}

export async function saveUpload(dir: string, bytes: Uint8Array) {
  if (!bytes.length) throw new Error('圖片是空的。');
  if (bytes.length > maxUploadBytes) throw new Error('圖片超過 20 MB 上限。');
  const extension = imageExtension(bytes);
  if (!extension) throw new Error('只支援 PNG、JPEG、GIF 與 WebP 圖片。');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}-${randomUUID().slice(0, 8)}.${extension}`);
  await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
  return file;
}

// Old uploads are removed so the folder does not grow without bound.
export async function pruneUploads(dir: string, now = Date.now()) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(png|jpg|gif|webp)$/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const info = await stat(file).catch(() => undefined);
    if (info && now - info.mtimeMs > keepDays * 86400000) await rm(file, { force: true });
  }
}
