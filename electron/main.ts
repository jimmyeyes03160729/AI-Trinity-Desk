import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
import {CliTasks,CliTaskStore} from './cli-tasks';
import {cliTaskCreateSchema,cliTaskPatchSchema,cliTaskStartSchema,cliTaskInputSchema,cliTaskResizeSchema,cliTaskAckSchema} from './contracts';
import { resolveExecutable, terminalEnvironment } from './commands';
import { ackSchema, inputSchema, paneIds, paneIdSchema, resizeSchema, settingsSchema, startSchema, discussionSchema, continueDiscussionSchema, skillEnrichSchema, type DiscussionState, type Result, type Settings } from './contracts';

if (!app.isPackaged && process.env.TRINITY_TEST_USER_DATA) app.setPath('userData', process.env.TRINITY_TEST_USER_DATA);
let win: BrowserWindow | null = null;
let sessions: Sessions;
let installers: InstallerManager;
let settings: Settings;
let closing = false;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('AI Trinity Desk 啟動失敗', String(error)); app.quit(); });
}

async function boot() {
  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const loaded = await store.load();
  settings = loaded.settings;
  const env = await terminalEnvironment();
  const managedRoot=path.join(app.getPath('userData'),'clis');
  const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH')||'PATH';
  env[pathKey]=(env[pathKey]||'')+(process.platform==='win32'?';':':')+path.join(managedRoot,'bin');
  const providerReader=new ProviderReader(()=>settings,env,app.getPath('userData'));
  const skillMarket=new SkillMarket(()=>settings.projectPath,path.join(app.getPath('userData'),'market-cache.json'),systemFetch);
  const skillSummaries=new SkillSummaries(id=>skillMarket.lookup(id),skill=>skillMarket.update(skill),()=>settings,createDiscussionRunner(app.getPath('userData'),env),systemFetch,path.join(app.getPath('userData'),'skill-summaries.json'));
  skillMarket.setSummaryLoader(ids=>skillSummaries.prime(ids));
  const skillInstaller=new SkillInstaller(id=>skillMarket.lookup(id),skillRoots(app.getPath('home')),path.join(app.getPath('userData'),'skill-installations.json'),limitedSystemFetch(64*1024*1024),states=>{if(win&&!win.isDestroyed())win.webContents.send('skill-install:event',states);});
  const discussionStore=new DiscussionStore(path.join(app.getPath('userData'),'discussions','latest.json'));
  let restoredDiscussion:DiscussionState|undefined;
  try{restoredDiscussion=await discussionStore.load();}catch(error){restoredDiscussion={status:'idle',messages:[],updatedAt:new Date().toISOString(),storageError:error instanceof Error?error.message:String(error)};}
  const discussions=new DiscussionManager(createDiscussionRunner(app.getPath('userData'),env),state=>{if(win&&!win.isDestroyed())win.webContents.send('discussion:event',state);},restoredDiscussion,state=>discussionStore.save(state));
  installers = new InstallerManager(() => settings,env,path.join(app.getPath('userData'),'installers'),states => {
    if (win && !win.isDestroyed()) win.webContents.send('installers:event',states);
  },process.platform,{
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
  let cliTasks:CliTasks;
  const taskStore=new CliTaskStore(path.join(app.getPath('userData'),'cli-tasks','index.json'));
  try {
    const pty = require('node-pty') as typeof import('node-pty');
    sessions = new Sessions(pty.spawn, event => { if (win && !win.isDestroyed()) win.webContents.send('terminal:event', event); }, env);
    cliTasks=new CliTasks(taskStore,path.join(app.getPath('userData'),'cli-tasks'),pty.spawn,env,()=>settings,event=>{if(win&&!win.isDestroyed())win.webContents.send('terminal:event',event);},state=>{if(win&&!win.isDestroyed())win.webContents.send('tasks:event',state);});
  } catch (error) { nativeError = 'PTY 元件無法載入。請重新安裝應用程式；開發環境請執行 npm run postinstall。' + String(error); }
  const devURL = !app.isPackaged && process.env.TRINITY_DEV_URL === 'http://127.0.0.1:5173' ? process.env.TRINITY_DEV_URL : undefined;
  const trustedURL = devURL ? devURL + '/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  function authorized(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
    return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === trustedURL;
  }
  function handle<T>(channel: string, fn: (value: unknown) => T | Promise<T>) {
    ipcMain.handle(channel, async (event, value): Promise<Result<T>> => {
      try { if (!authorized(event)) throw new Error('拒絕未授權的請求。'); return { ok: true, value: await fn(value) }; }
      catch (error) { return { ok: false, error: error instanceof z.ZodError ? '輸入格式不符：' + error.issues.map(i => i.message).join('；') : error instanceof Error ? error.message : String(error) }; }
    });
  }
  const native = () => { if (!sessions) throw new Error(nativeError || 'PTY 尚未就緒。'); return sessions; };
  const tasks=()=>{if(!cliTasks)throw new Error(nativeError||'任務終端尚未就緒。');return cliTasks;};
  handle('tasks:list',()=>tasks().list());
  handle('tasks:create',value=>tasks().create(cliTaskCreateSchema.parse(value)));
  handle('tasks:patch',value=>tasks().patch(cliTaskPatchSchema.parse(value)));
  handle('tasks:select',value=>tasks().select(z.string().uuid().parse(value)));
  handle('tasks:bind',value=>{const v=z.object({id:z.string().uuid(),nativeSessionId:z.string().uuid()}).strict().parse(value);return tasks().bind(v.id,v.nativeSessionId);});
  handle('tasks:start',value=>{const v=cliTaskStartSchema.parse(value);if(installers.active)throw new Error('請先完成或取消 CLI 安裝。');return tasks().start(v.taskId,v.cols,v.rows);});
  handle('tasks:stop',async value=>{await tasks().stop(z.string().uuid().parse(value));return null;});
  handle('tasks:input',value=>{const v=cliTaskInputSchema.parse(value);tasks().input(v.taskId,v.session,v.data);return null;});
  handle('tasks:resize',value=>{const v=cliTaskResizeSchema.parse(value);tasks().resize(v.taskId,v.session,v.cols,v.rows);return null;});
  ipcMain.on('tasks:ack',(event,value)=>{if(!authorized(event))return;const v=cliTaskAckSchema.safeParse(value);if(v.success)cliTasks?.ack(v.data.taskId,v.data.session,v.data.bytes);});
  handle('settings:load', () => ({ settings, warning: [loaded.warning, nativeError].filter(Boolean).join('\n') || undefined }));
  handle('settings:save', async value => {
    const next = settingsSchema.parse(value);
    if (next.projectPath !== settings.projectPath) throw new Error('專案路徑只能透過「選擇專案」變更。');
    if (installers.active && JSON.stringify(next.commands) !== JSON.stringify(settings.commands)) throw new Error('請先完成或取消 CLI 安裝，再變更啟動命令。');
    settings = await store.save(next); return settings;
  });
  handle('project:choose', async () => {
    if (sessions?.active) throw new Error('請先停止所有終端，再切換專案。');
    const result = await dialog.showOpenDialog(win!, { title: '選擇三個 CLI 使用的專案資料夾', properties: ['openDirectory'], defaultPath: settings.projectPath || app.getPath('documents') });
    if (result.canceled || !result.filePaths[0]) return null;
    if (sessions?.active) throw new Error('終端已啟動，請先停止所有終端。');
    settings = await store.save({ ...settings, projectPath: result.filePaths[0] });
    return settings.projectPath;
  });
  handle('environment:detect', async () => ({
    platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron,
    shell: process.platform === 'win32' ? 'Windows ConPTY / PowerShell shim' : (env.SHELL || '/bin/zsh'),
    results: await Promise.all(paneIds.map(async id => {
      const resolved = await resolveExecutable(settings.commands[id].executable, env);
      return { id, available: !!resolved, path: resolved || undefined, message: resolved ? '已找到執行檔（尚未驗證登入與服務連線）' : '找不到執行檔，請安裝 CLI 或指定完整路徑。' };
    }))
  }));
  handle('installers:state', () => installers.snapshot);
  handle('provider:info',value=>providerReader.read(paneIdSchema.parse(value)));
  handle('market:list',async value=>{const result=await skillMarket.get(value);await skillInstaller.scan(result.skills);return result;});
  handle('market:open',async value=>{await shell.openExternal(skillMarket.link(value));return null;});
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
  handle('terminal:start', value => {
    const v = startSchema.parse(value);
    const state = installers.snapshot.find(s=>s.id===v.id)!;
    if (['queued','checking','downloading','installing'].includes(state.status)) throw new Error('CLI 正在安裝，請完成後再啟動。');
    return native().start(v.id, settings, v.cols, v.rows);
  });
  handle('terminal:stop', async value => { await native().stop(paneIdSchema.parse(value)); return null; });
  handle('terminal:input', value => { const v = inputSchema.parse(value); native().write(v.id, v.session, v.data); return null; });
  handle('terminal:resize', value => { const v = resizeSchema.parse(value); native().resize(v.id, v.session, v.cols, v.rows); return null; });
  ipcMain.on('terminal:ack', (event, value) => { if (!authorized(event)) return; const result = ackSchema.safeParse(value); if (result.success) { const v = result.data; sessions?.ack(v.id, v.session, v.bytes); } });
  handle('clipboard:read', async () => (await clipboard.readText()).slice(0, 1024 * 1024));
  handle('clipboard:write', async value => { await clipboard.writeText(z.string().max(1024 * 1024).parse(value)); return null; });

  function createWindow() {
    win = new BrowserWindow({ width: 1500, height: 920, minWidth: 950, minHeight: 650, backgroundColor: '#0c1017', title: 'AI Trinity Desk', show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.on('render-process-gone', () => { void sessions?.stopAll().catch(() => {});void cliTasks?.shutdown().catch(()=>{});void discussions.stop();void skillInstaller.shutdown();void skillSummaries.shutdown(); for (const id of paneIds) void installers.cancel(id); });
    win.once('ready-to-show', () => win?.show());
    win.on('close', event => {
      if(closing)return;
      if(!sessions?.active&&!cliTasks?.active&&!installers.active&&!discussions.active&&!skillInstaller.active&&!skillSummaries.active){event.preventDefault();if(quitting)return;quitting=true;void Promise.all([discussions.flush(),taskStore.flush().catch(()=>{})]).then(()=>{closing=true;win?.close();});return;}
      event.preventDefault();
      if (quitting) return;
      const choice = dialog.showMessageBoxSync(win!, { type: 'question', buttons: ['繼續工作', '停止全部並關閉'], defaultId: 0, cancelId: 0, message: '仍有終端、討論、翻譯或安裝正在執行', detail: '關閉會停止討論與翻譯、取消安裝並停止終端與其子程序。請先確認 CLI 工作已儲存。' });
      if (choice === 1) { quitting = true; void Promise.all([sessions?.stopAll(),cliTasks?.shutdown(),installers.shutdown(),discussions.stop(),skillInstaller.shutdown(),skillSummaries.shutdown()]).then(() => { closing = true; win?.close(); }).catch(error => { quitting = false; dialog.showErrorBox('停止失敗', String(error)); }); }
    });
    win.on('closed', () => { win = null; });
    if (devURL) void win.loadURL(trustedURL); else void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' as const }, { role: 'quit' as const }] }] : []),
    { label: '編輯', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '檢視', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  createWindow();
  app.on('activate', () => { if (!win) { closing = false; quitting = false; installers.reopen(); createWindow(); } });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
