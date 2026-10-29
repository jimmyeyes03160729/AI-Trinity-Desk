import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandWithModel } from '../electron/models';
import { defaultSettings, settingsSchema } from '../electron/contracts';
import { serviceError } from '../src/service-errors';
test('manual model overrides only existing model flags and does not mutate other arguments',()=>{
  const command={executable:'codex',args:['--sandbox','read-only','--model=old','-m','older','--other','value']};
  assert.deepEqual(commandWithModel(command,'new-model').args,['--sandbox','read-only','--other','value','--model','new-model']);
  assert.equal(commandWithModel(command,''),command);assert.ok(command.args.includes('--model=old'));
});
test('old settings retain CLI model defaults and model values reject command injection',()=>{
  const old:any=defaultSettings();delete old.models;
  assert.deepEqual(settingsSchema.parse(old).models,{claude:'',antigravity:'',codex:''});
  for(const value of ['a b','--dangerous','model\nrun','model;run'])assert.equal(settingsSchema.safeParse({...defaultSettings(),models:{claude:value,antigravity:'',codex:''}}).success,false);
  assert.equal(settingsSchema.safeParse({...defaultSettings(),models:{claude:'sonnet[1m]',antigravity:'vendor/model-id',codex:'my-model'}}).success,true);
});
test('service restrictions have precise messages without treating every error as a region failure',()=>{
  assert.match(serviceError('antigravity','FAILED_PRECONDITION (code 400): User location is not supported for the API use.')!,/地區/);
  assert.equal(serviceError('antigravity','HTTP 400 invalid parameter'),undefined);
  assert.match(serviceError('claude','Unable to connect to Anthropic services\nStatus 403')!,/HTTP 403/);
});
