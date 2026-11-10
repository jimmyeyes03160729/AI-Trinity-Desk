import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('node-pty/package.json'));
const prebuilt = path.join(root,'prebuilds',`${process.platform}-${process.arch}`);
// node-pty 1.1 ships Node-API binaries. They do not need an Electron ABI
// rebuild. Rebuilding them unconditionally requires an unnecessary compiler.
if (!fs.existsSync(prebuilt) && !fs.existsSync(path.join(root,'build','Release'))) {
  throw new Error('找不到 node-pty 原生元件。請安裝系統 C++ 建置工具後執行 npm run rebuild:native。');
}
// node-pty 1.1.0 publishes the macOS spawn-helper without the execute bit,
// and newer npm versions skip dependency install scripts. Without this every
// terminal fails on macOS with "posix_spawnp failed".
for (const arch of ['arm64', 'x64']) {
  const helper = path.join(root, 'prebuilds', `darwin-${arch}`, 'spawn-helper');
  if (fs.existsSync(helper) && (fs.statSync(helper).mode & 0o111) !== 0o111) fs.chmodSync(helper, 0o755);
}
require('node-pty');
console.log(`node-pty ready: ${process.platform}-${process.arch} (Node-API prebuild or local build)`);
