import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discussionSchema,continueDiscussionSchema,extendDiscussionSchema,retryDiscussionSchema,defaultSettings,type DiscussionState,type DiscussionConfig} from '../electron/contracts';
import {DiscussionManager,discussionArgs,discussionModel,discussionPrompt,parseDiscussionReply,runDiscussionProcess} from '../electron/discussion';
import {DiscussionStore} from '../electron/discussion-store';
import {TurnClock,DiscussionTimeoutError,agreementReply} from '../electron/discussion-clock';
const fixture=path.resolve('tests/discussion-fixture.cjs');
const config:DiscussionConfig={topic:'測試純文字討論',participants:['claude','codex'],rounds:2,timeoutSeconds:30};
async function until(predicate:()=>boolean){const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw new Error('test wait timed out');await new Promise(r=>setTimeout(r,15));}}

test('discussion IPC validates unique participants, bounded topic, rounds, timeout and rejects command overrides',()=>{
  assert.equal(discussionSchema.safeParse({...config,participants:['codex']}).success,false);
  assert.equal(discussionSchema.safeParse({...config,participants:['codex','codex']}).success,false);
  assert.equal(discussionSchema.safeParse({...config,rounds:6}).success,false);
  assert.equal(discussionSchema.safeParse({...config,topic:'x'.repeat(6001)}).success,false);
  assert.equal(discussionSchema.safeParse({...config,executable:'bad'}).success,false);
  assert.equal(discussionSchema.safeParse({...config,timeoutSeconds:0}).success,false);
});
test('discussion adapters use official structured protocols, selected models, bounded permissions and no shell prompts',()=>{
  assert.ok(discussionArgs('claude','sonnet').includes('--tools='));
  assert.ok(discussionArgs('claude','').includes('--disable-slash-commands'));
  assert.ok(discussionArgs('codex','').includes('read-only'));
  assert.ok(discussionArgs('antigravity','').includes('stream-json'));
  for(const id of ['claude','codex','antigravity'] as const){assert.deepEqual(discussionArgs(id,'demo').slice(-2),['--model','demo']);assert.ok(!discussionArgs(id,'').some(a=>a.includes('dangerously')));}
  const s=defaultSettings();s.commands.codex.args=['-m','prior'];assert.equal(discussionModel(s,'codex'),'prior');
  s.models.codex='selected';assert.equal(discussionModel(s,'codex'),'selected');
  s.commands.codex.args=['--yolo'];assert.throws(()=>discussionModel(s,'codex'),/自訂/);
});
test('only successful complete vendor replies are relayed; errors, partial output and oversize replies fail',()=>{
  assert.equal(parseDiscussionReply('claude','{"result":"中文", "is_error":false}'),'中文');
  assert.equal(parseDiscussionReply('codex','{"type":"item.completed","item":{"type":"agent_message","text":"A"}}\n{"type":"turn.completed"}'),'A');
  assert.equal(parseDiscussionReply('antigravity','{"event":"result","result":{"status":"SUCCESS","response":"B"}}'),'B');
  assert.throws(()=>parseDiscussionReply('codex','{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}'),/完成訊號/);
  assert.throws(()=>parseDiscussionReply('codex','{"type":"turn.failed","error":{"message":"quota"}}'),/quota/);
  assert.throws(()=>parseDiscussionReply('claude','{"result":"denied","is_error":true}'),/denied/);
  assert.throws(()=>parseDiscussionReply('antigravity','{"event":"result","result":{"status":"WAITING"}}'),/WAITING/);
  assert.throws(()=>parseDiscussionReply('claude',JSON.stringify({result:'x'.repeat(12001)})),/超過/);
});
test('round robin forwards real previous replies, finishes at round cap and freezes model settings',async()=>{
  const states:DiscussionState[]=[],calls:{id:string;prompt:string;model:string}[]=[];const s=defaultSettings();s.models.codex='frozen-model';
  const cwd=await mkdtemp(path.join(os.tmpdir(),'trinity-discussion-'));
  const manager=new DiscussionManager(async(id,model,prompt,_settings,signal)=>{
    calls.push({id,prompt,model});const json=JSON.parse(prompt.slice(prompt.indexOf('{"topic"')));
    const output=await runDiscussionProcess({file:process.execPath,args:[fixture,'reply']},cwd,process.env,JSON.stringify({provider:id,historyLength:json.history.length}),signal,5000);
    return parseDiscussionReply('claude',output);
  },state=>states.push(state));
  manager.start(config,s);s.models.codex='changed-after-start';
  assert.throws(()=>manager.start(config,s),/已有討論/);
  await until(()=>!manager.active);
  assert.deepEqual(calls.map(c=>c.id),['claude','codex','claude','codex']);
  assert.equal(calls[1].model,'frozen-model');assert.match(calls[1].prompt,/FIXTURE claude: received 0 prior replies/);
  assert.match(calls[3].prompt,/最後一輪：每一位 AI/);assert.equal(manager.snapshot.status,'completed');
  assert.equal(manager.snapshot.messages.length,4);assert.equal(states[0].messages.length,0);
  const external=manager.snapshot;external.messages.length=0;assert.equal(manager.snapshot.messages.length,4);
});
test('discussion failure preserves earlier replies and never starts the next AI',async()=>{
  let count=0;const manager=new DiscussionManager(async()=>{if(++count===2)throw new Error('quota limit');return 'first reply';},()=>{});
  manager.start({...config,participants:['claude','codex','antigravity']},defaultSettings());
  await until(()=>!manager.active);assert.equal(count,2);assert.equal(manager.snapshot.status,'error');assert.equal(manager.snapshot.messages.length,1);assert.match(manager.snapshot.error!,/quota/);
});
test('real discussion process preserves Unicode stdin and propagates exit, timeout and output limits',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'trinity-discussion-'));const signal=new AbortController().signal;
  const run=(mode:string,input='',ms=5000)=>runDiscussionProcess({file:process.execPath,args:[fixture,mode]},cwd,process.env,input,signal,ms);
  const input='中文\n$(not-a-command) & ; "quoted"';assert.equal(await run('echo',input),input);
  await assert.rejects(()=>run('fail'),/FIXTURE_FAILURE/);
  await assert.rejects(()=>run('hang','',150),/逾時/);
  await assert.rejects(()=>run('flood'),/輸出過大/);
});
test('stop cancels the active real process and its child tree, and no next turn is sent',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'trinity-discussion-')),pidFile=path.join(cwd,'child.pid');let calls=0;
  const manager=new DiscussionManager(async(_id,_model,_prompt,_s,signal)=>{calls++;return runDiscussionProcess({file:process.execPath,args:[fixture,'hang',pidFile]},cwd,process.env,'',signal,10000);},()=>{});
  manager.start(config,defaultSettings());
  let pid=0;const deadline=Date.now()+5000;while(!pid){try{pid=Number(await readFile(pidFile,'utf8'));}catch{}if(Date.now()>deadline)throw new Error('fixture not ready');await new Promise(r=>setTimeout(r,20));}
  await manager.stop();assert.equal(manager.snapshot.status,'stopped');assert.equal(calls,1);
  await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
});
test('long discussions retain topic, disclose omitted history and bound forwarded context',()=>{
  const messages=Array.from({length:15},(_,i)=>({id:String(i),provider:'claude' as const,round:1,text:'x'.repeat(12000),model:'',createdAt:''}));
  const prompt=discussionPrompt(config,messages,'codex',2);assert.ok(prompt.length<55000);assert.match(prompt,/較舊發言省略數：11/);assert.ok(prompt.includes(config.topic));
});

