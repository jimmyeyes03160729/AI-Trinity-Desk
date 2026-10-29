import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'test-results'); await fs.mkdir(artifacts, { recursive:true });
const data = await fs.mkdtemp(path.join(artifacts, 'profile-'));
const project = path.join(data, '專案 with spaces'); await fs.mkdir(project);
// Never install or alter real vendor CLIs during desktop regression tests.
await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,projectPath:'',commands:{claude:{executable:'claude',args:[]},antigravity:{executable:'agy',args:[]},codex:{executable:'codex',args:[]}},layout:'columns',sizes:[34,33,33],fontSize:14,autoInstallMissing:false}));
const env = { ...process.env, TRINITY_TEST_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const ids = ['claude','antigravity','codex'];
const labels = ['Claude Code','Antigravity CLI','Codex CLI'];
const packagedExe = process.env.TRINITY_PACKAGED_EXE;
const prefix = packagedExe ? 'packaged-' : '';
let app;
const checks=[];
async function launch() {
  app = await electron.launch({ executablePath:packagedExe || electronPath, args:packagedExe ? [`--user-data-dir=${data}`] : [root], env, timeout:30000 });
  if (packagedExe) expect(await app.evaluate(({app})=>app.getPath('userData'))).toBe(data);
  app.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  const page = await app.firstWindow(); await page.getByRole('heading',{name:'AI Trinity Desk V1.3.0'}).waitFor();
  return page;
}
async function buffer(page,id) {
  // Read rendered accessibility/text canvas through xterm's public DOM rows.
  return page.getByTestId(`terminal-${id}`).locator('.xterm-rows').innerText();
}
async function waitText(page,id,text) { await expect.poll(() => buffer(page,id),{timeout:20000}).toContain(text); }
async function input(page,id,line) {
  const area=page.getByTestId(`terminal-${id}`).locator('textarea'); await area.focus(); await page.keyboard.type(line); await page.keyboard.press('Enter');
}
try {
  let page=await launch();
  await page.screenshot({path:path.join(artifacts,`${prefix}welcome.png`)});
  const security=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  if (!security.sandbox || !security.contextIsolation || security.nodeIntegration) throw new Error('Unsafe BrowserWindow preferences');
  expect(await page.evaluate(()=>typeof window.require)).toBe('undefined');
  expect((await page.evaluate(()=>window.desk.start('wrong',80,24))).ok).toBe(false);
  expect((await page.evaluate(()=>window.desk.installCli('wrong'))).ok).toBe(false);
  expect((await page.evaluate(()=>window.desk.providerInfo('wrong'))).ok).toBe(false);
  await expect(page.getByRole('region',{name:'CLI 自動安裝',exact:true})).toBeVisible();
  checks.push('sandbox / context isolation / invalid IPC rejected');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});}, project);
  await page.getByRole('button',{name:'選擇專案…',exact:true}).click(); await expect(page.getByText(project,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();
  for (let i=0;i<3;i++) {
    await page.getByRole('textbox',{name:`${labels[i]} 執行檔`,exact:true}).fill(process.execPath);
    await page.getByRole('textbox',{name:`${labels[i]} 參數`,exact:true}).fill(JSON.stringify([path.join(root,'tests','fixture.cjs'),ids[i]]));
  }
  await page.getByRole('textbox',{name:'Codex CLI 模型',exact:true}).fill('fixture-model');
  await page.getByRole('button',{name:'儲存設定',exact:true}).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'環境檢查',exact:true}).click(); await expect(page.locator('.detection-grid .found')).toHaveCount(3);
  await page.getByRole('button',{name:'關閉環境檢查'}).click();
  for (const id of ids) { await page.getByTestId(`pane-${id}`).getByRole('button',{name:'▶ 啟動',exact:true}).click(); await waitText(page,id,`READY:${id}:TTY=true`); }
  await expect.poll(async()=> (await buffer(page,'codex')).replace(/\s/g,'')).toContain('ARGS:codex:["--model","fixture-model"]');
  await input(page,'codex','cwd');
  await expect.poll(async()=> (await buffer(page,'codex')).replace(/\s/g,''),{timeout:20000}).toContain(('CWD:codex:'+project).replace(/\s/g,''));
  checks.push('manual model setting passes the correct CLI flag');
  await expect(page.getByRole('button',{name:'選擇專案…',exact:true})).toBeDisabled();
  for (const id of ids) { await input(page,id,`hello-${id}`); await waitText(page,id,`ECHO:${id}:hello-${id}`); }
  expect(await buffer(page,'claude')).not.toContain('ECHO:codex'); checks.push('three real independent PTYs / Unicode project path / keyboard input / project-switch guard');
  const retainedStatus=await page.getByTestId('pane-claude').locator('.status').innerText();
  await page.locator('.visibility-menu summary').click();
  await page.getByRole('checkbox',{name:'顯示 Claude Code',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'顯示 Antigravity CLI',exact:true}).uncheck();
  await expect(page.getByTestId('pane-claude')).toBeHidden();
  await expect(page.getByRole('checkbox',{name:'顯示 Codex CLI',exact:true})).toBeDisabled();
  await expect(page.locator('.app-footer')).toContainText('2 個已隱藏');
  const onePane=await page.getByTestId('pane-codex').boundingBox(),workspaceBox=await page.locator('.workspace').boundingBox();
  expect(onePane.width).toBeGreaterThan(workspaceBox.width-4);
  await page.getByRole('checkbox',{name:'顯示 Claude Code',exact:true}).check();
  await page.getByRole('checkbox',{name:'顯示 Antigravity CLI',exact:true}).check();
  await page.locator('.visibility-menu summary').click();
  expect(await page.getByTestId('pane-claude').locator('.status').innerText()).toBe(retainedStatus);
  await input(page,'claude','after-show');await waitText(page,'claude','ECHO:claude:after-show');
  checks.push('AI visibility selection / single pane fills workspace / hidden PTY keeps same PID and remains interactive');
  // Synthetic UI metadata only. Actual account read validation is recorded separately.
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('provider:info');
    ipcMain.handle('provider:info',(_event,id)=>({ok:true,value:{id,models:[{id:'fixture-model',name:'Synthetic model'}],windows:id==='codex'?[{label:'Synthetic 5-hour window',usedPercent:25,remainingPercent:75,resetsAt:1900000000}]:[],message:id==='claude'?'請輸入 /usage 查看額度':'Synthetic account fixture',source:'TEST FIXTURE',updatedAt:new Date().toISOString()}}));
  });
  await page.getByRole('button',{name:'模型與額度',exact:true}).click();
  await expect(page.getByTestId('provider-codex')).toContainText('已用 25%');
  await expect(page.getByTestId('provider-codex')).toContainText('剩餘 75%');
  await expect(page.getByTestId('provider-codex')).toContainText('重置：');
  await expect(page.getByTestId('provider-claude')).toContainText('/usage');
  await page.getByRole('combobox',{name:'Claude Code 處理模型',exact:true}).selectOption('fixture-model');
  await expect.poll(()=>page.evaluate(async()=>{const s=await window.desk.loadSettings();return s.ok&&s.value.settings.models.claude;})).toBe('fixture-model');
  await page.screenshot({path:path.join(artifacts,`${prefix}models-usage.png`)});
  await page.getByRole('combobox',{name:'Claude Code 處理模型',exact:true}).selectOption('');
  await page.getByRole('button',{name:'模型與額度',exact:true}).click();
  checks.push('account used / remaining / reset time display / provider limitations / model dropdown saves without restarting session');
  await page.screenshot({path:path.join(artifacts,`${prefix}three-terminals.png`)});
  const before=await page.getByTestId('pane-codex').locator('.status').innerText();
  await page.getByTestId('pane-codex').getByRole('button',{name:'↻ 重啟',exact:true}).click();
  await expect.poll(async()=>{const text=await page.getByTestId('pane-codex').locator('.status').innerText();return text.includes('執行中') && text!==before;}).toBe(true);
  await waitText(page,'codex','READY:codex:TTY=true');
  await input(page,'codex','child'); await waitText(page,'codex','CHILD:codex:');
  const text=await buffer(page,'codex'); const childPid=Number(text.match(/CHILD:codex:(\d+)/)?.[1]); if (!childPid) throw new Error('Missing child PID');
  await page.getByTestId('pane-codex').getByRole('button',{name:'■ 停止',exact:true}).click();
  await expect.poll(()=>page.getByTestId('pane-codex').locator('.status').innerText()).toContain('待命');
  let alive=true; try { process.kill(childPid,0); } catch { alive=false; } expect(alive).toBe(false);
  checks.push('restart gives new PID / stop terminates child process tree');
  await app.evaluate(({clipboard})=>clipboard.writeText('中文 paste test'));
  await page.getByTestId('pane-claude').getByRole('button',{name:'貼上',exact:true}).click(); await expect(page.getByTestId('terminal-claude').locator('textarea')).toBeFocused(); await page.keyboard.press('Enter'); await waitText(page,'claude','ECHO:claude:中文 paste test');
  const copyLine=page.getByTestId('terminal-claude').locator('.xterm-rows>div').filter({hasText:'ECHO:claude:中文 paste test'}).last();
  const copyRect=await copyLine.boundingBox(); await page.mouse.click(copyRect.x+20,copyRect.y+copyRect.height/2,{clickCount:3}); await page.getByTestId('pane-claude').getByRole('button',{name:'複製',exact:true}).click();
  expect(await app.evaluate(({clipboard})=>clipboard.readText())).toContain('ECHO:claude:中文 paste test');
  if(process.platform==='win32') {
    const box=await copyLine.boundingBox();await page.mouse.click(box.x+20,box.y+box.height/2,{clickCount:3});
    await app.evaluate(({clipboard})=>clipboard.writeText('copy-sentinel'));
    await page.keyboard.press('Control+c');
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toContain('ECHO:claude:中文 paste test');
    await app.evaluate(({clipboard})=>clipboard.writeText('plain-ctrl-v'));
    await page.getByTestId('terminal-claude').locator('textarea').focus();await page.keyboard.press('Control+v');await waitText(page,'claude','plain-ctrl-v');await page.keyboard.press('Enter');await waitText(page,'claude','ECHO:claude:plain-ctrl-v');
    await page.keyboard.type('interrupt-me');await page.keyboard.press('Control+c');
    await expect.poll(async()=>{const text=await buffer(page,'claude');return text.includes('INTERRUPT:claude')||text.includes('代碼 -1073741510');},{timeout:20000}).toBe(true);
    if((await page.getByTestId('pane-claude').locator('.status').innerText()).includes('已結束')){await page.getByTestId('pane-claude').getByRole('button',{name:'▶ 啟動',exact:true}).click();await waitText(page,'claude','READY:claude:TTY=true');}
    checks.push('Ctrl+C copies selected text / Ctrl+V pastes / Ctrl+C without selection interrupts');
  }
  await app.evaluate(({clipboard})=>clipboard.writeText('keyboard-paste'));
  await page.getByTestId('terminal-claude').locator('textarea').focus(); await page.keyboard.press(process.platform==='darwin'?'Meta+v':'Control+Shift+v'); await waitText(page,'claude','keyboard-paste');await page.keyboard.press('Enter'); await waitText(page,'claude','ECHO:claude:keyboard-paste');
  await input(page,'claude','size'); await waitText(page,'claude','DIM:claude:'); const dimensionsBefore=(await buffer(page,'claude')).match(/DIM:claude:(\d+x\d+)/)?.[1];
  const rect=await page.getByRole('separator',{name:'調整第 1 欄大小'}).boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2); await page.mouse.down(); await page.mouse.move(rect.x+80,rect.y+rect.height/2); await page.mouse.up();
  await expect.poll(async()=>{await input(page,'claude','size'); const matches=[...(await buffer(page,'claude')).matchAll(/DIM:claude:(\d+x\d+)/g)];return matches.at(-1)?.[1];},{timeout:15000}).not.toBe(dimensionsBefore);
  await page.getByRole('button',{name:'☰ 三列',exact:true}).click();
  await expect(page.locator('.workspace')).toHaveClass('workspace rows');
  await page.getByRole('button',{name:'▥ 三欄',exact:true}).click();
  checks.push('clipboard / drag resize propagates to PTY / row and column layouts');
  await input(page,'antigravity','region-error');await expect(page.getByTestId('pane-antigravity').getByRole('alert')).toContainText('地區');
  checks.push('Google location restriction is explained precisely');
  await page.getByTestId('pane-antigravity').getByRole('button',{name:'↻ 重啟',exact:true}).click();await expect(page.getByTestId('pane-antigravity').getByRole('alert')).toHaveCount(0);await waitText(page,'antigravity','READY:antigravity:TTY=true');
  await input(page,'antigravity','fail'); await expect(page.getByTestId('pane-antigravity').getByRole('alert')).toContainText('代碼 7');
  await input(page,'claude','burst'); await waitText(page,'claude','BURST_DONE:claude');
  await input(page,'claude','still-responsive'); await waitText(page,'claude','ECHO:claude:still-responsive');
  await page.screenshot({path:path.join(artifacts,`${prefix}running.png`)});
  await page.getByTestId('pane-claude').getByRole('button',{name:'■ 停止',exact:true}).click();
  await expect.poll(()=>page.getByTestId('pane-claude').locator('.status').innerText()).toContain('待命');
  await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();
  await page.getByRole('checkbox',{name:'開啟時自動安裝缺少的官方 CLI'}).check();
  await page.getByRole('button',{name:'儲存設定',exact:true}).click();
  await expect(page.locator('.install-card.custom')).toHaveCount(3);
  await page.locator('.visibility-menu summary').click();
  await page.getByRole('checkbox',{name:'顯示 Antigravity CLI',exact:true}).uncheck();
  await page.locator('.visibility-menu summary').click();
  await expect.poll(()=>page.evaluate(async()=>{const s=await window.desk.loadSettings();return s.ok&&s.value.settings.visiblePanes;})).toEqual(['claude','codex']);
  await app.close();
  page=await launch(); await expect(page.getByText(project,{exact:true})).toBeVisible();
  await expect(page.getByTestId('pane-antigravity')).toBeHidden();
  await page.locator('.visibility-menu summary').click();
  await page.getByRole('checkbox',{name:'顯示 Antigravity CLI',exact:true}).check();
  await page.locator('.visibility-menu summary').click();
  checks.push('selected AI visibility survives app relaunch');
  expect(await page.evaluate(async()=>{const s=await window.desk.loadSettings();return s.ok && s.value.settings.commands.codex.executable;})).toBe(process.execPath);
  expect(await page.evaluate(async()=>{const s=await window.desk.loadSettings();return s.ok && s.value.settings.models.codex;})).toBe('fixture-model');
  await expect(page.locator('.status.running')).toHaveCount(0); checks.push('non-zero exit shown / 10,000-line output backpressure / settings survive relaunch / no automatic CLI start');
  await expect(page.locator('.install-card.custom')).toHaveCount(3);
  expect(await page.evaluate(async()=>{const result=await window.desk.loadSettings();return result.ok && result.value.settings.autoInstallMissing;})).toBe(true);
  checks.push('automatic install setting persists / startup handles custom commands without downloading / installer IPC rejects unknown ID');
  await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();
  await page.getByRole('textbox',{name:'Codex CLI 執行檔',exact:true}).fill('trinity-definitely-missing-command');
  await page.getByRole('button',{name:'儲存設定',exact:true}).click();
  await page.getByTestId('pane-codex').getByRole('button',{name:'▶ 啟動',exact:true}).click();
  await expect(page.getByTestId('pane-codex').getByRole('alert')).toContainText('尚未找到'); checks.push('missing executable reports actionable error');
  if(process.platform==='win32') {
    const shim=path.join(project,'CLI shim.cmd'); await fs.writeFile(shim,`@echo off\r\n"${process.execPath}" "${path.join(root,'tests','fixture.cjs')}" %*\r\n`);
    await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();
    await page.getByRole('textbox',{name:'Codex CLI 執行檔',exact:true}).fill(shim);
    await page.getByRole('textbox',{name:'Codex CLI 參數',exact:true}).fill('["shim-test"]');
    await page.getByRole('button',{name:'儲存設定',exact:true}).click();
    await page.getByTestId('pane-codex').getByRole('button',{name:'▶ 啟動',exact:true}).click(); await waitText(page,'codex','READY:shim-test:TTY=true');
    await input(page,'codex','shim-input'); await waitText(page,'codex','ECHO:shim-test:shim-input');
    for(const size of [{w:1500,h:920,z:1},{w:1024,h:700,z:1},{w:1500,h:920,z:1.25}]){
      await app.evaluate(({BrowserWindow},size)=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(size.w,size.h);win.webContents.setZoomFactor(size.z);},size);
      await expect.poll(async()=>{await input(page,'codex','fullscreen');return page.getByTestId('terminal-codex').locator('.xterm-rows>div').last().innerText();},{timeout:15000}).toContain('FOOTER:shim-test');
      const fits=await page.getByTestId('pane-codex').evaluate(pane=>{
        const surface=pane.querySelector('.terminal-surface').getBoundingClientRect();const screen=pane.querySelector('.xterm-screen').getBoundingClientRect();const last=[...pane.querySelectorAll('.xterm-rows>div')].at(-1).getBoundingClientRect();const footer=pane.querySelector('.pane-footer').getBoundingClientRect();
        return screen.bottom<=surface.bottom+1&&screen.right<=surface.right+1&&last.bottom<=footer.top;
      });expect(fits).toBe(true);
      await page.screenshot({path:path.join(artifacts,`${prefix}footer-${size.w}-${size.z}.png`)});
    }
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.webContents.setZoomFactor(1);win.setSize(1500,920);});
    checks.push('full-screen CLI last row stays visible at normal / compact window sizes and 125% zoom');
    await page.getByTestId('pane-codex').getByRole('button',{name:'■ 停止',exact:true}).click();
    await expect.poll(()=>page.getByTestId('pane-codex').locator('.status').innerText()).toContain('待命');
    checks.push('Windows .cmd shim with spaces and Unicode path launches through PowerShell');
  }
  await page.screenshot({path:path.join(artifacts,`${prefix}desktop.png`)});
  const report={passed:true,packaged:!!packagedExe,platform:process.platform,arch:process.arch,checks,timestamp:new Date().toISOString()};
  await fs.writeFile(path.join(artifacts,`${prefix}e2e-report.json`),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} catch(error) { if(app) { const page=await app.firstWindow().catch(()=>null); if(page) await page.screenshot({path:path.join(artifacts,`${prefix}failure.png`)}).catch(()=>{}); } console.error(error); process.exitCode=1; }
finally { if(app) { const page=await app.firstWindow().catch(()=>null); if(page) await page.evaluate(async()=>{await Promise.all(['claude','antigravity','codex'].map(id=>window.desk.stop(id)));}).catch(()=>{}); await app.close().catch(()=>{}); } }
