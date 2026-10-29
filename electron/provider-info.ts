import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import type {PaneId,ProviderInfo,Settings} from './contracts';
import {launchSpec,resolveExecutable} from './commands';
import {agyModels,codexModels,codexWindows} from './provider-parsing';

// Only metadata methods are sent. No thread/start, turn/start, login or account
// mutation is exposed through IPC or this app-server connection.
export async function readCodexMetadata(executable:string,cwd:string,env:NodeJS.ProcessEnv):Promise<{models:any;limits:any;error?:string}>{
  const spec=launchSpec(executable,{executable,args:['app-server','--stdio']});
  const child=spawn(spec.file,spec.args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();let next=1,buffer='',received=0;
  const decoder=new StringDecoder('utf8');
  const fail=(error:Error)=>{for(const waiter of pending.values())waiter.reject(error);pending.clear();};
  child.on('error',fail);child.on('exit',()=>fail(new Error('CLI metadata service ended')));child.stdin.on('error',fail);child.stdout.on('error',fail);
  child.stderr.on('data',()=>{});
  child.stdout.on('data',data=>{
    received+=data.length;if(received>2*1024*1024){fail(new Error('CLI metadata response too large'));child.kill();return;}
    buffer+=decoder.write(data);
    while(buffer.includes('\n')){const index=buffer.indexOf('\n');const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const message=JSON.parse(line);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);if(message.error)waiter.reject(new Error(message.error.message||'CLI metadata error'));else waiter.resolve(message.result);}}catch{/* Non-protocol log line. */}}
  });
  const timer=setTimeout(()=>{fail(new Error('CLI metadata query timed out'));child.kill();},30000);
  const rpc=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,...(params?{params}:{})})+'\n');});
  try{
    await rpc('initialize',{clientInfo:{name:'ai_trinity_desk',title:'AI Trinity Desk',version:'1.3.0'}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const [models,limits]=await Promise.allSettled([rpc('model/list',{limit:100}),rpc('account/rateLimits/read')]);
    return {models:models.status==='fulfilled'?models.value:null,limits:limits.status==='fulfilled'?limits.value:null,error:limits.status==='rejected'?'帳號額度讀取失敗，請確認 Codex CLI 已登入。':undefined};
  }finally{
    clearTimeout(timer);child.stdin.end();fail(new Error('Metadata connection closed'));
    if(child.exitCode===null&&child.pid){
      if(process.platform==='win32')await new Promise<void>(resolve=>execFile(path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000},()=>resolve()));
      else child.kill();
    }
  }
}

export class ProviderReader{
  private pending=new Map<PaneId,Promise<ProviderInfo>>();
  constructor(private settings:()=>Settings,private env:NodeJS.ProcessEnv,private root:string){}
  read(id:PaneId){const existing=this.pending.get(id);if(existing)return existing;const task=this.query(id).finally(()=>this.pending.delete(id));this.pending.set(id,task);return task;}
  private async executable(id:PaneId){
    const configured=this.settings().commands[id];
    if(configured.args.length)throw new Error('此欄有自訂啟動參數，請在 CLI 內查看帳號額度，以免顯示不同帳號的資料。');
    const executable=await resolveExecutable(configured.executable,this.env);if(!executable)throw new Error('尚未找到 CLI，請先完成安裝。');
    const expected=id==='antigravity'?'agy':id;
    if(!new RegExp(`^${expected}(?:\\.(?:exe|cmd|ps1|bat))?$`,'i').test(path.basename(executable)))throw new Error('自訂 CLI 請自行指定模型，並使用其內建用量指令。');
    const managed=path.join(this.root,'clis','bin');
    if(executable.toLowerCase().startsWith((managed+path.sep).toLowerCase())){
      const data=JSON.parse(await readFile(path.join(this.root,'clis',id+'.json'),'utf8'));
      const target=path.resolve(data.executable);const allowed=path.resolve(this.root,'clis',id)+path.sep;
      if(!target.toLowerCase().startsWith(allowed.toLowerCase())||path.basename(target)!==id+'.exe'||!(await stat(target)).isFile())throw new Error('管理的 CLI 路徑驗證失敗。');
      return target;
    }return executable;
  }
  private async query(id:PaneId):Promise<ProviderInfo>{
    const base:ProviderInfo={id,models:[],windows:[],message:'',source:'CLI 帳號資料',updatedAt:new Date().toISOString()};
    if(id==='claude')return {...base,models:[{id:'opus',name:'Opus（官方別名，依帳號權限）'},{id:'sonnet',name:'Sonnet（官方別名，依帳號權限）'},{id:'haiku',name:'Haiku（官方別名，依帳號權限）'}],source:'Claude CLI 官方模型別名',message:'Claude CLI 未提供穩定的非互動帳號額度介面。請在 Claude 終端輸入 /usage 查看已用、剩餘額度與重置時間；此處不推算剩餘額度。'};
    try{
      const executable=await this.executable(id);const cwd=path.join(this.root,'metadata');await mkdir(cwd,{recursive:true});
      if(id==='codex'){
        const value=await readCodexMetadata(executable,cwd,this.env);
        const windows=codexWindows(value.limits);
        return {...base,models:codexModels(value.models),windows,message:value.error||(windows.length?'帳號額度由 Codex 服務提供；可能與其他裝置共用。':'服務未提供可顯示的帳號額度。請確認登入方式，或在 CLI 內輸入 /status 查看。'),source:'Codex app-server：model/list、account/rateLimits/read'};
      }
      const run=async(args:string[])=>{const spec=launchSpec(executable,{executable,args});return promisify(execFile)(spec.file,spec.args,{cwd,env:this.env,windowsHide:true,timeout:25000,maxBuffer:1024*1024});};
      const [models,usage]=await Promise.allSettled([run(['models']),run(['--disable-slash-commands=false','--print-timeout','15','--print','/usage'])]);
      return {...base,models:models.status==='fulfilled'?agyModels(models.value.stdout):[],usageText:usage.status==='fulfilled'?usage.value.stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').trim().slice(0,20000):undefined,message:usage.status==='fulfilled'?'下方顯示 Antigravity CLI 原始額度報告。':'Antigravity 額度讀取失敗或尚未登入。請在該 CLI 輸入 /usage；服務的地區限制仍適用。',source:'Antigravity CLI：agy models、agy --print /usage'};
    }catch(error){return {...base,message:error instanceof Error?error.message:'讀取失敗，請使用 CLI 內建用量指令。'};}
  }
}
