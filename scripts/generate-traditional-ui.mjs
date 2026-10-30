// Convert pinned upstream translation tables; never translate terminal input.
import { readFile, writeFile } from 'node:fs/promises';
import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'cn', to: 'twp' });
const sources = {
  claude: ['vendor/localization/claude/translations.json'],
  codex: ['vendor/localization/codex/ui-translations.json', 'vendor/localization/codex/ui-translations-extra.json', 'vendor/localization/codex/ui-translations-slash.json', 'vendor/localization/codex/ui-translations-source.json', 'vendor/localization/codex/ui-translations-words.json']
};
for (const [name, files] of Object.entries(sources)) {
  const table = {};
  for (const file of files) {
    const entries = JSON.parse(await readFile(file, 'utf8'));
    for (const entry of entries) {
      if (typeof entry.en !== 'string' || typeof entry.zh !== 'string') continue;
      const en = entry.en.trim(), zh = convert(entry.zh.trim());
      // Only exact, printable UI text; dynamic templates and control sequences
      // cannot safely be substituted in an interactive terminal.
      if (en.length < 4 || en.length > 200 || !zh || /[\x00-\x1f\x7f]|\$\{|\\u[0-9a-f]{4}/i.test(en + zh) || en.startsWith('/') || en.startsWith('--') || en.includes('`')) continue;
      table[en] ??= zh;
    }
  }
  await writeFile(`src/localization/${name}.json`, JSON.stringify(table, null, 2) + '\n');
  console.log(`${name}: ${Object.keys(table).length} literal translations`);
}
