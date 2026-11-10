import { contextBridge, ipcRenderer } from 'electron';
import type { DeskApi, TerminalEvent, InstallState,DiscussionState,SkillInstallState } from './contracts';

const api: DeskApi = {
  maintenanceState: state => ipcRenderer.send('maintenance:state', state),
  onMaintenanceProbe: read => {
    const activity = () => ipcRenderer.send('maintenance:activity');
    for (const event of ['input', 'keydown', 'pointerdown']) document.addEventListener(event, activity, true);
    const probe = (_: Electron.IpcRendererEvent, request: { nonce: string; freeze: boolean }) => {
      const reported = read();
      // Inspect live values too: React's child-to-parent effects may not have
      // settled when a maintenance request arrives immediately after typing.
      const topic = document.querySelector<HTMLTextAreaElement>('textarea[data-maintenance-saved]');
      const instruction = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="補充問題或分歧"]');
      const state = { ready: reported.ready, blocked: reported.blocked || !!document.querySelector('[role="dialog"]') || !!instruction?.value.trim() || !!(topic && topic.value !== topic.dataset.maintenanceSaved) };
      if (request.freeze && state.ready && !state.blocked) document.body.inert = true;
      ipcRenderer.send('maintenance:probe-result', { nonce: request.nonce, ...state });
    };
    const resume = () => { document.body.inert = false; };
    ipcRenderer.on('maintenance:probe', probe); ipcRenderer.on('maintenance:resume', resume);
    return () => { for (const event of ['input', 'keydown', 'pointerdown']) document.removeEventListener(event, activity, true); ipcRenderer.removeListener('maintenance:probe', probe); ipcRenderer.removeListener('maintenance:resume', resume); resume(); };
  },
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  chooseProject: id => ipcRenderer.invoke('project:choose', id),
  detect: () => ipcRenderer.invoke('environment:detect'),
  providerInfo:id=>ipcRenderer.invoke('provider:info',id),
  skillMarket:query=>ipcRenderer.invoke('market:list',query),
  openSkillLink:value=>ipcRenderer.invoke('market:open',value),
  enrichSkills:value=>ipcRenderer.invoke('market:enrich',value),
  cancelSkillTranslation:()=>ipcRenderer.invoke('market:cancel-translation'),
  installSkill:value=>ipcRenderer.invoke('skill:install',value),
  skillInstallations:()=>ipcRenderer.invoke('skill:installed'),
  localSkills:id=>ipcRenderer.invoke('local-skills:list',id),
  translateLocalSkill:value=>ipcRenderer.invoke('local-skills:translate',value),
  cancelSkillInstall:id=>ipcRenderer.invoke('skill:cancel',id),
  onSkillInstall:listener=>{const handler=(_:Electron.IpcRendererEvent,states:SkillInstallState[])=>listener(states);ipcRenderer.on('skill-install:event',handler);return()=>ipcRenderer.removeListener('skill-install:event',handler);},
  discussionState:()=>ipcRenderer.invoke('discussion:state'),
  startDiscussion:config=>ipcRenderer.invoke('discussion:start',config),
  continueDiscussion:config=>ipcRenderer.invoke('discussion:continue',config),
  extendDiscussion:config=>ipcRenderer.invoke('discussion:extend',config),
  retryDiscussion:config=>ipcRenderer.invoke('discussion:retry',config),
  stopDiscussion:()=>ipcRenderer.invoke('discussion:stop'),
  onDiscussion:listener=>{
    const handler=(_:Electron.IpcRendererEvent,state:DiscussionState)=>listener(state);
    ipcRenderer.on('discussion:event',handler);
    return ()=>ipcRenderer.removeListener('discussion:event',handler);
  },
  installers: () => ipcRenderer.invoke('installers:state'),
  ensureCli: () => ipcRenderer.invoke('installers:ensure'),
  installCli: id => ipcRenderer.invoke('installers:install',id),
  cancelInstall: id => ipcRenderer.invoke('installers:cancel',id),
  onInstall: listener => {
    const handler = (_: Electron.IpcRendererEvent, states: InstallState[]) => listener(states);
    ipcRenderer.on('installers:event',handler);
    return () => ipcRenderer.removeListener('installers:event',handler);
  },
  start: (id, cols, rows, expectedProject) => ipcRenderer.invoke('terminal:start', { id, cols, rows, expectedProject }),
  stop: id => ipcRenderer.invoke('terminal:stop', id),
  input: (id, session, data) => ipcRenderer.invoke('terminal:input', { id, session, data }),
  resize: (id, session, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, session, cols, rows }),
  ack: (id, session, bytes) => ipcRenderer.send('terminal:ack', { id, session, bytes }),
  attachTerminal: id => ipcRenderer.invoke('terminal:attach', id),
  uploadImage: async image => ipcRenderer.invoke('upload:image', new Uint8Array(await image.arrayBuffer())),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: text => ipcRenderer.invoke('clipboard:write', text),
  onTerminal: listener => {
    const handler = (_: Electron.IpcRendererEvent, event: TerminalEvent) => listener(event);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  }
};
contextBridge.exposeInMainWorld('desk', Object.freeze(api));
