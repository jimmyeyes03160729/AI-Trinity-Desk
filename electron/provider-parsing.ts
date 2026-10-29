import type { ModelChoice, UsageWindow } from './contracts';
export function codexWindows(value:any):UsageWindow[]{
  const byId=value?.rateLimitsByLimitId&&typeof value.rateLimitsByLimitId==='object'?Object.values(value.rateLimitsByLimitId):[];
  const buckets=byId.length?byId:value?.rateLimits?[value.rateLimits]:[];
  const result:UsageWindow[]=[];
  for(const bucket of buckets as any[]){for(const key of ['primary','secondary']){
    const window=bucket?.[key];if(typeof window?.usedPercent!=='number'||!Number.isFinite(window.usedPercent))continue;
    const used=Math.min(100,Math.max(0,window.usedPercent));const minutes=window.windowDurationMins;
    const duration=typeof minutes==='number'&&minutes>0?(minutes%1440===0?`${minutes/1440} 天`:minutes%60===0?`${minutes/60} 小時`:`${minutes} 分鐘`):key==='primary'?'主要額度':'次要額度';
    result.push({label:`${bucket.limitName||bucket.limitId||'Codex'} · ${duration}`,usedPercent:used,remainingPercent:100-used,...(typeof window.resetsAt==='number'&&window.resetsAt>0?{resetsAt:window.resetsAt}:{})});
  }}return result;
}
export function codexModels(value:any):ModelChoice[]{
  if(!Array.isArray(value?.data))return [];
  return value.data.filter((m:any)=>m&&!m.hidden&&typeof(m.model||m.id)==='string').map((m:any)=>({id:m.model||m.id,name:m.displayName||m.model||m.id})).slice(0,100);
}
export function agyModels(text:string):ModelChoice[]{
  const result:ModelChoice[]=[];
  for(const line of text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').split(/\r?\n/)){
    const match=line.trim().match(/^([a-z][a-z0-9._-]*(?:\/[a-z0-9._-]+)?)\s{2,}(.+)$/);
    if(match && /(?:gemini|claude|gpt|model)/i.test(match[1]))result.push({id:match[1],name:match[2].trim()});
  }return result.slice(0,100);
}
