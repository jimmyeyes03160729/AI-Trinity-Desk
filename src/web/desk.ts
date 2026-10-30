import type { DeskApi, Result, Settings } from '../../electron/contracts';
import { pickFolder } from './FolderPicker';
import { labels } from '../TerminalPane';

// Browser implementation of the preload API. Every call is the same channel
// the Electron preload uses, carried over one authenticated WebSocket.
type Pending = (result: Result<unknown>) => void;
const listeners = new Map<string, Set<(value: never) => void>>();
const pending = new Map<number, Pending>();
let queue: string[] = [];
let socket: WebSocket | undefined;
let next = 1;
let opened = false;
let retry = 0;

function banner(text: string | undefined) {
  let element = document.getElementById('web-connection');
  if (!text) { element?.remove(); return; }
  if (!element) { element = document.createElement('div'); element.id = 'web-connection'; element.setAttribute('role', 'status'); document.body.append(element); }
  element.textContent = text;
}
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket = ws;
  ws.onopen = () => {
    // State may have changed while offline; reload so every panel reads the
    // server again and terminals reattach with their recent output.
    if (opened) { location.reload(); return; }
    opened = true; retry = 0; banner(undefined);
    for (const message of queue) ws.send(message);
    queue = [];
  };
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.t === 'res') { pending.get(message.id)?.(message.r); pending.delete(message.id); }
    if (message.t === 'ev') for (const listener of listeners.get(message.ch) || []) listener(message.v as never);
  };
  ws.onclose = event => {
    for (const resolve of pending.values()) resolve({ ok: false, error: '與主機的連線中斷，請稍後再試。' });
    pending.clear();
    if (event.code === 4001) { location.replace('/login'); return; }
    void fetch('/api/session', { credentials: 'same-origin' }).then(response => {
      if (response.status === 401) { location.replace('/login'); return; }
      banner('與主機的連線中斷，正在重新連線…');
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    }, () => { banner('無法連線到主機，正在重試…'); setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++)); });
  };
}
function call<T>(channel: string, value?: unknown): Promise<Result<T>> {
  return new Promise(resolve => {
    const id = next++;
    pending.set(id, resolve as Pending);
    const message = JSON.stringify({ t: 'call', id, ch: channel, v: value });
    if (socket?.readyState === WebSocket.OPEN) socket.send(message); else queue.push(message);
  });
}
function on<T>(channel: string, listener: (value: T) => void) {
  const set = listeners.get(channel) || new Set();
  listeners.set(channel, set); set.add(listener as (value: never) => void);
  return () => { set.delete(listener as (value: never) => void); };
}
async function writeClipboard(text: string): Promise<Result<null>> {
  try { await navigator.clipboard.writeText(text); return { ok: true, value: null }; }
  catch {
    // navigator.clipboard needs HTTPS; plain-HTTP access falls back here.
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    const copied = document.execCommand('copy'); area.remove();
    return copied ? { ok: true, value: null } : { ok: false, error: '瀏覽器不允許寫入剪貼簿，請用 HTTPS 連線或手動複製。' };
  }
}
async function readClipboard(): Promise<Result<string>> {
  try { return { ok: true, value: (await navigator.clipboard.readText()).slice(0, 1024 * 1024) }; }
  catch {
    const text = window.prompt('瀏覽器未允許讀取剪貼簿。請在此貼上文字，或直接在終端按 Ctrl+V／⌘V：');
    return text === null ? { ok: false, error: '已取消貼上。' } : { ok: true, value: text.slice(0, 1024 * 1024) };
  }
}
export async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.replace('/login');
}

export function installWebDesk() {
  const api: DeskApi = {
    web: true,
    loadSettings: () => call('settings:load'),
    saveSettings: settings => call('settings:save', settings),
    chooseProject: async id => {
      const folder = await pickFolder(call, id ? `選擇 ${labels[id]} 的專案資料夾` : undefined);
      return folder === null ? { ok: true, value: null } : call<Settings>('project:set', { folder, id });
    },
    detect: () => call('environment:detect'),
    providerInfo: id => call('provider:info', id),
    skillMarket: query => call('market:list', query),
    openSkillLink: async value => {
      // Open synchronously so the popup blocker treats it as a user action.
      const opened = window.open('', '_blank');
      const result = await call<string>('market:link', value);
      if (!result.ok) { opened?.close(); return result; }
      if (opened) { opened.opener = null; opened.location.href = result.value; } else window.location.assign(result.value);
      return { ok: true, value: null };
    },
    enrichSkills: value => call('market:enrich', value),
    cancelSkillTranslation: () => call('market:cancel-translation'),
    installSkill: value => call('skill:install', value),
    skillInstallations: () => call('skill:installed'),
    cancelSkillInstall: id => call('skill:cancel', id),
    onSkillInstall: listener => on('skill-install:event', listener),
    discussionState: () => call('discussion:state'),
    startDiscussion: config => call('discussion:start', config),
    continueDiscussion: config => call('discussion:continue', config),
    extendDiscussion: config => call('discussion:extend', config),
    retryDiscussion: config => call('discussion:retry', config),
    stopDiscussion: () => call('discussion:stop'),
    onDiscussion: listener => on('discussion:event', listener),
    installers: () => call('installers:state'),
    ensureCli: () => call('installers:ensure'),
    installCli: id => call('installers:install', id),
    cancelInstall: id => call('installers:cancel', id),
    onInstall: listener => on('installers:event', listener),
    start: (id, cols, rows) => call('terminal:start', { id, cols, rows }),
    stop: id => call('terminal:stop', id),
    input: (id, session, data) => call('terminal:input', { id, session, data }),
    resize: (id, session, cols, rows) => call('terminal:resize', { id, session, cols, rows }),
    ack: () => {},
    attachTerminal: id => call('terminal:attach', id),
    readClipboard,
    writeClipboard,
    onTerminal: listener => on('terminal:event', listener)
  };
  Object.defineProperty(window, 'desk', { value: Object.freeze(api) });
  connect();
}
