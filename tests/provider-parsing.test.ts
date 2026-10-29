import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexModels,codexWindows,agyModels} from '../electron/provider-parsing';
import {defaultSettings,settingsSchema} from '../electron/contracts';
test('quota percentages represent account windows and missing quota is never rendered as zero',()=>{
  assert.deepEqual(codexWindows({rateLimits:{primary:{usedPercent:null}}}),[]);
  assert.equal(codexWindows({rateLimitsByLimitId:{},rateLimits:{primary:{usedPercent:12}}})[0].remainingPercent,88);
  const result=codexWindows({rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1000},secondary:{usedPercent:0,windowDurationMins:10080}}}});
  assert.equal(result[0].remainingPercent,75);assert.equal(result[0].resetsAt,1000);assert.match(result[0].label,/5 小時/);assert.equal(result[1].usedPercent,0);assert.equal(result[1].remainingPercent,100);assert.equal(result[1].resetsAt,undefined);
});
test('model catalogs filter hidden rows and parse CLI model IDs without assuming account entitlement',()=>{
  assert.deepEqual(codexModels({data:[{model:'a',displayName:'Model A'},{model:'hidden',hidden:true}]}),[{id:'a',name:'Model A'}]);
  assert.deepEqual(agyModels('gemini-demo-high    Gemini Demo (High)\ninvalid heading\n'),[{id:'gemini-demo-high',name:'Gemini Demo (High)'}]);
});
test('visibility settings preserve old defaults and reject empty or duplicate selection',()=>{
  const old:any=defaultSettings();delete old.visiblePanes;assert.deepEqual(settingsSchema.parse(old).visiblePanes,['claude','antigravity','codex']);
  assert.equal(settingsSchema.safeParse({...defaultSettings(),visiblePanes:[]}).success,false);
  assert.equal(settingsSchema.safeParse({...defaultSettings(),visiblePanes:['codex','codex']}).success,false);
  assert.deepEqual(settingsSchema.parse({...defaultSettings(),visiblePanes:['codex']}).visiblePanes,['codex']);
});
