import { contextBridge, ipcRenderer } from 'electron'
import type { CodePulseApi, DashboardSnapshot } from '../shared/contracts'

const api: CodePulseApi = {
  getSnapshot: () => ipcRenderer.invoke('monitor:get'),
  refresh: () => ipcRenderer.invoke('monitor:refresh'),
  installActivityHook: () => ipcRenderer.invoke('activity:install-hook'),
  getLaunchAtStartup: () => ipcRenderer.invoke('app:get-launch-at-startup'),
  setLaunchAtStartup: (enabled) => ipcRenderer.invoke('app:set-launch-at-startup', enabled),
  getWindowMode: () => ipcRenderer.invoke('window:get-mode'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  openWindow: (kind) => ipcRenderer.invoke('window:open', kind),
  getCompletionSound: () => ipcRenderer.invoke('sound:get-completion'),
  setCompletionSound: (enabled) => ipcRenderer.invoke('sound:set-completion', enabled),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DashboardSnapshot) => listener(snapshot)
    ipcRenderer.on('monitor:snapshot', handler)
    return () => ipcRenderer.removeListener('monitor:snapshot', handler)
  },
  windowAction: (action) => ipcRenderer.invoke('window:action', action)
}

contextBridge.exposeInMainWorld('codePulse', api)

declare global {
  interface Window {
    codePulse: CodePulseApi
  }
}
