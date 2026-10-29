import { net } from 'electron';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { registryAsset } from './native-packages';

export function validateAssetUrl(value:string) {
  const url=new URL(value);
  if(url.hostname==='registry.npmjs.org')return registryAsset(value);
  const accepted=['claude.ai','downloads.claude.ai','antigravity.google','releases.openai.com','storage.googleapis.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
  const github=url.hostname==='github.com' && url.pathname.startsWith('/openai/codex/');
  const api=url.hostname==='api.github.com' && url.pathname.startsWith('/repos/openai/codex/');
  if(url.protocol!=='https:'||url.username||url.password||url.port||(!accepted.includes(url.hostname)&&!github&&!api))throw new Error('Rejected non-official installer asset host');
  return url;
}
export async function startDownloadBridge(log: (message:string)=>void = ()=>{}) {
  const token=randomBytes(32).toString('hex');
  const active=new Set<Electron.ClientRequest>();
  const server=createServer((incoming,reply)=>{
    if(incoming.method!=='GET'||incoming.headers.authorization!==`Bearer ${token}`){reply.writeHead(403);reply.end('Forbidden');return;}
    let target:URL;
    try {const input=new URL(incoming.url!,'http://127.0.0.1');if(input.pathname!=='/download')throw new Error('Invalid route');target=validateAssetUrl(input.searchParams.get('url')||'');}
    catch {reply.writeHead(400);reply.end('Unsupported download URL');return;}
    const request=net.request({url:target.href,method:'GET',redirect:'manual',useSessionCookies:false});
    active.add(request);
    let bytes=0,redirects=0,finished=false,lastProgress=Date.now();
    log(`下載官方資源：${target.origin}${target.pathname}\n`);
    const timer=setTimeout(()=>fail('Download timed out'),5*60*1000);
    const cleanup=()=>{clearTimeout(timer);active.delete(request);};
    const fail=(message:string)=>{if(finished)return;finished=true;cleanup();log(`下載中斷：${message}\n`);if(!reply.headersSent){reply.writeHead(502);reply.end(message);}else reply.destroy(new Error(message));request.abort();};
    reply.on('close',()=>{cleanup();if(!finished){finished=true;request.abort();}});
    reply.on('error',()=>{cleanup();request.abort();});
    request.setHeader('User-Agent','AI-Trinity-Desk/1.0.2');
    request.setHeader('Cache-Control','no-cache');
    request.setHeader('Accept-Encoding','identity');
    if(typeof incoming.headers.range==='string' && /^bytes=\d+-\d*$/.test(incoming.headers.range))request.setHeader('Range',incoming.headers.range);
    request.on('redirect',(_code,_method,url)=>{
      try {validateAssetUrl(url);if(++redirects>8)throw new Error('Too many redirects');request.followRedirect();}
      catch {fail('Unsupported download redirect');}
    });
    request.on('error',error=>fail(error.message));
    request.on('response',response=>{
      const headers:Record<string,string>={};
      // Chromium may decompress responses. Forwarding the original compressed
      // Content-Length would make curl truncate the body or wait indefinitely.
      for(const name of ['content-type','content-range','accept-ranges']){const value=response.headers[name];if(typeof value==='string')headers[name]=value;else if(Array.isArray(value)&&value[0])headers[name]=value[0];}
      reply.writeHead(response.statusCode,headers);
      response.on('data',(data:Buffer)=>{
        bytes+=data.length;if(bytes>1024*1024*1024){fail('Download exceeds 1 GiB');return;}
        if(Date.now()-lastProgress>5000){lastProgress=Date.now();log(`已接收 ${(bytes/1048576).toFixed(1)} MiB\n`);}
        reply.write(data);
        if(reply.writableLength>8*1024*1024)fail('Local download consumer is too slow');
      });
      response.on('error',error=>fail(error.message));
      response.on('end',()=>{if(!finished){finished=true;cleanup();log(`資源下載完成：${bytes} bytes\n`);reply.end();}});
    });
    request.end();
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Cannot bind download bridge');
  return {
    env:{TRINITY_DOWNLOAD_PROXY:`http://127.0.0.1:${address.port}/download`,TRINITY_DOWNLOAD_TOKEN:token},
    close:async()=>{for(const request of active)request.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  };
}
