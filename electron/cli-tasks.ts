import {mkdir,readFile,writeFile,rename,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {cliTaskSchema,cliTaskCreateSchema,cliTaskPatchSchema,type CliTask,type CliTaskList,type Command,type Settings,type TerminalEvent} from './contracts';
import {Sessions,type SpawnPty} from './sessions';

const uuid=z.string().uuid();
const storeSchema=z.object({version:z.literal(1),selected:uuid.optional(),tasks:z.array(cliTaskSchema).max(500)}).strict();
export class CliTaskStore{
  private state:z.infer<typeof storeSchema>={version:1,tasks:[]};private queue:Promise<unknown>=Promise.resolve();private loaded?:Promise<void>;private failed=false;
  constructor(private file:string){}
  async load(){if(!this.loaded)this.loaded=(async()=>{try{if((await stat(this.file)).size>4*1024*1024)throw new Error('過大');const state=storeSchema.parse(JSON.parse(await readFile(this.file,'utf8')));if(new Set(state.tasks.map(t=>t.id)).size!==state.tasks.length)throw new Error('重複任務');this.state=state;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.failed=true;throw new Error('任務清單無法讀取，原檔已保留；請先備份並檢查檔案。');}}})();await this.loaded;return structuredClone(this.state);}
  async mutate(update:(state:z.infer<typeof storeSchema>)=>void){const task=this.queue.catch(()=>{}).then(async()=>{await this.load();if(this.failed)throw new Error('任務清單損壞，已停止寫入。');const next=structuredClone(this.state);update(next);storeSchema.parse(next);await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600});await rename(this.file+'.tmp',this.file);this.state=next;return structuredClone(next);});this.queue=task;return task;}
  async flush(){await this.queue;}
}

