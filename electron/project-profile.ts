import {lstat,opendir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {MarketSkill,ProjectProfile,ProjectSignal} from './contracts';
const labels:Record<string,string>={code:'程式專案',javascript:'JavaScript',typescript:'TypeScript',react:'React',next:'Next.js',vue:'Vue',svelte:'Svelte',web:'網頁介面',electron:'Electron',playwright:'Playwright',testing:'測試流程',python:'Python',pytest:'pytest',fastapi:'FastAPI',django:'Django',data:'資料處理',sql:'SQL',database:'資料庫',postgres:'PostgreSQL',supabase:'Supabase',go:'Go',rust:'Rust',java:'Java',dotnet:'.NET',docx:'Word 文件',xlsx:'試算表',pdf:'PDF 文件',pptx:'簡報'};
const skip=new Set(['node_modules','.git','.venv','venv','dist','dist-electron','build','release','target','.next','.cache','vendor','coverage','test-results','evidence']);
const deps:Record<string,string[]>={react:['react','web'],next:['next','react','web'],vue:['vue','web'],svelte:['svelte','web'],electron:['electron'],'@playwright/test':['playwright','testing'],playwright:['playwright','testing'],vitest:['testing'],jest:['testing'],typescript:['typescript'],'@supabase/supabase-js':['supabase','postgres','database'],pg:['postgres','sql','database'],prisma:['database'],'drizzle-orm':['database']};
export async function inspectProject(folder:string):Promise<ProjectProfile>{
  if(!folder)throw new Error('請先選擇專案資料夾，再查看專案推薦。');
  const root=await realpath(folder);if(!(await lstat(root)).isDirectory())throw new Error('專案資料夾無法讀取。');
  const found=new Map<string,ProjectSignal>();const warnings:string[]=[];let count=0,dirs=0,visited=0,limited=false,manifestCount=0;
  const add=(tag:string,evidence:string)=>{const signal=found.get(tag)||{tag,label:labels[tag]||tag,evidence:[]};if(signal.evidence.length<3&&!signal.evidence.includes(evidence))signal.evidence.push(evidence);found.set(tag,signal);};
  const queue=[{dir:root,depth:0}];
  while(queue.length){
    const current=queue.shift()!;if(++dirs>150){limited=true;break;}
    let directory;try{const resolved=await realpath(current.dir);if(resolved!==root&&!resolved.startsWith(root+path.sep))continue;if((await lstat(current.dir)).isSymbolicLink())continue;directory=await opendir(current.dir);}catch{warnings.push('部分子資料夾無法讀取，已略過。');continue;}
    for await(const entry of directory){
      if(count>=2500||++visited>4000){limited=true;break;}
      const lower=entry.name.toLowerCase();
      if(entry.isSymbolicLink()||lower.startsWith('.env')||/^(?:credentials|secrets|id_rsa|id_ed25519)(?:\.|$)/i.test(lower))continue;
      const full=path.join(current.dir,entry.name),relative=path.relative(root,full);
      if(entry.isDirectory()){if(!skip.has(lower)&&!lower.startsWith('.')){if(current.depth<3)queue.push({dir:full,depth:current.depth+1});else limited=true;}continue;}
      if(!entry.isFile())continue;count++;
      const extension=path.extname(lower);
      const simple:Record<string,string[]>={'.py':['python','code'],'.js':['javascript','code'],'.jsx':['javascript','web','code'],'.ts':['typescript','code'],'.tsx':['typescript','web','code'],'.html':['web','code'],'.vue':['vue','web','code'],'.svelte':['svelte','web','code'],'.sql':['sql','database','code'],'.go':['go','code'],'.rs':['rust','code'],'.java':['java','code'],'.csproj':['dotnet','code'],'.docx':['docx'],'.xlsx':['xlsx'],'.csv':['data'],'.pdf':['pdf'],'.pptx':['pptx']};
      for(const tag of simple[extension]||[])add(tag,relative);
      if(lower==='go.mod')add('go',relative);if(lower==='cargo.toml')add('rust',relative);if(lower==='pom.xml')add('java',relative);
      if(lower==='package.json'&&manifestCount++<20){
        try{
          const info=await lstat(full);if(info.isSymbolicLink()||info.size>262144){warnings.push('部分套件清單過大或為連結，已略過。');continue;}
          const data=JSON.parse(await readFile(full,'utf8'));
          const dependencyNames=new Set([...Object.keys(data.dependencies||{}),...Object.keys(data.devDependencies||{})]);
          add('code',relative);add('javascript',relative);
          for(const name of dependencyNames)for(const tag of deps[name]||[])add(tag,`${relative}：${name}`);
        }catch{warnings.push('部分 package.json 無法解析，已略過。');}
      }
      if(['pyproject.toml','requirements.txt','setup.cfg'].includes(lower)&&manifestCount++<20){
        add('python',relative);add('code',relative);
        try{
          const info=await lstat(full);if(info.isSymbolicLink()||info.size>131072)continue;
          const content=await readFile(full,'utf8');
          for(const [name,tags] of Object.entries({pytest:['pytest','testing'],fastapi:['fastapi'],django:['django'],pandas:['data'],numpy:['data'],polars:['data'],sqlalchemy:['database','sql'],psycopg:['postgres','database']}))if(new RegExp(`(?:^|[\\s"'\\[,])${name}(?=[\\s"'\\[=<>!~,;]|$)`,'im').test(content))for(const tag of tags)add(tag,`${relative}：${name}`);
        }catch{warnings.push('部分 Python 套件清單無法讀取，已略過。');}
      }
    }
    if(count>=2500||visited>4000)break;
  }
  return {name:path.basename(root),signals:[...found.values()],scannedFiles:count,limited,warnings:[...new Set(warnings)].slice(0,5),updatedAt:new Date().toISOString()};
}
export function recommendSkills(skills:MarketSkill[],profile:ProjectProfile):MarketSkill[]{
  return skills.map(skill=>{
    const matched=profile.signals.filter(signal=>skill.tags.includes(signal.tag));
    const relevance=matched.reduce((score,signal)=>score+(signal.tag==='code'?1:signal.tag==='web'||signal.tag==='testing'?3:8),0);
    return {...skill,relevance,reasons:matched.slice(0,3).map(signal=>`偵測到 ${signal.label}（${signal.evidence[0]}），${skill.summaryOriginal?'匹配此 Skill 的用途標籤，請搭配來源 Summary 核對使用條件。':'與此 Skill 的用途相符。'}`)};
  }).filter(skill=>skill.relevance!>0).sort((a,b)=>(b.relevance!-a.relevance!)||((b.installs||0)-(a.installs||0))).slice(0,18);
}
