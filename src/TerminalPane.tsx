import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Command, PaneId, SessionInfo, TerminalEvent } from '../electron/contracts';
import { serviceError } from './service-errors';

export const labels: Record<PaneId, string> = { claude: 'Claude Code', antigravity: 'Antigravity CLI', codex: 'Codex CLI' };
type Props = { id: PaneId; command: Command; model:string; project: string; fontSize: number; onActive: (id: PaneId, active: boolean) => void; onSettings: () => void;onModels:()=>void };
export default function TerminalPane({ id, command, model, project, fontSize, onActive, onSettings,onModels }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const session = useRef<SessionInfo | null>(null);
  const starting = useRef(false);
  const early = useRef<TerminalEvent[]>([]);
  const outputTail=useRef('');
  const failure=useRef<string|undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'error'>('idle');
  const [error, setError] = useState('');
  const [pid, setPid] = useState<number>();
  const [copied, setCopied] = useState(false);
  const activeCallback = useRef(onActive); activeCallback.current = onActive;
  const attaching = useRef(false);
  // A pane may open while its CLI already runs: after a page reload, from a
  // second device, or when another browser started it. Show that session.
  const attach = useRef<() => Promise<void>>(async () => {});
  attach.current = async () => {
    if (attaching.current || starting.current || session.current) return;
    attaching.current = true;
    try {
      const result = await window.desk.attachTerminal(id);
      const terminal = term.current;
      if (!result.ok || !result.value || !terminal || starting.current || session.current) return;
      const value = result.value;
      session.current = { session: value.session, pid: value.pid }; outputTail.current = value.history.slice(-16000); failure.current = undefined;
      setPid(value.pid); setStatus('running'); setError(''); activeCallback.current(id, true);
      terminal.reset(); terminal.write(value.history);
      fit.current?.fit();
      void window.desk.resize(id, value.session, terminal.cols, terminal.rows);
    } finally { attaching.current = false; }
  };
  const consume = useRef<(event: TerminalEvent) => void>(() => {});
  consume.current = event => {
    if (event.id !== id || event.session !== session.current?.session) return;
    if (event.type === 'data') {
      term.current?.write(event.data, () => window.desk.ack(id, event.session, event.data.length));
      outputTail.current=(outputTail.current+event.data).slice(-16000);
      const message=serviceError(id,outputTail.current);
      if(message&&message!==failure.current){failure.current=message;setError(message);}
    }
    if (event.type === 'exit') {
      session.current = null; setPid(undefined); setStatus('exited'); activeCallback.current(id, false);
      term.current?.writeln(`\r\n\x1b[90m[工作階段結束 · 代碼 ${event.exitCode}${event.signal ? ' · 訊號 ' + event.signal : ''}]\x1b[0m`);
      if (event.exitCode !== 0) setError(failure.current||`程序以代碼 ${event.exitCode} 結束，請查看上方輸出與啟動設定。`);
    }
    if (event.type === 'error') { setError(event.message); setStatus('error'); }
  };
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: true, fontSize, fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace", scrollback: 5000, allowProposedApi: false, theme: { background: '#10151f', foreground: '#dde6f5', cursor: '#9ce5c3', selectionBackground: '#34475f', black: '#16202b', brightBlack: '#7e8da3', red: '#f9818e', green: '#9ce5c3', yellow: '#eac588', blue: '#8bbaff', magenta: '#c6acff', cyan: '#91dbe7', white: '#dde6f5' } });
    const fitter = new FitAddon(); terminal.loadAddon(fitter); terminal.open(container.current!); term.current = terminal; fit.current = fitter;
    terminal.writeln('\x1b[90m終端已就緒。選擇專案並按「啟動」。\x1b[0m');
    const send = async (data: string) => {
      const current = session.current;
      if (!current) return;
      for (let offset = 0; offset < data.length; offset += 32768) {
        const result = await window.desk.input(id, current.session, data.slice(offset, offset + 32768));
        if (!result.ok) { setError(result.error); break; }
      }
    };
    const input = terminal.onData(data => { void send(data); });
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      const mac = /Mac/.test(navigator.platform);
      const modifier = mac ? event.metaKey : event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'c' && (mac || event.shiftKey || terminal.hasSelection())) { event.preventDefault(); void copySelection(); return false; }
      // Browsers only grant clipboard reads to the native paste event, which
      // the paste listener below forwards to the terminal.
      if (modifier && event.key.toLowerCase() === 'v') { if (window.desk.web) return false; event.preventDefault(); void paste(); return false; }
      return true;
    });
    // xterm's context-menu text area uses the native paste event. Route through
    // terminal.paste so bracketed-paste support is preserved.
    const pasteListener = (event: ClipboardEvent) => { event.preventDefault(); event.stopPropagation(); terminal.paste(event.clipboardData?.getData('text/plain') || ''); };
    container.current!.addEventListener('paste', pasteListener, true);
    let frame = 0,alive=true;
    const fitLater=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(alive&&container.current?.clientWidth)fitter.fit();});};
    const observer = new ResizeObserver(fitLater);
    observer.observe(container.current!);
    window.addEventListener('resize',fitLater);
    void document.fonts.ready.then(()=>{if(alive)fitLater();});
    void attach.current();
    const resize = terminal.onResize(({ cols, rows }) => { const current = session.current; if (current) void window.desk.resize(id, current.session, cols, rows).then(result => { if (!result.ok && session.current === current) setError(result.error); }); });
    const off = window.desk.onTerminal(event => {
      if (event.id !== id) return;
      if (starting.current && !session.current) { early.current.push(event); return; }
      if (!session.current && event.type === 'data') { void attach.current(); return; }
      consume.current(event);
    });
    return () => { alive=false;observer.disconnect();window.removeEventListener('resize',fitLater); cancelAnimationFrame(frame); off(); input.dispose(); resize.dispose(); container.current?.removeEventListener('paste', pasteListener, true); terminal.dispose(); term.current = null; };
    // Terminal instances remain stable while settings and layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { if (term.current) { term.current.options.fontSize = fontSize; fit.current?.fit(); } }, [fontSize]);
  async function copySelection() {
    const selected = term.current?.getSelection();
    if (!selected) { setError('請先在終端選取要複製的文字。'); return; }
    const result = await window.desk.writeClipboard(selected);
    if (!result.ok) setError(result.error); else { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }
  async function paste() {
    if (!session.current) { setError('請先啟動終端再貼上。'); return; }
    const result = await window.desk.readClipboard();
    if (!result.ok) setError(result.error); else { term.current?.paste(result.value); term.current?.focus(); }
  }
  async function start() {
    if (starting.current || session.current) return;
    starting.current = true; early.current = [];outputTail.current='';failure.current=undefined; setError(''); setStatus('starting'); activeCallback.current(id, true);
    fit.current?.fit(); term.current?.reset();
    const terminal = term.current;
    const result = await window.desk.start(id, terminal?.cols || 80, terminal?.rows || 24, project);
    if (result.ok) { session.current = result.value; setPid(result.value.pid); setStatus('running');if(terminal)void window.desk.resize(id,result.value.session,terminal.cols,terminal.rows); }
    else { setError(result.error); setStatus('error'); activeCallback.current(id, false); }
    starting.current = false;
    for (const event of early.current) consume.current(event);
    early.current = []; term.current?.focus();
  }
  async function stop(restart = false) {
    setStatus('stopping'); setError('');
    const result = await window.desk.stop(id);
    if (!result.ok) { setError(result.error); setStatus(session.current ? 'running' : 'error'); return; }
    session.current = null; setPid(undefined); activeCallback.current(id, false); setStatus('idle');
    if (restart) await start();
  }
  const running = status === 'running'; const busy = status === 'starting' || status === 'stopping';
  const names = { idle: '待命', starting: '啟動中', running: '執行中', stopping: '停止中', exited: '已結束', error: '啟動失敗' };
  return <section className={`terminal-pane ${id}`} data-testid={`pane-${id}`} aria-label={labels[id]}>
    <header className="pane-header"><div className="pane-title"><span className="agent-mark">{id === 'claude' ? 'C' : id === 'codex' ? 'X' : 'A'}</span><div><h2>{labels[id]}</h2><span className={`status ${status}`}><i />{names[status]}{pid ? ` · PID ${pid}` : ''}</span></div></div><button className="icon-button" aria-label={`${labels[id]} 設定`} title="啟動設定" onClick={onSettings}>⚙</button></header>
    <div className="command-line" title={[command.executable,...command.args].join(' ')}><span>›</span> {command.executable}{command.args.length > 0 ? ` ${command.args.join(' ')}` : ''}<button className="model-button" onClick={onModels} title="下次啟動套用；目前工作階段可手動輸入 /model">模型：{model||'CLI 預設'}</button></div>
    <div className="terminal-toolbar"><div><button disabled={busy || running || !project} onClick={() => void start()}>▶ 啟動</button><button disabled={!running || busy} onClick={() => void stop()}>■ 停止</button><button disabled={!running || busy} onClick={() => void stop(true)}>↻ 重啟</button></div><div><button title="選取文字後複製" onClick={() => void copySelection()}>{copied ? '已複製' : '複製'}</button><button onClick={() => void paste()} disabled={!running}>貼上</button><button title="清除畫面，不會停止程序" onClick={() => term.current?.clear()}>清屏</button></div></div>
    {error && <div role="alert" className="pane-error">{error}<button aria-label="關閉訊息" onClick={() => setError('')}>×</button></div>}
    <div className="terminal-frame"><div className="terminal-surface" ref={container} data-testid={`terminal-${id}`} /></div>
    <footer className="pane-footer"><span>獨立 PTY</span><span>{running ? 'Ctrl+C 中斷 · 輸入直接送往 CLI' : '由你決定何時啟動'}</span></footer>
  </section>;
}
