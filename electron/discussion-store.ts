import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {discussionSchema,paneIdSchema,type DiscussionState} from './contracts';
const stamp=z.string().max(64);
const storedSchema=z.object({
  runId:z.string().uuid().optional(),status:z.enum(['idle','running','stopping','completed','stopped','error']),config:discussionSchema.optional(),
  messages:z.array(z.object({id:z.string().uuid(),provider:paneIdSchema,round:z.number().int().min(1).max(250),text:z.string().max(12000),model:z.string().max(200),agreement:z.boolean().optional(),createdAt:stamp}).strict()).max(150),
  batches:z.array(z.object({startRound:z.number().int().min(1).max(250),rounds:z.number().int().min(1).max(5),messageStart:z.number().int().min(0).max(150),instruction:z.string().max(3000),participants:z.array(paneIdSchema).min(2).max(3).refine(ids=>new Set(ids).size===ids.length).optional(),createdAt:stamp}).strict()).max(21).optional(),
  models:z.object({claude:z.string().max(200).optional(),antigravity:z.string().max(200).optional(),codex:z.string().max(200).optional()}).strict().optional(),
  current:paneIdSchema.optional(),error:z.string().max(10000).optional(),errorKind:z.enum(['timeout','interrupted']).optional(),endReason:z.enum(['agreement','round-limit']).optional(),
  pendingTurn:z.object({round:z.number().int().min(1).max(250),endRound:z.number().int().min(1).max(250),providerIndex:z.number().int().min(0).max(2)}).strict().optional(),turnDeadlineAt:z.number().finite().positive().optional(),
  storageError:z.string().max(1000).optional(),updatedAt:stamp
}).strict();
export class DiscussionStore{
  private queue:Promise<void>=Promise.resolve();
  constructor(private file:string){}
  async load():Promise<DiscussionState|undefined>{
    try{
      if((await stat(this.file)).size>8*1024*1024)throw new Error('紀錄過大');
      const state=storedSchema.parse(JSON.parse(await readFile(this.file,'utf8')));
      if(state.messages.length&&(!state.runId||!state.config))throw new Error('缺少討論主題');
      if(state.config&&state.messages.some(m=>!state.config!.participants.includes(m.provider)))throw new Error('發言者與成員不符');
      if(state.config&&state.batches?.some(b=>b.participants&&(b.participants.length!==state.config!.participants.length||b.participants.some(id=>!state.config!.participants.includes(id)))))throw new Error('回答順序與成員不符');
      if(state.batches?.length){let next=1;for(const batch of state.batches){if(batch.startRound!==next)throw new Error('輪次不連續');next+=batch.rounds;}}
      if(state.pendingTurn&&(!state.config||state.pendingTurn.providerIndex>=state.config.participants.length||state.pendingTurn.round>state.pendingTurn.endRound))throw new Error('未完成回覆位置無效');
      if(state.status==='running'||state.status==='stopping'){state.status='stopped';state.current=undefined;state.turnDeadlineAt=undefined;state.errorKind=state.pendingTurn?'interrupted':undefined;state.error='上次討論尚未完成。已保留完整發言，可接續；不會自動送出請求。';}
      return state;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw new Error('無法讀取先前討論紀錄，原檔未改動。請檢查磁碟或保留備份。');}
  }
  save(state:DiscussionState){
    const data=JSON.stringify(storedSchema.parse(state),null,2);
    if(Buffer.byteLength(data)>8*1024*1024)throw new Error('討論紀錄超過保存上限。');
    const task=this.queue.catch(()=>{}).then(async()=>{
      await mkdir(path.dirname(this.file),{recursive:true});
      await writeFile(this.file+'.tmp',data,{encoding:'utf8',mode:0o600});
      await rename(this.file+'.tmp',this.file);
    });
    this.queue=task;return task;
  }
}
