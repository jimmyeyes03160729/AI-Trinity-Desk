// Web server end-to-end: one-time account setup, login, terminals over
// WebSocket, reattaching after reload, a second browser, and origin checks.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trinity-web-')));
const data = path.join(root, 'data'), project = path.join(root, 'project'), project2 = path.join(root, 'project-two'), home = path.join(root, 'home');
await fs.mkdir(data, { recursive: true }); await fs.mkdir(project); await fs.mkdir(project2); await fs.mkdir(home);
await fs.mkdir(path.join(project, '.agents', 'skills', 'demo'), { recursive: true });
await fs.writeFile(path.join(project, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 測試技能用途\n---\n');
const fixture = path.resolve('tests/fixture.cjs');
const command = tag => ({ executable: process.execPath, args: [fixture, tag] });
await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, projectPath: '', commands: { claude: command('claude'), antigravity: command('agy'), codex: command('codex') }, layout: 'columns', sizes: [34, 33, 33], fontSize: 14, autoInstallMissing: false }));
const port = 18000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const prefix = process.env.TRINITY_TEST_BASE_PATH || '';
const base = origin + prefix;
let log = '';
const server = spawn(process.execPath, ['dist-server/server.cjs'], { env: { ...process.env, TRINITY_TEST_HOME: home, TRINITY_DATA_DIR: data, TRINITY_WEB_PORT: String(port), TRINITY_PROJECT_ROOTS: root, TRINITY_BASE_PATH: prefix }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 100)); } };
const expect = (ok, label) => { if (!ok) throw new Error('FAILED: ' + label + '\n' + log); console.log('ok -', label); };
const browser = await chromium.launch(process.env.TRINITY_CHROMIUM ? { executablePath: process.env.TRINITY_CHROMIUM } : {});
try {
  const code = await until(() => log.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/)?.[1]);
  expect((await fs.readFile(path.join(data, 'setup-code.txt'), 'utf8')).trim() === code, 'setup code printed and saved');
  if (prefix) {
    expect((await fetch(base, { redirect: 'manual' })).headers.get('location') === prefix + '/', 'base path redirects to trailing slash');
    expect((await fetch(origin + '/api/session')).status === 404, 'outside base path is rejected');
  }
  expect((await fetch(base + '/', { redirect: 'manual' })).headers.get('location') === prefix + '/setup', 'unconfigured root redirects to setup');
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
  if (process.platform !== 'win32') expect(((await fs.stat(path.join(data, 'web-auth.json'))).mode & 0o077) === 0, 'auth file is private (0600)');
  const second = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ code, username: 'evil', password: 'another long password' }) });
  expect(second.status === 400 && /已建立/.test((await second.json()).error), 'second account cannot be created');
  expect((await fetch(base + '/setup', { redirect: 'manual' })).headers.get('location') === prefix + '/login', 'setup page closed after account exists');
  const cross = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ username: 'owner', password: 'correct horse battery' }) });
  expect(cross.status === 403, 'cross-origin login rejected');
  const wrong = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'owner', password: 'wrong password!!' }) });
  expect(wrong.status === 401 && (await wrong.json()).error === '帳號或密碼錯誤。', 'wrong password gets generic error');
  expect((await fetch(base + '/assets/x.js')).status === 401, 'app assets require login');
  const cookie = (await page.context().cookies()).find(c => c.name === 'trinity_session');
  expect(cookie?.httpOnly && cookie.sameSite === 'Strict', 'session cookie is HttpOnly + SameSite=Strict');
  expect(cookie.path === (prefix || '') + '/', 'session cookie scoped to application path');
  const hijack = await new Promise(resolve => { const ws = new WebSocket(`ws://127.0.0.1:${port}${prefix}/ws`, { headers: { Cookie: `trinity_session=${cookie.value}`, Origin: 'https://evil.example' } }); ws.on('open', () => resolve('open')); ws.on('error', () => resolve('rejected')); });
  expect(hijack === 'rejected', 'cross-site WebSocket rejected even with cookie');

  // Project picker browses the host.
  await page.click('text=選擇專案…');
  await page.waitForSelector('.folder-picker');
  await page.getByRole('button', { name: '▱ project', exact: true }).click();
  await page.click('text=使用此資料夾');
  await page.locator('strong').filter({ hasText: project }).waitFor();
  expect(true, 'project chosen through folder picker');
  const outside = await page.evaluate(({ prefix, outsidePath }) => new Promise(r => { const ws = new WebSocket('ws://' + location.host + prefix + '/ws'); ws.onopen = () => ws.send(JSON.stringify({ t: 'call', id: 1, ch: 'fs:list', v: outsidePath })); ws.onmessage = e => { r(JSON.parse(e.data).r); ws.close(); }; }), { prefix, outsidePath: path.parse(root).root });
  expect(!outside.ok, 'folders outside project roots are refused');

  // Terminal round trip.
  const pane = page.getByTestId('pane-codex');
  await pane.getByRole('button', { name: '▶ 啟動' }).click();
  await until(async () => (await pane.textContent()).includes('READY:codex:TTY=true'));
  await page.getByRole('button', { name: 'Codex CLI 選擇 Skill' }).click();
  const picker = page.getByRole('dialog', { name: 'Codex CLI 已安裝的 Skills' });
  await picker.getByText('測試技能用途').first().waitFor();
  await picker.getByTestId('local-skill').filter({ hasText: '測試技能用途' }).getByRole('button', { name: '插入指令' }).click();
  expect(!(await pane.textContent()).includes('ECHO:codex:$demo'), 'skill insertion does not submit');
  await page.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes('ECHO:codex:$demo'));
  expect(true, 'skill picker inserts a Codex mention into the existing terminal');
  await page.getByRole('button', { name: 'Codex CLI 繁體中文顯示' }).click();
  await page.getByTestId('terminal-codex').click();
  await page.keyboard.type('ui'); await page.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes('接受'));
  await page.getByRole('button', { name: 'Codex CLI 繁體中文顯示' }).click();
  await page.getByTestId('terminal-codex').click();
  await page.keyboard.type('ui'); await page.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes('Accept'));
  expect(true, 'optional Traditional Chinese display can be toggled without changing terminal input');
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

  // Project changes are shared across clients and a stale start fails closed.
  await other.getByTestId('pane-claude').getByRole('button', { name: '■ 停止' }).click();
  await until(async () => /待命|已結束/.test(await claude.textContent()));
  await other.click('text=選擇專案…');
  await other.getByRole('button', { name: '↰ 上一層' }).click();
  await other.getByRole('button', { name: '▱ project-two', exact: true }).click();
  await other.click('text=使用此資料夾');
  await page.locator('strong').filter({ hasText: project2 }).waitFor();
  await other.locator('strong').filter({ hasText: project2 }).waitFor();
  const stale = await page.evaluate(old => window.desk.start('codex', 80, 24, old), project);
  expect(!stale.ok && stale.error.includes('其他裝置變更'), 'stale project cannot start a terminal');
  await pane.getByRole('button', { name: '▶ 啟動' }).click();
  await until(async () => (await pane.textContent()).includes('READY:codex:TTY=true'));
  await page.getByTestId('terminal-codex').click(); await page.keyboard.type('cwd'); await page.keyboard.press('Enter');
  await until(async () => (await pane.textContent()).includes(`CWD:codex:${project2}`));
  expect(true, 'both clients show selected folder and CLI runs in it');
  await pane.getByRole('button', { name: '■ 停止' }).click();
  await until(async () => /待命|已結束/.test(await otherPane.textContent()));
  await other.getByRole('button', { name: '各自資料夾' }).click();
  await until(async () => await page.getByRole('button', { name: '各自資料夾' }).getAttribute('aria-pressed') === 'true');
  await other.getByRole('button', { name: '選擇 Codex CLI 的專案' }).click();
  await other.getByRole('button', { name: '↰ 上一層' }).click();
  await other.getByRole('button', { name: '▱ project', exact: true }).click();
  await other.click('text=使用此資料夾');
  await until(async () => (await page.locator('.project-path').allTextContents()).some(s => s.includes(project)));
  const selected = await page.evaluate(() => window.desk.loadSettings());
  expect(selected.ok && selected.value.settings.projectMode === 'separate' && selected.value.settings.projectPaths.codex === project, 'separate mode and per-AI folder synchronize');
  const staleSeparate = await page.evaluate(old => window.desk.start('codex', 80, 24, old), project2);
  expect(!staleSeparate.ok, 'stale per-AI project cannot start a terminal');

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
