// Web server end-to-end: one-time account setup, login, terminals over
// WebSocket, reattaching after reload, a second browser, and origin checks.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trinity-web-'));
const data = path.join(root, 'data'), project = path.join(root, 'project');
await fs.mkdir(data, { recursive: true }); await fs.mkdir(project);
const fixture = path.resolve('tests/fixture.cjs');
const command = tag => ({ executable: process.execPath, args: [fixture, tag] });
await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, projectPath: '', commands: { claude: command('claude'), antigravity: command('agy'), codex: command('codex') }, layout: 'columns', sizes: [34, 33, 33], fontSize: 14, autoInstallMissing: false }));
const port = 18000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
let log = '';
const server = spawn(process.execPath, ['dist-server/server.cjs'], { env: { ...process.env, TRINITY_DATA_DIR: data, TRINITY_WEB_PORT: String(port), TRINITY_PROJECT_ROOTS: root }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 100)); } };
const expect = (ok, label) => { if (!ok) throw new Error('FAILED: ' + label + '\n' + log); console.log('ok -', label); };
const browser = await chromium.launch(process.env.TRINITY_CHROMIUM ? { executablePath: process.env.TRINITY_CHROMIUM } : {});
try {
  const code = await until(() => log.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/)?.[1]);
  expect((await fs.readFile(path.join(data, 'setup-code.txt'), 'utf8')).trim() === code, 'setup code printed and saved');
  expect((await fetch(base + '/', { redirect: 'manual' })).headers.get('location') === '/setup', 'unconfigured root redirects to setup');
  const page = await browser.newPage();
  await page.goto(base + '/');
  expect(page.url().endsWith('/setup'), 'browser lands on setup page');
  await page.fill('#code', 'AAAA-BBBB-CCCC'); await page.fill('#username', 'owner'); await page.fill('#password', 'correct horse battery'); await page.fill('#confirm', 'correct horse battery');
  await page.click('#submit');
  await page.waitForSelector('#error:has-text("設定碼錯誤")');
  expect(true, 'wrong setup code rejected');
  await page.fill('#code', code.toLowerCase()); await page.fill('#password', 'short'); await page.fill('#confirm', 'short'); await page.click('#submit');
  await page.waitForSelector('#error:has-text("12")');
  expect(true, 'weak password rejected');
  await page.fill('#password', 'correct horse battery'); await page.fill('#confirm', 'correct horse battery'); await page.click('#submit');
  await page.waitForSelector('text=AI Trinity Desk');
  expect(!(await fs.stat(path.join(data, 'setup-code.txt')).catch(() => null)), 'setup code removed after account creation');
  const stored = await fs.readFile(path.join(data, 'web-auth.json'), 'utf8');
  expect(!stored.includes('correct horse') && /"hash"/.test(stored), 'password stored only as hash');
  expect(((await fs.stat(path.join(data, 'web-auth.json'))).mode & 0o077) === 0, 'auth file is private (0600)');
  const second = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ code, username: 'evil', password: 'another long password' }) });
  expect(second.status === 400 && /已建立/.test((await second.json()).error), 'second account cannot be created');
  expect((await fetch(base + '/setup', { redirect: 'manual' })).headers.get('location') === '/login', 'setup page closed after account exists');
  const cross = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ username: 'owner', password: 'correct horse battery' }) });
  expect(cross.status === 403, 'cross-origin login rejected');
  const wrong = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'owner', password: 'wrong password!!' }) });
  expect(wrong.status === 401 && (await wrong.json()).error === '帳號或密碼錯誤。', 'wrong password gets generic error');
  expect((await fetch(base + '/assets/x.js')).status === 401, 'app assets require login');
  const cookie = (await page.context().cookies()).find(c => c.name === 'trinity_session');
  expect(cookie?.httpOnly && cookie.sameSite === 'Strict', 'session cookie is HttpOnly + SameSite=Strict');
  const hijack = await new Promise(resolve => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: `trinity_session=${cookie.value}`, Origin: 'https://evil.example' } }); ws.onopen = () => resolve('open'); ws.onerror = () => resolve('rejected'); });
  expect(hijack === 'rejected', 'cross-site WebSocket rejected even with cookie');

  // Project picker browses the host.
  await page.click('text=選擇專案…');
  await page.waitForSelector('.folder-picker');
  await page.click('.folder-item:has-text("project")');
  await page.click('text=使用此資料夾');
  await page.waitForSelector(`strong[title="${project}"]`);
  expect(true, 'project chosen through folder picker');
  const outside = await page.evaluate(() => new Promise(r => { const ws = new WebSocket('ws://' + location.host + '/ws'); ws.onopen = () => ws.send(JSON.stringify({ t: 'call', id: 1, ch: 'fs:list', v: '/' })); ws.onmessage = e => r(JSON.parse(e.data).r); }));
  expect(!outside.ok, 'folders outside project roots are refused');

  // Terminal round trip.
  const pane = page.getByTestId('pane-codex');
  await pane.getByRole('button', { name: '▶ 啟動' }).click();
  await until(async () => (await pane.textContent()).includes('READY:codex:TTY=true'));
  await page.getByTestId('terminal-codex').click(); await page.keyboard.type('hello web'); await page.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes('ECHO:codex:hello web'));
  expect(true, 'terminal input and output over WebSocket');
  await page.keyboard.type('burst'); await page.keyboard.press('Enter');
  await until(async () => (await page.evaluate(() => document.querySelector('[data-testid=pane-codex]').textContent)).includes('BURST_DONE:codex'), 20000);
  expect(true, 'large output burst delivered');

  // Reload: pane reattaches to the running CLI with its history.
  await page.reload(); await page.waitForSelector('[data-testid=pane-codex]');
  await until(async () => (await pane.textContent()).includes('執行中'));
  await until(async () => (await pane.textContent()).includes('BURST_DONE:codex'));
  expect(true, 'reload reattaches to running terminal with history');

  // Second device sees the same session and its new output.
  const other = await browser.newPage();
  await other.goto(base + '/');
  expect(other.url().endsWith('/login'), 'new browser must log in');
  await other.fill('#username', 'OWNER'); await other.fill('#password', 'correct horse battery'); await other.click('#submit');
  await other.waitForSelector('[data-testid=pane-codex]');
  const otherPane = other.getByTestId('pane-codex');
  await until(async () => (await otherPane.textContent()).includes('執行中'));
  await other.getByTestId('terminal-codex').click(); await other.keyboard.type('from second'); await other.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes('ECHO:codex:from second'));
  expect(true, 'second device shares the session; output reaches both');
  const claude = page.getByTestId('pane-claude');
  await other.getByTestId('pane-claude').getByRole('button', { name: '▶ 啟動' }).click();
  await until(async () => (await claude.textContent()).includes('READY:claude'));
  expect(true, 'terminal started on one device appears on the other');
  await pane.getByRole('button', { name: '■ 停止' }).click();
  await until(async () => /待命|已結束/.test(await otherPane.textContent()));
  expect(true, 'stop on one device ends it on the other');

  // Change password: other device is signed out.
  await page.goto(base + '/account');
  await page.fill('#current', 'correct horse battery'); await page.fill('#password', 'a brand new passphrase'); await page.fill('#confirm', 'a brand new passphrase'); await page.click('#submit');
  await page.waitForSelector('[data-testid=pane-codex]');
  await until(() => other.url().endsWith('/login'));
  expect(true, 'password change signs out other devices');
  await page.click('text=登出'); await page.waitForURL(/\/login$/);
  expect(true, 'logout');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise(r => server.once('exit', r));
  await fs.rm(root, { recursive: true, force: true });
}
console.log('web e2e passed');
