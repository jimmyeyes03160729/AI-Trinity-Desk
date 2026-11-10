import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, powerMonitor } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IdleGate, requiredIdleSeconds, startMaintenanceServer } from './idle-maintenance';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createBackend, type Backend } from './backend';
import { paneIdSchema, projectFor, type PaneId, type Result } from './contracts';

const paneLabels: Record<PaneId, string> = { hermes: 'Hermes Agent', claude: 'Claude Code', antigravity: 'Antigravity CLI', codex: 'Codex CLI' };

if (!app.isPackaged && process.env.TRINITY_TEST_USER_DATA) app.setPath('userData', process.env.TRINITY_TEST_USER_DATA);
let win: BrowserWindow | null = null;
let backend: Backend;
let closing = false;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('AI Trinity Desk 啟動失敗', String(error)); app.quit(); });
}

async function boot() {
  backend = await createBackend({
    userData: app.getPath('userData'), home: app.getPath('home'), runtime: process.versions.electron,
    emit: (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
  });
  const devURL = !app.isPackaged && process.env.TRINITY_DEV_URL === 'http://127.0.0.1:5173' ? process.env.TRINITY_DEV_URL : undefined;
  const trustedURL = devURL ? devURL + '/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  function authorized(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
    return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === trustedURL;
  }
  let rendererState = { ready: false, blocked: true };
  const validState = (value: unknown): value is { ready: boolean; blocked: boolean } => !!value && typeof value === 'object' && typeof (value as { ready?: unknown }).ready === 'boolean' && typeof (value as { blocked?: unknown }).blocked === 'boolean';
  const gate = new IdleGate(() => ({ busy: [...backend.maintenanceBlockers, ...(rendererState.ready && rendererState.blocked ? ['仍有草稿、未完成操作或開啟中的設定面板'] : [])], unknown: !win || win.isDestroyed() || win.webContents.isLoading() || !rendererState.ready ? ['畫面狀態無法確認'] : [] }));
  ipcMain.on('maintenance:state', (event, value) => { if (authorized(event) && validState(value)) { rendererState = value; if (!value.ready || value.blocked) gate.touch(); } });
  ipcMain.on('maintenance:activity', event => { if (authorized(event)) gate.touch(); });
  const probe = (freeze: boolean) => new Promise<boolean>(resolve => {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) { rendererState = { ready: false, blocked: true }; gate.touch(); resolve(false); return; }
    const nonce = randomUUID();
    const timer = setTimeout(() => { ipcMain.removeListener('maintenance:probe-result', reply); rendererState = { ready: false, blocked: true }; gate.touch(); resolve(false); }, 1500);
    const reply = (event: Electron.IpcMainEvent, value: unknown) => {
      if (!authorized(event) || !validState(value) || (value as { nonce?: unknown }).nonce !== nonce) return;
      clearTimeout(timer); ipcMain.removeListener('maintenance:probe-result', reply); rendererState = value;
      if (!value.ready || value.blocked) gate.touch();
      resolve(value.ready && !value.blocked);
    };
    ipcMain.on('maintenance:probe-result', reply); win.webContents.send('maintenance:probe', { nonce, freeze });
  });
  const resume = () => { gate.release(); if (win && !win.isDestroyed()) win.webContents.send('maintenance:resume'); };
  function handle<T>(channel: string, fn: (value: unknown) => T | Promise<T>) {
    ipcMain.handle(channel, async (event, value): Promise<Result<T>> => {
      try { if (!authorized(event)) throw new Error('拒絕未授權的請求。'); return { ok: true, value: await gate.track(() => fn(value)) }; }
      catch (error) { return { ok: false, error: error instanceof z.ZodError ? '輸入格式不符：' + error.issues.map(i => i.message).join('；') : error instanceof Error ? error.message : String(error) }; }
    });
  }
  for (const [channel, fn] of backend.handlers) handle(channel, fn);
  for (const [channel, fn] of backend.notifications) ipcMain.on(channel, (event, value) => { if (authorized(event)) fn(value); });
  handle('project:choose', async value => {
    const id = paneIdSchema.optional().parse(value ?? undefined);
    backend.checkProjectChange(id);
    const current = id ? projectFor(backend.settings, id) || backend.settings.projectPath : backend.settings.projectPath;
    const result = await dialog.showOpenDialog(win!, { title: id ? `選擇 ${paneLabels[id]} 使用的專案資料夾` : '選擇三個 CLI 使用的專案資料夾', properties: ['openDirectory'], defaultPath: current || app.getPath('documents') });
    if (result.canceled || !result.filePaths[0]) return null;
    return backend.setProject(result.filePaths[0], id);
  });
  handle('market:open', async value => { await shell.openExternal(await backend.handlers.get('market:link')!(value) as string); return null; });
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
    win.webContents.on('render-process-gone', () => { rendererState = { ready: false, blocked: true }; gate.touch(); backend.abort(); });
    win.webContents.on('did-start-loading', () => { rendererState = { ready: false, blocked: true }; gate.touch(); });
    win.on('focus', () => gate.touch());
    win.once('ready-to-show', () => win?.show());
    win.on('close', event => {
      if(closing)return;
      if(!backend.busy){event.preventDefault();if(quitting)return;quitting=true;void backend.flush().then(()=>{closing=true;win?.close();});return;}
      event.preventDefault();
      if (quitting) return;
      const choice = dialog.showMessageBoxSync(win!, { type: 'question', buttons: ['繼續工作', '停止全部並關閉'], defaultId: 0, cancelId: 0, message: '仍有終端、討論、翻譯或安裝正在執行', detail: '關閉會停止討論與翻譯、取消安裝並停止終端與其子程序。請先確認 CLI 工作已儲存。' });
      if (choice === 1) { quitting = true; void backend.shutdown().then(() => { closing = true; win?.close(); }).catch(error => { quitting = false; dialog.showErrorBox('停止失敗', String(error)); }); }
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
  if (process.platform === 'darwin') {
    const interval = setInterval(() => gate.status(), 1000); interval.unref();
    powerMonitor.on('resume', () => gate.touch());
    try {
      const maintenance = await startMaintenanceServer({
        userData: app.getPath('userData'),
        status: async () => { await probe(false); return { ...gate.status(), userIdleSeconds: powerMonitor.getSystemIdleTime() }; },
        restart: async () => {
          if (quitting || powerMonitor.getSystemIdleTime() < requiredIdleSeconds) return { accepted: false, reason: 'Mac 最近仍有人操作，稍後再檢查' };
          try {
            if (!await probe(true) || !gate.acquire()) { resume(); return { accepted: false, reason: '尚未確認連續空閒 15 分鐘，或仍有工作／草稿' }; }
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([backend.flush(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('儲存逾時')), 2000); })]); }
            finally { clearTimeout(deadline); }
            if (backend.maintenanceBlockers.length || powerMonitor.getSystemIdleTime() < requiredIdleSeconds || !win || win.isDestroyed() || win.webContents.isLoading()) { resume(); return { accepted: false, reason: '重啟前狀態改變，已延後' }; }
            app.relaunch(); closing = true; quitting = true;
            setTimeout(() => app.quit(), 150);
            return { accepted: true, reason: '已確認空閒，正在正常退出並重開' };
          } catch { resume(); return { accepted: false, reason: '儲存或檢查失敗，已取消重啟' }; }
        }
      });
      app.once('will-quit', () => { void maintenance.close(); });
    } catch (error) { console.warn('安全重啟狀態服務未啟用：', error instanceof Error ? error.message : '狀態不明'); }
  }
  app.on('activate', () => { if (!win) { closing = false; quitting = false; backend.reopen(); createWindow(); } });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
