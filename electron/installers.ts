import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { paneIds, type PaneId, type Settings, type InstallState } from './contracts';
import { refreshCliPath, resolveExecutable } from './commands';
import { windowsBootstrap } from './windows-bootstrap';

export const cliCatalog = {
  claude: { command: 'claude', win: 'https://claude.ai/install.ps1', mac: 'https://claude.ai/install.sh' },
  antigravity: { command: 'agy', win: 'https://antigravity.google/cli/install.ps1', mac: 'https://antigravity.google/cli/install.sh' },
  codex: { command: 'codex', win: 'https://chatgpt.com/codex/install.ps1', mac: 'https://chatgpt.com/codex/install.sh' }
} as const;
type Platform = NodeJS.Platform;
type Run = (file: string, env: NodeJS.ProcessEnv, signal: AbortSignal, log: (text: string) => void, platform: Platform) => Promise<void>;
type Dependencies = {
  download: (url: string, signal: AbortSignal) => Promise<string>;
  run: Run;
  resolve: typeof resolveExecutable;
  native?: (id:PaneId,env:NodeJS.ProcessEnv,signal:AbortSignal,log:(message:string)=>void)=>Promise<string>;
};

export function validateInstallerUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['claude.ai','downloads.claude.ai','antigravity.google','chatgpt.com','releases.openai.com'].includes(url.hostname)) throw new Error('拒絕未列入官方清單的 HTTPS 安裝來源：'+url.origin);
  return url;
}
export async function downloadInstaller(initial: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<string> {
  for (let attempt=1;attempt<=3;attempt++) {
    signal.throwIfAborted();
    try { return await downloadInstallerOnce(initial,signal,transport); }
    catch(error) {
      if (signal.aborted || attempt===3 || !isTransientDownloadError(error)) throw error;
      await new Promise<void>((resolve,reject)=>{
        const cancel=()=>{clearTimeout(timer);reject(new Error('下載已取消。'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},attempt*1000);
        signal.addEventListener('abort',cancel,{once:true});
      });
    }
  }
  throw new Error('下載失敗。');
}
export function isTransientDownloadError(error:unknown) {
  const message=error instanceof Error?error.message:String(error);
  return /ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|fetch failed|timeout|逾時|HTTP (429|5\d\d)/i.test(message);
}
async function downloadInstallerOnce(initial: string, signal: AbortSignal, transport: typeof fetch): Promise<string> {
  let url = initial;
  for (let redirects = 0; redirects <= 5; redirects++) {
    validateInstallerUrl(url);
    const response = await transport(url, { redirect: 'manual', headers: { 'User-Agent': 'AI-Trinity-Desk/1.0.2', Accept: 'text/plain, application/octet-stream;q=0.9, */*;q=0.1' }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('安裝來源重新導向缺少位置。');
      url = new URL(location,url).href;
      if (new URL(url).hostname === 'claude.com' && new URL(url).pathname.includes('app-unavailable-in-region')) throw new Error('Claude 官方來源回傳地區限制頁面，請確認官方支援區域及網路。');
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`下載安裝程式失敗（HTTP ${response.status}）。`); }
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error('安裝腳本超過大小限制。'); parts.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const script = Buffer.concat(parts).toString('utf8');
    if (!script.trim() || /<!doctype\s+html|<html[\s>]/i.test(script.slice(0,1024))) throw new Error('官方來源未回傳有效安裝腳本，請稍後重試。');
    return script;
  }
  throw new Error('安裝來源重新導向次數過多。');
}

export function installerSpec(script: string, platform: Platform) {
  if (platform === 'win32') return { file: path.win32.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'), args: ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script] };
  if (platform === 'darwin') return { file: '/bin/bash', args: [script] };
  throw new Error('自動安裝目前支援 Windows 與 macOS。');
}
export const runInstaller: Run = async (script, environment, signal, log, platform) => {
  signal.throwIfAborted();
  let executableScript=script;
  if(platform==='win32'){
    executableScript=path.join(path.dirname(script),'trinity-bootstrap.ps1');
    await writeFile(executableScript,'\ufeff'+windowsBootstrap,{encoding:'utf8',mode:0o600});
  }
  const spec = installerSpec(executableScript,platform);
  if(platform==='win32')spec.args.push(script);
  const env = { ...environment, CODEX_NON_INTERACTIVE: '1', NO_COLOR: '1' };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  for (const key of ['CODEX_INSTALL_DAEMON_ONLY','CODEX_INSTALL_DEFER_SELECTION','CODEX_INSTALL_IF_LATEST','CODEX_INSTALL_IF_CURRENT','CODEX_UPDATE_FROM_RELEASE']) delete (env as NodeJS.ProcessEnv)[key];
  await new Promise<void>((resolve,reject) => {
    const child = spawn(spec.file,spec.args,{ cwd: path.dirname(script), env, windowsHide: true, detached: platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
    const out = new StringDecoder('utf8'), err = new StringDecoder('utf8');
    let timedOut = false;
    const kill = () => {
      if (!child.pid) return;
      if (platform === 'win32') execFile(path.win32.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/pid',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000},() => {});
      else { try { process.kill(-child.pid,'SIGKILL'); } catch { /* exited */ } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); },10 * 60 * 1000);
    signal.addEventListener('abort',kill,{once:true});
    if (signal.aborted) kill();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort',kill); };
    child.stdout.on('data',data => log(out.write(data))); child.stderr.on('data',data => log(err.write(data)));
    child.once('error',error => { cleanup(); reject(error); });
    child.once('close',code => {
      cleanup(); log(out.end()); log(err.end());
      if (signal.aborted) reject(new Error('安裝已取消。'));
      else if (timedOut) reject(new Error('安裝超過 10 分鐘，已停止。請檢查網路後重試。'));
      else if (code !== 0) reject(new Error(`安裝程式以代碼 ${code} 結束，請查看安裝紀錄。`));
      else resolve();
    });
  });
};

export class InstallerManager {
  private states: Record<PaneId,InstallState> = Object.fromEntries(paneIds.map(id=>[id,{id,status:'idle',message:'尚未檢查',log:''}])) as Record<PaneId,InstallState>;
  private jobs = new Map<PaneId,AbortController>();
  private queue: PaneId[] = [];
  private draining?: Promise<void>;
  private notification?: ReturnType<typeof setTimeout>;
  private closed = false;
  private deps: Dependencies;
  constructor(private settings: () => Settings, private env: NodeJS.ProcessEnv, private root: string, private emit: (states: InstallState[]) => void, private platform: Platform = process.platform, deps: Partial<Dependencies> = {}) {
    this.deps = { download: downloadInstaller, run: runInstaller, resolve: resolveExecutable, ...deps };
  }
  get snapshot() { return paneIds.map(id=>({...this.states[id]})); }
  get active() { return this.jobs.size > 0; }
  reopen() { if (!this.active) this.closed = false; }
  private update(id: PaneId, patch: Partial<InstallState>, immediate = true) {
    this.states[id] = { ...this.states[id], ...patch };
    if (immediate) this.emit(this.snapshot);
    else if (!this.notification) this.notification = setTimeout(()=>{ this.notification=undefined; this.emit(this.snapshot); },100);
  }
  request(ids: readonly PaneId[]) {
    if (this.closed) return this.snapshot;
    for (const id of ids) {
      if (this.jobs.has(id)) continue;
      if (this.settings().commands[id].executable !== cliCatalog[id].command) { this.update(id,{status:'custom',message:'自訂命令由你管理；改回官方命令可使用自動安裝。'}); continue; }
      this.jobs.set(id,new AbortController()); this.queue.push(id);
      this.update(id,{status:'queued',message:'等待檢查與安裝',log:'',path:undefined});
    }
    if (!this.draining && this.queue.length) {
      this.draining = this.drain().finally(()=>{this.draining=undefined;});
    }
    return this.snapshot;
  }
  async cancel(id: PaneId) {
    this.jobs.get(id)?.abort();
    if (this.states[id].status === 'queued') {
      this.queue = this.queue.filter(item=>item!==id); this.jobs.delete(id);
      this.update(id,{status:'cancelled',message:'安裝已取消，可按重試。'});
    }
  }
  async shutdown() {
    this.closed = true;
    for (const controller of this.jobs.values()) controller.abort();
    await this.draining;
    if (this.notification) clearTimeout(this.notification);
  }
  private async drain() {
    while (this.queue.length) {
      const id = this.queue.shift()!; const controller = this.jobs.get(id)!;
      try { await this.install(id,controller.signal); }
      catch (error) {
        const message=controller.signal.aborted?'安裝已取消，可按重試。':error instanceof Error?error.message:String(error);
        this.update(id,{status:controller.signal.aborted?'cancelled':'error',message,log:(this.states[id].log+'\n'+message+'\n').slice(-65536)});
      }
      finally {
        this.jobs.delete(id);
        try { await mkdir(this.root,{recursive:true}); await writeFile(path.join(this.root,id+'.log'),JSON.stringify(this.states[id],null,2),{encoding:'utf8',mode:0o600}); } catch { /* UI still retains the original installation result. */ }
      }
    }
  }
  private async install(id: PaneId, signal: AbortSignal) {
    signal.throwIfAborted();
    const command = cliCatalog[id].command;
    if (this.settings().commands[id].executable !== command) { this.update(id,{status:'custom',message:'命令設定已變更，略過自動安裝。'}); return; }
    refreshCliPath(this.env);
    this.update(id,{status:'checking',message:'檢查已安裝的 CLI'});
    const existing = await this.deps.resolve(command,this.env,this.platform);
    signal.throwIfAborted();
    if (existing) { this.update(id,{status:'ready',message:'已找到 CLI，略過安裝；可啟動並登入。',path:existing}); return; }
    if (!['win32','darwin'].includes(this.platform)) throw new Error('自動安裝目前支援 Windows 與 macOS。');
    if(this.platform==='win32'&&this.deps.native&&(id==='claude'||id==='codex')){
      this.update(id,{status:'installing',message:'正在下載並校驗官方原生 CLI 套件',source:'https://registry.npmjs.org',log:'官方原生 CLI 安裝\n'});
      const executable=await this.deps.native(id,this.env,signal,text=>this.update(id,{log:(this.states[id].log+text).slice(-65536)},false));
      signal.throwIfAborted();this.update(id,{status:'ready',message:'安裝及版本驗證完成，可啟動並登入。',path:executable});return;
    }
    const url = this.platform === 'win32' ? cliCatalog[id].win : cliCatalog[id].mac;
    this.update(id,{status:'downloading',message:'下載官方安裝程式（連線中斷會自動重試）',source:url,log:`官方來源：${url}\n`});
    const script = await this.deps.download(url,signal); signal.throwIfAborted();
    await mkdir(this.root,{recursive:true});
    const dir = await mkdtemp(path.join(this.root,id+'-'));
    const filename = path.join(dir,this.platform==='win32'?'install.ps1':'install.sh');
    await writeFile(filename,script,{encoding:'utf8',mode:0o600});
    const digest = createHash('sha256').update(script).digest('hex');
    this.update(id,{status:'installing',message:'正在安裝，下載 CLI 時可能暫無輸出',log:`官方來源：${url}\n腳本 SHA-256：${digest}\n`});
    await this.deps.run(filename,this.env,signal,text=>{if(text)this.update(id,{log:(this.states[id].log+text).slice(-65536)},false);},this.platform);
    signal.throwIfAborted(); refreshCliPath(this.env);
    const resolved = await this.deps.resolve(command,this.env,this.platform);
    signal.throwIfAborted();
    if (!resolved) throw new Error('安裝程式已結束，但尚未找到 CLI。請查看紀錄、重試或設定完整路徑。');
    this.update(id,{status:'ready',message:'安裝完成，可啟動 CLI 並登入。',path:resolved});
  }
}
