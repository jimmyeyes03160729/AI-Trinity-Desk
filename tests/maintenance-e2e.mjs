import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = await fs.mkdtemp('/tmp/trinity-idle-e2e-');
const socket = path.join(data, 'memory-guard.sock');
const project = path.join(data, 'project'); await fs.mkdir(project);
const command = {executable:process.execPath,args:[path.join(root,'tests/fixture.cjs')]};
await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,agent:'hermes',projectPath:project,layout:'columns',sizes:[34,33,33],fontSize:14,commands:{hermes:command,claude:command,antigravity:command,codex:command},autoInstallMissing:false}));
const env = {...process.env,TRINITY_TEST_USER_DATA:data}; delete env.ELECTRON_RUN_AS_NODE;
function request(value) {
  return new Promise((resolve,reject)=>{
    const client=createConnection(socket);let text='';
    client.setTimeout(5000,()=>{client.destroy();reject(new Error('bridge timeout'));});
    client.on('connect',()=>client.write(JSON.stringify(value)+'\n'));client.on('data',chunk=>text+=chunk);client.on('error',reject);
    client.on('end',()=>{try{resolve(JSON.parse(text));}catch(error){reject(error);}});
  });
}
let app; const checks=[];
try {
  app=await electron.launch({executablePath:process.env.TRINITY_PACKAGED_EXE||electronPath,args:process.env.TRINITY_PACKAGED_EXE?[`--user-data-dir=${data}`]:[root],env,timeout:30000});
  console.log('fixture app launched');
  const page=await app.firstWindow();page.on('pageerror',e=>console.error('renderer error',e.message));page.on('console',m=>{if(m.type()==='error')console.error('renderer console',m.text());});await page.getByRole('heading',{name:'AI Trinity Desk V1.3.0'}).waitFor();
  await expect.poll(async()=>{try{return (await request({op:'status'})).state;}catch{return 'starting';}}).toBe('idle');
  const initial=await request({op:'status'});expect(initial.pid).toBeGreaterThan(0);console.log('checkpoint',checks.length+1);checks.push('fresh idle state from real desktop renderer');
  await page.getByRole('button',{name:'AI 互相對話',exact:true}).click();
  await page.getByRole('textbox',{name:'討論主題',exact:true}).fill('UNSENT DRAFT - must block restart');
  await expect.poll(async()=>(await request({op:'status'})).state).toBe('busy');
  await page.getByRole('button',{name:'收合 AI 討論'}).click();
  expect((await request({op:'status'})).state).toBe('busy');console.log('checkpoint',checks.length+1);checks.push('hidden unsent draft blocks restart');
  await page.getByRole('button',{name:'AI 互相對話',exact:true}).click();await page.getByRole('textbox',{name:'討論主題',exact:true}).fill('');await page.getByRole('button',{name:'收合 AI 討論'}).click();
  await expect.poll(async()=>(await request({op:'status'})).state).toBe('idle');
  await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();expect((await request({op:'status'})).state).toBe('busy');
  await page.getByRole('button',{name:'取消',exact:true}).click();console.log('checkpoint',checks.length+1);checks.push('open settings blocks restart');
  await page.getByTestId('pane-hermes').getByRole('button',{name:'▶ 啟動',exact:true}).click();
  await expect.poll(async()=>(await request({op:'status'})).state).toBe('busy');
  await page.getByRole('radio',{name:/Claude Code/}).click();
  expect((await request({op:'status'})).state).toBe('busy');console.log('checkpoint',checks.length+1);checks.push('hidden open CLI session blocks restart');
  await page.evaluate(async()=>{await window.desk.stop('hermes');});
  await expect.poll(async()=>(await request({op:'status'})).state).toBe('idle');
  const status=await request({op:'status'});
  expect((await request({op:'restart',instance:'stale',pid:status.pid})).accepted).toBe(false);
  expect((await request({op:'restart',instance:status.instance,pid:status.pid})).accepted).toBe(false);console.log('checkpoint',checks.length+1);checks.push('stale identity and short idle refuse restart');
  // Advance only this disposable Electron process's clocks. Production still
  // requires fifteen real minutes; there is no shipped environment bypass.
  await app.evaluate(({app,powerMonitor})=>{
    const original=globalThis.performance.now.bind(globalThis.performance);globalThis.__idleOffset=0;
    Object.defineProperty(globalThis.performance,'now',{value:()=>original()+globalThis.__idleOffset,configurable:true});
    powerMonitor.getSystemIdleTime=()=>10000;
    globalThis.__restartCalls=0;globalThis.__quitCalls=0;globalThis.__originalQuit=app.quit.bind(app);
    app.relaunch=()=>{globalThis.__restartCalls++;};app.quit=()=>{globalThis.__quitCalls++;};
  });
  await request({op:'status'});await app.evaluate(()=>{globalThis.__idleOffset+=901000;});
  expect((await request({op:'status'})).idleForSeconds).toBeGreaterThanOrEqual(900);
  await page.getByRole('button',{name:'AI 互相對話',exact:true}).click();await page.getByRole('textbox',{name:'討論主題',exact:true}).fill('NEW WORK after previous idle observation');
  expect((await request({op:'restart',instance:status.instance,pid:status.pid})).accepted).toBe(false);
  expect(await page.evaluate(()=>document.body.inert)).toBe(false);console.log('checkpoint',checks.length+1);checks.push('final preflight catches newly entered work and resumes input');
  await page.getByRole('textbox',{name:'討論主題',exact:true}).fill('');await page.getByRole('button',{name:'收合 AI 討論'}).click();
  await request({op:'status'});await app.evaluate(()=>{globalThis.__idleOffset+=901000;});
  const accepted=await request({op:'restart',instance:status.instance,pid:status.pid});expect(accepted.accepted).toBe(true);
  await expect.poll(()=>app.evaluate(()=>globalThis.__quitCalls)).toBe(1);
  expect(await app.evaluate(()=>globalThis.__restartCalls)).toBe(1);expect(await page.evaluate(()=>document.body.inert)).toBe(true);
  const denied=await page.evaluate(()=>window.desk.start('claude',80,24));expect(denied.ok).toBe(false);expect(denied.error).toContain('安全重啟');console.log('checkpoint',checks.length+1);checks.push('safe relaunch and normal quit requested once; new work blocked');
  const report={passed:true,checks};await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/maintenance-e2e.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) { console.error(error); if(app){console.log('main diagnostics',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),loading:w.webContents.isLoading()}))).catch(()=>null));const p=await app.firstWindow().catch(()=>null);if(p)console.log('renderer diagnostics',await p.evaluate(()=>({maintenance:typeof window.desk?.maintenanceState,probe:typeof window.desk?.onMaintenanceProbe,text:document.body.innerText.slice(0,1600)})).catch(()=>null));} throw error; } finally {
  if(app){const page=await app.firstWindow().catch(()=>null);if(page)await page.evaluate(async()=>{await Promise.all(['hermes','claude','codex','antigravity'].map(id=>window.desk.stop(id)));}).catch(()=>{});await app.evaluate(({app})=>{if(globalThis.__originalQuit)app.quit=globalThis.__originalQuit;}).catch(()=>{});const exited=new Promise(resolve=>{if(app.process().exitCode!==null)resolve();else app.process().once('exit',resolve);});await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await exited;}
  await fs.rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
