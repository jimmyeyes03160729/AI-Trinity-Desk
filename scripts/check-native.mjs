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
require('node-pty');
console.log(`node-pty ready: ${process.platform}-${process.arch} (Node-API prebuild or local build)`);
