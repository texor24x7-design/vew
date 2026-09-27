import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MiniAction, type MiniInfo } from '../shared/ipc'

// Keep the latest info: main may send it before React has subscribed.
let latest: MiniInfo | null = null
const listeners = new Set<(info: MiniInfo) => void>()
ipcRenderer.on(IPC.miniInfo, (_e, info: MiniInfo) => {
  latest = info
  listeners.forEach((cb) => cb(info))
})

const api = {
  act: (action: MiniAction): void => ipcRenderer.send(IPC.miniAction, action),
  onInfo: (cb: (info: MiniInfo) => void): (() => void) => {
    listeners.add(cb)
    if (latest) cb(latest)
    return () => listeners.delete(cb)
  }
}

export type MiniApi = typeof api
contextBridge.exposeInMainWorld('vew', api)
