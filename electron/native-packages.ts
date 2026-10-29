import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rename, stat, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PaneId } from './contracts';

const execute=promisify(execFile);
export function nativePackageSelection(id:PaneId,architecture:string,root: {version:string;optionalDependencies?:Record<string,string>}) {
  if(!['claude','codex'].includes(id)||!['x64','arm64'].includes(architecture))throw new Error('Unsupported native CLI package');
  const name=id==='claude'?'@anthropic-ai/claude-code':'@openai/codex';
  const dependency=root.optionalDependencies?.[`${name}-win32-${architecture}`];
  if(!dependency)throw new Error('官方套件未提供此 Windows 架構。');
  const alias=dependency.match(/^npm:(@[^/]+\/[^@]+)@([0-9][0-9A-Za-z.+-]*)$/);
  const selected=alias?{name:alias[1],version:alias[2]}:{name:`${name}-win32-${architecture}`,version:dependency};
  if(selected.name!==(id==='codex'?name:`${name}-win32-${architecture}`)||!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.+-]+)?$/.test(selected.version))throw new Error('官方原生套件參照格式不符。');
  return selected;
}
export function validateTarEntries(list:string) {
  for(const raw of list.split(/\r?\n/).filter(Boolean)) {
    const entry=raw.replaceAll('\\','/');
    if(!entry.startsWith('package/')||entry.split('/').includes('..')||entry.includes(':')||entry.includes('\0'))throw new Error('套件封存檔含不安全的路徑。');
  }
}
export function registryAsset(value:string) {
  const url=new URL(value);
  const pathname=decodeURIComponent(url.pathname);
  if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.port||url.username||url.password||!/^\/@(?:anthropic-ai\/claude-code(?:-win32-(?:x64|arm64))?|openai\/codex)(?:\/|$)/.test(pathname))throw new Error('拒絕非官方 CLI 套件來源。');
  return url;
}
export async function installNativePackage(id:PaneId,root:string,environment:NodeJS.ProcessEnv,signal:AbortSignal,log:(message:string)=>void,transport:typeof fetch) {
  const rootName=id==='claude'?'@anthropic-ai/claude-code':'@openai/codex';
  const get=async(url:string)=>{
    registryAsset(url);signal.throwIfAborted();
    const response=await transport(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),headers:{Accept:'application/json'},credentials:'omit'});
    if(!response.ok)throw new Error(`官方套件資訊下載失敗（HTTP ${response.status}）。`);
    const text=await response.text();if(text.length>2*1024*1024)throw new Error('套件資訊過大。');return JSON.parse(text);
  };
  log(`讀取官方套件：${rootName}\n`);
  const selected=nativePackageSelection(id,process.arch,await get(`https://registry.npmjs.org/${encodeURIComponent(rootName)}/latest`));
  const metadata=await get(`https://registry.npmjs.org/${encodeURIComponent(selected.name)}/${encodeURIComponent(selected.version)}`);
  if(metadata.name!==selected.name||metadata.version!==selected.version)throw new Error('套件名稱或版本驗證失敗。');
  const tarball=registryAsset(metadata.dist?.tarball).href;
  const integrity=String(metadata.dist?.integrity||'');if(!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity))throw new Error('官方套件缺少 SHA-512 校驗值。');
  await mkdir(root,{recursive:true});const staging=await mkdtemp(path.join(root,`${id}-staging-`));
  const archive=path.join(staging,'package.tgz');
  const curl=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe');
  const tar=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');
  const proxy=environment.TRINITY_DOWNLOAD_PROXY,token=environment.TRINITY_DOWNLOAD_TOKEN;
  if(!proxy||!token)throw new Error('官方套件下載連線尚未建立。');
  log(`下載 ${selected.name}@${selected.version}\n來源：${tarball}\n`);
  for(let attempt=1;attempt<=6;attempt++){
    try {
      await execute(curl,['--fail','--silent','--show-error','--continue-at','-','--connect-timeout','15','--max-time','300','--proto','=http','--noproxy','127.0.0.1','--header',`Authorization: Bearer ${token}`,'--output',archive,'--url',`${proxy}?url=${encodeURIComponent(tarball)}`],{windowsHide:true,env:environment,signal,maxBuffer:65536});
      break;
    } catch(error) {
      signal.throwIfAborted();
      if(attempt===6)throw new Error('官方 CLI 套件下載失敗：'+String((error as {stderr?:string}).stderr||'連線中斷或逾時').slice(-1000));
      const downloaded=await stat(archive).then(s=>s.size).catch(()=>0);
      log(`連線中斷；保留 ${(downloaded/1048576).toFixed(1)} MiB，正在續傳（${attempt}/6）。\n`);
    }
  }
  signal.throwIfAborted();const hash=createHash('sha512');for await(const chunk of createReadStream(archive))hash.update(chunk);
  if(`sha512-${hash.digest('base64')}`!==integrity)throw new Error('套件 SHA-512 校驗失敗，已停止安裝。');
  log('SHA-512 校驗通過，解開官方原生套件。\n');
  const listing=await execute(tar,['-tzf',archive],{windowsHide:true,signal,maxBuffer:8*1024*1024});validateTarEntries(listing.stdout);
  const verbose=await execute(tar,['-tvzf',archive],{windowsHide:true,signal,maxBuffer:8*1024*1024});
  if(verbose.stdout.split(/\r?\n/).some(line=>/^[lh]/.test(line)))throw new Error('原生套件包含連結，已停止解壓縮。');
  await execute(tar,['-xzf',archive,'-C',staging],{windowsHide:true,signal,maxBuffer:65536});
  const candidates:string[]=[];
  const find=async(folder:string)=>{for(const entry of await readdir(folder,{withFileTypes:true})){const filename=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('原生套件含不支援的連結。');if(entry.isDirectory())await find(filename);else if(entry.name===`${id}.exe`)candidates.push(filename);}};
  await find(path.join(staging,'package'));if(candidates.length!==1)throw new Error('無法唯一識別官方 CLI 執行檔。');
  const before=candidates[0];const handle=await open(before,'r');const signature=Buffer.alloc(2);try{await handle.read(signature,0,2,0);}finally{await handle.close();}if(signature[0]!==0x4d||signature[1]!==0x5a)throw new Error('原生套件不是 Windows 執行檔。');
  const version=await execute(before,['--version'],{cwd:staging,env:environment,windowsHide:true,signal,timeout:30000,maxBuffer:65536});
  if(!version.stdout.trim())throw new Error('CLI 版本驗證失敗。');
  const installDir=path.join(root,id,`${selected.version}-${process.arch}`);await mkdir(path.dirname(installDir),{recursive:true});
  const relative=path.relative(path.join(staging,'package'),before);
  try {await rename(path.join(staging,'package'),installDir);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'&&(error as NodeJS.ErrnoException).code!=='EPERM')throw error;if(!(await stat(path.join(installDir,relative))).isFile())throw error;}
  const executable=path.join(installDir,relative);const bin=path.join(root,'bin');await mkdir(bin,{recursive:true});
  const escaped=executable.replaceAll('%','%%');await writeFile(path.join(bin,id+'.cmd'),`@echo off\r\n@chcp 65001 >nul\r\n"${escaped}" %*\r\n`,{encoding:'utf8',mode:0o600});
  await writeFile(path.join(root,id+'.json'),JSON.stringify({package:selected.name,version:selected.version,integrity,executable,verification:version.stdout.trim()},null,2),{encoding:'utf8',mode:0o600});
  await unlink(archive).catch(()=>{});await rmdir(staging).catch(()=>{});
  log(`正式 CLI 驗證成功：${version.stdout.trim()}\n`);return executable;
}
