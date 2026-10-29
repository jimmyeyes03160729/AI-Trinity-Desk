import { build } from 'esbuild';
await build({ entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts', 'install-probe': 'scripts/check-install-sources.ts' }, outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node-pty'], sourcemap: true });
