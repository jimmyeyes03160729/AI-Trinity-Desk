import path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import type { Command } from './contracts';

// Finder-launched macOS apps often have a reduced PATH. Only query the user's
// login shell for PATH; never copy shell output or arbitrary environment values.
export async function terminalEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'darwin') {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const { stdout } = await promisify(execFile)(shell, ['-l', '-c', 'printf "\\n__TRINITY_PATH__%s\\n" "$PATH"'], { timeout: 5000, maxBuffer: 65536 });
      const value = stdout.match(/__TRINITY_PATH__(.*)/)?.[1]?.trim();
      if (value) env.PATH = value;
    } catch { /* Inherit the app environment; detection shows missing commands. */ }
  }
  refreshCliPath(env);
  return env;
}

export function refreshCliPath(env: NodeJS.ProcessEnv, home = os.homedir(), platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  const separator = platform === 'win32' ? ';' : ':';
  const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
  const known = [p.join(home,'.local','bin'), ...(platform === 'win32' ? [p.join(local,'agy','bin'), p.join(local,'Programs','OpenAI','Codex','bin'), p.join(env.APPDATA || p.join(home,'AppData','Roaming'),'npm')] : ['/opt/homebrew/bin','/usr/local/bin'])];
  // Preserve explicit PATH precedence; append user install directories only.
  env[key] = [...new Set([...(env[key] || '').split(separator).filter(Boolean), ...known])].join(separator);
}

export async function resolveExecutable(command: string, env: NodeJS.ProcessEnv, platform = process.platform): Promise<string | null> {
  if (!command || command.includes('\0')) return null;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  // Relative executables are intentionally rejected: project files must not
  // silently override trusted CLI names. Absolute paths remain configurable.
  if (!p.isAbsolute(command) && /[/\\]/.test(command)) return null;
  const rawPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const extensions = win && !p.extname(command) ? ['', '.exe', '.com', '.cmd', '.bat', '.ps1'] : [''];
  const bases = p.isAbsolute(command) ? [command] : rawPath.split(win ? ';' : ':').filter(v => p.isAbsolute(v.replace(/^"|"$/g, ''))).map(dir => p.join(dir.replace(/^"|"$/g, ''), command));
  for (const base of bases) for (const ext of extensions) {
    const candidate = base + ext;
    try { if ((await stat(candidate)).isFile()) { await access(candidate, win ? constants.F_OK : constants.X_OK); return candidate; } } catch { /* next candidate */ }
  }
  return null;
}
export function quotePowerShell(value: string): string { return "'" + value.replaceAll("'", "''") + "'"; }
export function launchSpec(executable: string, command: Command, platform = process.platform): { file: string; args: string[] } {
  if (platform !== 'win32' || !/\.(cmd|bat|ps1)$/i.test(executable)) return { file: executable, args: command.args };
  const script = `$ErrorActionPreference = 'Stop'; try { & ${[executable, ...command.args].map(quotePowerShell).join(' ')}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  return { file: path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}
