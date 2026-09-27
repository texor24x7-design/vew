import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type InternalRequest } from '../shared/ipc'

const api = {
  call: <T>(req: InternalRequest): Promise<T> => ipcRenderer.invoke(IPC.internal, req)
}

export type InternalApi = typeof api
contextBridge.exposeInMainWorld('vew', api)
