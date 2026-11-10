// Preserve the installed runtime and its verified native dependencies while
// updating the freshly built application code. No downloads or CLI installs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as asar from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.resolve(process.argv[2] || '/Applications/AI Trinity Desk.app');
const output = path.join(root, 'release/idle-local/AI Trinity Desk.app');
const payload = path.join(root, 'release/idle-payload');
if (base === output) throw new Error('The source and destination must differ');
await fs.access(path.join(root, 'dist/index.html'));
await fs.access(path.join(root, 'dist-electron/main.cjs'));
await fs.mkdir(path.dirname(output), {recursive:true});
execFileSync('/usr/bin/ditto', [base, output]);
await fs.rm(payload, {recursive:true,force:true});
asar.extractAll(path.join(base,'Contents/Resources/app.asar'), payload);
const previous = JSON.parse(await fs.readFile(path.join(payload,'package.json'),'utf8'));
const current = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const canonical = value => JSON.stringify(Object.entries(value || {}).sort(([a],[b])=>a.localeCompare(b)));
if (canonical(previous.dependencies) !== canonical(current.dependencies)) throw new Error('Dependencies differ; use a complete package build instead');
for (const directory of ['dist','dist-electron']) {
  await fs.rm(path.join(payload,directory),{recursive:true,force:true});
  await fs.cp(path.join(root,directory),path.join(payload,directory),{recursive:true});
}
await fs.writeFile(path.join(payload,'package.json'),JSON.stringify(current,null,2));
const archive = path.join(output,'Contents/Resources/app.asar');
await asar.createPackageWithOptions(payload,archive,{unpackDir:'node_modules/node-pty'});
const digest = createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :ElectronAsarIntegrity:Resources/app.asar:hash ${digest}`,path.join(output,'Contents/Info.plist')]);
for (const arch of ['arm64','x64']) {
  const helper=path.join(output,`Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`);
  await fs.chmod(helper,0o755).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-','--entitlements',path.join(root,'build/entitlements.mac.plist'),output],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',output],{stdio:'inherit'});
await fs.rm(payload,{recursive:true,force:true});
console.log(output);
