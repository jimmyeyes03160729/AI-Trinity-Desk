import path from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { SettingsStore } from './settings';
import { Sessions } from './sessions';
import { InstallerManager, downloadInstaller, runInstaller } from './installers';
import { systemFetch,limitedSystemFetch } from './network';
import { startDownloadBridge } from './download-bridge';
import { installNativePackage } from './native-packages';
import { ProviderReader } from './provider-info';
import {DiscussionManager,createDiscussionRunner} from './discussion';
import {DiscussionStore} from './discussion-store';
import {SkillMarket} from './skill-market';
import {SkillSummaries} from './skill-summary';
import {SkillInstaller,skillRoots} from './skill-install';
import { resolveExecutable, terminalEnvironment } from './commands';
import { ackSchema, inputSchema, paneIds, paneIdSchema, resizeSchema, settingsSchema, startSchema, discussionSchema, continueDiscussionSchema, skillEnrichSchema, type DiscussionState, type PaneId, type Result, type Settings, type TerminalEvent, type TerminalAttach } from './contracts';

// Everything except the window, dialogs and OS integrations lives here so the
// Electron app and the web server expose exactly the same channels.
export type BackendHost = {
  userData: string;
  home: string;
  runtime: string;
  emit: (channel: string, payload: unknown) => void;
  // The web server has no renderer able to apply backpressure per client.
  autoAck?: boolean;
};
export type Handler = (value: unknown) => unknown;

// Keeps the recent output of each running terminal so a reloaded page or a
// second device can attach to it instead of seeing an idle pane.
const historyLimit = 512 * 1024;
type History = { session: string; pid?: number; data: string };
export class TerminalHistory {
  private items = new Map<string, History>();
  private ended = new Set<string>();
  record(event: TerminalEvent) {
    const key = event.id;
    if (event.type === 'exit') { if (this.items.get(key)?.session === event.session) this.items.delete(key); this.ended.add(event.session); if (this.ended.size > 256) this.ended.delete(this.ended.values().next().value!); return; }
    if (event.type !== 'data' || this.ended.has(event.session)) return;
    let item = this.items.get(key);
    if (!item || item.session !== event.session) { item = { session: event.session, data: '' }; this.items.set(key, item); }
    item.data += event.data;
    if (item.data.length > historyLimit * 1.25) {
      // Prefer cutting at a line break so replay does not start mid-sequence.
      const cut = item.data.length - historyLimit, line = item.data.indexOf('\n', cut);
      item.data = item.data.slice(line >= 0 && line - cut < 4096 ? line + 1 : cut);
    }
  }
  started(id: string, session: string, pid: number) {
    if (this.ended.has(session)) return;
    const item = this.items.get(id);
    if (item?.session === session) item.pid = pid; else this.items.set(id, { session, pid, data: '' });
  }
  attach(id: string, active: boolean): TerminalAttach | null {
    const item = this.items.get(id);
    if (!item || !active || item.pid === undefined) return null;
    return { session: item.session, pid: item.pid, history: item.data };
  }
}

