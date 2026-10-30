import { useEffect, useState } from 'react';
import type { LocalSkill, PaneId } from '../electron/contracts';
import { labels } from './TerminalPane';

export default function LocalSkillPicker({ id, project, running, onInsert, onClose }: { id: PaneId; project: string; running: boolean; onInsert: (text: string) => void; onClose: () => void }) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState('');
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true); setError('');
    try { const result = await window.desk.localSkills(id); if (result.ok) setSkills(result.value); else setError(result.error); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [id, project]);
  async function translate(skill: LocalSkill) {
    const key = skill.scope + '/' + skill.folder; setTranslating(key); setError('');
    try {
      const result = await window.desk.translateLocalSkill({ ai: id, scope: skill.scope, folder: skill.folder });
      if (!result.ok) setError(result.error);
      else setSkills(items => items.map(item => item.scope === skill.scope && item.folder === skill.folder ? { ...item, ...result.value } : item));
    } finally { setTranslating(''); }
  }
  const shown = skills.filter(skill => `${skill.name} ${skill.description} ${skill.descriptionZh || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog local-skills-dialog" role="dialog" aria-modal="true" aria-label={`${labels[id]} 已安裝的 Skills`} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <header><div><span className="eyebrow">{labels[id]}</span><h2>選擇已安裝的 Skill</h2></div><button aria-label="關閉 Skills" onClick={onClose}>×</button></header>
      <div className="local-skills-tools"><input aria-label="搜尋已安裝 Skills" placeholder="搜尋名稱或用途" value={search} onChange={event => setSearch(event.target.value)} /><button disabled={loading} onClick={() => void refresh()}>{loading ? '讀取中…' : '重新整理'}</button></div>
      <p className="local-skills-help">選擇後只插入指令，不會自動送出；請在 CLI 的輸入提示處使用。技能是否載入由 CLI 決定，新安裝後可能需要重啟。</p>
      <p className="local-skills-help">清單來自常見使用者目錄及目前專案；插件、系統內建與其他自訂位置的 Skills 不一定會列出。</p>
      <p className="local-skills-help">翻譯會把該 Skill 的名稱與描述送至 {labels[id]}，可能產生用量；不會傳送完整 Skill 檔案。</p>
      {error && <div role="alert" className="pane-error">{error}</div>}
      <div className="local-skills-list" aria-busy={loading}>
        {!loading && !shown.length && <p>沒有找到符合的 Skill。可重新整理，或在 Skills 市場安裝。</p>}
        {shown.map(skill => <article key={skill.scope + '/' + skill.folder} data-testid="local-skill">
          <div className="local-skill-heading"><strong>{skill.name}</strong><span>{skill.scope === 'project' ? '目前專案' : skill.scope === 'legacy' ? '使用者舊目錄' : '使用者目錄'}</span></div>
          <p>{skill.descriptionZh || '尚無中文說明；可查看原文或按「翻譯用途」。'}</p>
          <details><summary>原始用途說明{skill.translationSource === 'translated' ? '（中文為 AI 翻譯）' : skill.translationSource === 'converted' ? '（中文經繁體字詞轉換）' : ''}</summary><p>{skill.description}</p></details>
          {skill.ambiguous && <small>有同名 Skill，無法確認 CLI 會選取哪一個。</small>}
          {!skill.invocable && <small>此 Skill 的名稱或設定不支援直接呼叫。</small>}
          <div className="local-skill-actions"><button disabled={!!translating} onClick={() => void translate(skill)}>{translating === skill.scope + '/' + skill.folder ? '翻譯中…' : skill.descriptionZh ? '重新翻譯用途' : '翻譯用途'}</button><button className="primary" disabled={!running || !skill.invocable || skill.ambiguous} title={!running ? '先啟動 CLI' : undefined} onClick={() => { onInsert((id === 'codex' ? '$' : '/') + skill.name + ' '); onClose(); }}>插入指令</button></div>
        </article>)}
      </div>
    </section>
  </div>;
}
