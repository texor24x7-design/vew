import { contextBridge, ipcRenderer } from 'electron'
import { EMPTY_STATE, IPC, type BrowserState, type Command } from '../shared/ipc'

// Cache the latest state so a late subscriber (React mounts after the first push) still gets it.
let state: BrowserState = EMPTY_STATE
const stateListeners = new Set<(s: BrowserState) => void>()
ipcRenderer.on(IPC.state, (_e, s: BrowserState) => {
  state = s
  stateListeners.forEach((cb) => cb(s))
})

const api = {
  send: (cmd: Command): void => ipcRenderer.send(IPC.command, cmd),
  onState: (cb: (s: BrowserState) => void): (() => void) => {
    stateListeners.add(cb)
    cb(state)
    return () => stateListeners.delete(cb)
  },
  onFocusUrl: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.focusUrl, listener)
    return () => ipcRenderer.off(IPC.focusUrl, listener)
  },
  onToast: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string): void => cb(message)
    ipcRenderer.on(IPC.toast, listener)
    return () => ipcRenderer.off(IPC.toast, listener)
  }
}

export type VewApi = typeof api
contextBridge.exposeInMainWorld('vew', api)
