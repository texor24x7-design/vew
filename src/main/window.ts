import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  WebContentsView,
  type Event,
  type Input,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import { IPC, isCommand, type BrowserState, type Command } from '../shared/ipc'
import { PAGE_RADIUS, WIN_TITLEBAR_HEIGHT, pageBounds } from '../shared/layout'
import { toUrl, type SearchEngine } from '../shared/url'
import { shortcutFor } from './shortcuts'

const secureWebPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false }
const HOME_URL = 'https://www.google.com'
// ponytail: fixed engine; the Phase 6 settings page will store the user's choice.
const SEARCH_ENGINE: SearchEngine = 'google'
const REOPEN_LIMIT = 25

interface Tab {
  id: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  /** Created lazily on first activation (or immediately when adopting a popup's WebContents). */
  view: WebContentsView | null
}

let nextTabId = 1

const load = (wc: WebContents, url: string): void => {
  wc.loadURL(url).catch((err: Error & { errno?: number }) => {
    // -3 ERR_ABORTED: superseded by another navigation, not a failure.
    if (err.errno !== -3) console.warn(`load ${url}: ${err.message}`)
  })
}

/** Close a view's page. Once its WebContents is destroyed, `view.webContents` is gone despite the typings. */
const closeView = (view: WebContentsView): void => {
  const wc = view.webContents as WebContents | undefined
  if (wc && !wc.isDestroyed()) wc.close()
}

/** One browser window: its shell UI plus the tabs it owns. */
export class VewWindow {
  readonly win: BrowserWindow
  private tabs: Tab[] = []
  private activeId: number | null = null
  private closedUrls: string[] = []

