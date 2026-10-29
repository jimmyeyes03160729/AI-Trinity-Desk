import {useEffect,useRef,useState} from 'react';
import type {DiscussionConfig,DiscussionState,PaneId,Settings} from '../electron/contracts';
import {paneIds} from '../electron/ids';
import {labels} from './TerminalPane';

export function discussionMarkdown(state:DiscussionState){
  const notes=(index:number)=>(state.batches||[]).filter(b=>b.startRound>1&&b.messageStart===index).map(b=>`## 使用者接續重點（從第 ${b.startRound} 輪）\n\n${b.instruction||'繼續釐清尚未解決的分歧。'}${b.participants?`\n\n回答順序：${b.participants.map(id=>labels[id]).join(' → ')}`:''}`).join('\n\n');
  return `# AI 互相對話\n\n${state.config?.topic||''}\n\n`+state.messages.map((m,i)=>`${notes(i)}\n\n## 第 ${m.round} 輪 · ${labels[m.provider]}${m.model?`（${m.model}）`:''}\n\n${m.text}`).join('\n\n')+`\n\n${notes(state.messages.length)}`+(state.error?`\n\n討論停止原因：${state.error}`:'');
}
export default function DiscussionPanel({settings,onActive,onClose}:{settings:Settings;onActive:(active:boolean)=>void;onClose:()=>void}){
  const [state,setState]=useState<DiscussionState>({status:'idle',messages:[],updatedAt:''});
  const [topic,setTopic]=useState('');
  const [instruction,setInstruction]=useState('');
  const [autoStopAgreement,setAutoStopAgreement]=useState(true),[now,setNow]=useState(Date.now());
  const [participants,setParticipants]=useState<PaneId[]>(settings.visiblePanes.length>=2?[...settings.visiblePanes]:[...paneIds]);
  const [rounds,setRounds]=useState(2),[timeout,setTimeoutSeconds]=useState(180);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const [follow,setFollow]=useState(true);
  const history=useRef<HTMLDivElement>(null);
  const active=state.status==='running'||state.status==='stopping';
  useEffect(()=>{
    let alive=true,received=false;
    const update=(next:DiscussionState)=>{if(!alive)return;setState(next);if(next.config){setTopic(next.config.topic);setParticipants(next.config.participants);setRounds(next.batches?.at(-1)?.rounds||next.config.rounds);setTimeoutSeconds(next.config.timeoutSeconds);setAutoStopAgreement(next.config.autoStopAgreement!==false);}};
    const off=window.desk.onDiscussion(next=>{received=true;update(next);});
    void window.desk.discussionState().then(result=>{if(result.ok&&!received)update(result.value);else if(!result.ok&&alive)setError(result.error);});
    return()=>{alive=false;off();};
  },[]);
  useEffect(()=>{onActive(active);},[active,onActive]);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active]);
  useEffect(()=>{if(follow&&history.current)history.current.scrollTop=history.current.scrollHeight;},[state.messages.length,state.status,follow]);
  async function start(){
    setBusy(true);setError('');setCopied(false);
    const config:DiscussionConfig={topic:topic.trim(),participants,rounds,timeoutSeconds:timeout,autoStopAgreement};
    try{const result=await window.desk.startDiscussion(config);if(!result.ok)setError(result.error);else setState(result.value);}
    catch{setError('無法開始討論，請重新開啟程式。');}finally{setBusy(false);}
  }
  async function stop(){setBusy(true);try{const result=await window.desk.stopDiscussion();if(result.ok)setState(result.value);else setError(result.error);}finally{setBusy(false);}}
  async function continueChat(){
    if(!state.runId)return;setBusy(true);setError('');setCopied(false);
    try{const result=await window.desk.continueDiscussion({runId:state.runId,instruction:instruction.trim(),rounds,timeoutSeconds:timeout,participants});if(result.ok){setState(result.value);setInstruction('');}else setError(result.error);}
    catch{setError('無法接續討論，原有紀錄仍保留。');}finally{setBusy(false);}
  }
  async function extend(){if(!state.runId)return;const result=await window.desk.extendDiscussion({runId:state.runId,seconds:180});if(result.ok)setState(result.value);else setError(result.error);}
  async function retry(){
    if(!state.runId)return;setBusy(true);setError('');
    try{const result=await window.desk.retryDiscussion({runId:state.runId,timeoutSeconds:timeout});if(result.ok)setState(result.value);else setError(result.error);}finally{setBusy(false);}
  }
  async function copy(){const result=await window.desk.writeClipboard(discussionMarkdown(state));if(result.ok)setCopied(true);else setError(result.error);}
  function moveParticipant(id:PaneId,direction:number){setParticipants(previous=>{const index=previous.indexOf(id),target=index+direction;if(index<0||target<0||target>=previous.length)return previous;const next=[...previous];[next[index],next[target]]=[next[target],next[index]];return next;});}
  function selectParticipant(id:PaneId,selected:boolean){setParticipants(previous=>selected?(previous.includes(id)?previous:[...previous,id]):previous.filter(p=>p!==id));}
  const displayOrder=[...participants,...paneIds.filter(id=>!participants.includes(id))];
  const canContinue=!!state.config&&participants.length===state.config.participants.length&&participants.every(id=>state.config!.participants.includes(id));
  const status={idle:'尚未開始',running:`${state.current?labels[state.current]:'AI'} 回覆中…`,stopping:'正在停止…',completed:state.endReason==='agreement'?'全員表示一致，已提前結束':'討論完成',stopped:'已停止',error:'討論中斷'}[state.status];
  const batch=state.batches?.at(-1);
  const planned=batch?batch.messageStart+batch.rounds*(state.config?.participants.length||participants.length):(state.config?.rounds||rounds)*(state.config?.participants.length||participants.length);
  const notes=(index:number)=>(state.batches||[]).filter(b=>b.startRound>1&&b.messageStart===index).map(b=><aside className="discussion-followup" key={b.startRound}><strong>你的接續重點 · 從第 {b.startRound} 輪</strong><div>{b.instruction||'繼續釐清尚未解決的分歧。'}</div>{b.participants&&<small>回答順序：{b.participants.map(id=>labels[id]).join(' → ')}</small>}</aside>);
  return <section className="discussion-panel" aria-label="AI 互相對話">
    <header><div><h2>AI 互相對話</h2><p>沿用已安裝 CLI、登入與模型。選擇主題，讓 AI 輪流回應彼此，不需 Skills。</p></div><button aria-label="收合 AI 討論" onClick={onClose}>收合</button></header>
    <div className="discussion-body"><div className="discussion-setup"><label>討論主題<textarea aria-label="討論主題" rows={5} maxLength={6000} value={topic} disabled={active||busy} placeholder="例如：討論這項功能的使用流程，互相提出問題，最後整理共識。" onChange={e=>setTopic(e.target.value)} /></label>
      <fieldset disabled={active||busy}><legend>參與的 AI 與回答順序</legend>{displayOrder.map(id=>{const index=participants.indexOf(id);return <div className="discussion-member" key={id}><span className="discussion-order-number">{index<0?'—':index+1}</span><div className="discussion-member-choice"><label><input type="checkbox" aria-label={`討論參與 ${labels[id]}`} checked={index>=0} onChange={e=>selectParticipant(id,e.target.checked)} /><span>{labels[id]}</span></label><small>{settings.models[id]||'CLI 預設模型'}</small></div><div className="discussion-order-buttons"><button type="button" aria-label={`${labels[id]} 提前回答`} title="上移" disabled={index<=0} onClick={()=>moveParticipant(id,-1)}>↑</button><button type="button" aria-label={`${labels[id]} 延後回答`} title="下移" disabled={index<0||index===participants.length-1} onClick={()=>moveParticipant(id,1)}>↓</button></div></div>;})}<p className="discussion-order-preview" data-testid="discussion-order-preview">回答順序：{participants.length?participants.map(id=>labels[id]).join(' → '):'請勾選 AI'}</p></fieldset>
      <div className="discussion-options"><label>討論輪數<select aria-label="討論輪數" value={rounds} disabled={active||busy} onChange={e=>setRounds(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n} 輪</option>)}</select></label><label>每次回覆等候<select aria-label="每次回覆等候" value={timeout} disabled={active||busy} onChange={e=>setTimeoutSeconds(Number(e.target.value))}>{[60,180,300,600].map(n=><option value={n} key={n}>{n/60} 分鐘</option>)}</select></label></div>
      <label className="discussion-agreement-option"><input type="checkbox" checked={autoStopAgreement} disabled={active||busy||state.messages.length>0} onChange={e=>setAutoStopAgreement(e.target.checked)} />全員明確表示一致時提前停止</label>
      <p className="discussion-note">一輪＝每個 AI 各發言一次；最後一位整理共識與分歧。內容會分享給所選 AI，並計入各家帳號用量。</p>
      <p className="discussion-note">使用獨立討論工作階段，不接續終端歷史、不以目前專案為工作目錄。最新一場討論會自動保存於本機，重開程式可接續；不會自動送出請求。</p>
      {state.messages.length>0&&<div className="discussion-continue"><label>補充問題或分歧<textarea aria-label="補充問題或分歧" rows={3} maxLength={3000} value={instruction} disabled={active||busy} onChange={e=>setInstruction(e.target.value)} placeholder="例如：兩位對方案 A、B 仍有分歧，請比較成立條件與驗證方法。留空也可繼續討論。" /></label><p className="discussion-note">接續保留全部紀錄及原主題／成員／模型，可調整原成員的回答順序，再按上方輪數追加討論。更換主題或成員請用新討論。</p>{!canContinue&&<p className="discussion-note">請保留原本參與的 AI，才能接續；可自由調整先後順序。</p>}<button className="primary" disabled={active||busy||!canContinue} onClick={()=>void continueChat()}>接續討論</button></div>}
      <div className="discussion-actions"><button className={state.messages.length?'':'primary'} disabled={active||busy||participants.length<2||!topic.trim()} onClick={()=>void start()}>{state.messages.length?'開始新討論':'開始討論'}</button><button disabled={!active||busy} onClick={()=>void stop()}>停止討論</button></div>
      {state.messages.length>0&&<small className="discussion-note">「開始新討論」會清除這場紀錄；未解決的問題請用「接續討論」。</small>}
      {(error||state.error)&&<div role="alert" className="pane-error">{error||state.error}</div>}
      {state.errorKind&&state.pendingTurn&&<button className="primary discussion-retry" disabled={active||busy} onClick={()=>void retry()}>{state.errorKind==='timeout'?'延長並重試這次回覆':'接續未完成的回覆'}</button>}
      {state.storageError&&<div role="alert" className="pane-error">{state.storageError}</div>}
    </div><div className="discussion-transcript"><div className="discussion-progress" role="status"><strong>{status}</strong><span>{state.messages.length} / {planned} 次回覆</span>{active&&state.turnDeadlineAt&&<><span>剩餘 {Math.max(0,Math.ceil((state.turnDeadlineAt-Math.max(now,Date.now()))/1000))} 秒</span><button disabled={state.status!=='running'} onClick={()=>void extend()}>延長等候 +3 分鐘</button></>}<label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)} />跟隨最新</label><button disabled={!state.messages.length} onClick={()=>void copy()}>{copied?'已複製紀錄':'複製討論紀錄'}</button></div>
      <div className="discussion-history" ref={history} data-testid="discussion-history">{!state.messages.length&&<div className="discussion-empty">選擇至少兩個 AI 並輸入主題。它們會讀取已完成的討論內容，再輪流提出看法。</div>}{state.messages.map((message,index)=><div key={message.id}>{notes(index)}<article className={`discussion-message ${message.provider}`}><header><strong>{labels[message.provider]}</strong><span>第 {message.round} 輪 · {message.model||'CLI 預設模型'} · {new Date(message.createdAt).toLocaleTimeString('zh-TW')}</span></header><div>{message.text}</div></article></div>)}{notes(state.messages.length)}{active&&<p className="discussion-wait">{status} 收合面板仍會繼續；按「停止討論」可中止。</p>}</div>
    </div></div>
  </section>;
}
