import type { InstallState, PaneId } from '../electron/contracts';
import { labels } from './TerminalPane';
export default function InstallPanel({ states, onRetry, onCancel }: { states: InstallState[]; onRetry: (id: PaneId) => void; onCancel: (id: PaneId) => void }) {
  const busy = states.some(s=>['queued','checking','downloading','installing'].includes(s.status));
  return <section className="install-panel" aria-label="CLI 自動安裝">
    <header><strong>CLI 自動安裝</strong><span>{busy ? '依序準備工具，完成後可在各欄啟動並登入。' : '已安裝的工具會略過；帳號登入由各 CLI 引導。'}</span></header>
    <div className="install-grid" style={{gridTemplateColumns:`repeat(${Math.max(1,states.length)},minmax(0,1fr))`}}>{states.map(state=>{
      const pending = ['queued','checking','downloading','installing'].includes(state.status);
      return <article key={state.id} data-testid={`install-${state.id}`} className={`install-card ${state.status}`}>
        <div className="install-title"><strong>{labels[state.id]}</strong>{pending ? <button onClick={()=>onCancel(state.id)}>取消安裝</button> : ['error','cancelled','idle'].includes(state.status) ? <button onClick={()=>onRetry(state.id)}>{state.status==='idle'?'檢查並安裝':'重試安裝'}</button> : <span>{state.status==='ready'?'✓ 可使用':'自訂命令'}</span>}</div>
        <p role={state.status==='error'?'alert':undefined}>{state.message}</p>
        {pending && <progress aria-label={`${labels[state.id]} 安裝進度`} />}
        {state.path && <code title={state.path}>{state.path}</code>}
        {state.log && <details><summary>安裝紀錄</summary><pre>{state.log.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'')}</pre></details>}
      </article>;
    })}</div>
  </section>;
}
