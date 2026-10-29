import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,symlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {extractSkillSummary,parseSummaryTranslations,inferSummaryTags,SkillSummaries} from '../electron/skill-summary';
import {SkillInstaller,skillRoots,readSkillArchive,githubSkillFetch} from '../electron/skill-install';
import {catalogSkills} from '../electron/skill-catalog';
import {defaultSettings} from '../electron/contracts';
import {zipFixture} from './zip-fixture';
const skill={...catalogSkills()[0],id:'owner/repo/demo',source:'owner/repo',slug:'demo',name:'demo',marketUrl:'https://www.skills.sh/owner/repo/demo'};
const summary='<div>Summary</div><section><div class="prose"><p>Helps React and TypeScript applications.</p><ul><li>Review frontend performance.</li></ul></div></section><div>SKILL.md</div><p>DO_NOT_TRANSLATE_SKILL_INSTRUCTIONS</p>';
const manifest='---\nname: demo\ndescription: A local test fixture\n---\nOnly test data.';
const archive=()=>zipFixture([{name:'repo-hash/skills/demo/SKILL.md',content:manifest},{name:'repo-hash/skills/demo/scripts/never-run.js',content:'throw new Error("INSTALL_MUST_NOT_EXECUTE")'}]);
test('Summary extraction includes the actual outline and excludes Skill instructions or scripts',()=>{
  const text=extractSkillSummary(summary+'<script>BAD_SCRIPT</script>');assert.match(text,/Helps React/);assert.match(text,/• Review frontend performance/);assert.ok(!text.includes('DO_NOT_TRANSLATE'));assert.ok(!text.includes('BAD_SCRIPT'));
  assert.throws(()=>extractSkillSummary('<div>SKILL.md</div>'),/未提供/);assert.ok(inferSummaryTags(text).includes('typescript'));
  assert.throws(()=>parseSummaryTranslations('{"translations":[{"id":"other","titleZh":"中文","summaryZh":"內容"}]}',[skill.id]),/來源項目/);
});
test('translation uses only public Summary data, preserves Chinese and caches without repeated model requests',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-summary-'));let requests=0;const updated:any[]=[];
  const service=new SkillSummaries(()=>skill,s=>updated.push(s),()=>defaultSettings(),async(_provider,_model,prompt)=>{requests++;assert.ok(prompt.includes('Helps React'));assert.ok(!prompt.includes('DO_NOT_TRANSLATE_SKILL_INSTRUCTIONS'));return JSON.stringify({translations:[{id:skill.id,titleZh:'React 協助',summaryZh:'協助 React 與 TypeScript 應用。\n• 檢查前端效能。'}]});},async()=>new Response(summary),path.join(root,'summaries.json'));
  const result=await service.translate([skill.id],'claude');assert.equal(result[0].summaryKind,'translated');assert.match(result[0].summaryZh,/前端效能/);assert.match(result[0].summaryOriginal!,/Helps React/);
  await service.translate([skill.id],'codex');assert.equal(requests,1);assert.ok(updated.length>0);
});
test('translation failure retains the original Summary instead of inventing a Chinese description',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-summary-fail-'));const service=new SkillSummaries(()=>skill,()=>{},()=>defaultSettings(),async()=>{throw new Error('CLI quota');},async()=>new Response(summary),path.join(root,'cache.json'));
  const result=await service.translate([skill.id],'claude');assert.equal(result[0].summaryKind,'original');assert.match(result[0].translationError!,/quota/);assert.match(result[0].summaryOriginal!,/Helps React/);
});
test('skill archives reject traversal, symbolic links and mismatched skill names',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(()=>readSkillArchive(zipFixture([{name:'repo/../escape',content:'x'}]),skill,signal));
  await assert.rejects(()=>readSkillArchive(zipFixture([{name:'repo/skills/demo/SKILL.md',content:manifest},{name:'repo/skills/demo/link',content:'/private',mode:0o120777}]),skill,signal),/連結/);
  await assert.rejects(()=>readSkillArchive(zipFixture([{name:'repo/skills/demo/SKILL.md',content:manifest.replace('name: demo','name: unrelated')}]),skill,signal),/找不到/);
  const files=await readSkillArchive(archive(),skill,signal);assert.equal(files.size,2);assert.ok(files.has('SKILL.md'));assert.ok(files.has('scripts/never-run.js'));
});
test('one click installs selected AI folders, persists ownership and never runs packaged scripts',async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'trinity-skill-install-'))),roots=skillRoots(path.join(root,'home'));let downloads=0;
  const installer=new SkillInstaller(()=>skill,roots,path.join(root,'installed.json'),async url=>{downloads++;return String(url).includes('api.github.com')?Response.json([{sha:'a'.repeat(40)}]):new Response(new Uint8Array(archive()));},()=>{});
  const result=await installer.install({id:skill.id,targets:['claude','codex','antigravity']});assert.equal(result.filter(s=>s.status==='installed').length,3);assert.equal(downloads,2);
  for(const ai of ['claude','codex','antigravity'] as const)assert.equal(await readFile(path.join(roots[ai],'demo','SKILL.md'),'utf8'),manifest);
  await installer.install({id:skill.id,targets:['claude','codex','antigravity']});assert.equal(downloads,2);
  const restored=new SkillInstaller(()=>skill,roots,path.join(root,'installed.json'),async()=>{throw new Error('must not download');},()=>{});assert.equal((await restored.snapshot()).length,3);
});
test('installation preserves unknown same-name content and rejects unsafe target roots and redirects',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'trinity-skill-existing-')),roots=skillRoots(path.join(root,'home'));await mkdir(path.join(roots.claude,'demo'),{recursive:true});await writeFile(path.join(roots.claude,'demo','SKILL.md'),'OWNER_CONTENT');
  const installer=new SkillInstaller(()=>skill,roots,path.join(root,'registry.json'),async()=>{throw new Error('must not download');},()=>{});const result=await installer.install({id:skill.id,targets:['claude']});assert.equal(result[0].status,'existing');assert.equal(await readFile(path.join(roots.claude,'demo','SKILL.md'),'utf8'),'OWNER_CONTENT');
  let calls=0;await assert.rejects(()=>githubSkillFetch('https://api.github.com/repos/a/b',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.example/code.zip'}});},new AbortController().signal),/拒絕/);assert.equal(calls,1);
  const outside=path.join(root,'outside');await mkdir(outside);const linked=path.join(root,'linked');await symlink(outside,linked,process.platform==='win32'?'junction':'dir');
  const unsafe=new SkillInstaller(()=>skill,{...roots,codex:path.join(linked,'skills')},path.join(root,'unsafe.json'),async url=>String(url).includes('api.github.com')?Response.json([{sha:'b'.repeat(40)}]):new Response(new Uint8Array(archive())),()=>{});
  assert.equal((await unsafe.install({id:skill.id,targets:['codex']}))[0].status,'error');
});
