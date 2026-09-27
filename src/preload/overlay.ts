import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Command,
  type FindState,
  type PaletteData,
  type PeekInfo,
  type RailLabel
} from '../shared/ipc'

const api = {
  send: (cmd: Command): void => ipcRenderer.send(IPC.command, cmd),
  suggest: (query: string): Promise<string[]> => ipcRenderer.invoke(IPC.suggest, query),
  onOpen: (cb: (data: PaletteData) => void): (() => void) => {
    const listener = (_e: unknown, data: PaletteData): void => cb(data)
    ipcRenderer.on(IPC.paletteOpen, listener)
    return () => ipcRenderer.off(IPC.paletteOpen, listener)
  },
  onPeek: (cb: (info: PeekInfo | null) => void): (() => void) => {
    const listener = (_e: unknown, info: PeekInfo | null): void => cb(info)
    ipcRenderer.on(IPC.peek, listener)
    return () => ipcRenderer.off(IPC.peek, listener)
  },
  onFind: (cb: (state: FindState | null) => void): (() => void) => {
    const listener = (_e: unknown, state: FindState | null): void => cb(state)
    ipcRenderer.on(IPC.find, listener)
    return () => ipcRenderer.off(IPC.find, listener)
  },
  onPopup: (cb: (open: boolean) => void): (() => void) => {
    const listener = (_e: unknown, open: boolean): void => cb(open)
    ipcRenderer.on(IPC.popup, listener)
    return () => ipcRenderer.off(IPC.popup, listener)
  },
  onLabel: (cb: (label: RailLabel | null) => void): (() => void) => {
    const listener = (_e: unknown, label: RailLabel | null): void => cb(label)
    ipcRenderer.on(IPC.label, listener)
    return () => ipcRenderer.off(IPC.label, listener)
  },
  onClose: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.paletteClose, listener)
    return () => ipcRenderer.off(IPC.paletteClose, listener)
  }
}

export type OverlayApi = typeof api
contextBridge.exposeInMainWorld('vew', api)