test('continuation and timeout IPC reject stale identifiers, unexpected fields and excessive values',()=>{
  assert.equal(continueDiscussionSchema.safeParse({runId:'bad',instruction:'x',rounds:1,timeoutSeconds:60}).success,false);
  assert.equal(continueDiscussionSchema.safeParse({runId:'32df07ba-ac8e-4522-8a3d-37d886dadb5f',instruction:'x'.repeat(3001),rounds:1,timeoutSeconds:60}).success,false);
  assert.equal(extendDiscussionSchema.safeParse({runId:'32df07ba-ac8e-4522-8a3d-37d886dadb5f',seconds:601}).success,false);
  assert.equal(retryDiscussionSchema.safeParse({runId:'32df07ba-ac8e-4522-8a3d-37d886dadb5f',timeoutSeconds:60,executable:'bad'}).success,false);
});
test('continuation retains the same conversation, original replies/models and adds focus and round numbers',async()=>{
  const calls:{model:string;prompt:string}[]=[];const settings=defaultSettings();settings.models.codex='original';
  const manager=new DiscussionManager(async(id,model,prompt)=>{calls.push({model,prompt});return `${id} reply ${calls.length}`;},()=>{});
  manager.start(config,settings);await until(()=>!manager.active);const before=manager.snapshot;
  settings.models.codex='changed';manager.continue({runId:before.runId!,instruction:'比較尚存分歧的成立條件',rounds:1,timeoutSeconds:60},settings);
  assert.throws(()=>manager.continue({runId:before.runId!,instruction:'',rounds:1,timeoutSeconds:60},settings),/目前討論/);
  await until(()=>!manager.active);const after=manager.snapshot;
  assert.equal(after.runId,before.runId);assert.deepEqual(after.messages.slice(0,4),before.messages);assert.equal(after.messages.length,6);
  assert.deepEqual(after.messages.slice(4).map(m=>m.round),[3,3]);assert.match(calls[4].prompt,/比較尚存分歧/);assert.match(calls[4].prompt,/claude reply 1/);
  assert.equal(calls[5].model,'original');assert.match(calls[4].prompt,/最後一輪：每一位 AI/);
  assert.throws(()=>manager.continue({runId:'32df07ba-ac8e-4522-8a3d-37d886dadb5f',instruction:'',rounds:1,timeoutSeconds:60},settings),/沒有可接續/);
});
test('failed continuation keeps its user focus and earlier history for the next continuation',async()=>{
  let calls=0;const prompts:string[]=[];const manager=new DiscussionManager(async(_id,_model,prompt)=>{prompts.push(prompt);if(++calls===3)throw new Error('fixture error');return 'reply';},()=>{});
  manager.start({...config,rounds:1},defaultSettings());await until(()=>!manager.active);const runId=manager.snapshot.runId!;
  manager.continue({runId,instruction:'第一次補充',rounds:1,timeoutSeconds:60},defaultSettings());await until(()=>!manager.active);
  assert.equal(manager.snapshot.status,'error');assert.equal(manager.snapshot.messages.length,2);
  manager.continue({runId,instruction:'第二次補充',rounds:1,timeoutSeconds:60},defaultSettings());await until(()=>!manager.active);
  assert.match(prompts[3],/第一次補充/);assert.match(prompts[3],/第二次補充/);assert.equal(manager.snapshot.messages.length,4);
  assert.equal(manager.snapshot.batches!.length,3);
});
test('local history saves, restores and can continue after reopening without automatically requesting AI',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'trinity-discussion-store-'));const store=new DiscussionStore(path.join(dir,'latest.json'));
  const manager=new DiscussionManager(async()=> 'saved reply',()=>{},undefined,state=>store.save(state));
  manager.start({...config,rounds:1},defaultSettings());await until(()=>!manager.active);await manager.flush();
  const restored=await store.load();assert.equal(restored!.messages.length,2);
  let calls=0;const reopened=new DiscussionManager(async()=>{calls++;return 'continued reply';},()=>{},restored,state=>store.save(state));
  assert.equal(calls,0);reopened.continue({runId:restored!.runId!,instruction:'還有一點分歧',rounds:1,timeoutSeconds:60},defaultSettings());
  await until(()=>!reopened.active);await reopened.flush();assert.equal(calls,2);assert.equal((await store.load())!.messages.length,4);
  const interrupted={...reopened.snapshot,status:'running' as const,pendingTurn:{round:3,endRound:3,providerIndex:1}};
  await store.save(interrupted);const recovered=await store.load();assert.equal(recovered!.status,'stopped');assert.equal(recovered!.errorKind,'interrupted');
  await writeFile(path.join(dir,'latest.json'),'{corrupt','utf8');await assert.rejects(()=>store.load(),/原檔未改動/);assert.equal(await readFile(path.join(dir,'latest.json'),'utf8'),'{corrupt');
});
test('saving failures remain visible without clearing the in-memory discussion',async()=>{
  const manager=new DiscussionManager(async()=> 'reply',()=>{},undefined,async()=>{throw new Error('disk full');});
  manager.start({...config,rounds:1},defaultSettings());await until(()=>!manager.active);await manager.flush();
  assert.equal(manager.snapshot.messages.length,2);assert.match(manager.snapshot.storageError!,/保存失敗/);
});
test('extending a real process deadline lets the same request finish instead of timing out',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'trinity-discussion-clock-')),clock=new TurnClock(150);
  const pending=runDiscussionProcess({file:process.execPath,args:[fixture,'reply']},cwd,process.env,JSON.stringify({provider:'demo',historyLength:0,delayMs:350}),new AbortController().signal,150,clock);
  setTimeout(()=>clock.extend(1),40);assert.match(await pending,/FIXTURE demo/);
  assert.throws(()=>clock.extend(2000),/30 分鐘/);clock.expired=true;assert.throws(()=>clock.extend(1),/已逾時/);
});
test('timeout retries exactly the unfinished AI turn, preserving earlier responses and final-round notice',async()=>{
  const calls:string[]=[];let fail=true;const manager=new DiscussionManager(async(id,_model,prompt)=>{calls.push(id);if(id==='codex'&&fail){fail=false;throw new DiscussionTimeoutError();}assert.match(prompt,/最後一輪：每一位 AI/);return 'reply';},()=>{});
  manager.start({...config,rounds:1},defaultSettings());await until(()=>!manager.active);const original=manager.snapshot.messages[0];
  assert.equal(manager.snapshot.errorKind,'timeout');assert.equal(manager.snapshot.pendingTurn!.providerIndex,1);
  manager.retry({runId:manager.snapshot.runId,timeoutSeconds:300},defaultSettings());await until(()=>!manager.active);
  assert.deepEqual(calls,['claude','codex','codex']);assert.deepEqual(manager.snapshot.messages[0],original);assert.equal(manager.snapshot.messages.length,2);
  assert.equal(manager.snapshot.status,'completed');assert.equal(manager.snapshot.config!.timeoutSeconds,300);
});
test('agreement stops early only when every participant explicitly agrees in the same round',async()=>{
  assert.deepEqual(agreementReply('目前一致但還要檢查'),{text:'目前一致但還要檢查'});
  assert.deepEqual(agreementReply('結論\n[[TRINITY_AGREE]]'),{text:'結論',agreement:true});
  let calls=0;const manager=new DiscussionManager(async()=>{calls++;return '本次結論\n[[TRINITY_AGREE]]';},()=>{});
  manager.start({...config,rounds:5},defaultSettings());await until(()=>!manager.active);assert.equal(calls,2);assert.equal(manager.snapshot.endReason,'agreement');
  const mixed=new DiscussionManager(async id=>id==='claude'?'結論\n[[TRINITY_AGREE]]':'仍有分歧\n[[TRINITY_OPEN]]',()=>{});
  mixed.start({...config,rounds:2},defaultSettings());await until(()=>!mixed.active);assert.equal(mixed.snapshot.messages.length,4);assert.equal(mixed.snapshot.endReason,'round-limit');
  manager.continue({runId:manager.snapshot.runId!,instruction:'提出新的分歧',rounds:1,timeoutSeconds:60},defaultSettings());await until(()=>!manager.active);assert.equal(manager.snapshot.messages.length,4);
});
test('custom answer order applies to each round, last speaker and continuation without clearing history',async()=>{
  const calls:{id:string;prompt:string}[]=[];const manager=new DiscussionManager(async(id,_model,prompt)=>{calls.push({id,prompt});return `${id} answer`;},()=>{});
  manager.start({...config,participants:['codex','claude'],rounds:2},defaultSettings());await until(()=>!manager.active);
  assert.deepEqual(calls.map(c=>c.id),['codex','claude','codex','claude']);assert.match(calls[3].prompt,/你也是本次最後一位/);assert.doesNotMatch(calls[2].prompt,/你也是本次最後一位/);
  const original=manager.snapshot;
  assert.throws(()=>manager.continue({runId:original.runId!,instruction:'',rounds:1,timeoutSeconds:60,participants:['claude','antigravity']},defaultSettings()),/原成員/);
  manager.continue({runId:original.runId!,instruction:'改由 Claude 先說',rounds:1,timeoutSeconds:60,participants:['claude','codex']},defaultSettings());await until(()=>!manager.active);
  assert.deepEqual(calls.slice(4).map(c=>c.id),['claude','codex']);assert.match(calls[5].prompt,/你也是本次最後一位/);
  assert.equal(manager.snapshot.runId,original.runId);assert.deepEqual(manager.snapshot.messages.slice(0,4),original.messages);
  assert.deepEqual(manager.snapshot.batches![0].participants,['codex','claude']);assert.deepEqual(manager.snapshot.batches![1].participants,['claude','codex']);
});
