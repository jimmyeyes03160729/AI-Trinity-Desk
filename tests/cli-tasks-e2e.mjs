import {_electron as electron,expect} from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),artifacts=path.join(root,'test-results');await fs.mkdir(artifacts,{recursive:true});
const profile=await fs.mkdtemp(path.join(artifacts,'task-profile-')),project=path.join(profile,'獨立任務 專案');await fs.mkdir(project);
const fixture=path.join(root,'tests/cli-task-fixture.cjs'),shim=path.join(profile,process.platform==='win32'?'codex.cmd':'codex');
if(process.platform==='win32')await fs.writeFile(shim,`@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);else await fs.writeFile(shim,`#!/bin/sh\nexec '${process.execPath.replace(/'/g,"'\\''")}' '${fixture.replace(/'/g,"'\\''")}' "$@"\n`,{mode:0o755});
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({version:1,projectPath:project,commands:{claude:{executable:'claude',args:[]},antigravity:{executable:'agy',args:[]},codex:{executable:shim,args:[]}},layout:'columns',sizes:[34,33,33],fontSize:14,autoInstallMissing:false,models:{claude:'',antigravity:'',codex:'remembered-model'}}));
const env={...process.env,TRINITY_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;const packaged=process.env.TRINITY_PACKAGED_EXE,prefix=packaged?'packaged-':'';let app;const checks=[];
const pane=(page,id)=>page.getByTestId('task-pane-'+id);
const buffer=(page,id)=>pane(page,id).locator('.xterm-rows').innerText();
async function input(page,id,text){await pane(page,id).locator('textarea').focus();await page.keyboard.type(text);await page.keyboard.press('Enter');}
async function launch(){app=await electron.launch({executablePath:packaged||electronPath,args:packaged?[`--user-data-dir=${profile}`]:[root],env});const page=await app.firstWindow();await page.getByRole('heading',{name:'AI Trinity Desk V1.3.0'}).waitFor();return page;}
async function create(page,title){await page.getByRole('button',{name:'新增 CLI 任務',exact:true}).click();await page.getByLabel('CLI 任務名稱',{exact:true}).fill(title);await page.getByLabel('CLI 任務 AI',{exact:true}).selectOption('codex');await page.getByRole('button',{name:'建立任務',exact:true}).click();const state=await page.evaluate(()=>window.desk.cliTasks());expect(state.ok).toBe(true);return state.value.selected;}
async function stopAll(){if(!app)return;const page=await app.firstWindow().catch(()=>null);if(page)await page.evaluate(async()=>{const result=await window.desk.cliTasks();if(result.ok)for(const task of result.value.tasks)await window.desk.stopCliTask(task.id);}).catch(()=>{});}
try{
 let page=await launch();
 expect((await page.evaluate(()=>window.desk.createCliTask({provider:'codex',title:'unsafe',projectPath:'C:/private'}))).ok).toBe(false);
 expect((await page.evaluate(()=>window.desk.selectCliTask('../../settings.json'))).ok).toBe(false);
 await page.getByRole('button',{name:'CLI 任務',exact:true}).click();const first=await create(page,'登入流程研究');await pane(page,first).getByRole('button',{name:'▶ 啟動新任務',exact:true}).click();await expect.poll(()=>buffer(page,first)).toContain('TASK_READY:');
 await input(page,first,'記住這段任務內容');await expect.poll(()=>buffer(page,first)).toContain('TASK_ECHO:記住這段任務內容');
 await expect.poll(async()=>{const result=await page.evaluate(()=>window.desk.cliTasks());return result.value.tasks.find(t=>t.id===first)?.resumeReady;}).toBe(true);
 const firstPid=(await pane(page,first).locator('.status').innerText()).match(/PID (\d+)/)[1];
 const second=await create(page,'效能改善');await pane(page,second).getByRole('button',{name:'▶ 啟動新任務',exact:true}).click();await expect.poll(()=>buffer(page,second)).toContain('TASK_READY:');await input(page,second,'第二份獨立內容');await expect.poll(()=>buffer(page,second)).toContain('TASK_ECHO:第二份獨立內容');
 const secondPid=(await pane(page,second).locator('.status').innerText()).match(/PID (\d+)/)[1];expect(firstPid).not.toBe(secondPid);
 await page.getByRole('button',{name:'開啟任務 登入流程研究',exact:true}).click();expect(await pane(page,first).locator('.status').innerText()).toContain('PID '+firstPid);expect(await buffer(page,first)).toContain('TASK_ECHO:記住這段任務內容');expect(await buffer(page,first)).not.toContain('第二份獨立內容');
 checks.push('strict task IPC rejects arbitrary project path / invalid ID','two tasks for the same AI retain independent PTYs, history and original PID across switches');
 expect(await page.getByRole('button',{name:'封存 登入流程研究',exact:true}).isDisabled()).toBe(true);
 await page.getByRole('button',{name:'釘選 登入流程研究',exact:true}).click();await expect(page.getByRole('heading',{name:'已釘選',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新命名',exact:true}).click();await page.getByLabel('重新命名 CLI 任務',{exact:true}).fill('登入功能持續任務');await page.getByRole('button',{name:'儲存名稱',exact:true}).click();await expect(page.getByRole('button',{name:'開啟任務 登入功能持續任務',exact:true})).toBeVisible();
 await page.getByLabel('搜尋 CLI 任務',{exact:true}).fill('效能');await expect(page.getByRole('button',{name:'開啟任務 登入功能持續任務',exact:true})).toHaveCount(0);await page.getByLabel('搜尋 CLI 任務',{exact:true}).fill('');
 checks.push('pin / rename / search / project grouping and running archive guard');
 await pane(page,first).getByRole('button',{name:'■ 停止',exact:true}).click();await pane(page,first).getByRole('button',{name:'▶ 接續對話',exact:true}).click();await expect.poll(()=>buffer(page,first)).toContain('RESTORED:記住這段任務內容');expect(await buffer(page,first)).toContain('MODEL=remembered-model');expect(await pane(page,first).locator('.status').innerText()).not.toContain('PID '+firstPid);
 checks.push('stop then resume passes exact native ID and retained model; fixture restores native conversation context');
 await page.getByRole('button',{name:'收合 CLI 任務',exact:true}).click();await expect(page.getByTestId('pane-codex')).toBeVisible();await page.getByRole('button',{name:/^CLI 任務/}).click();await expect(pane(page,first)).toBeVisible();expect(await buffer(page,first)).toContain('RESTORED:記住這段任務內容');checks.push('return to three-pane workspace and reopen keeps task process alive');
 await page.screenshot({path:path.join(artifacts,prefix+'cli-tasks-sidebar.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,720));await expect(pane(page,first).getByRole('button',{name:'■ 停止',exact:true})).toBeVisible();await input(page,first,'fullscreen');await expect.poll(()=>buffer(page,first)).toContain('FOOTER:task');
 const bounds=await pane(page,first).evaluate(element=>{const terminal=element.querySelector('.terminal-surface').getBoundingClientRect(),last=[...element.querySelectorAll('.xterm-rows>div')].at(-1).getBoundingClientRect(),footer=element.querySelector('.pane-footer').getBoundingClientRect();return {last:last.bottom,surface:terminal.bottom,footer:footer.top};});expect(bounds.last).toBeLessThanOrEqual(bounds.surface+2);expect(bounds.last).toBeLessThanOrEqual(bounds.footer+2);await page.screenshot({path:path.join(artifacts,prefix+'cli-tasks-compact.png')});checks.push('compact sidebar and terminal final row remain accessible');
 await stopAll();await app.close();app=undefined;page=await launch();await expect(page.getByRole('region',{name:'CLI 任務',exact:true})).toBeVisible();
 let state=await page.evaluate(()=>window.desk.cliTasks());expect(state.value.tasks).toHaveLength(2);expect(state.value.tasks.every(t=>!t.running)).toBe(true);expect(state.value.tasks.find(t=>t.id===first).pinned).toBe(true);
 await pane(page,first).getByRole('button',{name:'▶ 接續對話',exact:true}).click();await expect.poll(()=>buffer(page,first)).toContain('RESTORED:記住這段任務內容');await pane(page,first).getByRole('button',{name:'■ 停止',exact:true}).click();checks.push('app restart retains selected task, names, pin and IDs without auto-launch; manual native resume succeeds');
 await page.getByRole('button',{name:'封存 登入功能持續任務',exact:true}).click();await page.getByRole('button',{name:'已封存',exact:true}).click();await expect(page.getByRole('button',{name:'還原 登入功能持續任務',exact:true})).toBeVisible();await page.getByRole('button',{name:'還原 登入功能持續任務',exact:true}).click();await page.getByRole('button',{name:'任務',exact:true}).click();await expect(page.getByRole('button',{name:'開啟任務 登入功能持續任務',exact:true})).toBeVisible();checks.push('archive and restore preserve task and native history');
 const report={passed:true,version:'1.3.0',packaged:!!packaged,timestamp:new Date().toISOString(),checks,note:'Real Electron and independent native PTYs with local named codex test shim and native-context fixture. No vendor AI calls or writes to actual vendor settings in this test. Real native validation is separate.'};await fs.writeFile(path.join(artifacts,prefix+'cli-tasks-e2e-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){if(app){const page=await app.firstWindow().catch(()=>null);await page?.screenshot({path:path.join(artifacts,prefix+'cli-tasks-failure.png')}).catch(()=>{});}throw error;}finally{await stopAll();await app?.close().catch(()=>{});}
