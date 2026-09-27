import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import { IPC, isInternalRequest, type InternalRequest, type SettingsView } from '../shared/ipc'
import { installFromStore, listExtensions, loadUnpacked, removeExtension } from './extensions'
import { history } from './history'
import { settings } from './settings'

export const INTERNAL_PAGES = ['history', 'settings'] as const
export const isInternalUrl = (url: string): boolean => url.startsWith('vew://')

/** Must run before the app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'vew', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/**
 * Internal pages (vew://history, vew://settings) are Vew's own UI: they live in the default session, which no
 * website uses (web tabs run in profile partitions), and only they can reach the internal IPC below.
 */
export function serveInternalPages(openUrl: (url: string) => void): void {
  const root = join(__dirname, '../renderer')
  session.defaultSession.protocol.handle('vew', (req) => {
    const { host, pathname } = new URL(req.url)
    if (!(INTERNAL_PAGES as readonly string[]).includes(host)) {
      return new Response('Not found', { status: 404 })
    }
    const path = pathname === '/' ? '/internal/index.html' : pathname
    const dev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
    if (dev) return net.fetch(`${dev}${path}`)
    const file = normalize(join(root, path))
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 }) // no ../ escapes
    return net.fetch(pathToFileURL(file).toString())
  })

  ipcMain.handle(IPC.internal, async (e, req: unknown) => {
    // Only the internal pages, in their own session: never a website, even one that got here somehow.
    if (
      !isInternalUrl(e.senderFrame?.url ?? '') ||
      e.sender.session !== session.defaultSession ||
      !isInternalRequest(req)
    ) {
      throw new Error('not allowed')
    }
    return handle(req, openUrl)
  })
}

async function handle(req: InternalRequest, openUrl: (url: string) => void): Promise<unknown> {
  switch (req.method) {
    case 'historySearch':
      return history().search(req.query, req.limit, req.before)
    case 'historyDelete':
      return history().delete(req.url)
    case 'historyClear': {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        message: 'Clear all browsing history?',
        detail: 'This can’t be undone. Open tabs are not affected.',
        buttons: ['Clear History', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (response === 0) history().clear()
      return response === 0
    }
    case 'getSettings':
      return settingsView()
    case 'setSettings':
      settings.update((s) => Object.assign(s, req.patch))
      return settingsView()
    case 'makeDefaultBrowser':
      // ponytail: in development this registers the Electron binary; packaged builds register Vew (Phase 9).
      app.setAsDefaultProtocolClient('http')
      app.setAsDefaultProtocolClient('https')
      return settingsView()
    case 'open':
      return openUrl(req.url)
    case 'extList':
      return listExtensions()
    case 'extInstall':
      return installFromStore(req.source)
    case 'extLoadUnpacked':
      return loadUnpacked()
    case 'extRemove':
      return removeExtension(req.id)
  }
}

const settingsView = (): SettingsView => ({
  settings: settings.get(),
  isDefaultBrowser: app.isDefaultProtocolClient('https')
})
