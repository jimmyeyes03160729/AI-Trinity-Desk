import type {PaneId,ProviderInfo} from '../electron/contracts';
import {labels} from './TerminalPane';
export default function ProviderPanel({ids,info,loading,models,onRefresh,onModel,onCustom}:{ids:PaneId[];info:Partial<Record<PaneId,ProviderInfo>>;loading:Partial<Record<PaneId,boolean>>;models:Record<PaneId,string>;onRefresh:(id:PaneId)=>void;onModel:(id:PaneId,model:string)=>void;onCustom:()=>void}){
  return <section className="provider-panel" aria-label="模型與帳號額度"><header><strong>模型與帳號額度</strong><span>只讀取官方帳號資料；不送出 AI 任務。模型選擇於下次啟動套用。</span></header>
    <div className="provider-grid" style={{gridTemplateColumns:`repeat(${ids.length},minmax(0,1fr))`}}>{ids.map(id=>{
      const data=info[id];const choices=data?.models||[];
      return <article key={id} data-testid={`provider-${id}`}><div className="provider-title"><strong>{labels[id]}</strong><button disabled={loading[id]} onClick={()=>onRefresh(id)}>{loading[id]?'讀取中…':'重新整理'}</button></div>
        <label>處理模型<select aria-label={`${labels[id]} 處理模型`} value={models[id]} onChange={e=>onModel(id,e.target.value)}><option value="">CLI 原本設定</option>{models[id]&&!choices.some(m=>m.id===models[id])&&<option value={models[id]}>手動：{models[id]}</option>}{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
        <button className="manual-model" onClick={onCustom}>手動輸入其他模型 ID…</button>
        {!data&&!loading[id]&&<p>按重新整理取得模型與額度。</p>}
        {data?.windows.map((window,index)=><div className="usage-window" key={index}><strong>{window.label}</strong><div><span>已用 {window.usedPercent.toFixed(0)}%</span><span>剩餘 {window.remainingPercent.toFixed(0)}%</span></div><progress max={100} value={window.usedPercent} /><small>重置：{window.resetsAt?new Date(window.resetsAt*1000).toLocaleString('zh-TW'):'服務未提供時間'}</small></div>)}
        {data?.usageText&&<pre className="usage-report">{data.usageText}</pre>}
        {data&&<><p>{data.message}</p><small>更新：{new Date(data.updatedAt).toLocaleString('zh-TW')} · {data.source}</small></>}
        <p className="model-help">清單依 CLI 提供；實際可用模型與額度由登入帳號決定。</p>
      </article>;
    })}</div>
  </section>;
}
