// Optional local smoke test using an actual CLI, an empty config and no prompt.
// Run with TRINITY_PROBE_CLI set to an absolute Claude executable path.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exe = process.env.TRINITY_PROBE_CLI;
const codexExe = process.env.TRINITY_PROBE_CODEX;
if (!exe || !path.isAbsolute(exe)) throw new Error('TRINITY_PROBE_CLI must be an absolute path');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trinity-real-ui-'));
const data = path.join(root, 'data'), project = path.join(root, 'project'), config = path.join(root, 'config');
await Promise.all([data, project, config].map(dir => fs.mkdir(dir)));
if (codexExe && !path.isAbsolute(codexExe)) throw new Error('TRINITY_PROBE_CODEX must be an absolute path');
const commands = { claude: { executable: exe, args: [] }, antigravity: { executable: 'agy', args: [] }, codex: { executable: codexExe || 'codex', args: codexExe ? ['--help'] : [] } };
await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, projectPath: project, commands, layout: 'columns', sizes: [34,33,33], fontSize: 14, autoInstallMissing: false }));
const env = { ...process.env, TRINITY_TEST_USER_DATA: data, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1' };
for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN)/.test(key)) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
let app;
let pane;
try {
  app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'AI Trinity Desk V1.3.0' }).waitFor();
  pane = page.getByTestId('pane-claude');
  await page.getByRole('button', { name: 'Claude Code 繁體中文顯示' }).click();
  await pane.getByRole('button', { name: '▶ 啟動' }).click();
  await expect.poll(async () => await pane.textContent(), { timeout: 45000 }).toContain('深色模式');
  console.log('PASS: actual Claude startup TUI renders 深色模式 through the app');
  if (codexExe) {
    const codex = page.getByTestId('pane-codex');
    await page.getByRole('button', { name: 'Codex CLI 繁體中文顯示' }).click();
    await codex.getByRole('button', { name: '▶ 啟動' }).click();
    await expect.poll(async () => await codex.locator('.xterm-rows').innerText(), { timeout: 15000 }).toContain('列印版本');
    console.log('PASS: actual Codex --help renders 列印版本 through the app');
  }
} finally {
  if (app) {
    try { if (pane && await pane.getByRole('button', { name: '■ 停止' }).isEnabled()) await pane.getByRole('button', { name: '■ 停止' }).click({ timeout: 5000 }); } catch { /* shutting down */ }
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
