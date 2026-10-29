import {useEffect,useRef,useState} from 'react';
import type {MarketQuery,MarketResult,PaneId,SkillInstallState} from '../electron/contracts';
import {paneIds} from '../electron/ids';
import {labels} from './TerminalPane';
export default function SkillMarketPanel({projectPath,visible,onClose}:{projectPath:string;visible:boolean;onClose:()=>void}){
  const [view,setView]=useState<MarketQuery['view']>(projectPath?'recommended':'popular');
  const [input,setInput]=useState(''),[search,setSearch]=useState('');
  const [result,setResult]=useState<MarketResult>(),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const serial=useRef(0);
  const content=useRef<HTMLDivElement>(null),queue=useRef(new Set<string>()),attempted=useRef(new Set<string>()),pumping=useRef(false),isVisible=useRef(visible);isVisible.current=visible;
  const [autoTranslate,setAutoTranslate]=useState(true),[provider,setProvider]=useState<PaneId>('claude'),[translating,setTranslating]=useState<string[]>([]);
  const providerRef=useRef(provider);providerRef.current=provider;
  const [targets,setTargets]=useState<PaneId[]>([...paneIds]),[installed,setInstalled]=useState<SkillInstallState[]>([]),[installing,setInstalling]=useState<string[]>([]);
  useEffect(()=>window.desk.onSkillInstall(setInstalled),[]);
  useEffect(()=>{if(visible)void window.desk.skillInstallations().then(response=>{if(response.ok)setInstalled(response.value);});},[visible]);
  async function translate(ids:string[]){
    setTranslating(previous=>[...new Set([...previous,...ids])]);
    try{const response=await window.desk.enrichSkills({ids,provider:providerRef.current});if(response.ok)setResult(previous=>previous?{...previous,skills:previous.skills.map(skill=>response.value.find(s=>s.id===skill.id)?{...response.value.find(s=>s.id===skill.id)!,reasons:skill.reasons}:skill)}:previous);else setResult(previous=>previous?{...previous,skills:previous.skills.map(skill=>ids.includes(skill.id)?{...skill,translationError:response.error}:skill)}:previous);}
    finally{setTranslating(previous=>previous.filter(id=>!ids.includes(id)));}
  }
  async function pump(){if(pumping.current)return;pumping.current=true;try{while(queue.current.size&&isVisible.current){const ids=[...queue.current].slice(0,4);ids.forEach(id=>queue.current.delete(id));await translate(ids);}}finally{pumping.current=false;}}
  useEffect(()=>{
    if(!visible||!autoTranslate||!result)return;
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=(entry.target as HTMLElement).dataset.skillId;if(entry.isIntersecting&&id&&!attempted.current.has(id)&&result.skills.find(s=>s.id===id)?.summaryKind!=='translated'){attempted.current.add(id);queue.current.add(id);}}void pump();},{root:content.current,threshold:0.1});
    content.current?.querySelectorAll('[data-skill-id]').forEach(node=>observer.observe(node));return()=>observer.disconnect();
  },[visible,autoTranslate,result]);
  async function install(id:string){setInstalling(previous=>[...previous,id]);try{const response=await window.desk.installSkill({id,targets});if(response.ok)setInstalled(response.value);else setError(response.error);}finally{setInstalling(previous=>previous.filter(value=>value!==id));}}
  async function load(refresh=false){
    const request=++serial.current;setLoading(true);setError('');setResult(undefined);queue.current.clear();attempted.current.clear();
    try{const response=await window.desk.skillMarket({view,query:search,refresh});if(request!==serial.current)return;if(response.ok)setResult(response.value);else{setResult(undefined);setError(response.error);}}
    catch{if(request===serial.current){setResult(undefined);setError('無法讀取 Skills 市場，請稍後重試。');}}
    finally{if(request===serial.current)setLoading(false);}
  }
  useEffect(()=>{if(visible)void load();else serial.current++;return()=>{serial.current++;};},[visible,view,search,projectPath]);
  async function open(id:string,target:'market'|'source'){const response=await window.desk.openSkillLink({id,target});if(!response.ok)setError(response.error);}
  function submit(event:React.FormEvent){event.preventDefault();if(input.trim().length<2){setError('搜尋至少輸入兩個字元。');return;}if(view==='search'&&search===input.trim())void load(true);else{setSearch(input.trim());setView('search');}}
  return <section className="skill-market-panel" aria-label="Skills 熱門市場"><header><div><h2>Skills 熱門市場</h2><p>瀏覽熱門工具，依目前專案找出可參考的能力。</p></div><button aria-label="收合 Skills 市場" onClick={onClose}>收合</button></header>
    <div className="market-controls"><div className="market-tabs" aria-label="市場分類"><button aria-pressed={view==='recommended'} onClick={()=>setView('recommended')}>專案推薦</button><button aria-pressed={view==='popular'} onClick={()=>setView('popular')}>熱門排行</button><button aria-pressed={view==='trending'} onClick={()=>setView('trending')}>近期趨勢</button></div><form onSubmit={submit}><input aria-label="搜尋 Skills" maxLength={80} placeholder="搜尋技能，例如 React、測試…" value={input} onChange={e=>setInput(e.target.value)} /><button type="submit">搜尋</button></form><button disabled={loading} onClick={()=>void load(true)}>{loading?'讀取中…':'重新整理市場'}</button></div>
    <div className="skill-action-settings"><div><strong>安裝所屬 AI</strong>{paneIds.map(id=><label key={id}><input type="checkbox" aria-label={`安裝到 ${labels[id]}`} checked={targets.includes(id)} onChange={e=>{const checked=e.target.checked;setTargets(previous=>checked?[...previous,id]:previous.filter(p=>p!==id));}} />{labels[id]}</label>)}</div><div><label><input type="checkbox" checked={autoTranslate} onChange={e=>{setAutoTranslate(e.target.checked);attempted.current.clear();if(!e.target.checked){queue.current.clear();void window.desk.cancelSkillTranslation();}}} />自動翻譯可見項目的 Summary</label><select aria-label="Summary 翻譯用 AI" value={provider} onChange={e=>setProvider(e.target.value as PaneId)}>{paneIds.map(id=><option key={id} value={id}>{labels[id]}</option>)}</select><small>翻譯使用既有登入，計入所選 CLI 用量。</small></div></div>
    <p className="market-privacy">專案偵測留在本機；翻譯只傳公開 Summary。按「一鍵安裝」才會下載至勾選 AI 的使用者 Skills 目錄，保留同名既有內容。安裝後重開所屬 CLI；互相對話仍維持純文字模式。</p>
    <div className="market-content" aria-busy={loading} ref={content}>
      {error&&<div role="alert" className="notice">{error}</div>}
      {result?.warning&&<div role="status" className="market-warning">{result.warning}</div>}
      {view==='recommended'&&result?.profile&&<div className="project-profile" data-testid="skill-project-profile"><strong>目前專案：{result.profile.name}</strong><span>已檢視 {result.profile.scannedFiles} 個檔案名稱{result.profile.limited?'（有範圍上限）':''}</span><div className="profile-tags">{result.profile.signals.map(signal=><span title={signal.evidence.join('\n')} key={signal.tag}>{signal.label}</span>)}</div>{result.profile.warnings.map(warning=><p key={warning}>{warning}</p>)}<small>推薦依技術訊號匹配，並非必裝清單；未深入審閱專案需求。</small></div>}
      {result&&<div className="market-data-source"><span>{result.source} · {result.updatedAt?`取得於 ${new Date(result.updatedAt).toLocaleString('zh-TW')}`:'尚未取得線上資料'}{result.stale?' · 非即時資料':''}</span><span>顯示 {result.skills.length} 項{result.total>result.skills.length?`／取得 ${result.total} 項`:''}</span></div>}
      {loading&&!result&&<p className="market-empty">正在讀取市場資料…</p>}
      {result&&!result.skills.length&&!loading&&<p className="market-empty">{view==='recommended'?'目前沒有足夠訊號推薦特定 Skill，可改看熱門排行或自行搜尋。':'沒有符合的 Skill，請換個關鍵字。'}</p>}
      <div className="skill-card-grid">{result?.skills.map(skill=>{const states=installed.filter(s=>s.id===skill.id),busy=installing.includes(skill.id)||states.some(s=>['queued','downloading','installing'].includes(s.status)),done=targets.length>0&&targets.every(ai=>states.some(s=>s.ai===ai&&s.status==='installed'));return <article className="skill-card" data-testid="skill-market-card" data-skill-id={skill.id} key={skill.id}><div className="skill-card-heading"><strong>{skill.titleZh}</strong>{view!=='recommended'&&view!=='search'&&skill.rank&&<span>來源榜 #{skill.rank}</span>}</div><code>{skill.name}</code><small className="skill-source">{skill.source}</small><p>{skill.summaryZh}</p><span className={`skill-summary-kind ${skill.summaryKind}`}>{skill.summaryKind==='translated'?`來源 Summary 中文翻譯 · ${labels[skill.translationProvider!]}`:skill.summaryKind==='original'?'來源 Summary 原文（待翻譯）':skill.summaryKind==='reviewed'?'內建中文摘要（待更新來源 Summary）':'待讀取來源 Summary'}</span>{skill.summaryOriginal&&<details className="skill-original"><summary>Summary 原文與來源時間</summary><pre>{skill.summaryOriginal}</pre><small>{skill.summaryFetchedAt?new Date(skill.summaryFetchedAt).toLocaleString('zh-TW'):''}</small></details>}{skill.translationError&&<p className="skill-translation-error">{skill.translationError}</p>}<button className="skill-translate-button" disabled={translating.includes(skill.id)} onClick={()=>void translate([skill.id])}>{translating.includes(skill.id)?'讀取並翻譯中…':skill.summaryKind==='translated'?'重新讀取中文翻譯':'讀取並翻譯 Summary'}</button>{skill.reasons.length>0&&<ul className="skill-reasons">{skill.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}<div className="skill-installed-targets">{states.map(state=><div key={state.ai} className={state.status}><strong>{labels[state.ai]}</strong><span>{({queued:'等待中',downloading:'下載中',installing:'安裝中',installed:'已安裝',existing:'同名既有，未覆寫',error:'安裝失敗',cancelled:'已取消'})[state.status]}</span><details><summary>位置與紀錄</summary><code>{state.folder}</code><p>{state.message}</p></details></div>)}</div><footer><span>{skill.installs===undefined?'未提供安裝統計':`${view==='trending'?'趨勢榜數值':'累計安裝'} ${skill.installs.toLocaleString('zh-TW')}`}</span><div><button onClick={()=>void open(skill.id,'market')}>市場介紹</button><button onClick={()=>void open(skill.id,'source')}>GitHub 來源</button></div></footer><button className="primary skill-install-button" disabled={busy||done||!targets.length} onClick={()=>void install(skill.id)}>{busy?'安裝中…':done?'已安裝至所選 AI':'一鍵安裝至所選 AI'}</button>{busy&&<button onClick={()=>void window.desk.cancelSkillInstall(skill.id)}>取消這項安裝</button>}</article>;})}</div>
      {result&&<p className="market-footnote">Summary 以來源頁面為準；翻譯與匹配可能有誤，請搭配原文核對。安裝只放置 Skill 檔案，不執行其中腳本；來源程式碼仍需自行評估。</p>}
    </div>
  </section>;
}
