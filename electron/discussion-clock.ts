export class DiscussionTimeoutError extends Error{
  constructor(){super('此 AI 回覆逾時，已保留前文。可選較長等候時間，按「延長並重試這次回覆」。');}
}
export class TurnClock{
  readonly startedAt=Date.now();
  deadlineAt:number;
  expired=false;
  private listeners=new Set<()=>void>();
  constructor(timeoutMs:number){this.deadlineAt=this.startedAt+timeoutMs;}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  extend(seconds:number){
    if(this.expired)throw new Error('這次回覆已逾時，請選較長時間後重試。');
    const next=Math.max(Date.now(),this.deadlineAt)+seconds*1000;
    if(next>this.startedAt+1800000)throw new Error('單次回覆最多延長至 30 分鐘；逾時後仍可選擇重試。');
    this.deadlineAt=next;for(const listener of this.listeners)listener();
  }
}
export function agreementReply(text:string):{text:string;agreement?:boolean}{
  const match=text.trimEnd().match(/(?:^|\n)\[\[TRINITY_(AGREE|OPEN)\]\]$/);
  if(!match)return {text};
  return {text:text.trimEnd().slice(0,match.index).trimEnd(),agreement:match[1]==='AGREE'};
}
