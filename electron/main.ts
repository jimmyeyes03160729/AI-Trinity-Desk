import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createBackend, type Backend } from './backend';
import type { Result } from './contracts';

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
  function handle<T>(channel: string, fn: (value: unknown) => T | Promise<T>) {
    ipcMain.handle(channel, async (event, value): Promise<Result<T>> => {
      try { if (!authorized(event)) throw new Error('拒絕未授權的請求。'); return { ok: true, value: await fn(value) }; }
      catch (error) { return { ok: false, error: error instanceof z.ZodError ? '輸入格式不符：' + error.issues.map(i => i.message).join('；') : error instanceof Error ? error.message : String(error) }; }
    });
  }
  for (const [channel, fn] of backend.handlers) handle(channel, fn);
  for (const [channel, fn] of backend.notifications) ipcMain.on(channel, (event, value) => { if (authorized(event)) fn(value); });
  handle('project:choose', async () => {
    if (backend.terminalsActive) throw new Error('請先停止所有終端，再切換專案。');
    const result = await dialog.showOpenDialog(win!, { title: '選擇三個 CLI 使用的專案資料夾', properties: ['openDirectory'], defaultPath: backend.settings.projectPath || app.getPath('documents') });
    if (result.canceled || !result.filePaths[0]) return null;
    return backend.setProject(result.filePaths[0]);
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
    win.webContents.on('render-process-gone', () => backend.abort());
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
  app.on('activate', () => { if (!win) { closing = false; quitting = false; backend.reopen(); createWindow(); } });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
