import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { InstallerManager, cliCatalog, downloadInstaller, installerSpec, runInstaller, validateInstallerUrl, isTransientDownloadError } from '../electron/installers';
import { defaultSettings, settingsSchema } from '../electron/contracts';
import { SettingsStore } from '../electron/settings';
import { refreshCliPath } from '../electron/commands';
import { nativePackageSelection, registryAsset, validateTarEntries } from '../electron/native-packages';

const pause = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
async function settle(manager:InstallerManager) { for(let i=0;i<500 && manager.active;i++) await pause(5); assert.equal(manager.active,false,'installer queue did not finish'); }
test('catalog contains only exact official installers and the real agy command', () => {
  assert.equal(cliCatalog.antigravity.command,'agy');
  for(const cli of Object.values(cliCatalog)) {assert.equal(validateInstallerUrl(cli.win).protocol,'https:'); assert.equal(validateInstallerUrl(cli.mac).protocol,'https:');}
  for(const bad of ['http://claude.ai/install.ps1','https://claude.ai.attacker.test/install.ps1','https://evil.test/install.ps1','https://user@claude.ai/install.ps1','https://claude.ai:999/install.ps1']) assert.throws(()=>validateInstallerUrl(bad));
  assert.deepEqual(installerSpec('/tmp/install.sh','darwin'),{file:'/bin/bash',args:['/tmp/install.sh']});
  assert.ok(installerSpec('C:\\test space\\install.ps1','win32').args.includes('Bypass'));
});
test('native packages follow exact official dependencies including npm platform aliases',()=>{
  assert.deepEqual(nativePackageSelection('claude','x64',{version:'2.1.312',optionalDependencies:{'@anthropic-ai/claude-code-win32-x64':'2.1.312'}}),{name:'@anthropic-ai/claude-code-win32-x64',version:'2.1.312'});
  assert.deepEqual(nativePackageSelection('codex','x64',{version:'0.165.0',optionalDependencies:{'@openai/codex-win32-x64':'npm:@openai/codex@0.165.0-win32-x64'}}),{name:'@openai/codex',version:'0.165.0-win32-x64'});
  assert.throws(()=>nativePackageSelection('codex','x64',{version:'1.0.0',optionalDependencies:{'@openai/codex-win32-x64':'npm:attacker@1.0.0'}}));
});
test('package transport rejects unrelated registries and archive traversal',()=>{
  assert.equal(registryAsset('https://registry.npmjs.org/%40openai%2Fcodex/latest').hostname,'registry.npmjs.org');
  for(const url of ['https://evil.test/@openai/codex/latest','https://registry.npmjs.org/attacker/latest','http://registry.npmjs.org/@openai/codex/latest'])assert.throws(()=>registryAsset(url));
  validateTarEntries('package/claude.exe\npackage/package.json\n');
  for(const list of ['../outside.exe','package/../../outside','C:/outside','package\\..\\outside'])assert.throws(()=>validateTarEntries(list));
});
test('download validates each redirect before contacting it and rejects HTML or oversized scripts',async()=>{
  let calls=0;
  const invalid:typeof fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.test/install.ps1'}});};
  await assert.rejects(downloadInstaller(cliCatalog.codex.win,new AbortController().signal,invalid),/官方清單/);assert.equal(calls,1);
  await assert.rejects(downloadInstaller(cliCatalog.codex.win,new AbortController().signal,async()=>new Response('<!doctype html><html>error</html>')),/有效安裝腳本/);
  await assert.rejects(downloadInstaller(cliCatalog.codex.win,new AbortController().signal,async()=>new Response('x'.repeat(2*1024*1024+1))),/大小限制/);
});
test('verified vendor redirect hosts are supported without permitting other subdomains',async()=>{
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return calls===1?new Response(null,{status:302,headers:{location:'https://downloads.claude.ai/install.ps1'}}):new Response('Write-Output ok');};
  assert.equal(await downloadInstaller(cliCatalog.claude.win,new AbortController().signal,transport),'Write-Output ok');assert.equal(calls,2);
  assert.throws(()=>validateInstallerUrl('https://downloads.claude.ai.evil.test/install.ps1'));
});
test('temporary connection failures retry, while unsafe sources never retry',async()=>{
  let calls=0;
  assert.equal(await downloadInstaller(cliCatalog.claude.win,new AbortController().signal,async()=>{calls++;if(calls===1)throw new Error('net::ERR_CONNECTION_CLOSED');return new Response('installer');}),'installer');
  assert.equal(calls,2);assert.equal(isTransientDownloadError(new Error('HTTP 503')),true);assert.equal(isTransientDownloadError(new Error('官方清單')),false);
});
test('Windows installer bootstrap preserves UTF-8 output and official digest validation script unchanged', {skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-unicode-'));const filename=path.join(root,'unicode.ps1');
  const script="Write-Output '安裝測試輸出'\nexit 0\n";await writeFile(filename,'\ufeff'+script,'utf8');let log='';
  await runInstaller(filename,process.env,new AbortController().signal,text=>{log+=text;},'win32');assert.match(log,/安裝測試輸出/);
  assert.equal(await readFile(filename,'utf8'),'\ufeff'+script);
  const bootstrap=await readFile(path.join(root,'trinity-bootstrap.ps1'),'utf8');assert.match(bootstrap,/--retry-all-errors/);assert.match(bootstrap,/Tls12/);assert.ok(!bootstrap.includes('--insecure'));
});
test('old settings migrate the placeholder and preserve custom CLI paths and opt-out', async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'trinity-migrate-')); const filename=path.join(folder,'settings.json');
  const old:any=defaultSettings(); delete old.autoInstallMissing; old.commands.antigravity.executable='antigravity';
  await writeFile(filename,JSON.stringify(old)); const migrated=(await new SettingsStore(filename).load()).settings;
  assert.equal(migrated.commands.antigravity.executable,'agy'); assert.equal(migrated.autoInstallMissing,true);
  old.commands.antigravity.executable='/custom/agent'; old.autoInstallMissing=false; await writeFile(filename,JSON.stringify(old));
  const custom=(await new SettingsStore(filename).load()).settings; assert.equal(custom.commands.antigravity.executable,'/custom/agent');assert.equal(custom.autoInstallMissing,false);
  assert.equal(settingsSchema.safeParse({...custom,autoInstallMissing:'yes'}).success,false);
});
test('new official bin paths are available immediately without replacing PATH precedence',()=>{
  const env={Path:'C:\\trusted\\bin',LOCALAPPDATA:'C:\\Users\\demo\\AppData\\Local'};
  refreshCliPath(env,'C:\\Users\\demo','win32'); refreshCliPath(env,'C:\\Users\\demo','win32');
  assert.ok(env.Path.startsWith('C:\\trusted\\bin;')); assert.ok(env.Path.includes('Programs\\OpenAI\\Codex\\bin')); assert.ok(env.Path.includes('agy\\bin'));
  assert.equal(env.Path.split(';').length,new Set(env.Path.split(';')).size);
});
test('missing tools install serially, deduplicate requests, retain script digest, and re-detect',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-install-')); const installed=new Set<string>(); const ran:string[]=[]; let parallel=0,max=0;
  const manager=new InstallerManager(defaultSettings,{},root,()=>{},'win32',{
    resolve:async command=>installed.has(command)?`C:\\bin\\${command}.exe`:null,
    download:async url=>url,
    run:async(file,_env,_signal,log)=>{parallel++;max=Math.max(max,parallel);const script=await readFile(file,'utf8');const entry=Object.values(cliCatalog).find(c=>c.win===script)!;ran.push(entry.command);log('installed\n');await pause(5);installed.add(entry.command);parallel--;}
  });
  manager.request(['claude','antigravity','codex']);manager.request(['claude']); await settle(manager);
  assert.deepEqual(ran,['claude','agy','codex']);assert.equal(max,1);
  for(const state of manager.snapshot){assert.equal(state.status,'ready');assert.match(state.log,/SHA-256：[a-f0-9]{64}/);assert.ok(state.path);}
  manager.request(['claude']);await settle(manager);assert.equal(ran.length,3);await manager.shutdown();
});
test('pre-existing and custom executables do not download or replace installed tools',async()=>{
  const settings=defaultSettings();settings.commands.codex.executable='/custom/codex';let downloads=0;
  const manager=new InstallerManager(()=>settings,{},os.tmpdir(),()=>{},'win32',{resolve:async()=>'/existing',download:async()=>{downloads++;return 'script';}});
  manager.request(['claude','codex']);await settle(manager);assert.equal(downloads,0);assert.equal(manager.snapshot[0].status,'ready');assert.equal(manager.snapshot[2].status,'custom');await manager.shutdown();
});
test('download failure is visible, retry works, and a missing post-install executable fails closed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-retry-'));let attempts=0;
  const manager=new InstallerManager(defaultSettings,{},root,()=>{},'win32',{resolve:async()=>null,download:async()=>{attempts++;if(attempts===1)throw new Error('network offline');return 'script';},run:async()=>{}});
  manager.request(['codex']);await settle(manager);assert.equal(manager.snapshot[2].status,'error');assert.match(manager.snapshot[2].message,/network offline/);
  manager.request(['codex']);await settle(manager);assert.equal(attempts,2);assert.match(manager.snapshot[2].message,/尚未找到 CLI/);await manager.shutdown();
});
test('running download and queued installations can be cancelled without continuing the queue',async()=>{
  let entered=false;
  const manager=new InstallerManager(defaultSettings,{},os.tmpdir(),()=>{},'win32',{resolve:async()=>null,download:async(_url,signal)=>{entered=true;await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));return 'script';}});
  manager.request(['claude','codex']); while(!entered)await pause(1);
  await manager.cancel('codex');assert.equal(manager.snapshot[2].status,'cancelled');await manager.shutdown();assert.equal(manager.active,false);assert.equal(manager.snapshot[0].status,'cancelled');
});
test('real local installer process streams output and propagates nonzero exit without running vendor scripts',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-runner-'));const file=path.join(root,process.platform==='win32'?'fixture.ps1':'fixture.sh');
  await writeFile(file,process.platform==='win32'?"Write-Output 'fixture-output'; exit 7":"echo fixture-output\nexit 7\n");let log='';
  await assert.rejects(runInstaller(file,process.env,new AbortController().signal,text=>{log+=text;},process.platform==='win32'?'win32':'darwin'),/代碼 7/);assert.match(log,/fixture-output/);
});
test('cancelling a real Windows installer fixture kills its subprocess tree', {skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-cancel-'));const file=path.join(root,'cancel.ps1');
  await writeFile(file,"$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru -WindowStyle Hidden\nWrite-Output ('CHILD:' + $child.Id)\nStart-Sleep -Seconds 30\n");
  const controller=new AbortController();let output='';let childPid=0;
  const timer=setTimeout(()=>controller.abort(),10000);
  try {
    await assert.rejects(runInstaller(file,process.env,controller.signal,text=>{output+=text;const match=output.match(/CHILD:(\d+)/);if(match){childPid=Number(match[1]);controller.abort();}},'win32'),/取消/);
    assert.ok(childPid,'fixture child started');
    let alive=true;for(let i=0;i<100 && alive;i++){try{process.kill(childPid,0);}catch{alive=false;}if(alive)await pause(25);}
    assert.equal(alive,false,'installer child remained alive');
  } finally {clearTimeout(timer);}
});
