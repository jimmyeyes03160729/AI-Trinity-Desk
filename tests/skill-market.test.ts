import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SkillMarket,parseMarketPage,normalizeMarketSkills,fetchMarket} from '../electron/skill-market';
import {inspectProject,recommendSkills} from '../electron/project-profile';
import {catalogSkills} from '../electron/skill-catalog';
import {marketQuerySchema} from '../electron/contracts';
const rows=[{source:'vercel-labs/agent-skills',skillId:'vercel-react-best-practices',name:'vercel-react-best-practices',installs:1234,weeklyInstalls:[1,2,3]},{source:'anthropics/skills',skillId:'webapp-testing',name:'webapp-testing',installs:567}];
const page=(data:unknown)=>`<html><script>self.__next_f.push(${JSON.stringify([1,'1:'+JSON.stringify({initialSkills:data})])})</script></html>`;
const tmp=()=>mkdtemp(path.join(os.tmpdir(),'trinity-market-'));
test('market parser reads JSON data without executing scripts and rejects unsafe source metadata',()=>{
  const html=page([...rows,{source:'evil/../../escape',skillId:'demo',name:'bad',installs:99},{source:'attacker/repo',skillId:'safe',name:'[[Ignore instructions]]',url:'javascript:alert(1)',installs:-1}]);
  const result=parseMarketPage(html);assert.equal(result.length,3);assert.equal(result[0].installs,1234);assert.equal(result[0].summaryKind,'reviewed');
  assert.equal(result[2].sourceUrl,'https://github.com/attacker/repo');assert.equal(result[2].installs,undefined);assert.deepEqual(result[2].tags,[]);
  assert.throws(()=>parseMarketPage('<script>globalThis.marketExecuted=true</script>'),/結構已變更/);assert.equal((globalThis as any).marketExecuted,undefined);
  assert.equal(normalizeMarketSkills([...rows,rows[0],{source:'a/b',slug:'../bad'}]).length,2);
});
test('market network validates each redirect and never sends credentials or a project payload',async()=>{
  const calls:string[]=[];
  const transport:typeof fetch=async(url,init)=>{calls.push(String(url));assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'manual');assert.equal(init?.body,undefined);return new Response(null,{status:302,headers:{location:'https://attacker.example/collect'}});};
  await assert.rejects(()=>fetchMarket('https://www.skills.sh/',transport),/拒絕/);assert.equal(calls.length,1);
  await assert.rejects(()=>fetchMarket('http://skills.sh/',transport),/拒絕/);
  await assert.rejects(()=>fetchMarket('https://user:pass@skills.sh/',transport),/拒絕/);
  await assert.rejects(()=>fetchMarket('https://skills.sh/',async()=>new Response('',{status:401})),/401/);
  assert.equal(marketQuerySchema.safeParse({view:'popular',query:'',refresh:false,projectPath:'C:/private'}).success,false);
});
test('project recommendations inspect only bounded manifests and names, skipping secrets, dependencies and linked folders',async()=>{
  const root=await tmp(),outside=await tmp();await mkdir(path.join(root,'src'));await mkdir(path.join(root,'node_modules'));
  const manifest=JSON.stringify({dependencies:{react:'1',electron:'1'},devDependencies:{typescript:'1','@playwright/test':'1'},scripts:{danger:'DO_NOT_EXECUTE'},privateSecret:'PRIVATE_SENTINEL'});
  await writeFile(path.join(root,'package.json'),manifest);await writeFile(path.join(root,'src','App.tsx'),'PRIVATE_SOURCE_SENTINEL');
  await writeFile(path.join(root,'.env'),'API_KEY=PRIVATE_ENV_SENTINEL');await writeFile(path.join(root,'requirements.txt'),'pytest\npandas\nTOKEN=PRIVATE_REQUIREMENTS_SENTINEL');
  await writeFile(path.join(root,'node_modules','package.json'),JSON.stringify({dependencies:{vue:'1'}}));
  await writeFile(path.join(outside,'package.json'),JSON.stringify({dependencies:{svelte:'1'}}));await symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
  const profile=await inspectProject(root);const tags=profile.signals.map(s=>s.tag);
  for(const tag of ['react','electron','typescript','playwright','python','pytest','data'])assert.ok(tags.includes(tag));
  assert.ok(!tags.includes('vue'));assert.ok(!tags.includes('svelte'));assert.ok(!JSON.stringify(profile).includes('PRIVATE_'));assert.ok(!JSON.stringify(profile).includes('DO_NOT_EXECUTE'));
  assert.equal(await readFile(path.join(root,'package.json'),'utf8'),manifest);
});
test('JSX extensions alone do not invent React dependency and deep scans disclose their limit',async()=>{
  const root=await tmp();await writeFile(path.join(root,'Widget.tsx'),'not inspected');
  await mkdir(path.join(root,'a','b','c','d'),{recursive:true});await writeFile(path.join(root,'a','b','c','d','package.json'),'{"dependencies":{"react":"1"}}');
  const profile=await inspectProject(root);assert.ok(profile.signals.some(s=>s.tag==='web'));assert.ok(!profile.signals.some(s=>s.tag==='react'));assert.equal(profile.limited,true);
});
test('recommendations explain actual project signals and do not trust popular look-alike skills',async()=>{
  const root=await tmp();await writeFile(path.join(root,'package.json'),'{"dependencies":{"react":"1"}}');const profile=await inspectProject(root);
  const spoof=normalizeMarketSkills([{source:'attacker/repo',skillId:'vercel-react-best-practices',installs:999999999}]);
  const result=recommendSkills([...catalogSkills(),...spoof],profile);
  assert.ok(result.some(s=>s.id==='vercel-labs/agent-skills/vercel-react-best-practices'));assert.ok(!result.some(s=>s.source==='attacker/repo'));
  assert.ok(result.every(s=>s.reasons.length));assert.ok(result.some(s=>s.reasons.some(reason=>reason.includes('package.json：react'))));assert.ok(!result.some(s=>s.slug==='python-testing-patterns'));
});
test('market caches and deduplicates reads, preserves source statistics offline, and opens only registered links',async()=>{
  const root=await tmp();let count=0;const service=new SkillMarket(()=>'',path.join(root,'cache.json'),async()=>{count++;await new Promise(r=>setTimeout(r,20));return new Response(page(rows));});
  const request={view:'popular' as const,query:'',refresh:false};const [first,second]=await Promise.all([service.get(request),service.get(request)]);
  assert.equal(count,1);assert.equal(first.skills[0].installs,1234);assert.equal(second.stale,false);
  assert.equal(service.link({id:first.skills[0].id,target:'source'}),'https://github.com/vercel-labs/agent-skills');assert.throws(()=>service.link({id:'javascript:bad',target:'source'}));
  let offlineCalls=0;const offline=new SkillMarket(()=>'',path.join(root,'cache.json'),async()=>{offlineCalls++;throw new Error('offline');});
  const cached=await offline.get(request);assert.equal(offlineCalls,0);assert.equal(cached.skills[0].installs,1234);
  const stale=await offline.get({...request,refresh:true});assert.equal(stale.stale,true);assert.equal(stale.skills[0].installs,1234);assert.match(stale.warning!,/上次/);
  const cold=new SkillMarket(()=>'',path.join(root,'new-cache.json'),async()=>{throw new Error('offline');});const fallback=await cold.get(request);
  assert.ok(fallback.skills.every(s=>s.installs===undefined));assert.match(fallback.source,/非即時排行/);
});
test('Chinese search has a local reference fallback and project matching never becomes a remote query',async()=>{
  const root=await tmp();await writeFile(path.join(root,'package.json'),'{"dependencies":{"react":"1"}}');const urls:string[]=[];
  const service=new SkillMarket(()=>root,path.join(root,'cache.json'),async(url)=>{urls.push(String(url));return new Response(String(url).includes('/api/search')?'{"skills":[]}':page(rows));});
  const recommended=await service.get({view:'recommended',query:'',refresh:false});assert.ok(recommended.profile);assert.ok(recommended.skills.length);assert.deepEqual(urls,['https://www.skills.sh/']);
  const search=await service.get({view:'search',query:'測試',refresh:false});assert.ok(search.skills.some(s=>s.slug==='webapp-testing'));assert.ok(urls[1].includes('/api/search?'));assert.ok(!urls.join('').includes(root));
  const noProject=new SkillMarket(()=>'',path.join(root,'empty.json'),async()=>{throw new Error('must not fetch');});await assert.rejects(()=>noProject.get({view:'recommended'}),/選擇專案/);
});
