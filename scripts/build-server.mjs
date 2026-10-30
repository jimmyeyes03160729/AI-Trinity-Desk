import { build } from 'esbuild';
import path from 'node:path';
// The web server reuses electron/*.ts; `electron` resolves to a Node shim of
// the net module, so the bundle runs on plain Node without Electron.
await build({ entryPoints: { server: 'server/main.ts' }, outdir: 'dist-server', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['node-pty', 'bufferutil', 'utf-8-validate'], alias: { electron: path.resolve('server/electron-net.ts') }, sourcemap: true });