// A hook receives native session metadata only. It produces no model context,
// stores no prompts, and runs using Electron's bundled Node runtime.
export const captureHelper=`const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{input+=s;if(input.length>65536)process.exit(1);});process.stdin.on('end',()=>{try{const value=JSON.parse(input),id=value.session_id;if(typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))process.exit(1);const file=process.argv[2]||process.env.TRINITY_TASK_CAPTURE;if(!file)process.exit(1);fs.writeFileSync(file+'.tmp',JSON.stringify({id}),{mode:0o600});fs.renameSync(file+'.tmp',file);}catch{process.exitCode=1;}});`;
function shellQuote(text:string){return "'"+text.replace(/'/g,"'\\''")+"'";}
export function captureCommand(executable:string,helper:string,file:string,platform=process.platform){
  if(platform==='win32'){const q=(s:string)=>"'"+s.replace(/'/g,"''")+"'";const script=`$env:ELECTRON_RUN_AS_NODE='1'; & ${q(executable)} ${q(helper)} ${q(file)}`;return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`;}
  return `/usr/bin/env ELECTRON_RUN_AS_NODE=1 ${shellQuote(executable)} ${shellQuote(helper)} ${shellQuote(file)}`;
}
export function taskCommand(task:CliTask,command:Command,files:{capture:string;helper:string;log:string;runtime:string}):Command{
  const expected=task.provider==='antigravity'?'agy':task.provider;
  if(!new RegExp(`^${expected}(?:\\.(?:exe|cmd|ps1|bat))?$`,'i').test(path.basename(command.executable)))throw new Error('任務接續需要對應官方 CLI；請在設定使用 claude、codex 或 agy 執行檔。');
  if(command.args.some(a=>/^(?:resume|fork|exec|--(?:resume|continue|conversation|session-id|fork-session|no-session-persistence|print|output-format|input-format|log-file|remote|ephemeral|session-name))(?:=|$)/.test(a)||['-c','-r','-p'].includes(a)))throw new Error('任務會管理對話接續，請先移除設定中既有的 resume／continue／非互動模式參數。');
  const args=[...command.args];
  if(task.provider==='claude'){
    if(command.args.some(a=>a==='--settings'||a.startsWith('--settings=')))throw new Error('任務需要加入對話 ID 記錄，請先移除自訂 --settings 參數。原有使用者設定仍由 CLI 載入。');
    args.push('--settings',JSON.stringify({hooks:{SessionStart:[{matcher:'startup|resume|clear|compact',hooks:[{type:'command',command:captureCommand(files.runtime,files.helper,files.capture),timeout:10}]}]}}));
    if(task.nativeSessionId)args.push('--resume',task.nativeSessionId);else args.push('--session-id',task.id);
  }
  if(task.provider==='codex'){
    const hook=captureCommand(files.runtime,files.helper,files.capture);
    args.push('-c',`hooks.SessionStart=[{matcher="startup|resume|clear|fork",hooks=[{type="command",command=${JSON.stringify(hook)},timeout=10}]}]`);
    if(task.nativeSessionId)args.push('resume',task.nativeSessionId);
  }
  if(task.provider==='antigravity'){args.push('--log-file',files.log);if(task.nativeSessionId)args.push('--conversation',task.nativeSessionId);}
  return {...command,args};
}
export function capturedConversation(provider:CliTask['provider'],text:string){
  if(provider==='codex'){try{const result=JSON.parse(text);return uuid.parse(result.id);}catch{return;}}
  // Read only the per-task log; never guess the newest conversation for a cwd.
  const matches=[...text.matchAll(/(?:Created conversation |conversationID[=:]"?)([0-9a-f-]{36})/gi)];
  const value=matches.at(-1)?.[1];return uuid.safeParse(value).success?value:undefined;
}
async function readLimited(file:string,max:number){const handle=await open(file,'r');try{const size=(await handle.stat()).size;const buffer=Buffer.alloc(Math.min(size,max));await handle.read(buffer,0,buffer.length,Math.max(0,size-max));return buffer.toString('utf8');}finally{await handle.close();}}
type Runtime={sessions:Sessions;provider:CliTask['provider'];timer?:ReturnType<typeof setInterval>;checking:boolean;capture:string;log:string;warn?:string};
export class CliTasks{
  private runtimes=new Map<string,Runtime>();private starting=new Set<string>();private warning?:string;private closing=false;
  constructor(private store:CliTaskStore,private root:string,private spawn:SpawnPty,private env:NodeJS.ProcessEnv,private settings:()=>Settings,private emitTerminal:(event:TerminalEvent)=>void,private emitList:(state:CliTaskList)=>void,private runtime=process.execPath){}
  get active(){return this.starting.size>0||[...this.runtimes.values()].some(r=>r.sessions.active);}
  async list():Promise<CliTaskList>{const state=await this.store.load();return {selected:state.selected,warning:this.warning,tasks:state.tasks.map(task=>({...task,running:this.runtimes.get(task.id)?.sessions.active||this.starting.has(task.id),resumeReady:!!task.nativeSessionId,warning:this.runtimes.get(task.id)?.warn}))};}
  private async publish(){this.emitList(await this.list());}
  private async task(id:string){uuid.parse(id);const task=(await this.store.load()).tasks.find(t=>t.id===id);if(!task)throw new Error('找不到此任務。');return task;}
  async create(input:unknown){const value=cliTaskCreateSchema.parse(input),settings=this.settings();if(!settings.projectPath||!(await stat(settings.projectPath)).isDirectory())throw new Error('請先選擇有效的專案資料夾。');const now=new Date().toISOString();await this.store.mutate(state=>{if(state.tasks.length>=500)throw new Error('任務已達 500 筆上限。');if(value.nativeSessionId&&state.tasks.some(t=>t.provider===value.provider&&t.nativeSessionId===value.nativeSessionId))throw new Error('此原生對話已連結其他任務。');const task:CliTask={id:randomUUID(),provider:value.provider,title:value.title,projectPath:settings.projectPath,model:settings.models[value.provider],createdAt:now,updatedAt:now,pinned:false,archived:false,nativeSessionId:value.nativeSessionId,launched:!!value.nativeSessionId};state.tasks.push(task);state.selected=task.id;});await this.publish();return this.list();}
  async select(id:string){const task=await this.task(id);if(task.archived)throw new Error('請先還原封存任務。');await this.store.mutate(state=>{state.selected=id;});await this.publish();return this.list();}
  async patch(input:unknown){const value=cliTaskPatchSchema.parse(input);await this.task(value.id);if(value.archived&&(this.starting.has(value.id)||this.runtimes.get(value.id)?.sessions.active))throw new Error('請先停止此任務，再封存。');await this.store.mutate(state=>{const task=state.tasks.find(t=>t.id===value.id)!;if(value.title!==undefined)task.title=value.title;if(value.pinned!==undefined)task.pinned=value.pinned;if(value.archived!==undefined)task.archived=value.archived;task.updatedAt=new Date().toISOString();if(task.archived&&state.selected===task.id)state.selected=undefined;});await this.publish();return this.list();}
  async start(id:string,cols:number,rows:number){
    if(this.closing)throw new Error('任務正在關閉，請稍後再試。');
    if(this.starting.has(id)||this.runtimes.get(id)?.sessions.active)throw new Error('任務已在執行；請切回原工作階段。');
    if([...this.runtimes.values()].filter(r=>r.sessions.active).length+this.starting.size>=12)throw new Error('同時執行上限為 12 個任務，請先停止不需要的任務。');
    this.starting.add(id);let opened:Runtime|undefined;
    try{
      let task=await this.task(id);if(task.archived)throw new Error('請先還原封存任務。');
      if(task.launched&&!task.nativeSessionId){await this.capture(id);task=await this.task(id);if(!task.nativeSessionId)throw new Error('尚未取得原生對話 ID，已保留任務並停止另開對話。請從 CLI 的 /status、/resume 或離開提示取得 ID，再使用「連結對話 ID」。');}
      const directory=path.join(this.root,id);await mkdir(directory,{recursive:true});const helper=path.join(this.root,'capture.cjs');await writeFile(helper,captureHelper,{mode:0o600});
      const files={helper,capture:path.join(directory,'session.json'),log:path.join(directory,'native.log'),runtime:this.runtime};
      // Retain previous capture for resume validation; fresh tasks have unique dirs.
      const settings=structuredClone(this.settings());settings.projectPath=task.projectPath;settings.models[task.provider]=task.model;settings.commands[task.provider]=taskCommand(task,settings.commands[task.provider],files);
      const previous=this.runtimes.get(id);if(previous?.timer)clearInterval(previous.timer);
      const sessions=new Sessions(this.spawn,event=>{
        this.emitTerminal({...event,taskId:id});
        if(event.type==='exit'){const runtime=this.runtimes.get(id);if(runtime?.timer)clearInterval(runtime.timer);void this.capture(id).then(()=>this.publish()).catch(()=>{});}
      },{...this.env,TRINITY_TASK_CAPTURE:files.capture});
      const runtime:Runtime={sessions,provider:task.provider,checking:false,capture:files.capture,log:files.log};this.runtimes.set(id,runtime);opened=runtime;
      const info=await sessions.start(task.provider,settings,cols,rows);
      await this.store.mutate(state=>{const item=state.tasks.find(t=>t.id===id)!;item.launched=true;item.updatedAt=new Date().toISOString();});
      if(sessions.active){runtime.timer=setInterval(()=>{void this.capture(id).catch(()=>{});},1500);runtime.timer.unref();}
      await this.publish();return info;
    }catch(error){if(opened?.sessions.active)await opened.sessions.stop(opened.provider).catch(()=>{});throw error;}finally{this.starting.delete(id);await this.publish().catch(()=>{});}
  }
  private async capture(id:string){
    const runtime=this.runtimes.get(id);if(runtime?.checking)return;if(runtime)runtime.checking=true;
    try{const task=await this.task(id);let nativeId:string|undefined;
      if(task.provider==='claude'){
        // Claude accepts an explicit UUID at creation. A transcript must exist
        // before claiming the native resume target is ready.
        const captured=await readLimited(runtime?.capture||path.join(this.root,id,'session.json'),4096).then(text=>capturedConversation('codex',text)).catch(()=>undefined);
        const home=this.env.CLAUDE_CONFIG_DIR||path.join(this.env.USERPROFILE||this.env.HOME||'','.claude');
        const {readdir}=await import('node:fs/promises');const projects=path.join(home,'projects');const folders=(await readdir(projects,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).slice(0,1000);
        for(const entry of folders){const candidate=path.join(projects,entry.name,(captured||task.nativeSessionId||task.id)+'.jsonl');if((await stat(candidate).catch(()=>undefined))?.isFile()){nativeId=captured||task.nativeSessionId||task.id;break;}}
      }else nativeId=capturedConversation(task.provider,await readLimited(task.provider==='codex'?(runtime?.capture||path.join(this.root,id,'session.json')):(runtime?.log||path.join(this.root,id,'native.log')),524288));
      if(nativeId&&nativeId!==task.nativeSessionId){await this.store.mutate(state=>{const item=state.tasks.find(t=>t.id===id)!;if(state.tasks.some(t=>t.id!==id&&t.provider===item.provider&&t.nativeSessionId===nativeId))throw new Error('此原生對話已連結其他任務。');item.nativeSessionId=nativeId;item.updatedAt=new Date().toISOString();});if(runtime)runtime.warn=undefined;await this.publish();}
    }catch(error){if(runtime&&(error as NodeJS.ErrnoException).code!=='ENOENT')runtime.warn='對話 ID 尚未確認；停止後不會自動另開新對話。';}
    finally{if(runtime)runtime.checking=false;}
  }
  async bind(id:string,nativeSessionId:string){await this.task(id);uuid.parse(nativeSessionId);if(this.starting.has(id)||this.runtimes.get(id)?.sessions.active)throw new Error('請先停止任務再連結 ID。');await this.store.mutate(state=>{const task=state.tasks.find(t=>t.id===id)!;if(state.tasks.some(t=>t.id!==id&&t.provider===task.provider&&t.nativeSessionId===nativeSessionId))throw new Error('此對話已連結其他任務。');task.nativeSessionId=nativeSessionId;task.launched=true;task.updatedAt=new Date().toISOString();});await this.publish();return this.list();}
  private session(id:string){const runtime=this.runtimes.get(uuid.parse(id));if(!runtime)throw new Error('任務尚未啟動。');return runtime.sessions;}
  input(id:string,token:string,data:string){this.session(id).write(this.provider(id),token,data);}
  private provider(id:string){return this.runtimes.get(id)!.provider;}
  resize(id:string,token:string,cols:number,rows:number){this.session(id).resize(this.provider(id),token,cols,rows);}
  ack(id:string,token:string,bytes:number){this.runtimes.get(id)?.sessions.ack(this.provider(id),token,bytes);}
  async stop(id:string){const task=await this.task(id);await this.runtimes.get(id)?.sessions.stop(task.provider);await this.capture(id);await this.publish();}
  async shutdown(){this.closing=true;try{while(this.starting.size)await new Promise(resolve=>setTimeout(resolve,20));await Promise.all([...this.runtimes.keys()].map(id=>this.stop(id)));for(const runtime of this.runtimes.values())if(runtime.timer)clearInterval(runtime.timer);await this.store.flush();}finally{this.closing=false;}}
}