export async function createBackend(host: BackendHost) {
  const { userData } = host;
  const store = new SettingsStore(path.join(userData, 'settings.json'));
  const loaded = await store.load();
  let settings: Settings = loaded.settings;
  const env = await terminalEnvironment();
  const managedRoot=path.join(userData,'clis');
  const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH')||'PATH';
  env[pathKey]=(env[pathKey]||'')+(process.platform==='win32'?';':':')+path.join(managedRoot,'bin');
  const history = new TerminalHistory();
  let sessions: Sessions | undefined;
  const emitTerminal = (event: TerminalEvent) => {
    history.record(event);
    host.emit('terminal:event', event);
    if (host.autoAck && event.type === 'data') sessions?.ack(event.id, event.session, event.data.length);
  };
  const providerReader=new ProviderReader(()=>settings,env,userData);
  // In separate mode the market recommends for the first AI with a folder.
  const marketProject=()=>settings.projectMode==='separate'&&paneIds.map(id=>settings.projectPaths[id]).find(Boolean)||settings.projectPath;
  const skillMarket=new SkillMarket(marketProject,path.join(userData,'market-cache.json'),systemFetch);
  const skillSummaries=new SkillSummaries(id=>skillMarket.lookup(id),skill=>skillMarket.update(skill),()=>settings,createDiscussionRunner(userData,env),systemFetch,path.join(userData,'skill-summaries.json'));
  skillMarket.setSummaryLoader(ids=>skillSummaries.prime(ids));
  const skillInstaller=new SkillInstaller(id=>skillMarket.lookup(id),skillRoots(host.home),path.join(userData,'skill-installations.json'),limitedSystemFetch(64*1024*1024),states=>host.emit('skill-install:event',states));
  const discussionStore=new DiscussionStore(path.join(userData,'discussions','latest.json'));
  let restoredDiscussion:DiscussionState|undefined;
  try{restoredDiscussion=await discussionStore.load();}catch(error){restoredDiscussion={status:'idle',messages:[],updatedAt:new Date().toISOString(),storageError:error instanceof Error?error.message:String(error)};}
  const discussions=new DiscussionManager(createDiscussionRunner(userData,env),state=>host.emit('discussion:event',state),restoredDiscussion,state=>discussionStore.save(state));
  const installers = new InstallerManager(() => settings,env,path.join(userData,'installers'),states => host.emit('installers:event',states),process.platform,{
    download:(url,signal)=>downloadInstaller(url,signal,systemFetch),
    native:async(id,environment,signal,log)=>{
      const bridge=await startDownloadBridge(log);
      try{return await installNativePackage(id,managedRoot,{...environment,...bridge.env},signal,log,systemFetch);}
      finally{await bridge.close();}
    },
    run:async(script,environment,signal,log,platform)=>{
      if(platform!=='win32')return runInstaller(script,environment,signal,log,platform);
      const bridge=await startDownloadBridge(log);
      try {await runInstaller(script,{...environment,...bridge.env},signal,log,platform);}
      finally {await bridge.close();}
    }
  });
  // Failure to load a native addon is a readable UI error, not a blank window.
  let nativeError: string | undefined;
  try {
    const pty = require('node-pty') as typeof import('node-pty');
    sessions = new Sessions(pty.spawn, emitTerminal, env);
  } catch (error) { nativeError = 'PTY 元件無法載入。請重新安裝應用程式；開發環境請執行 npm run postinstall。' + String(error); }
  const native = () => { if (!sessions) throw new Error(nativeError || 'PTY 尚未就緒。'); return sessions; };
  // A running CLI keeps its folder. The shared folder and the mode affect
  // every pane; a separate folder affects only its own pane.
  const checkProjectChange = (id?: PaneId) => {
    if (id ? sessions?.has(id) : sessions?.active) throw new Error(id ? '此 AI 的終端已啟動，請先停止再切換資料夾。' : '終端已啟動，請先停止所有終端。');
  };
  const handlers = new Map<string, Handler>();
  const notifications = new Map<string, (value: unknown) => void>();
  const handle = (channel: string, fn: Handler) => handlers.set(channel, fn);
  handle('settings:load', () => ({ settings, warning: [loaded.warning, nativeError].filter(Boolean).join('\n') || undefined }));
  handle('settings:save', async value => {
    const next = settingsSchema.parse(value);
    if (next.projectPath !== settings.projectPath || JSON.stringify(next.projectPaths) !== JSON.stringify(settings.projectPaths)) throw new Error('專案路徑只能透過「選擇專案」變更。');
    if (next.projectMode !== settings.projectMode) checkProjectChange();
    if (installers.active && JSON.stringify(next.commands) !== JSON.stringify(settings.commands)) throw new Error('請先完成或取消 CLI 安裝，再變更啟動命令。');
    settings = await store.save(next); return settings;
  });
  handle('environment:detect', async () => ({
    platform: process.platform, arch: process.arch, node: process.versions.node, electron: host.runtime,
    shell: process.platform === 'win32' ? 'Windows ConPTY / PowerShell shim' : (env.SHELL || '/bin/zsh'),
    results: await Promise.all(paneIds.map(async id => {
      const resolved = await resolveExecutable(settings.commands[id].executable, env);
      return { id, available: !!resolved, path: resolved || undefined, message: resolved ? '已找到執行檔（尚未驗證登入與服務連線）' : '找不到執行檔，請安裝 CLI 或指定完整路徑。' };
    }))
  }));
  handle('installers:state', () => installers.snapshot);
  handle('provider:info',value=>providerReader.read(paneIdSchema.parse(value)));
  handle('market:list',async value=>{const result=await skillMarket.get(value);await skillInstaller.scan(result.skills);return result;});
  handle('market:link',value=>skillMarket.link(value));
  handle('market:enrich',value=>{const request=skillEnrichSchema.parse(value);return skillSummaries.translate([...new Set(request.ids)],request.provider);});
  handle('market:cancel-translation',()=>{skillSummaries.cancel();return null;});
  handle('skill:install',value=>skillInstaller.install(value));
  handle('skill:installed',()=>skillInstaller.snapshot());
  handle('skill:cancel',value=>{skillInstaller.cancel(z.string().min(1).max(300).parse(value));return null;});
  handle('discussion:state',()=>discussions.snapshot);
  handle('discussion:start',value=>{
    const config=discussionSchema.parse(value);
    if(installers.active)throw new Error('請先完成或取消 CLI 安裝，再開始討論。');
    return discussions.start(config,settings);
  });
  handle('discussion:stop',()=>discussions.stop());
  handle('discussion:continue',value=>{
    if(installers.active)throw new Error('請先完成或取消 CLI 安裝，再接續討論。');
    return discussions.continue(continueDiscussionSchema.parse(value),settings);
  });
  handle('discussion:extend',value=>discussions.extend(value));
  handle('discussion:retry',value=>{
    if(installers.active)throw new Error('請先完成或取消 CLI 安裝，再重試回覆。');
    return discussions.retry(value,settings);
  });
  handle('installers:ensure', () => settings.autoInstallMissing ? installers.request(paneIds) : installers.snapshot);
  handle('installers:install', value => installers.request([paneIdSchema.parse(value)]));
  handle('installers:cancel', async value => { await installers.cancel(paneIdSchema.parse(value)); return null; });
  handle('terminal:start', async value => {
    const v = startSchema.parse(value);
    const state = installers.snapshot.find(s=>s.id===v.id)!;
    if (['queued','checking','downloading','installing'].includes(state.status)) throw new Error('CLI 正在安裝，請完成後再啟動。');
    const info = await native().start(v.id, settings, v.cols, v.rows);
    history.started(v.id, info.session, info.pid);
    return info;
  });
  handle('terminal:stop', async value => { await native().stop(paneIdSchema.parse(value)); return null; });
  handle('terminal:input', value => { const v = inputSchema.parse(value); native().write(v.id, v.session, v.data); return null; });
  handle('terminal:resize', value => { const v = resizeSchema.parse(value); native().resize(v.id, v.session, v.cols, v.rows); return null; });
  handle('terminal:attach', value => { const id = paneIdSchema.parse(value); const attached = history.attach(id, !!sessions?.has(id)); if (attached) sessions?.ack(id, attached.session, Number.MAX_SAFE_INTEGER); return attached; });
  notifications.set('terminal:ack', value => { const result = ackSchema.safeParse(value); if (result.success) { const v = result.data; sessions?.ack(v.id, v.session, v.bytes); } });

  async function invoke(channel: string, value: unknown): Promise<Result<unknown>> {
    const fn = handlers.get(channel);
    try { if (!fn) throw new Error('未知的請求。'); return { ok: true, value: await fn(value) }; }
    catch (error) { return { ok: false, error: error instanceof z.ZodError ? '輸入格式不符：' + error.issues.map(i => i.message).join('；') : error instanceof Error ? error.message : String(error) }; }
  }
  return {
    handlers, notifications, invoke, env,
    get settings() { return settings; },
    checkProjectChange,
    // Only the project picker may change the working folders.
    async setProject(folder: string, id?: PaneId) {
      checkProjectChange(id);
      if (!path.isAbsolute(folder) || !(await stat(folder).catch(() => undefined))?.isDirectory()) throw new Error('請選擇存在的資料夾。');
      settings = await store.save(id ? { ...settings, projectPaths: { ...settings.projectPaths, [id]: folder } } : { ...settings, projectPath: folder });
      return settings;
    },
    get busy() { return !!sessions?.active||installers.active||discussions.active||skillInstaller.active||skillSummaries.active; },
    flush: () => discussions.flush(),
    shutdown: () => Promise.all([sessions?.stopAll(),installers.shutdown(),discussions.stop(),skillInstaller.shutdown(),skillSummaries.shutdown()]),
    abort() { void sessions?.stopAll().catch(() => {});void discussions.stop();void skillInstaller.shutdown();void skillSummaries.shutdown(); for (const id of paneIds) void installers.cancel(id); },
    reopen: () => installers.reopen(),
    installersActive: () => installers.active
  };
}
export type Backend = Awaited<ReturnType<typeof createBackend>>;
