import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { WebSocketServer, WebSocket } from 'ws';
import { createBackend } from '../electron/backend';
import { paneIdSchema, type Result } from '../electron/contracts';
import { Auth, readCookie } from './auth';
import { accountPage, loginPage, setupPage } from './login-page';

const version = '1.3.0';
const env = process.env;
const home = env.TRINITY_TEST_HOME || os.homedir();
const rawBasePath = env.TRINITY_BASE_PATH || '';
if (rawBasePath && rawBasePath !== '/' && !/^\/(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*\/?$/.test(rawBasePath)) throw new Error('TRINITY_BASE_PATH 格式無效。');
const basePath = rawBasePath === '/' ? '' : rawBasePath.replace(/\/$/, '');
const appPath = (pathname: string) => basePath + pathname;
function defaultDataDir() {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'AI Trinity Desk Web');
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'AI Trinity Desk Web');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ai-trinity-desk-web');
}
const config = {
  host: env.TRINITY_WEB_HOST || '127.0.0.1',
  port: Number(env.TRINITY_WEB_PORT || 8765),
  dataDir: path.resolve(env.TRINITY_DATA_DIR || defaultDataDir()),
  distDir: path.resolve(env.TRINITY_DIST_DIR || path.join(__dirname, '..', 'dist')),
  // Behind Cloudflare Tunnel, Tailscale Serve or another reverse proxy.
  trustProxy: env.TRINITY_TRUST_PROXY === '1',
  allowedOrigins: (env.TRINITY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  projectRoots: (env.TRINITY_PROJECT_ROOTS || home).split(path.delimiter).filter(Boolean).map(p => path.resolve(p)),
  tlsCert: env.TRINITY_TLS_CERT, tlsKey: env.TRINITY_TLS_KEY
};
const cookieName = 'trinity_session';

async function main() {
  const auth = new Auth(path.join(config.dataDir, 'web-auth.json'));
  // Only someone with access to the host can reset the single account.
  if (process.argv.includes('--reset-account')) {
    await auth.reset();
    console.log('已刪除網頁登入帳號，所有裝置已登出。重新啟動伺服器後，會顯示新的設定碼供你重新建立帳號。');
    return;
  }
  const setupCode = await auth.load();
  const roots = await Promise.all(config.projectRoots.map(root => realpath(root).catch(() => root)));

  const clients = new Set<WebSocket & { token?: string; alive?: boolean }>();
  function broadcast(channel: string, payload: unknown) {
    const message = JSON.stringify({ t: 'ev', ch: channel, v: payload });
    for (const socket of clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // A stalled browser must not hold terminal output in memory forever; it
      // reloads and replays the recent history when it reconnects.
      if (socket.bufferedAmount > 32 * 1024 * 1024) { socket.terminate(); continue; }
      socket.send(message);
    }
  }
  const backend = await createBackend({ userData: config.dataDir, home, runtime: `web ${version}`, emit: broadcast, autoAck: true });

  const inRoots = (target: string) => roots.some(root => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); });
  const web = new Map<string, (value: unknown) => unknown>();
  web.set('fs:list', async value => {
    const requested = z.string().max(4096).optional().parse(value);
    const start = requested ? path.resolve(requested) : (backend.settings.projectPath && inRoots(backend.settings.projectPath) ? backend.settings.projectPath : roots[0]);
    const folder = await realpath(start).catch(() => { throw new Error('找不到資料夾：' + start); });
    if (!inRoots(folder)) throw new Error('此資料夾不在允許的專案範圍內（TRINITY_PROJECT_ROOTS）。');
    const entries = (await readdir(folder, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b)).slice(0, 1000);
    const parent = path.dirname(folder);
    return { path: folder, parent: parent !== folder && inRoots(parent) ? parent : null, roots, entries };
  });
  web.set('project:set', async value => {
    const request = z.object({ folder: z.string().min(1).max(4096), id: paneIdSchema.optional() }).strict().parse(value);
    const folder = await realpath(request.folder).catch(() => { throw new Error('找不到此資料夾。'); });
    if (!inRoots(folder)) throw new Error('此資料夾不在允許的專案範圍內（TRINITY_PROJECT_ROOTS）。');
    return backend.setProject(folder, request.id);
  });
  async function call(channel: string, value: unknown): Promise<Result<unknown>> {
    const fn = web.get(channel);
    if (!fn) return backend.invoke(channel, value);
    try { return { ok: true, value: await fn(value) }; }
    catch (error) { return { ok: false, error: error instanceof z.ZodError ? '輸入格式不符：' + error.issues.map(i => i.message).join('；') : error instanceof Error ? error.message : String(error) }; }
  }

  const forwarded = (req: http.IncomingMessage, name: string) => { const value = req.headers[name]; return config.trustProxy && typeof value === 'string' ? value.split(',')[0].trim() : undefined; };
  const clientAddress = (req: http.IncomingMessage) => forwarded(req, 'cf-connecting-ip') || forwarded(req, 'x-forwarded-for') || req.socket.remoteAddress || 'unknown';
  const secure = (req: http.IncomingMessage) => 'encrypted' in req.socket || req.headers['x-forwarded-proto'] === 'https';
  const hostOf = (req: http.IncomingMessage) => forwarded(req, 'x-forwarded-host') || req.headers.host || '';
  // Cookies alone do not stop another site from opening a WebSocket, so
  // every state-changing request must come from this page's own origin.
  function sameOrigin(req: http.IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return false;
    if (config.allowedOrigins.includes(origin)) return true;
    try { return new URL(origin).host === hostOf(req); } catch { return false; }
  }
  const authorized = (req: http.IncomingMessage) => auth.valid(readCookie(req.headers.cookie, cookieName));
  const common = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin' };
  function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
    res.writeHead(status, { ...common, 'Cache-Control': 'no-store', ...headers }); res.end(body);
  }
  const json = (res: http.ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  async function body(req: http.IncomingMessage) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('too large'); }
    return text;
  }
  const types: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json' };
  async function serveApp(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    if (pathname === '/' || pathname === '/index.html') {
      const html = (await readFile(path.join(config.distDir, 'index.html'), 'utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '').replace('</head>', `<meta name="trinity-base-path" content="${basePath}"></head>`);
      const host = hostOf(req).replace(/[^A-Za-z0-9.:\-[\]]/g, '');
      const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://${host} wss://${host}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'`;
      send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }); return;
    }
    const file = path.resolve(config.distDir, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(config.distDir + path.sep) || !(await stat(file).catch(() => undefined))?.isFile()) { send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); return; }
    const immutable = pathname.startsWith('/assets/');
    res.writeHead(200, { ...common, 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(await readFile(file));
  }
  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (basePath && url.pathname === basePath) { send(res, 308, '', { Location: basePath + '/' + url.search }); return; }
    if (basePath && !url.pathname.startsWith(basePath + '/')) { send(res, 404, 'Not found'); return; }
    if (basePath) url.pathname = url.pathname.slice(basePath.length);
    const pages: Record<string, () => string> = { '/setup': () => setupPage(nonce, basePath), '/login': () => loginPage(nonce, basePath), '/account': () => accountPage(nonce, auth.username || '', basePath) };
    const nonce = randomBytes(16).toString('base64');
    if (pages[url.pathname] && req.method === 'GET') {
      // Exactly one of setup or login is reachable, depending on whether the
      // account exists; the account page needs a signed-in session.
      const target = !auth.configured ? '/setup' : url.pathname === '/account' ? (authorized(req) ? '/account' : '/login') : authorized(req) ? '/' : '/login';
      if (target !== url.pathname) { send(res, 302, '', { Location: appPath(target) }); return; }
      send(res, 200, pages[url.pathname](), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
      return;
    }
    const cookie = (session: { token: string; maxAge: number }) => ({ 'Set-Cookie': `${cookieName}=${session.token}; Path=${appPath('/')}; HttpOnly; SameSite=Strict; Max-Age=${session.maxAge}${secure(req) ? '; Secure' : ''}` });
    const credentials = { '/api/setup': true, '/api/login': true, '/api/password': true } as Record<string, boolean>;
    if (credentials[url.pathname] && req.method === 'POST') {
      if (!sameOrigin(req)) { json(res, 403, { error: '拒絕跨站請求。' }); return; }
      let input: Record<string, string>;
      try { input = z.record(z.string(), z.string().max(1024)).parse(JSON.parse(await body(req))); }
      catch { json(res, 400, { error: '請填寫所有欄位。' }); return; }
      const address = clientAddress(req);
      try {
        if (url.pathname === '/api/setup') {
          const session = await auth.setup({ code: input.code || '', username: input.username || '', password: input.password || '' }, address);
          console.log(`已建立網頁登入帳號「${auth.username}」。`);
          json(res, 200, { ok: true }, cookie(session));
        } else if (url.pathname === '/api/login') {
          const session = await auth.login(input.username || '', input.password || '', address);
          if (!session) { json(res, 401, { error: '帳號或密碼錯誤。' }); return; }
          json(res, 200, { ok: true }, cookie(session));
        } else {
          const session = await auth.changePassword(readCookie(req.headers.cookie, cookieName), input.current || '', input.password || '', address);
          for (const socket of clients) if (!auth.valid(socket.token)) socket.close(4001, 'password changed');
          json(res, 200, { ok: true }, cookie(session));
        }
      } catch (error) { json(res, /過多/.test(String(error)) ? 429 : 400, { error: error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) { json(res, 403, { error: '拒絕跨站請求。' }); return; }
      const token = readCookie(req.headers.cookie, cookieName);
      await auth.logout(token);
      for (const socket of clients) if (socket.token === token) socket.close(4001, 'logged out');
      json(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=; Path=${appPath('/')}; HttpOnly; SameSite=Strict; Max-Age=0` });
      return;
    }
    if (url.pathname === '/api/session') { json(res, authorized(req) ? 200 : 401, { ok: authorized(req) }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Method not allowed'); return; }
    if (!authorized(req)) {
      if (url.pathname === '/' || url.pathname === '/index.html') send(res, 302, '', { Location: appPath(auth.configured ? '/login' : '/setup') });
      else send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });
      return;
    }
    await serveApp(req, res, url.pathname);
  }
  const handler: http.RequestListener = (req, res) => { route(req, res).catch(error => { console.error(error); if (!res.headersSent) send(res, 500, 'Internal error'); else res.destroy(); }); };
  const server = config.tlsCert && config.tlsKey
    ? https.createServer({ cert: await readFile(config.tlsCert), key: await readFile(config.tlsKey) }, handler)
    : http.createServer(handler);

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== appPath('/ws') || !authorized(req) || !sameOrigin(req)) {
      if (url.pathname === appPath('/ws') && authorized(req)) console.warn(`拒絕來源 ${req.headers.origin} 的 WebSocket；若使用反向代理，請設定 TRINITY_TRUST_PROXY=1 或 TRINITY_ALLOWED_ORIGINS。`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      const client = ws as WebSocket & { token?: string; alive?: boolean };
      client.token = readCookie(req.headers.cookie, cookieName); client.alive = true;
      clients.add(client);
      client.on('pong', () => { client.alive = true; });
      client.on('close', () => clients.delete(client));
      client.on('message', raw => {
        let message: { t?: string; id?: number; ch?: string; v?: unknown };
        try { message = JSON.parse(String(raw)); } catch { return; }
        if (!auth.valid(client.token)) { client.close(4001, 'session expired'); return; }
        if (typeof message.ch !== 'string') return;
        // The server acknowledges output itself, so renderer acks are ignored.
        if (message.t !== 'call' || typeof message.id !== 'number') return;
        const id = message.id;
        void call(message.ch, message.v).then(result => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ t: 'res', id, r: result })); });
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive || !auth.valid(client.token)) { client.terminate(); continue; }
      client.alive = false; client.ping();
    }
  }, 30000);

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => resolve()); });
  const scheme = config.tlsCert ? 'https' : 'http';
  console.log(`AI Trinity Desk Web ${version}`);
  console.log(`  網址：${scheme}://${config.host === '0.0.0.0' ? os.hostname() : config.host}:${config.port}${appPath('/')}`);
  console.log(`  資料目錄：${config.dataDir}`);
  console.log(`  可選專案範圍：${roots.join(', ')}`);
  if (setupCode) console.log(`\n  尚未建立登入帳號。請用瀏覽器開啟網址，輸入以下設定碼並建立唯一的帳號密碼：\n\n      ${setupCode}\n\n  （設定碼也保存在 ${auth.codeFile}，建立帳號後自動刪除）\n`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.tlsCert) console.warn('  注意：目前以未加密的 HTTP 對外提供服務。跨網路使用請透過 Tailscale 或 Cloudflare Tunnel 等 HTTPS 通道。');

  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    console.log('正在停止所有終端與工作…');
    clearInterval(heartbeat);
    for (const client of clients) client.close(1001, 'server stopping');
    server.close();
    await Promise.race([backend.shutdown().catch(error => console.error(error)), new Promise(resolve => setTimeout(resolve, 10000))]);
    await backend.flush().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
main().catch(error => { console.error('AI Trinity Desk Web 啟動失敗：', error); process.exit(1); });