  constructor() {
    const isMac = process.platform === 'darwin'
    this.win = new BrowserWindow({
      title: 'Vew',
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 400,
      show: false,
      backgroundColor: '#00000000',
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 16, y: 16 },
            vibrancy: 'sidebar',
            visualEffectState: 'active'
          }
        : {
            titleBarStyle: 'hidden',
            titleBarOverlay: {
              color: '#00000000',
              symbolColor: '#6b7280',
              height: WIN_TITLEBAR_HEIGHT
            },
            backgroundMaterial: 'mica'
          }),
      webPreferences: { ...secureWebPreferences, preload: join(__dirname, '../preload/index.js') }
    })

    const shell = this.win.webContents
    const onCommand = (e: IpcMainEvent, cmd: unknown): void => {
      if (e.sender === shell && isCommand(cmd)) this.run(cmd)
    }
    ipcMain.on(IPC.command, onCommand)
    shell.on('before-input-event', (e, input) => this.onInput(e, input))
    shell.on('did-finish-load', () => this.push())
    this.win.on('resize', () => this.layout())
    this.win.once('ready-to-show', () => this.win.show())
    this.win.on('closed', () => {
      ipcMain.off(IPC.command, onCommand)
      const tabs = this.tabs
      this.tabs = []
      for (const t of tabs) if (t.view) closeView(t.view)
    })

    const query = { platform: process.platform }
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      this.win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
    this.openTab(HOME_URL, { activate: true })
  }

  run(cmd: Command): void {
    const active = this.active()
    const wc = active?.view?.webContents
    switch (cmd.type) {
      case 'open': {
        const url = toUrl(cmd.input, SEARCH_ENGINE)
        if (url) this.openTab(url, { activate: true })
        return
      }
      case 'navigate': {
        const url = toUrl(cmd.input, SEARCH_ENGINE)
        if (!url) return
        if (!wc) return this.run({ type: 'open', input: cmd.input })
        load(wc, url)
        wc.focus()
        return
      }
      case 'close':
        return this.closeTab(cmd.id ?? this.activeId)
      case 'activate':
        return this.activate(cmd.id)
      case 'select': {
        const tab = cmd.index === -1 ? this.tabs.at(-1) : this.tabs[cmd.index]
        if (tab) this.activate(tab.id)
        return
      }
      case 'cycle': {
        if (!active) return
        const n = this.tabs.length
        this.activate(this.tabs[(this.tabs.indexOf(active) + cmd.delta + n) % n].id)
        return
      }
      case 'reorder': {
        const from = this.tabs.findIndex((t) => t.id === cmd.id)
        if (from < 0) return
        const [tab] = this.tabs.splice(from, 1)
        this.tabs.splice(Math.max(0, Math.min(cmd.index, this.tabs.length)), 0, tab)
        return this.push()
      }
      case 'back':
        if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        return
      case 'forward':
        if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        return
      case 'reload':
        return wc?.reload()
      case 'stop':
        return wc?.stop()
      case 'reopen': {
        const url = this.closedUrls.pop()
        if (url) this.openTab(url, { activate: true })
        return
      }
    }
  }

  private active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId)
  }

  /** New tabs go to the top (like Arc); tabs opened from a page go right below their opener. */
  private openTab(
    url: string,
    opts: { activate: boolean; opener?: Tab; webContents?: WebContents }
  ): Tab {
    const tab: Tab = { id: nextTabId++, url, title: url, loading: false, view: null }
    this.tabs.splice(opts.opener ? this.tabs.indexOf(opts.opener) + 1 : 0, 0, tab)
    if (opts.webContents) this.createView(tab, opts.webContents)
    if (opts.activate) this.activate(tab.id)
    else this.push()
    return tab
  }

  private createView(tab: Tab, webContents?: WebContents): WebContentsView {
    const view = new WebContentsView(
      webContents ? { webContents } : { webPreferences: secureWebPreferences }
    )
    view.setBorderRadius(PAGE_RADIUS)
    view.setBackgroundColor('#ffffff')
    tab.view = view

    const wc = view.webContents
    const update = (patch: Partial<Tab>): void => {
      Object.assign(tab, patch)
      this.push()
    }
    wc.on('did-start-loading', () => update({ loading: true }))
    wc.on('did-stop-loading', () => update({ loading: false }))
    wc.on('page-title-updated', (_e, title) => update({ title }))
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] }))
    wc.on('did-navigate', (_e, url) => update({ url, favicon: undefined }))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && update({ url }))
    wc.on('before-input-event', (e, input) => this.onInput(e, input))
    // A page closing itself (e.g. an OAuth popup calling window.close()).
    wc.on('destroyed', () => this.closeTab(tab.id))
    // window.open and target=_blank become Vew tabs. Adopting Chromium's WebContents keeps window.opener working.
    wc.setWindowOpenHandler((details) => ({
      action: 'allow',
      createWindow: (options) => {
        // Electron passes the new guest WebContents here, but it is missing from the typings.
        const guest = (options as { webContents?: WebContents }).webContents
        const child = this.openTab(details.url, {
          activate: details.disposition !== 'background-tab',
          opener: tab,
          webContents: guest
        })
        const childWc = child.view?.webContents ?? this.createView(child).webContents
        if (!guest) load(childWc, details.url)
        return childWc
      }
    }))
    return view
  }

  private activate(id: number): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const prev = this.active()
    if (prev?.view && prev !== tab) this.win.contentView.removeChildView(prev.view)
    this.activeId = id
    let view = tab.view
    if (!view) {
      view = this.createView(tab)
      load(view.webContents, tab.url)
    }
    this.win.contentView.addChildView(view)
    this.layout()
    view.webContents.focus()
    this.push()
  }

  private closeTab(id: number | null): void {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    const [tab] = this.tabs.splice(i, 1)
    this.closedUrls.push(tab.url)
    if (this.closedUrls.length > REOPEN_LIMIT) this.closedUrls.shift()
    if (tab.view) {
      this.win.contentView.removeChildView(tab.view)
      closeView(tab.view)
    }
    if (this.activeId === id) {
      this.activeId = null
      const next = this.tabs[Math.min(i, this.tabs.length - 1)]
      if (next) return this.activate(next.id)
    }
    this.push()
  }

  private onInput(e: Event, input: Input): void {
    const shortcut = shortcutFor(input, process.platform)
    if (!shortcut) return
    e.preventDefault()
    if (shortcut.type !== 'focusUrl') return this.run(shortcut)
    this.win.webContents.focus()
    this.win.webContents.send(IPC.focusUrl, { newTab: shortcut.newTab })
  }

  private layout(): void {
    const view = this.active()?.view
    if (!view) return
    const [width, height] = this.win.getContentSize()
    view.setBounds(pageBounds(width, height, process.platform))
  }

  private push(): void {
    if (this.win.isDestroyed()) return
    const state: BrowserState = {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title || t.url,
        favicon: t.favicon,
        loading: t.loading,
        canGoBack: t.view?.webContents.navigationHistory.canGoBack() ?? false,
        canGoForward: t.view?.webContents.navigationHistory.canGoForward() ?? false
      }))
    }
    this.win.webContents.send(IPC.state, state)
  }
}
