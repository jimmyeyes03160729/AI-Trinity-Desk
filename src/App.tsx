import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, PaneId, Environment, InstallState, ProviderInfo } from '../electron/contracts';
import { paneIds, projectFor } from '../electron/ids';
import TerminalPane, { labels } from './TerminalPane';
import InstallPanel from './InstallPanel';
import ProviderPanel from './ProviderPanel';
import DiscussionPanel from './DiscussionPanel';
import SkillMarketPanel from './SkillMarketPanel';
import { logout, webPath } from './web/desk';

export default function App() {
  const [settings, setSettings] = useState<Settings>();
  const current = useRef<Settings | undefined>(undefined);
  const committed = useRef<Settings | undefined>(undefined);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [message, setMessage] = useState('');
  const [active, setActive] = useState<Partial<Record<PaneId, boolean>>>({});
  const [environment, setEnvironment] = useState<Environment>();
  const [checking, setChecking] = useState(false);
  const [editor, setEditor] = useState<Settings>();
  const [argsText, setArgsText] = useState<Record<PaneId,string>>({ claude: '', antigravity: '', codex: '' });
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [installStates,setInstallStates] = useState<InstallState[]>([]);
  const [showProviders,setShowProviders]=useState(false);
  const [showDiscussion,setShowDiscussion]=useState(false);
  const [showMarket,setShowMarket]=useState(false);
  const [discussionActive,setDiscussionActive]=useState(false);
  const [providerInfo,setProviderInfo]=useState<Partial<Record<PaneId,ProviderInfo>>>({});
  const [providerLoading,setProviderLoading]=useState<Partial<Record<PaneId,boolean>>>({});
  const autoStarted = useRef(false);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!showProviders||!settings)return;
    const timer=setInterval(()=>{if(document.visibilityState==='visible')for(const id of current.current!.visiblePanes)void refreshProvider(id);},60000);
    return ()=>clearInterval(timer);
  },[showProviders]);
  useEffect(() => {
    void window.desk.loadSettings().then(result => { if (result.ok) { current.current = result.value.settings; committed.current = result.value.settings; setSettings(result.value.settings); if (result.value.warning) setMessage(result.value.warning); if (!autoStarted.current) { autoStarted.current=true; void window.desk.ensureCli().then(result=>{if(result.ok)setInstallStates(result.value);else setMessage(result.error);}); } } else setMessage(result.error); });
    const off = window.desk.onInstall(setInstallStates);
    void window.desk.installers().then(result=>{if(result.ok)setInstallStates(result.value);});
    return off;
  }, []);
  const changeActive = useCallback((id: PaneId, value: boolean) => setActive(previous => ({ ...previous, [id]: value })), []);
  const persist = useCallback((next: Settings): Promise<boolean> => {
    current.current = next; setSettings(next);
    const task = saveQueue.current.catch(() => {}).then(async () => {
      const result = await window.desk.saveSettings(next);
      if (!result.ok) { setMessage('設定未儲存：' + result.error); if (current.current === next && committed.current) { current.current = committed.current; setSettings(committed.current); } return false; }
      committed.current = result.value;
      return true;
    });
    saveQueue.current = task; return task;
  }, []);
  async function chooseProject(id?: PaneId) {
    await saveQueue.current;
    const result = await window.desk.chooseProject(id);
    if (!result.ok) setMessage(result.error);
    else if (result.value && current.current) { const next = { ...current.current, projectPath: result.value.projectPath, projectPaths: result.value.projectPaths }; current.current = next; committed.current = next; setSettings(next); }
  }
  async function detect() {
    setShowMarket(false);setShowDiscussion(false);
    setChecking(true); const result = await window.desk.detect(); setChecking(false);
    if (result.ok) setEnvironment(result.value); else setMessage(result.error);
  }
  function openSettings() {
    if (!current.current) return;
    setEditorError('');
    setEditor(structuredClone(current.current));
    setArgsText(Object.fromEntries(paneIds.map(id => [id, JSON.stringify(current.current!.commands[id].args, null, 2)])) as Record<PaneId,string>);
  }
  async function refreshProvider(id:PaneId){
    setProviderLoading(previous=>({...previous,[id]:true}));
    try{const result=await window.desk.providerInfo(id);if(result.ok)setProviderInfo(previous=>({...previous,[id]:result.value}));else setMessage(result.error);}
    finally{setProviderLoading(previous=>({...previous,[id]:false}));}
  }
  function openProviders(){setShowMarket(false);setShowDiscussion(false);setShowProviders(true);for(const id of current.current!.visiblePanes)if(!providerInfo[id]||Date.now()-Date.parse(providerInfo[id]!.updatedAt)>60000)void refreshProvider(id);}
  async function saveEditor() {
    if (!editor || !current.current) return;
    try {
      const commands = structuredClone(editor.commands);
      for (const id of paneIds) {
        const args: unknown = JSON.parse(argsText[id]);
        if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) throw new Error(`${labels[id]} 的參數必須是 JSON 字串陣列。`);
        commands[id] = { executable: commands[id].executable.trim(), args };
        if (!commands[id].executable) throw new Error(`${labels[id]} 的執行檔不可空白。`);
      }
      setEditorError(''); setSaving(true);
      const ok = await persist({ ...current.current, commands, models:editor.models, fontSize: editor.fontSize, autoInstallMissing: editor.autoInstallMissing });
      setSaving(false);
      if (ok) { setEditor(undefined); setEnvironment(undefined); if(editor.autoInstallMissing) {const result=await window.desk.ensureCli();if(result.ok)setInstallStates(result.value);} }
      else setEditorError('無法儲存設定。請確認設定內容與磁碟寫入權限。');
    } catch (error) { setSaving(false); setEditorError(error instanceof Error ? error.message : String(error)); }
  }
  function resizeStart(index: number, nextIndex:number, event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const start = current.current!; const bounds = workspace.current!.getBoundingClientRect();
    const startPos = start.layout === 'columns' ? event.clientX : event.clientY;
    const extent = start.layout === 'columns' ? bounds.width : bounds.height;
    const handle = event.currentTarget;
    const move = (e: PointerEvent) => {
      const pos = start.layout === 'columns' ? e.clientX : e.clientY;
      const visibleTotal=paneIds.reduce((sum,id,i)=>sum+(start.visiblePanes.includes(id)?start.sizes[i]:0),0);
      const delta = (pos - startPos) / extent * visibleTotal;
      const sum = start.sizes[index] + start.sizes[nextIndex];
      const first = Math.max(15, Math.min(70, sum-15, Math.max(sum-70, start.sizes[index]+delta)));
      const sizes = [...start.sizes] as Settings['sizes']; sizes[index] = first; sizes[nextIndex] = sum-first;
      const next = { ...current.current!, sizes }; current.current = next; setSettings(next);
    };
    const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); void persist(current.current!); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  function resizeKey(index: number, nextIndex:number, event: React.KeyboardEvent) {
    const direction = ['ArrowLeft','ArrowUp'].includes(event.key) ? -2 : ['ArrowRight','ArrowDown'].includes(event.key) ? 2 : 0;
    if (!direction || !current.current) return;
    event.preventDefault(); const sizes = [...current.current.sizes] as Settings['sizes'];
    if (sizes[index]+direction < 15 || sizes[index]+direction > 70 || sizes[nextIndex]-direction < 15 || sizes[nextIndex]-direction > 70) return;
    sizes[index] += direction; sizes[nextIndex] -= direction; void persist({ ...current.current, sizes });
  }
  function changeVisibility(id:PaneId,show:boolean){
    const previous=current.current!;
    const next=paneIds.filter(pane=>pane===id?show:previous.visiblePanes.includes(pane));
    if(!next.length)return;
    void persist({...previous,visiblePanes:next});
  }
  if (!settings) return <main className="loading">{message || '正在開啟 AI Trinity Desk…'}</main>;
  const runningCount = Object.values(active).filter(Boolean).length;
  const hiddenRunning=paneIds.filter(id=>active[id]&&!settings.visiblePanes.includes(id)).length;
  const visibleIndices=paneIds.map((id,index)=>settings.visiblePanes.includes(id)?index:-1).filter(i=>i>=0);
  const visibleWeight=visibleIndices.reduce((sum,i)=>sum+settings.sizes[i],0);
  return <main className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-logo">△</div><div><h1>AI Trinity Desk <span>V1.3.0</span></h1><p>三個 AI 工作夥伴，一個專注的工作空間。</p></div></div><div className="header-actions">{window.desk.web?<><span className="local-badge"><i />遠端連線主機</span><a className="header-link" href={webPath('/account')}>帳號</a><button onClick={()=>void logout()}>登出</button></>:<span className="local-badge"><i />本機工作空間</span>}<details className="visibility-menu"><summary>顯示欄位</summary><div>{paneIds.map(id=><label key={id}><input type="checkbox" aria-label={`顯示 ${labels[id]}`} checked={settings.visiblePanes.includes(id)} disabled={settings.visiblePanes.length===1 && settings.visiblePanes.includes(id)} onChange={e=>changeVisibility(id,e.target.checked)} />{labels[id]}{active[id] && <small>執行中</small>}</label>)}<small>至少顯示一欄。隱藏不會停止工作。</small></div></details><button aria-pressed={showDiscussion} onClick={()=>{setShowMarket(false);setShowDiscussion(value=>!value);}}>AI 互相對話{discussionActive?" · 討論中":""}</button><button aria-pressed={showMarket} onClick={()=>{setShowDiscussion(false);setShowMarket(value=>!value);}}>Skills 熱門市場</button><button onClick={()=>{setShowMarket(false);setShowDiscussion(false);showProviders?setShowProviders(false):openProviders();}}>模型與額度</button><button onClick={() => void detect()} disabled={checking}>{checking ? '檢查中…' : '環境檢查'}</button><button onClick={openSettings}>⚙ 設定</button></div></header>
    <section className="project-bar">{settings.projectMode === 'separate'
      ? <div className="project-paths">{settings.visiblePanes.map(id => <div className="project-path" key={id}><span className="folder-icon">▱</span><div><span className="eyebrow">{labels[id]}</span><strong title={projectFor(settings, id)}>{settings.projectPaths[id] || (settings.projectPath ? '沿用共用：' + settings.projectPath : '尚未選擇資料夾')}</strong></div><button disabled={!!active[id]} aria-label={`選擇 ${labels[id]} 的專案`} title={active[id] ? '先停止此終端即可切換資料夾' : `選擇 ${labels[id]} 使用的資料夾`} onClick={() => void chooseProject(id)}>選擇…</button></div>)}</div>
      : <><div className="project-path"><span className="folder-icon">▱</span><div><span className="eyebrow">目前專案</span><strong title={settings.projectPath}>{settings.projectPath || '選擇資料夾，開始你的工作'}</strong></div></div><button disabled={runningCount > 0} title={runningCount ? '先停止所有終端即可切換專案' : '選擇專案資料夾'} onClick={() => void chooseProject()}>選擇專案…</button></>}
      <div className="layout-controls" aria-label="專案資料夾模式"><button aria-pressed={settings.projectMode === 'shared'} disabled={runningCount > 0} title={runningCount ? '先停止所有終端即可切換模式' : '三個 AI 使用同一個資料夾'} onClick={() => void persist({ ...current.current!, projectMode: 'shared' })}>共用資料夾</button><button aria-pressed={settings.projectMode === 'separate'} disabled={runningCount > 0} title={runningCount ? '先停止所有終端即可切換模式' : '每個 AI 各自選擇資料夾'} onClick={() => void persist({ ...current.current!, projectMode: 'separate' })}>各自資料夾</button></div><div className="layout-controls" aria-label="終端排列"><button aria-pressed={settings.layout === 'columns'} onClick={() => void persist({ ...current.current!, layout: 'columns' })}>▥ 三欄</button><button aria-pressed={settings.layout === 'rows'} onClick={() => void persist({ ...current.current!, layout: 'rows' })}>☰ 三列</button><button title="恢復相同欄寬" onClick={() => void persist({ ...current.current!, sizes: [34,33,33] })}>平均</button></div></section>
    {message && <div className="notice" role="alert"><span>{message}</span><button aria-label="關閉通知" onClick={() => setMessage('')}>×</button></div>}
    {!showMarket && !showDiscussion && !showProviders && <InstallPanel states={installStates.filter(s=>settings.visiblePanes.includes(s.id))} onRetry={id=>{void window.desk.installCli(id).then(result=>{if(result.ok)setInstallStates(result.value);else setMessage(result.error);});}} onCancel={id=>{void window.desk.cancelInstall(id).then(result=>{if(!result.ok)setMessage(result.error);});}} />}
    {!showMarket && !showDiscussion && showProviders && <ProviderPanel ids={settings.visiblePanes} info={providerInfo} loading={providerLoading} models={settings.models} onRefresh={id=>void refreshProvider(id)} onModel={(id,model)=>void persist({...current.current!,models:{...current.current!.models,[id]:model}})} onCustom={openSettings} />}
    {!showMarket && !showDiscussion && environment && <section className="environment"><div className="environment-heading"><strong>環境檢查</strong><span>{environment.platform} / {environment.arch} · {window.desk.web?'網頁伺服器':'Electron'} {environment.electron} · Node {environment.node}</span><button aria-label="關閉環境檢查" onClick={() => setEnvironment(undefined)}>×</button></div><div className="detection-grid">{environment.results.map(result => <div key={result.id} className={result.available ? 'found' : 'missing'}><strong>{result.available ? '✓' : '○'} {labels[result.id]}</strong><code>{result.path || settings.commands[result.id].executable}</code><small>{result.message}</small></div>)}</div></section>}
    <div className="market-view" hidden={!showMarket}><SkillMarketPanel projectPath={settings.projectPath} visible={showMarket} onClose={()=>setShowMarket(false)} /></div><div className="discussion-view" hidden={!showDiscussion||showMarket}><DiscussionPanel settings={settings} onActive={setDiscussionActive} onClose={()=>setShowDiscussion(false)} /></div><div className={`workspace ${settings.layout}`} ref={workspace} hidden={showDiscussion||showMarket}>{paneIds.map((id, index) => <div className="pane-slot" key={id} hidden={!settings.visiblePanes.includes(id)} style={{ flexBasis: `${settings.sizes[index]/visibleWeight*100}%` }}><TerminalPane id={id} command={settings.commands[id]} model={settings.models[id]} project={projectFor(settings, id)} fontSize={settings.fontSize} onActive={changeActive} onSettings={openSettings} onModels={openProviders} />{settings.visiblePanes.includes(id) && index!==visibleIndices.at(-1) && <div className="resize-handle" role="separator" aria-label={`調整第 ${index+1} 欄大小`} aria-orientation={settings.layout === 'columns' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(settings.sizes[index])} tabIndex={0} onPointerDown={e => resizeStart(index,visibleIndices[visibleIndices.indexOf(index)+1],e)} onKeyDown={e => resizeKey(index,visibleIndices[visibleIndices.indexOf(index)+1],e)} />}</div>)}</div>
    <footer className="app-footer"><span><i className={runningCount ? 'live-dot' : ''} />{runningCount} 個終端執行中{hiddenRunning>0?`（${hiddenRunning} 個已隱藏）`:""}</span><span>拖曳分隔線調整大小 · Windows Ctrl+C / V（另支援 Ctrl+Shift+C / V） · macOS ⌘C / V</span><span>V1.3.0 · LOCAL FIRST</span></footer>
    {editor && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditor(undefined); }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === 'Escape' && !saving) setEditor(undefined); if (event.key === 'Tab') { const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select')]; const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><header><div><span className="eyebrow">WORKSPACE PREFERENCES</span><h2 id="settings-title">啟動設定</h2></div><button aria-label="關閉設定" disabled={saving} onClick={() => setEditor(undefined)}>×</button></header><p>設定會儲存在這台電腦，下次啟動 CLI 時套用。開啟時可自動補裝缺少的官方 CLI；登入仍由你完成。</p>
      <div className="settings-scroll"><label className="auto-install-option"><input type="checkbox" checked={editor.autoInstallMissing} onChange={e=>setEditor({...editor,autoInstallMissing:e.target.checked})} />開啟時自動安裝缺少的官方 CLI</label>{editorError && <div className="pane-error" role="alert">{editorError}</div>}{paneIds.map(id => <fieldset key={id}><legend>{labels[id]}</legend><label>執行檔或完整路徑<input autoFocus={id === 'claude'} aria-label={`${labels[id]} 執行檔`} value={editor.commands[id].executable} placeholder={id} onChange={e => setEditor({ ...editor, commands: { ...editor.commands, [id]: { ...editor.commands[id], executable: e.target.value } } })} /></label><label>啟動參數（JSON 字串陣列）<textarea aria-label={`${labels[id]} 參數`} rows={2} value={argsText[id]} spellCheck={false} onChange={e => setArgsText({ ...argsText, [id]: e.target.value })} /></label><label>模型（留空使用 CLI 設定）<input aria-label={`${labels[id]} 模型`} value={editor.models[id]} placeholder="模型 ID 或別名；留空保留 CLI 設定" onChange={e=>setEditor({...editor,models:{...editor.models,[id]:e.target.value}})} /></label><p className="model-help">下次啟動套用。現在的工作階段可直接輸入 /model 選擇帳號可用模型。</p></fieldset>)}<label className="font-setting">終端字體大小<select aria-label="終端字體大小" value={editor.fontSize} onChange={e => setEditor({ ...editor, fontSize: Number(e.target.value) })}>{Array.from({ length: 15 }, (_,i) => i+10).map(n => <option key={n} value={n}>{n} px</option>)}</select></label><div className="settings-help"><strong>設定提示</strong><p>執行檔只填命令或路徑，不要加引號或參數。範例參數：<code>["--help"]</code>。含空白的路徑可直接貼上。</p><p>Antigravity 的官方 CLI 命令為 agy。自訂命令不會被自動安裝覆蓋。三個 CLI 的驗證、費用及權限由各自工具管理。</p><p>專案列可選「共用資料夾」或「各自資料夾」。共用時三個 AI 同時修改相同檔案可能衝突，請自行協調工作分配；各自資料夾未選擇時沿用共用資料夾。</p></div></div><footer><button disabled={saving} onClick={() => setEditor(undefined)}>取消</button><button className="primary" disabled={saving} onClick={() => void saveEditor()}>{saving ? '儲存中…' : '儲存設定'}</button></footer>
    </section></div>}
  </main>;
}
