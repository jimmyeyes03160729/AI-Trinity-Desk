import { createServer, createConnection } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

export const requiredIdleSeconds = 15 * 60;
export type IdleStatus = { state: 'idle' | 'busy' | 'unknown'; reason: string; idleForSeconds: number; userIdleSeconds?: number };

// IPC starts and the lock share one event loop. Queued async requests remain
// counted through settlement; no new work can enter after acquiring the lock.
export class IdleGate {
  private requests = 0;
  private locked = false;
  private idleSince: number | undefined;
  constructor(private blockers: () => { busy: string[]; unknown: string[] }, private now = () => performance.now()) {}
  touch() { this.idleSince = undefined; }
  async track<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.locked) throw new Error('正在安全重啟，暫不接受新工作。');
    this.requests++; this.touch();
    try { return await work(); } finally { this.requests--; this.touch(); }
  }
  status(): IdleStatus {
    const reasons = this.blockers();
    if (this.locked || this.requests || reasons.busy.length || reasons.unknown.length) {
      this.touch();
      return { state: reasons.unknown.length ? 'unknown' : 'busy', reason: this.locked ? '正在安全重啟' : this.requests ? '仍有操作或儲存尚未完成' : [...reasons.busy, ...reasons.unknown].join('；'), idleForSeconds: 0 };
    }
    this.idleSince ??= this.now();
    return { state: 'idle', reason: '沒有開啟中的 CLI、背景任務或未儲存草稿', idleForSeconds: Math.max(0, (this.now() - this.idleSince) / 1000) };
  }
  acquire(minimumSeconds = requiredIdleSeconds) {
    const status = this.status();
    if (status.state !== 'idle' || status.idleForSeconds < minimumSeconds) return false;
    this.locked = true; return true;
  }
  release() { this.locked = false; this.touch(); }
}

export async function startMaintenanceServer(options: { userData: string; status: () => Promise<IdleStatus>; restart: () => Promise<{ accepted: boolean; reason: string }> }) {
  const socketPath = path.join(options.userData, 'memory-guard.sock');
  if (Buffer.byteLength(socketPath) > 103) throw new Error('維護狀態路徑過長');
  const parent = await lstat(options.userData);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || (parent.mode & 0o022)) throw new Error('維護狀態目錄權限不符');
  const existing = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) {
    if (!existing.isSocket() || existing.uid !== process.getuid?.()) throw new Error('維護狀態路徑已被占用');
    const live = await new Promise<boolean>((resolve, reject) => {
      const client = createConnection(socketPath);
      client.setTimeout(500, () => { client.destroy(); reject(new Error('既有維護連線狀態不明')); });
      client.once('connect', () => { client.destroy(); resolve(true); });
      client.once('error', (error: NodeJS.ErrnoException) => ['ECONNREFUSED', 'ENOENT'].includes(error.code || '') ? resolve(false) : reject(error));
    });
    if (live) throw new Error('已有維護狀態服務');
    await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  const instance = randomUUID();
  const identity = { protocol: 1, instance, pid: process.pid };
  let restarting = false;
  const server = createServer(socket => {
    socket.setTimeout(5000, () => socket.destroy());
    let buffer = ''; let handled = false;
    socket.on('error', () => {});
    socket.on('data', data => {
      if (handled) return;
      buffer += data.toString('utf8');
      if (Buffer.byteLength(buffer) > 2048) { handled = true; socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      handled = true;
      void (async () => {
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as Record<string, unknown>;
        if (!request || typeof request !== 'object') throw new Error('請求格式不符');
        if (request.op === 'status') return { ...identity, ...(await options.status()), observedAt: Date.now() / 1000 };
        if (request.op !== 'restart' || request.instance !== instance || request.pid !== process.pid) throw new Error('維護工作階段不符');
        if (restarting) return { ...identity, accepted: false, reason: '已在處理重啟' };
        restarting = true;
        try { const result = await options.restart(); if (!result.accepted) restarting = false; return { ...identity, ...result }; }
        catch (error) { restarting = false; throw error; }
      })().then(result => socket.end(JSON.stringify(result) + '\n')).catch(() => socket.end(JSON.stringify({ ...identity, accepted: false, state: 'unknown', reason: '無法確認維護狀態' }) + '\n'));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); }); });
  await chmod(socketPath, 0o600);
  server.on('error', () => {});
  return { socketPath, instance, close: async () => { server.close(); await unlink(socketPath).catch(() => {}); } };
}
