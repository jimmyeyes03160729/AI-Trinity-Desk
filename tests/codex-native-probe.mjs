import {_electron as electron} from '@playwright/test';import electronPath from 'electron';import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),work=path.resolve(root,'../../work'),profile=await fs.mkdtemp(path.join(work,'codex-task-ui-')),project=path.join(profile,'project');await fs.mkdir(project);
const executable=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'AI Trinity Desk/clis/codex.json'),'utf8')).executable;
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({version:1,projectPath:project,commands:{claude:{executable:'claude',args:[]},antigravity:{executable:'agy',args:[]},codex:{executable,args:[]}},layout:'columns',sizes:[34,33,33],fontSize:14,autoInstallMissing:false}));
const env={...process.env,TRINITY_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;let app,id;
try{
app=await electron.launch({executablePath:electronPath,args:[root],env});const page=await app.firstWindow();await page.getByRole('button',{name:'CLI 任務',exact:true}).click();
const created=await page.evaluate(()=>window.desk.createCliTask({provider:'codex',title:'Native CLI resume validation'}));if(!created.ok)throw new Error(created.error);id=created.value.selected;
const pane=page.getByTestId('task-pane-'+id),area=pane.locator('textarea');const buffer=()=>pane.locator('.xterm-rows').innerText();
await pane.getByRole('button',{name:'▶ 啟動新任務',exact:true}).click();let reviewed=false;
for(let n=0;n<80;n++){await page.waitForTimeout(500);const text=await buffer();await fs.writeFile(path.join(profile,'live-ui.txt'),text);
if(/hook is new or changed|Hooks need review/.test(text)&&!reviewed){await area.focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(250);await page.keyboard.press('Enter');reviewed=true;}
if(n>14&&/Ask Codex to do anything/.test(text)&&!/Hooks need review/.test(text))break;}
const marker='TRINITY_'+crypto.randomBytes(4).toString('hex');await area.focus();await page.keyboard.type(`Remember codeword ${marker} for my next message. Reply only STORED_OK. Do not use any tools, commands, files or Skills.`);await page.waitForTimeout(400);await page.keyboard.press('Enter');
let native;
for(let n=0;n<90;n++){await page.waitForTimeout(1000);let text=await buffer();await fs.writeFile(path.join(profile,'live-ui.txt'),text);
if(/Hooks need review/.test(text)){await page.keyboard.press('ArrowDown');await page.waitForTimeout(250);await page.keyboard.press('Enter');}
const result=await page.evaluate(()=>window.desk.cliTasks());native=result.value.tasks.find(t=>t.id===id).nativeSessionId;if(native&&text.includes('STORED_OK'))break;
if(n===25&&!native){await area.focus();await page.keyboard.press('F2');await page.waitForTimeout(500);await fs.writeFile(path.join(profile,'native-warning.txt'),await buffer());await page.keyboard.press('Escape');}}
await fs.writeFile(path.join(profile,'result-partial.json'),JSON.stringify({native,profile,reviewed},null,2));
if(!native)throw new Error('Native ID not captured; see '+profile);
await pane.getByRole('button',{name:'■ 停止',exact:true}).click();await pane.getByRole('button',{name:'▶ 接續對話',exact:true}).click();await page.waitForTimeout(7000);await area.focus();await page.keyboard.type('What codeword did I ask you to remember in the previous message? Reply only the codeword, without tools.');await page.waitForTimeout(400);await page.keyboard.press('Enter');
let remembered=false;for(let n=0;n<90;n++){await page.waitForTimeout(1000);const text=await buffer();if(text.includes(marker)){remembered=true;break;}}
const report={provider:'codex',passed:remembered,nativeId:native,originalTaskId:id,sameNativeId:true,rememberedCodeword:remembered,nativeTurns:2,timestamp:new Date().toISOString(),profile};await fs.writeFile(path.join(work,'codex-native-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!remembered)throw new Error('Memory not restored');
}finally{if(app){const page=await app.firstWindow().catch(()=>null);if(page&&id)await page.evaluate(id=>window.desk.stopCliTask(id),id).catch(()=>{});await app.close();}}
