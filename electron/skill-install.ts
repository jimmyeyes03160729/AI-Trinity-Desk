import * as yauzl from 'yauzl';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import type {MarketSkill,PaneId,SkillInstallState} from './contracts';
import {skillInstallSchema} from './contracts';

export function skillRoots(home:string):Record<PaneId,string>{return {claude:path.join(home,'.claude','skills'),codex:path.join(home,'.agents','skills'),antigravity:path.join(home,'.gemini','antigravity-cli','skills')};}
export function archivePath(name:string){
  if(!name||name.startsWith('/')||name.includes('\\')||/[\x00-\x1f:]/.test(name)||name.split('/').includes('..')||name.split('/').includes('.'))throw new Error('Skill 封存檔含不安全路徑。');
  return name;
}
function windowsSafe(relative:string){return relative.split('/').every(part=>part&&!/[<>:"|?*\x00-\x1f]/.test(part)&&!/[. ]$/.test(part)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));}
function norm(name:string){return name.toLowerCase().replace(/[^a-z0-9]/g,'');}
export async function readSkillArchive(buffer:Buffer,skill:Pick<MarketSkill,'slug'|'name'>,signal:AbortSignal):Promise<Map<string,Buffer>>{
  if(buffer.length>64*1024*1024)throw new Error('Skill 來源封存檔超過 64 MiB。');
  const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,autoClose:false},(error,result)=>error?reject(error):resolve(result)));
  const entries:yauzl.Entry[]=[];let totalRead=0;
  const read=(entry:yauzl.Entry,max:number)=>new Promise<Buffer>((resolve,reject)=>{
    signal.throwIfAborted();if(entry.uncompressedSize>max)return reject(new Error('Skill 檔案超過大小限制。'));
    zip.openReadStream(entry,(error,stream)=>{if(error||!stream)return reject(error||new Error('無法讀取 Skill 檔案。'));const chunks:Buffer[]=[];let size=0;stream.on('data',(chunk:Buffer)=>{size+=chunk.length;totalRead+=chunk.length;if(size>max||totalRead>32*1024*1024||signal.aborted){stream.destroy(new Error('Skill 解壓縮超過限制或已取消。'));return;}chunks.push(chunk);});stream.on('error',reject);stream.on('end',()=>resolve(Buffer.concat(chunks)));});
  });
  try{
    await new Promise<void>((resolve,reject)=>{zip.on('error',reject);zip.on('entry',entry=>{try{signal.throwIfAborted();archivePath(entry.fileName);if(entries.length>=40000)throw new Error('來源封存檔項目過多。');entries.push(entry);zip.readEntry();}catch(error){reject(error);}});zip.on('end',resolve);zip.readEntry();});
    const manifests=entries.filter(e=>/(?:^|\/)SKILL\.md$/i.test(e.fileName)&&!e.fileName.split('/').some(p=>p==='.git'));
    const preferred=manifests.filter(e=>[skill.slug,skill.name].some(name=>norm(path.posix.basename(path.posix.dirname(e.fileName)))===norm(name)));
    const candidates=preferred.length?preferred:manifests.slice(0,120);const matches:{entry:yauzl.Entry;data:Buffer}[]=[];
    for(const entry of candidates){const data=await read(entry,262144),text=data.toString('utf8'),header=text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);const name=header?.[1].match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim();if(name&&[skill.slug,skill.name].some(value=>norm(value)===norm(name))&&/^description:\s*\S/m.test(header![1]))matches.push({entry,data});}
    if(!matches.length)throw new Error('找不到與市場項目相符、具有 name／description 的 SKILL.md。');
    if(matches.some(m=>!m.data.equals(matches[0].data)))throw new Error('來源有多個不同內容的同名 Skill，請先在來源確認。');
    matches.sort((a,b)=>a.entry.fileName.length-b.entry.fileName.length);const manifest=matches[0],directory=path.posix.dirname(manifest.entry.fileName)+'/',files=new Map<string,Buffer>();let extracted=0;
    for(const entry of entries.filter(e=>e.fileName.startsWith(directory)&&!e.fileName.endsWith('/'))){
      signal.throwIfAborted();const relative=entry===manifest.entry?'SKILL.md':entry.fileName.slice(directory.length);if(!windowsSafe(relative)||((entry.externalFileAttributes>>>16)&0o170000)===0o120000)throw new Error('Skill 內含不支援的檔名或連結。');
      if(files.size>=500)throw new Error('單一 Skill 檔案超過 500 個。');const data=entry===manifest.entry?manifest.data:await read(entry,8*1024*1024);extracted+=data.length;if(extracted>25*1024*1024)throw new Error('單一 Skill 解壓縮超過 25 MiB。');files.set(relative,data);
    }return files;
  }finally{zip.close();}
}
export async function githubSkillFetch(url:string,transport:typeof fetch,signal:AbortSignal){
  for(let redirects=0;redirects<4;redirects++){
    const target=new URL(url);if(target.protocol!=='https:'||!['api.github.com','codeload.github.com'].includes(target.hostname)||target.port||target.username||target.password)throw new Error('拒絕非 GitHub Skill 來源。');
    const response=await transport(target,{credentials:'omit',redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),headers:{Accept:'application/vnd.github+json','User-Agent':'AI-Trinity-Desk'}});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw new Error('來源重新導向無效。');url=new URL(location,target).href;continue;}
    if(!response.ok)throw new Error(`GitHub 下載失敗（HTTP ${response.status}），請稍後重試。`);return response;
  }throw new Error('來源重新導向過多。');
}
async function ensurePlainRoot(root:string){
  const resolved=path.resolve(root);let current=path.parse(resolved).root;
  for(const part of resolved.slice(current.length).split(path.sep)){current=path.join(current,part);const info=await lstat(current).catch(()=>undefined);if(info?.isSymbolicLink()||(info&&!info.isDirectory()))throw new Error('安裝位置含連結或非資料夾，已保留原有內容。');}
  await mkdir(resolved,{recursive:true});return resolved;
}
export class SkillInstaller{
  private states=new Map<string,SkillInstallState>();private queue:Promise<unknown>=Promise.resolve();private requests=new Map<string,Promise<SkillInstallState[]>>();private controllers=new Map<string,AbortController>();private initialized?:Promise<void>;
  constructor(private lookup:(id:string)=>MarketSkill,private roots:Record<PaneId,string>,private file:string,private transport:typeof fetch,private emit:(states:SkillInstallState[])=>void){}
  get active(){return this.controllers.size>0;}
  private key(id:string,ai:PaneId){return id+'|'+ai;}
  private async init(){if(!this.initialized)this.initialized=(async()=>{try{const data=JSON.parse(await readFile(this.file,'utf8'));for(const record of data.slice(0,1000))if(typeof record.id==='string'&&['claude','codex','antigravity'].includes(record.ai)&&record.status==='installed'){const slug=record.id.split('/').at(-1);if(/^[a-zA-Z0-9][\w.-]{0,119}$/.test(slug)&&record.folder===path.join(this.roots[record.ai as PaneId],slug))this.states.set(this.key(record.id,record.ai),record);}}catch{}})();await this.initialized;}
  private publish(){this.emit([...this.states.values()].map(s=>({...s})));}
  private set(state:SkillInstallState){this.states.set(this.key(state.id,state.ai),state);this.publish();}
  private async save(){await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify([...this.states.values()].filter(s=>s.status==='installed')),{encoding:'utf8',mode:0o600});await rename(this.file+'.tmp',this.file);}
  async snapshot(){await this.init();for(const [key,state] of this.states)if(state.status==='installed'&&!(await lstat(path.join(state.folder!,'SKILL.md')).catch(()=>undefined))?.isFile())this.states.delete(key);return [...this.states.values()];}
  async scan(skills:MarketSkill[]){await this.init();for(const skill of skills)for(const ai of ['claude','codex','antigravity'] as const){const key=this.key(skill.id,ai);if(this.states.has(key))continue;const folder=path.join(this.roots[ai],skill.slug);if(await lstat(folder).catch(()=>undefined))this.states.set(key,{id:skill.id,ai,status:'existing',folder,message:'此 AI 的同名位置已存在，來源尚未確認；不會覆寫。'});}this.publish();return this.snapshot();}
  cancel(id:string){this.controllers.get(id)?.abort();}
  async shutdown(){for(const controller of this.controllers.values())controller.abort();await this.queue.catch(()=>{});}
  install(input:unknown):Promise<SkillInstallState[]>{
    const request=skillInstallSchema.parse(input),skill=this.lookup(request.id);const existing=this.requests.get(request.id);if(existing)return existing;
    const controller=new AbortController();this.controllers.set(request.id,controller);
    const task=this.queue.catch(()=>{}).then(async()=>{
      await this.init();const pending:PaneId[]=[];
      for(const ai of request.targets){const folder=path.join(this.roots[ai],skill.slug),info=await lstat(folder).catch(()=>undefined);if(info){const previous=this.states.get(this.key(skill.id,ai)),manifest=await lstat(path.join(folder,'SKILL.md')).catch(()=>undefined);this.set(previous?.status==='installed'&&!info.isSymbolicLink()&&manifest?.isFile()?previous:{id:skill.id,ai,status:'existing',folder,message:'同名位置已存在，未覆寫；請自行核對來源。'});}else{pending.push(ai);this.set({id:skill.id,ai,status:'queued',folder,message:'等待下載'});}}
      try{
        controller.signal.throwIfAborted();if(!pending.length)return this.snapshot();
        for(const ai of pending)this.set({id:skill.id,ai,status:'downloading',folder:path.join(this.roots[ai],skill.slug),message:'正在從 GitHub 下載指定 Skill'});
        const metadata=await (await githubSkillFetch(`https://api.github.com/repos/${skill.source}/commits?per_page=1`,this.transport,controller.signal)).json() as any;
        const commit=metadata?.[0]?.sha;if(typeof commit!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit))throw new Error('無法驗證來源版本。');
        const response=await githubSkillFetch(`https://codeload.github.com/${skill.source}/zip/${commit}`,this.transport,controller.signal);
        if(Number(response.headers.get('content-length'))>64*1024*1024)throw new Error('Skill 來源封存檔過大。');
        const files=await readSkillArchive(Buffer.from(await response.arrayBuffer()),skill,controller.signal);
        for(const ai of pending){
          controller.signal.throwIfAborted();const root=await ensurePlainRoot(this.roots[ai]),folder=path.join(root,skill.slug),stagingBase=await ensurePlainRoot(path.join(path.dirname(root),'.trinity-skill-staging')),staging=path.join(stagingBase,randomUUID());
          this.set({id:skill.id,ai,status:'installing',folder,commit,message:'正在寫入此 AI 的使用者 Skills 目錄'});
          try{await mkdir(staging);for(const [relative,data] of files){controller.signal.throwIfAborted();const target=path.resolve(staging,...relative.split('/'));if(!target.startsWith(staging+path.sep))throw new Error('安裝路徑超出範圍。');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});}controller.signal.throwIfAborted();if(await lstat(folder).catch(()=>undefined))throw new Error('安裝位置已存在，未覆寫。');await rename(staging,folder);
            const digest=createHash('sha256').update(files.get('SKILL.md')!).digest('hex');this.set({id:skill.id,ai,status:'installed',folder,commit,message:`已安裝 ${files.size} 個檔案；SKILL.md SHA-256 ${digest}。重新開啟此 CLI 後可載入。`});await this.save();
          }finally{if(path.dirname(staging)===stagingBase)await rm(staging,{recursive:true,force:true}).catch(()=>{});}
        }
      }catch(error){for(const ai of pending){const state=this.states.get(this.key(skill.id,ai));if(state?.status!=='installed')this.set({id:skill.id,ai,status:controller.signal.aborted?'cancelled':'error',folder:state?.folder,message:controller.signal.aborted?'已取消安裝':error instanceof Error?error.message:String(error)});}}
      return this.snapshot();
    }).finally(()=>{this.controllers.delete(request.id);this.requests.delete(request.id);});this.requests.set(request.id,task);this.queue=task;return task;
  }
}
