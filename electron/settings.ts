import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSettings, settingsSchema, type Settings } from './contracts';

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly filename: string) {}
  async load(): Promise<{ settings: Settings; warning?: string }> {
    try {
      const settings = settingsSchema.parse(JSON.parse(await readFile(this.filename, 'utf8')));
      if (settings.commands.antigravity.executable === 'antigravity' && settings.commands.antigravity.args.length === 0) settings.commands.antigravity.executable = 'agy';
      return { settings };
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: defaultSettings() };
      return { settings: defaultSettings(), warning: '設定檔無法讀取或格式不符，已使用預設值。原始檔保留在 ' + this.filename };
    }
  }
  save(value: unknown): Promise<Settings> {
    const settings = settingsSchema.parse(value);
    const task = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temp = this.filename + '.tmp';
      await writeFile(temp, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.filename);
      return settings;
    });
    this.queue = task;
    return task;
  }
}
