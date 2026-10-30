import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Result } from '../../electron/contracts';
import './web.css';

type Listing = { path: string; parent: string | null; roots: string[]; entries: string[] };
type Call = <T>(channel: string, value?: unknown) => Promise<Result<T>>;

// The host's folders are browsed through the server, replacing the native
// folder dialog of the desktop app.
function Picker({ call, done }: { call: Call; done: (folder: string | null) => void }) {
  const [listing, setListing] = useState<Listing>();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function open(folder?: string) {
    setLoading(true); setError('');
    const result = await call<Listing>('fs:list', folder);
    setLoading(false);
    if (result.ok) { setListing(result.value); setTyped(result.value.path); } else setError(result.error);
  }
  useEffect(() => { void open(); }, []);
  const separator = listing?.path.includes('\\') ? '\\' : '/';
  const child = (name: string) => listing!.path.endsWith(separator) ? listing!.path + name : listing!.path + separator + name;
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) done(null); }}>
    <section className="settings-dialog folder-picker" role="dialog" aria-modal="true" aria-labelledby="folder-title" onKeyDown={event => { if (event.key === 'Escape') done(null); }}>
      <header><div><span className="eyebrow">主機上的資料夾</span><h2 id="folder-title">選擇專案資料夾</h2></div><button aria-label="關閉" onClick={() => done(null)}>×</button></header>
      <form className="folder-path" onSubmit={event => { event.preventDefault(); void open(typed); }}>
        <input aria-label="資料夾路徑" value={typed} spellCheck={false} onChange={event => setTyped(event.target.value)} />
        <button type="submit" disabled={loading}>前往</button>
      </form>
      {error && <div className="pane-error" role="alert">{error}</div>}
      <div className="folder-list" aria-busy={loading}>
        {listing?.parent && <button className="folder-item" onClick={() => void open(listing.parent!)}>↰ 上一層</button>}
        {listing?.entries.map(name => <button key={name} className="folder-item" onClick={() => void open(child(name))}>▱ {name}</button>)}
        {listing && !listing.entries.length && <p className="folder-empty">沒有子資料夾。</p>}
      </div>
      {listing && listing.roots.length > 1 && <div className="folder-roots">{listing.roots.map(root => <button key={root} onClick={() => void open(root)}>{root}</button>)}</div>}
      <footer><button onClick={() => done(null)}>取消</button><button className="primary" disabled={!listing || loading} onClick={() => done(listing!.path)}>使用此資料夾</button></footer>
    </section>
  </div>;
}

export function pickFolder(call: Call) {
  return new Promise<string | null>(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    root.render(<Picker call={call} done={folder => { root.unmount(); host.remove(); resolve(folder); }} />);
  });
}
