import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { IPty } from 'node-pty';
import { launchSpec, resolveExecutable } from './commands';
import { commandWithModel } from './models';
import type { PaneId, Settings, TerminalEvent, SessionInfo } from './contracts';

type Session = { pty: IPty; token: string; pending: number; paused: boolean; ended: Promise<void>; stopping?: Promise<void> };
export type SpawnPty = (file: string, args: string[], options: Parameters<typeof import('node-pty').spawn>[2]) => IPty;
export class Sessions {
  private sessions = new Map<PaneId, Session>();
  private starting = new Set<PaneId>();
  private shuttingDown = false;
  constructor(private spawn: SpawnPty, private emit: (event: TerminalEvent) => void, private env: NodeJS.ProcessEnv) {}
  get active() { return this.sessions.size > 0 || this.starting.size > 0; }
  has(id: PaneId) { return this.sessions.has(id); }
  async start(id: PaneId, settings: Settings, cols: number, rows: number): Promise<SessionInfo> {
    if (this.shuttingDown) throw new Error('所有終端正在停止，請稍後再試。');
    if (this.sessions.has(id) || this.starting.has(id)) throw new Error('此欄位已啟動，請先停止或使用重新啟動。');
    this.starting.add(id);
    try {
      if (!settings.projectPath || !(await stat(settings.projectPath)).isDirectory()) throw new Error('請先選擇有效的專案資料夾。');
      const command = commandWithModel(settings.commands[id],settings.models[id]);
      const executable = await resolveExecutable(command.executable, this.env);
      if (!executable) throw new Error(`尚未找到「${command.executable}」。請先在上方完成安裝，或在設定填入完整執行檔路徑。`);
      const spec = launchSpec(executable, command);
      const pty = this.spawn(spec.file, spec.args, { name: 'xterm-256color', cwd: settings.projectPath, cols, rows, env: this.env as Record<string,string> });
      const token = randomUUID();
      let finish!: () => void;
      const session: Session = { pty, token, pending: 0, paused: false, ended: new Promise(resolve => { finish = resolve; }) };
      this.sessions.set(id, session);
      pty.onData(data => {
        if (this.sessions.get(id) !== session) return;
        // Keep each IPC message bounded and pause native reads while xterm is
        // behind. Acknowledgements arrive after xterm has parsed the output.
        for (let offset = 0; offset < data.length; offset += 16384) {
          const chunk = data.slice(offset, offset + 16384);
          session.pending += chunk.length;
          this.emit({ id, session: token, type: 'data', data: chunk });
        }
        if (session.pending > 262144 && !session.paused) { session.paused = true; pty.pause(); }
      });
      pty.onExit(({ exitCode, signal }) => {
        if (this.sessions.get(id) === session) {
          this.sessions.delete(id);
          this.emit({ id, session: token, type: 'exit', exitCode, signal });
        }
        finish();
      });
      return { session: token, pid: pty.pid };
    } finally { this.starting.delete(id); }
  }
  write(id: PaneId, token: string, data: string) { const session = this.require(id, token); if (session.stopping) throw new Error('終端正在停止。'); session.pty.write(data); }
  resize(id: PaneId, token: string, cols: number, rows: number) { const session = this.require(id, token); if (!session.stopping) session.pty.resize(cols, rows); }
  ack(id: PaneId, token: string, count: number) {
    const session = this.sessions.get(id);
    if (!session || session.token !== token) return;
    session.pending = Math.max(0, session.pending - count);
    if (session.paused && session.pending < 65536) { session.paused = false; session.pty.resume(); }
  }
  private require(id: PaneId, token: string) {
    const session = this.sessions.get(id);
    if (!session || session.token !== token) throw new Error('終端工作階段已結束，請重新啟動。');
    return session;
  }
  async stop(id: PaneId): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.stopping) return session.stopping;
    session.stopping = this.kill(session);
    return session.stopping;
  }
  private async kill(session: Session) {
    if (session.paused) { session.paused = false; session.pty.resume(); }
    if (process.platform === 'win32') {
      await new Promise<void>(resolve => execFile(pathToTaskkill(), ['/pid', String(session.pty.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()));
      try { session.pty.kill(); } catch { /* already exited */ }
    } else {
      try { process.kill(-session.pty.pid, 'SIGTERM'); } catch { try { session.pty.kill(); } catch { /* already exited */ } }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([session.ended, new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]);
    if (timer) clearTimeout(timer);
    if ([...this.sessions.values()].includes(session)) {
      try { if (process.platform === 'win32') session.pty.kill(); else process.kill(-session.pty.pid, 'SIGKILL'); } catch { /* already exited */ }
      let finalTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([session.ended, new Promise<void>(resolve => { finalTimer = setTimeout(resolve, 1500); })]);
      if (finalTimer) clearTimeout(finalTimer);
      if ([...this.sessions.values()].includes(session)) throw new Error('無法確認終端已停止，請稍後再試。');
    }
  }
  async stopAll() {
    this.shuttingDown = true;
    try {
      while (this.starting.size) await new Promise(resolve => setTimeout(resolve, 20));
      await Promise.all([...this.sessions.keys()].map(id => this.stop(id)));
    } finally { this.shuttingDown = false; }
  }
}
function pathToTaskkill() { return (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\taskkill.exe'; }
