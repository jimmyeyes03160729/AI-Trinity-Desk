import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import type {MarketQuery,MarketResult,MarketSkill} from './contracts';
import {marketQuerySchema,marketLinkSchema} from './contracts';
import {catalogSkills,describeSkill} from './skill-catalog';
import {inspectProject,recommendSkills} from './project-profile';
const allowedHosts=new Set(['skills.sh','www.skills.sh']);
const sourcePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const slugPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
export function normalizeMarketSkills(rows:unknown):MarketSkill[]{
  if(!Array.isArray(rows))throw new Error('市場回傳格式已變更。');
  const seen=new Set<string>(),skills:MarketSkill[]=[];
  for(let index=0;index<Math.min(rows.length,700);index++){
    const row=rows[index];if(!row||typeof row!=='object')continue;
    const value=row as Record<string,unknown>,source=value.source;
    const slug=typeof value.skillId==='string'?value.skillId:typeof value.slug==='string'?value.slug:typeof value.id==='string'?value.id.split('/').at(-1):undefined;
    if(typeof source!=='string'||!sourcePattern.test(source)||typeof slug!=='string'||!slugPattern.test(slug)||value.isDuplicate===true)continue;
    const id=source+'/'+slug;if(seen.has(id))continue;seen.add(id);
    const name=(typeof value.name==='string'?value.name:slug).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160);
    const installs=typeof value.installs==='number'&&Number.isSafeInteger(value.installs)&&value.installs>=0?value.installs:undefined;
    skills.push({id,source,slug,name,...describeSkill(source,slug,name),installs,rank:typeof value.rank==='number'&&Number.isSafeInteger(value.rank)&&value.rank>0?value.rank:index+1,reasons:[],marketUrl:`https://www.skills.sh/${source}/${slug}`,sourceUrl:`https://github.com/${source}`});
  }return skills;
}
// Decode only JSON data embedded in the public page. No scripts or skill text
// are evaluated or executed, and page URLs never enter the renderer as HTML.
export function parseMarketPage(html:string):MarketSkill[]{
  for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){
    const call=match[1].match(/^self\.__next_f\.push\((.*)\)$/s);if(!call)continue;
    let payload:unknown;try{payload=JSON.parse(call[1])[1];}catch{continue;}
    if(typeof payload!=='string')continue;
    const marker=payload.indexOf('"initialSkills":[');if(marker<0)continue;
    const start=payload.indexOf('[',marker);let depth=0,quoted=false,escaped=false;
    for(let index=start;index<payload.length;index++){
      const char=payload[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}if(char==='['||char==='{')depth++;if(char===']'||char==='}')depth--;
      if(depth===0){try{const result=normalizeMarketSkills(JSON.parse(payload.slice(start,index+1)));if(result.length)return result;}catch{}break;}
    }
  }throw new Error('市場網頁結構已變更，暫時無法讀取排行。');
}
export async function fetchMarket(url:string,transport:typeof fetch):Promise<Response>{
  for(let redirects=0;redirects<4;redirects++){
    const target=new URL(url);if(target.protocol!=='https:'||!allowedHosts.has(target.hostname)||target.port||target.username||target.password)throw new Error('拒絕非市場來源的連線。');
    const response=await transport(target,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json, text/html'}});
    if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)throw new Error('市場重新導向無效。');url=new URL(next,target).href;continue;}
    if(!response.ok)throw new Error(`市場服務暫時無法使用（HTTP ${response.status}）。`);
    return response;
  }throw new Error('市場重新導向次數過多。');
}
type Snapshot={skills:MarketSkill[];updatedAt:string;source:string;stale:boolean;warning?:string};
export class SkillMarket{
  private cache=new Map<string,Snapshot>();
  private pending=new Map<string,Promise<Snapshot>>();
  private links=new Map<string,MarketSkill>();
  private loaded?:Promise<void>;
  private saving:Promise<void>=Promise.resolve();
  private enriched=new Map<string,MarketSkill>();
  private summaryLoader?: (ids:string[])=>Promise<void>;
  constructor(private project:()=>string,private cacheFile:string,private transport:typeof fetch){}
  lookup(id:string){const skill=this.enriched.get(id)||this.links.get(id);if(!skill)throw new Error('請先讀取此 Skill。');return structuredClone(skill);}
  update(skill:MarketSkill){if(!this.links.has(skill.id))throw new Error('未知的 Skill。');this.enriched.set(skill.id,skill);this.links.set(skill.id,skill);}
  setSummaryLoader(loader:(ids:string[])=>Promise<void>){this.summaryLoader=loader;}
  private async initialize(){
    if(!this.loaded)this.loaded=(async()=>{try{
      if((await stat(this.cacheFile)).size>2*1024*1024)return;
      const data=JSON.parse(await readFile(this.cacheFile,'utf8'));
      for(const key of ['popular','trending']){
        const value=data[key];if(value&&typeof value.updatedAt==='string'&&Number.isFinite(Date.parse(value.updatedAt))){const skills=normalizeMarketSkills(value.rows);if(skills.length)this.cache.set(key,{skills,updatedAt:value.updatedAt,source:`skills.sh 公開${key==='popular'?'累計':'趨勢'}榜`,stale:false});}
      }
    }catch{/* Offline browsing can still use the built-in reference catalog. */}})();
    await this.loaded;
  }
  private async saveCache(){
    const data=Object.fromEntries(['popular','trending'].flatMap(key=>{const snapshot=this.cache.get(key);return snapshot?[[key,{updatedAt:snapshot.updatedAt,rows:snapshot.skills.map(s=>({source:s.source,skillId:s.slug,name:s.name,installs:s.installs,rank:s.rank}))}]]:[];}));
    this.saving=this.saving.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.cacheFile),{recursive:true});await writeFile(this.cacheFile+'.tmp',JSON.stringify(data),{encoding:'utf8',mode:0o600});await rename(this.cacheFile+'.tmp',this.cacheFile);}).catch(()=>{});
    await this.saving;
  }
  private async load(view:'popular'|'trending'|'search',query:string,refresh:boolean):Promise<Snapshot>{
    await this.initialize();const key=view==='search'?'search:'+query:view,cached=this.cache.get(key);
    const age=cached?Date.now()-Date.parse(cached.updatedAt):Infinity;
    if(cached&&!refresh&&age>=0&&age<(view==='search'?300000:900000))return cached;
    const pending=this.pending.get(key);if(pending)return pending;
    const task=(async()=>{
      try{
        const url=view==='search'?`https://www.skills.sh/api/search?${new URLSearchParams({q:query,limit:'60'})}`:`https://www.skills.sh/${view==='trending'?'trending':''}`;
        const response=await fetchMarket(url,this.transport);
        if(Number(response.headers.get('content-length'))>2*1024*1024)throw new Error('市場資料超過大小限制。');
        const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw new Error('市場資料超過大小限制。');
        const skills=view==='search'?normalizeMarketSkills(JSON.parse(text).skills):parseMarketPage(text);
        const result:Snapshot={skills,updatedAt:new Date().toISOString(),source:`skills.sh 公開${view==='search'?'搜尋':view==='trending'?'趨勢榜':'累計榜'}`,stale:false};
        this.cache.set(key,result);if(view!=='search')await this.saveCache();
        while(this.cache.size>14){const disposable=[...this.cache.keys()].find(k=>k.startsWith('search:'));if(!disposable)break;this.cache.delete(disposable);}
        return result;
      }catch(error){
        const warning=error instanceof Error?error.message:'市場連線失敗。';
        return cached?{...cached,stale:true,warning:`${warning} 顯示上次取得資料，並非即時排行。`}:{skills:catalogSkills(),updatedAt:'',source:'內建參考清單（非即時排行）',stale:true,warning:`${warning} 先顯示內建參考清單；沒有即時安裝統計。`};
      }
    })().finally(()=>this.pending.delete(key));this.pending.set(key,task);return task;
  }
  async get(input:unknown):Promise<MarketResult>{
    const request=marketQuerySchema.parse(input);
    if(request.view==='recommended'&&!this.project())throw new Error('請先選擇專案資料夾，再查看專案推薦。');
    if(request.view==='search'&&request.query.length<2)throw new Error('搜尋至少輸入兩個字元。');
    const snapshot=await this.load(request.view==='recommended'?'popular':request.view,request.query,request.refresh);
    let skills=snapshot.skills,profile;
    for(const skill of [...catalogSkills(),...skills])if(!this.links.has(skill.id))this.links.set(skill.id,skill);
    if(request.view==='recommended'){
      const folder=this.project();profile=await inspectProject(folder);
      if(this.project()!==folder)throw new Error('專案已變更，請重新讀取推薦。');
      const terms=profile.signals.filter(s=>!['code','web','testing','javascript','data'].includes(s.tag)).map(s=>s.tag);
      const candidates=skills.filter(s=>s.summaryKind==='name-only'&&!this.enriched.has(s.id)&&terms.some(term=>`${s.name} ${s.slug}`.toLowerCase().includes(term))).slice(0,6);
      if(this.summaryLoader&&candidates.length)await this.summaryLoader(candidates.map(s=>s.id));
      const merged=new Map(catalogSkills().map(s=>[s.id,s]));for(const skill of skills)merged.set(skill.id,skill);for(const [id,skill] of merged)if(this.enriched.has(id))merged.set(id,{...skill,...this.enriched.get(id)});
      skills=recommendSkills([...merged.values()],profile);
    }else if(request.view==='search'){
      const query=request.query.toLocaleLowerCase();const local=catalogSkills().filter(s=>`${s.titleZh} ${s.summaryZh} ${s.name}`.toLocaleLowerCase().includes(query));
      const merged=new Map(skills.filter(s=>!snapshot.source.startsWith('內建')||`${s.titleZh} ${s.summaryZh} ${s.name}`.toLocaleLowerCase().includes(query)).map(s=>[s.id,s]));for(const skill of local)if(!merged.has(skill.id))merged.set(skill.id,skill);skills=[...merged.values()];
    }
    skills=skills.map(skill=>this.enriched.has(skill.id)?{...skill,...this.enriched.get(skill.id),reasons:skill.reasons,relevance:skill.relevance}:skill);
    for(const skill of skills)this.links.set(skill.id,skill);
    while(this.links.size>3000)this.links.delete(this.links.keys().next().value!);
    return {...snapshot,view:request.view,skills:skills.slice(0,60),profile,total:skills.length};
  }
  link(input:unknown){const request=marketLinkSchema.parse(input),skill=this.links.get(request.id);if(!skill)throw new Error('請先讀取此 Skill，再開啟來源。');return request.target==='source'?skill.sourceUrl:skill.marketUrl;}
}
