import { contextBridge, ipcRenderer } from 'electron';
import type { DeskApi, TerminalEvent, InstallState,DiscussionState,SkillInstallState } from './contracts';

const api: DeskApi = {
  cliTasks:()=>ipcRenderer.invoke('tasks:list'),
  createCliTask:value=>ipcRenderer.invoke('tasks:create',value),
  patchCliTask:value=>ipcRenderer.invoke('tasks:patch',value),
  selectCliTask:id=>ipcRenderer.invoke('tasks:select',id),
  bindCliTask:(id,nativeSessionId)=>ipcRenderer.invoke('tasks:bind',{id,nativeSessionId}),
  startCliTask:(taskId,cols,rows)=>ipcRenderer.invoke('tasks:start',{taskId,cols,rows}),
  stopCliTask:id=>ipcRenderer.invoke('tasks:stop',id),
  cliTaskInput:(taskId,session,data)=>ipcRenderer.invoke('tasks:input',{taskId,session,data}),
  cliTaskResize:(taskId,session,cols,rows)=>ipcRenderer.invoke('tasks:resize',{taskId,session,cols,rows}),
  cliTaskAck:(taskId,session,bytes)=>ipcRenderer.send('tasks:ack',{taskId,session,bytes}),
  attachCliTask:taskId=>ipcRenderer.invoke('tasks:attach',taskId),
  onCliTasks:listener=>{const handler=(_:Electron.IpcRendererEvent,state:import('./contracts').CliTaskList)=>listener(state);ipcRenderer.on('tasks:event',handler);return()=>ipcRenderer.removeListener('tasks:event',handler);},
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  detect: () => ipcRenderer.invoke('environment:detect'),
  providerInfo:id=>ipcRenderer.invoke('provider:info',id),
  skillMarket:query=>ipcRenderer.invoke('market:list',query),
  openSkillLink:value=>ipcRenderer.invoke('market:open',value),
  enrichSkills:value=>ipcRenderer.invoke('market:enrich',value),
  cancelSkillTranslation:()=>ipcRenderer.invoke('market:cancel-translation'),
  installSkill:value=>ipcRenderer.invoke('skill:install',value),
  skillInstallations:()=>ipcRenderer.invoke('skill:installed'),
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
  start: (id, cols, rows) => ipcRenderer.invoke('terminal:start', { id, cols, rows }),
  stop: id => ipcRenderer.invoke('terminal:stop', id),
  input: (id, session, data) => ipcRenderer.invoke('terminal:input', { id, session, data }),
  resize: (id, session, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, session, cols, rows }),
  ack: (id, session, bytes) => ipcRenderer.send('terminal:ack', { id, session, bytes }),
  attachTerminal: id => ipcRenderer.invoke('terminal:attach', id),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: text => ipcRenderer.invoke('clipboard:write', text),
  onTerminal: listener => {
    const handler = (_: Electron.IpcRendererEvent, event: TerminalEvent) => listener(event);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  }
};
contextBridge.exposeInMainWorld('desk', Object.freeze(api));
