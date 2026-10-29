import { net } from 'electron';

// net.request uses the OS proxy configuration. Unlike net.fetch it exposes
// manual redirects, allowing every destination to be checked before following.
export function limitedSystemFetch(maxBytes:number):typeof fetch{return async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new Promise<Response>((resolve,reject)=>{
    const request=net.request({url,method:'GET',redirect:'manual',useSessionCookies:false});
    let settled=false;
    const signal=init?.signal;
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const fail=(error:Error)=>{if(!settled){settled=true;cleanup();reject(error);}request.abort();};
    const complete=(response:Response)=>{if(!settled){settled=true;cleanup();resolve(response);}};
    const abort=()=>fail(new Error('下載已取消或逾時。'));
    request.on('error',error=>{if(!settled){settled=true;cleanup();reject(error);}});
    request.on('redirect',(status,_method,location)=>{complete(new Response(null,{status,headers:{location}}));request.abort();});
    request.on('response',response=>{
      const parts:Buffer[]=[];let bytes=0;
      response.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>maxBytes){fail(new Error('下載資料超過大小限制。'));return;}parts.push(data);});
      response.on('error',error=>fail(error));
      response.on('end',()=>{
        const headers=new Headers();for(const [key,value] of Object.entries(response.headers))if(value)headers.set(key,Array.isArray(value)?value.join(', '):value);
        complete(new Response([204,205,304].includes(response.statusCode)?null:new Uint8Array(Buffer.concat(parts)),{status:response.statusCode,headers}));
      });
    });
    for(const [key,value] of new Headers(init?.headers)) request.setHeader(key,value);
    request.setHeader('Cache-Control','no-store');
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else request.end();
  });
};}
export const systemFetch=limitedSystemFetch(2*1024*1024);
