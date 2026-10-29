import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CliTaskStore,CliTasks,taskCommand,capturedConversation,captureCommand} from '../electron/cli-tasks';
import {defaultSettings,cliTaskCreateSchema,cliTaskPatchSchema,type CliTask} from '../electron/contracts';
const fixture=():CliTask=>({id:randomUUID(),provider:'codex',title:'任務',projectPath:os.tmpdir(),model:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pinned:false,archived:false,launched:false});
const files={capture:'C:/test/native.json',helper:'C:/test/capture.cjs',log:'C:/test/native.log',runtime:'C:/test/Electron.exe'};
test('task native resume uses exact IDs, never latest-session guesses or copied text',()=>{
  for(const provider of ['claude','codex','antigravity'] as const){const task={...fixture(),provider,nativeSessionId:randomUUID()};const args=taskCommand(task,{executable:provider==='antigravity'?'agy':provider,args:[]},files).args;assert.ok(args.includes(task.nativeSessionId));assert.ok(!args.includes('--last'));assert.ok(!args.includes('--continue'));}
  const task={...fixture(),provider:'claude' as const};const initial=taskCommand(task,{executable:'claude',args:[]},files).args;assert.ok(initial.includes('--session-id'));assert.ok(initial.includes(task.id));assert.ok(initial.includes('--settings'));
  assert.throws(()=>taskCommand(task,{executable:'powershell.exe',args:[]},files),/官方 CLI/);
  assert.throws(()=>taskCommand(task,{executable:'claude',args:['--continue']},files),/移除/);
  assert.throws(()=>cliTaskCreateSchema.parse({provider:'claude',title:'name',projectPath:'/untrusted'}));assert.throws(()=>cliTaskPatchSchema.parse({id:task.id,nativeSessionId:randomUUID()}));
});
test('capture parses only per-task metadata and shell paths are encoded literally',()=>{
  const id=randomUUID();assert.equal(capturedConversation('codex',JSON.stringify({id})),id);assert.equal(capturedConversation('antigravity',`Created conversation ${id} (backend=...)`),id);assert.equal(capturedConversation('antigravity',`prompt mentions random ${id}`),undefined);assert.equal(capturedConversation('codex','malformed'),undefined);
  const command=captureCommand("C:/A ' & B/Electron.exe",'C:/語言/capture.cjs',files.capture,'win32');const script=Buffer.from(command.split(' ').at(-1)!,'base64').toString('utf16le');assert.ok(script.includes("'C:/A '' & B/Electron.exe'"));assert.ok(script.includes('ELECTRON_RUN_AS_NODE'));assert.ok(captureCommand('/A a/node',"/a'b/helper",'/tmp/id','darwin').includes("'\\''"));
});
test('task store preserves multiple conversations, serializes updates and fails closed on corruption',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-tasks-store-')),file=path.join(root,'index.json'),store=new CliTaskStore(file),one=fixture(),two=fixture();
  await Promise.all([store.mutate(s=>s.tasks.push(one)),store.mutate(s=>s.tasks.push(two))]);assert.equal((await new CliTaskStore(file).load()).tasks.length,2);
  await store.mutate(s=>{s.tasks[0].pinned=true;s.tasks[1].archived=true;});assert.ok((await new CliTaskStore(file).load()).tasks[1].archived);
  await writeFile(file,'CORRUPTED_OWNER_DATA');const broken=new CliTaskStore(file);await assert.rejects(()=>broken.load(),/原檔已保留/);await assert.rejects(()=>broken.mutate(s=>s.tasks=[]));assert.equal(await readFile(file,'utf8'),'CORRUPTED_OWNER_DATA');
});
test('individual CLI tasks retain project/model, reject archive while live, restore metadata and refuse unknown resume',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-tasks-run-')),settings=defaultSettings();settings.projectPath=root;settings.models.codex='selected-model';settings.commands.codex.executable=process.execPath.replace(/[^\\/]+$/,'codex.exe');
  // The command resolver needs an actual file, while spawn remains a fake PTY.
  const executable=path.join(root,'codex.exe');await writeFile(executable,'fixture',{mode:0o755});settings.commands.codex.executable=executable;
  const seen:any[]=[];let exit:((event:{exitCode:number})=>void)|undefined;
  const spawn:any=(_file:string,args:string[],options:any)=>{seen.push({args,options});return {pid:2147483000,onData:()=>{},onExit:(callback:any)=>{exit=callback;},write:()=>{},resize:()=>{},pause:()=>{},resume:()=>{},kill:()=>exit?.({exitCode:0})};};
  const store=new CliTaskStore(path.join(root,'index.json'));const manager=new CliTasks(store,path.join(root,'tasks'),spawn,process.env,()=>settings,()=>{},()=>{});
  const created=await manager.create({provider:'codex',title:'持續工作'}),id=created.selected!;settings.projectPath=os.tmpdir();settings.models.codex='changed-model';
  const first=await manager.start(id,80,24);assert.ok(seen[0].args.includes('selected-model'));assert.equal(seen[0].options.cwd,root);await assert.rejects(()=>manager.patch({id,archived:true}),/停止/);
  assert.throws(()=>manager.input(id,randomUUID(),'x'),/已結束/);assert.ok(first.session);
  await manager.stop(id);await assert.rejects(()=>manager.start(id,80,24),/停止另開對話/);assert.equal(seen.length,1);
  const native=randomUUID();await manager.bind(id,native);await manager.start(id,80,24);assert.ok(seen[1].args.includes('resume'));assert.ok(seen[1].args.includes(native));await manager.stop(id);
  await manager.patch({id,pinned:true,archived:true});const restored=new CliTasks(new CliTaskStore(path.join(root,'index.json')),path.join(root,'tasks'),spawn,process.env,()=>settings,()=>{},()=>{});assert.equal((await restored.list()).tasks[0].nativeSessionId,native);assert.equal((await restored.list()).tasks[0].running,false);await assert.rejects(()=>restored.start(id,80,24),/還原/);
  await restored.shutdown();await manager.shutdown();
});
test('crash recovery recovers the exact captured session rather than starting another conversation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-tasks-recover-')),task={...fixture(),launched:true},store=new CliTaskStore(path.join(root,'index.json'));await store.mutate(s=>s.tasks.push(task));await mkdir(path.join(root,'tasks',task.id),{recursive:true});const native=randomUUID();await writeFile(path.join(root,'tasks',task.id,'session.json'),JSON.stringify({id:native}));
  const settings=defaultSettings(),exe=path.join(root,'codex.exe');await writeFile(exe,'fixture',{mode:0o755});settings.commands.codex.executable=exe;let args:string[]=[];let onExit:any;
  const spawn:any=(_file:string,value:string[])=>{args=value;return {pid:2147483000,onData:()=>{},onExit:(callback:any)=>{onExit=callback;},write:()=>{},resize:()=>{},pause:()=>{},resume:()=>{},kill:()=>onExit({exitCode:0})};};
  const manager=new CliTasks(store,path.join(root,'tasks'),spawn,process.env,()=>settings,()=>{},()=>{});await manager.start(task.id,80,24);assert.ok(args.includes(native));assert.equal((await manager.list()).tasks[0].nativeSessionId,native);await manager.shutdown();
});
