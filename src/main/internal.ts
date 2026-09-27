import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import {
  IPC,
  isInternalRequest,
  type Account,
  type InternalRequest,
  type SettingsView,
  type WelcomeState
} from '../shared/ipc'
import {
  BROWSER_IDS,
  detectSources,
  importHistory,
  readBookmarks,
  type ImportedFolder
} from './importer'
import { installFromStore, listExtensions, loadUnpacked, removeExtension } from './extensions'
import { history } from './history'
import { settings } from './settings'

export const INTERNAL_PAGES = ['history', 'settings', 'welcome'] as const
export const isInternalUrl = (url: string): boolean => url.startsWith('vew://')

/** Must run before the app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'vew',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Internal pages (vew://history, vew://settings) are Vew's own UI: they live in the default session, which no
 * website uses (web tabs run in profile partitions), and only they can reach the internal IPC below.
 */
/** What internal pages may ask of the browser window. */
export interface InternalHooks {
  openUrl: (url: string) => void
  /** Theme colors of the active Space (read) / set them (onboarding). */
  colors: () => string[]
  setColors: (colors: string[]) => void
  importBookmarks: (folder: ImportedFolder) => number
  finishWelcome: () => void
  /** The active Space's Texor Account, signing in / out of it. */
  account: () => Account | null
  signIn: () => Promise<Account | null>
  signOut: () => Promise<void>
}

export function serveInternalPages(hooks: InternalHooks): void {
  const root = join(__dirname, '../renderer')
  session.defaultSession.protocol.handle('vew', (req) => {
    const { host, pathname, search } = new URL(req.url)
    if (!(INTERNAL_PAGES as readonly string[]).includes(host)) {
      return new Response('Not found', { status: 404 })
    }
    // The page lives at the root of vew://<page>/, but its files are in the renderer's internal/ folder:
    // "/" is its index.html, and its own relative references ("./main.tsx") belong in that folder too.
    const path =
      pathname === '/'
        ? '/internal/index.html'
        : /^\/[^/@]+$/.test(pathname)
          ? `/internal${pathname}`
          : pathname
    const dev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
    // Development: the Vite dev server, keeping the query (Vite's module versions).
    if (dev) {
      // Only Accept (CSS imported from code vs. a stylesheet) and Range (video) matter to Vite; other headers
      // here belong to the vew: request and would make the forwarded fetch fail.
      const headers: Record<string, string> = {}
      for (const name of ['accept', 'range']) {
        const value = req.headers.get(name)
        if (value) headers[name] = value
      }
      return net.fetch(`${dev}${path}${search}`, { headers })
    }
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
    return handle(req, hooks)
  })
}

async function handle(req: InternalRequest, hooks: InternalHooks): Promise<unknown> {
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
      return settingsView(hooks)
    case 'setSettings':
      settings.update((s) => Object.assign(s, req.patch))
      return settingsView(hooks)
    case 'makeDefaultBrowser':
      // ponytail: in development this registers the Electron binary; packaged builds register Vew (Phase 9).
      app.setAsDefaultProtocolClient('http')
      app.setAsDefaultProtocolClient('https')
      return settingsView(hooks)
    case 'open':
      return hooks.openUrl(req.url)
    case 'welcomeState':
      return {
        sources: detectSources(),
        colors: hooks.colors(),
        isDefaultBrowser: app.isDefaultProtocolClient('https'),
        account: hooks.account()
      } satisfies WelcomeState
    case 'setColors':
      return hooks.setColors(req.colors)
    case 'import': {
      if (!BROWSER_IDS.includes(req.source)) throw new Error('Unknown browser')
      const folder = req.bookmarks ? readBookmarks(req.source) : null
      return {
        bookmarks: folder ? hooks.importBookmarks(folder) : 0,
        history: req.history ? importHistory(req.source) : 0
      }
    }
    case 'welcomeDone':
      return hooks.finishWelcome()
    case 'texorSignIn':
      return hooks.signIn()
    case 'texorSignOut':
      await hooks.signOut()
      return hooks.account()
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

const settingsView = (hooks: InternalHooks): SettingsView => ({
  settings: settings.get(),
  isDefaultBrowser: app.isDefaultProtocolClient('https'),
  account: hooks.account()
})
