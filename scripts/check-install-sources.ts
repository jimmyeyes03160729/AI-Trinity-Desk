import { createHash } from 'node:crypto';
import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { systemFetch } from '../electron/network';
import { cliCatalog, downloadInstaller } from '../electron/installers';
// Read-only network diagnostic: download official scripts, never execute them.
app.setPath('userData',mkdtempSync(path.join(os.tmpdir(),'trinity-source-probe-')));
void app.whenReady().then(async()=>{
const results = await Promise.all(Object.entries(cliCatalog).map(async([id,cli])=>{
  const source=process.platform==='win32'?cli.win:cli.mac;
  try {const script=await downloadInstaller(source,new AbortController().signal,systemFetch);return {id,source,ok:true,bytes:Buffer.byteLength(script),sha256:createHash('sha256').update(script).digest('hex')};}
  catch(error){return {id,source,ok:false,error:error instanceof Error?error.message:String(error)};}
}));
console.log(JSON.stringify({executed:false,timestamp:new Date().toISOString(),results},null,2));
app.exit(results.some(result=>!result.ok)?1:0);
}).catch(error=>{console.error(error);app.exit(1);});
