import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  session,
  WebContentsView,
  type Event,
  type Input,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents
} from 'electron'
import {
  IPC,
  isCommand,
  type ArchivedTab,
  type BrowserState,
  type Command,
  type NodeState,
  type PaletteData,
  type PaletteTab,
  type PeekInfo,
  type SiteInfo,
  type Snapshot,
  type Profile,
  type TabState,
  type Zone
} from '../shared/ipc'
import {
  MAX_SPLIT,
  MIN_PANE,
  PAGE_RADIUS,
  WIN_TITLEBAR_HEIGHT,
  clampSidebarWidth,
  evenSizes,
  pageBounds,
  peekRect,
  splitRects,
  type Rect
} from '../shared/layout'
import { PRESETS } from '../shared/theme'
import { toUrl, type SearchEngine } from '../shared/url'
import { blockedOn, blockerEvents, resetBlocked } from './adblock'
import { clearDownloads, downloadAction, downloadList, downloads } from './downloads'
import { history } from './history'
import {
  clickAction,
  extensionMenuItems,
  extensionStates,
  optionsUrl,
  removeExtension,
  setExtensionHost,
  tabActivated,
  watchTab
} from './extensions'
import { isInternalUrl } from './internal'
import { originOf } from './permissions'
import { settings } from './settings'
import { sessionFor } from './profiles'
import { shortcutFor } from './shortcuts'
import { ARCHIVE_LIMIT, emptySaved, fromLive, load as loadSaved, save, toLive } from './store'
import {
  locate,
  move,
  tabsInOrder,
  zonesOf,
  type Folder,
  type Location,
  type Node,
  type Space,
  type Split,
  type Tab,
  type Zones
} from './tree'

export const secureWebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
}
const HOME_URL = 'https://www.google.com'
const engine = (): SearchEngine => settings.get().searchEngine
const ENGINE_NAMES: Record<SearchEngine, string> = {
  google: 'Google',
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing'
}
/** Each engine's suggestion endpoint; all answer [query, [suggestions…]]. */
const SUGGEST_URLS: Record<SearchEngine, (q: string) => string> = {
  google: (q) =>
    `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=${q}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?type=list&q=${q}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${q}`
}
/** Chrome's zoom steps. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const FIND_BAR = { width: 340, height: 48 }
const REOPEN_LIMIT = 25
const ARCHIVE_CHECK_MS = 60_000
const SIDEBAR_ANIM_MS = 180
const isMac = process.platform === 'darwin'
/** Default icons for new Spaces, so they're distinguishable in the switcher before being customized. */
const SPACE_ICONS = ['🏠', '💼', '🌿', '🔥', '🌊', '🎨', '📚', '🚀', '⭐️']

/** Search suggestions from the chosen engine. */
async function suggest(query: string): Promise<string[]> {
  const q = query.trim()
  if (!q) return []
  try {
    const res = await net.fetch(SUGGEST_URLS[engine()](encodeURIComponent(q)), {
      signal: AbortSignal.timeout(1500)
    })
    const body: unknown = await res.json()
    const list = Array.isArray(body) ? body[1] : null
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, 5) : []
  } catch {
    return [] // offline or slow: the bar still works from local data
  }
}

/** Picture-in-picture for a playing video when its tab leaves the screen, and back when it returns.
 * Runs in an isolated world so the page's own scripts can't interfere. */
const PIP_ENTER = `(() => {
  const v = [...document.querySelectorAll('video')].find((v) => !v.paused && !v.ended && v.readyState > 2 && !v.disablePictureInPicture)
  if (v && document.pictureInPictureEnabled && !document.pictureInPictureElement) v.requestPictureInPicture().catch(() => {})
})()`
const PIP_EXIT = `document.pictureInPictureElement && document.exitPictureInPicture().catch(() => {})`
const inIsolation = (wc: WebContents, code: string): void => {
  if (!wc.isDestroyed())
    void wc.executeJavaScriptInIsolatedWorld(999, [{ code }], true).catch(() => {})
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Which kind of page a URL is: Vew's internal pages, one extension's pages, or the web. Each kind runs with a
 * different preload (or none), so a tab never navigates from one kind to another.
 */
const pageKind = (url: string): string =>
  isInternalUrl(url)
    ? 'internal'
    : url.startsWith('chrome-extension://')
      ? `ext:${hostOf(url)}`
      : 'web'
const CRX_PRELOAD = (): string => join(__dirname, '../preload/crx.js')
const POPUP_MAX = { width: 800, height: 600 }

/** Load one of the renderer pages (shell, overlay) from the dev server or the build. */
export function loadPage(
  wc: WebContents,
  page: 'shell' | 'overlay' | 'mini',
  query: Record<string, string>
): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    wc.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/${page}/index.html?${new URLSearchParams(query)}`
    )
  } else {
    wc.loadFile(join(__dirname, `../renderer/${page}/index.html`), { query })
  }
}

let nextId = 1
const newId = (): number => nextId++

export const load = (wc: WebContents, url: string): void => {
  wc.loadURL(url).catch((err: Error & { errno?: number }) => {
    // -3 ERR_ABORTED: superseded by another navigation, not a failure.
    if (err.errno !== -3) console.warn(`load ${url}: ${err.message}`)
  })
}

/** Close a view's page. Once its WebContents is destroyed, `view.webContents` is gone despite the typings. */
export const closeView = (view: WebContentsView): void => {
  const wc = view.webContents as WebContents | undefined
  if (wc && !wc.isDestroyed()) wc.close()
}

const onlyTabs = (list: Node[]): Tab[] => list.filter((n): n is Tab => n.kind === 'tab')

/** One browser window: its shell UI plus the tabs it owns. */
export class VewWindow {
  readonly win: BrowserWindow
  /** Transparent view stacked above the page while the command bar is open. */
  private readonly overlay: WebContentsView
  /** Overlay view is attached (the bar is open or animating out). */
  private paletteOpen = false
  private paletteSeq = 0
  /** Page views currently attached to the window (the active tab, or every pane of its split). */
  private shown: WebContentsView[] = []
  /** A sidebar tab is being dragged: page views are detached so the shell sees the pointer over the page. */
  private dragging = false
  /** The find bar is showing (the overlay shrinks to just the bar, so the page stays usable). */
  private findOpen = false
  private pushTimer?: NodeJS.Timeout
  /** An extension's toolbar popup, floating under its icon. */
  private popup: {
    view: WebContentsView
    anchor: { x: number; y: number }
    size: { width: number; height: number }
  } | null = null
  /** Peek: a link from a pinned tab or favorite, floating over the page. */
  private peek: { view: WebContentsView; from: Tab; info: Omit<PeekInfo, 'rect'> } | null = null
  private paletteFallback?: NodeJS.Timeout
  private readonly file = join(app.getPath('userData'), 'sidebar.json')
  private favorites: Node[]
  private spaces: Space[]
  private activeSpaceId: number
  private profiles: Profile[]
  private archive: ArchivedTab[]
  private sidebar: BrowserState['sidebar']
  private renameId: number | null = null
  private editSpaceId: number | null = null
  private closedUrls: string[] = []
  private disposed = false
  private saveTimer?: NodeJS.Timeout
  private tween?: NodeJS.Timeout

  constructor() {
    const saved = loadSaved(this.file)
    const initial = saved ?? emptySaved()
    const live = toLive(initial, newId)
    this.favorites = live.favorites
    this.spaces = live.spaces
    this.activeSpaceId = live.activeSpaceId
    this.profiles = initial.profiles
    this.archive = initial.archive
    this.sidebar = { ...initial.sidebar, peek: false }

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
    this.overlay = new WebContentsView({
      webPreferences: { ...secureWebPreferences, preload: join(__dirname, '../preload/overlay.js') }
    })
    this.overlay.setBackgroundColor('#00000000')
    const overlay = this.overlay.webContents
    overlay.on('before-input-event', (e, input) => this.onInput(e, input))

    const onCommand = (e: IpcMainEvent, cmd: unknown): void => {
      if ((e.sender === shell || e.sender === overlay) && isCommand(cmd)) this.run(cmd)
    }
    ipcMain.on(IPC.command, onCommand)
    // Settings, downloads and the blocker all change what the sidebar shows.
    const unsubscribe = settings.subscribe(() => this.push())
    const onDownloads = (): void => this.schedulePush()
    const onDownloaded = (d: { filename: string; state: string }): void => {
      if (d.state === 'completed') this.toast(`Downloaded ${d.filename}`)
    }
    const onBlocked = (id: number): void => {
      if (this.active()?.view?.webContents.id === id) this.schedulePush()
    }
    downloads.on('change', onDownloads)
    downloads.on('done', onDownloaded)
    blockerEvents.on('blocked', onBlocked)
    this.win.on('closed', () => {
      unsubscribe()
      downloads.off('change', onDownloads)
      downloads.off('done', onDownloaded)
      blockerEvents.off('blocked', onBlocked)
      clearTimeout(this.pushTimer)
    })
    this.registerExtensionHost()
    ipcMain.handle(IPC.suggest, (e, query: unknown) =>
      e.sender === overlay && typeof query === 'string' && query.length <= 200 ? suggest(query) : []
    )
    shell.on('before-input-event', (e, input) => this.onInput(e, input))
    shell.on('did-finish-load', () => this.push())
    this.win.on('resize', () => this.layout())
    this.win.once('ready-to-show', () => this.win.show())
    const archiveTimer = setInterval(() => this.archiveIdle(), ARCHIVE_CHECK_MS)
    this.win.on('closed', () => {
      ipcMain.off(IPC.command, onCommand)
      ipcMain.removeHandler(IPC.suggest)
      clearTimeout(this.paletteFallback)
      clearInterval(archiveTimer)
      clearTimeout(this.saveTimer)
      clearInterval(this.tween)
      this.save()
      this.disposed = true
      for (const t of this.allTabs()) if (t.view) closeView(t.view)
      closeView(this.overlay)
    })

    // macOS vibrancy and Windows 11 Mica show through; elsewhere (Windows 10) the shell paints a solid tint.
    const hasMaterial =
      isMac ||
      (process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2]) >= 22000)
    const query = { platform: process.platform, material: hasMaterial ? '1' : '0' }
    loadPage(shell, 'shell', query)
    loadPage(overlay, 'overlay', query)
    this.updateTrafficLights()
    this.archiveIdle()
    if (!saved) this.openTab(HOME_URL, { activate: true })
    else if (this.activeId !== null) this.activate(this.activeId)
  }

  private get space(): Space {
    return this.spaces.find((sp) => sp.id === this.activeSpaceId) ?? this.spaces[0]
  }
  /** The active Space's sidebar: shared favorites + its pinned and today. */
  private get zones(): Zones {
    return zonesOf(this.favorites, this.space)
  }
  private get activeId(): number | null {
    return this.space.activeId
  }
  private set activeId(id: number | null) {
    this.space.activeId = id
  }

  /** Every tab in every Space (favorites once). */
  private allTabs(): Tab[] {
    const none: Node[] = []
    return [
      ...tabsInOrder({ favorites: this.favorites, pinned: none, today: none }),
      ...this.spaces.flatMap((sp) =>
        tabsInOrder({ favorites: none, pinned: sp.pinned, today: sp.today })
      )
    ]
  }

  /** Locate a node in any Space. Favorites resolve to the active Space. */
  private find(id: number): { loc: Location; space: Space } | null {
    for (const space of [this.space, ...this.spaces]) {
      const loc = locate(zonesOf(this.favorites, space), id)
      if (loc) return { loc, space }
    }
    return null
  }

  /** Profile new pages should use: the active Space's. */
  get profileId(): string {
    return this.space.profileId
  }

  get spaceList(): { id: number; name: string; icon: string; profileId: string }[] {
    return this.spaces.map(({ id, name, icon, profileId }) => ({ id, name, icon, profileId }))
  }

  /**
   * Take a page from elsewhere (the mini window) into a Space as its active Today tab. The live page is kept
   * when it already runs in that Space's profile; otherwise it reopens there, so it gets the right cookies.
   */
  adoptPage(
    view: WebContentsView,
    info: { url: string; title: string; favicon?: string },
    spaceId: number,
    profileId: string
  ): void {
    this.switchSpace(spaceId)
    const sameProfile = profileId === this.space.profileId
    if (!sameProfile) closeView(view)
    const tab = this.openTab(info.url, {
      activate: false,
      webContents: sameProfile ? view : undefined,
      title: info.title,
      favicon: info.favicon
    })
    this.activate(tab.id)
    if (this.win.isMinimized()) this.win.restore()
    this.win.focus()
  }

  run(cmd: Command): void {
    const active = this.active()
    const wc = active?.view?.webContents
    switch (cmd.type) {
      case 'open': {
        const url = toUrl(cmd.input, engine())
        if (url) this.openTab(url, { activate: true })
        return
      }
      case 'navigate': {
        const url = toUrl(cmd.input, engine())
        if (!url) return
        // Internal pages, extension pages and websites never share a tab (different preloads/sessions).
        if (!wc || !active || pageKind(url) !== pageKind(active.url)) {
          return this.run({ type: 'open', input: cmd.input })
        }
        load(wc, url)
        wc.focus()
        return
      }
      case 'close':
        return this.closeTab(cmd.id ?? this.activeId)
      case 'activate':
        return this.activate(cmd.id)
      case 'select': {
        const tabs = tabsInOrder(this.zones)
        const tab = cmd.index === -1 ? tabs.at(-1) : tabs[cmd.index]
        if (tab) this.activate(tab.id)
        return
      }
      case 'cycle': {
        const tabs = tabsInOrder(this.zones)
        if (!active) return
        const n = tabs.length
        this.activate(tabs[(tabs.indexOf(active) + cmd.delta + n) % n].id)
        return
      }
      case 'move':
        if (move(this.zones, cmd.id, cmd.where)) this.push()
        return
      case 'contextMenu':
        return this.contextMenu(cmd.id)
      case 'newFolder':
        return this.newFolder(null)
      case 'renameFolder': {
        const folder = locate(this.zones, cmd.id)?.node
        if (folder?.kind === 'folder') folder.name = cmd.name.trim() || 'Folder'
        return this.push()
      }
      case 'toggleFolder': {
        const folder = locate(this.zones, cmd.id)?.node
        if (folder?.kind === 'folder') folder.open = !folder.open
        return this.push()
      }
      case 'restore': {
        const [item] = this.archive.splice(cmd.index, 1)
        if (item)
          this.openTab(item.url, { activate: true, title: item.title, favicon: item.favicon })
        return
      }
      case 'toggleSidebar':
        this.sidebar = { ...this.sidebar, collapsed: !this.sidebar.collapsed, peek: false }
        this.updateTrafficLights()
        this.layout(true)
        return this.push()
      case 'sidebar':
        if (cmd.width !== undefined) this.sidebar.width = clampSidebarWidth(cmd.width)
        if (cmd.peek !== undefined) this.sidebar.peek = cmd.peek && this.sidebar.collapsed
        this.updateTrafficLights()
        this.layout(cmd.peek !== undefined)
        return this.push()
      case 'switchSpace':
        return this.switchSpace(cmd.id)
      case 'selectSpace': {
        const sp = this.spaces[cmd.index]
        if (sp) this.switchSpace(sp.id)
        return
      }
      case 'stepSpace': {
        // No wrap-around: swiping past the last Space does nothing.
        const sp = this.spaces[this.spaces.indexOf(this.space) + cmd.delta]
        if (sp) this.switchSpace(sp.id)
        return
      }
      case 'newSpace':
        return this.newSpace()
      case 'updateSpace':
        return this.updateSpace(cmd)
      case 'newProfile': {
        const sp = this.spaces.find((s) => s.id === cmd.spaceId)
        if (!sp) return
        const profile = { id: `p-${Date.now().toString(36)}`, name: sp.name }
        this.profiles.push(profile)
        return this.updateSpace({ type: 'updateSpace', id: sp.id, profileId: profile.id })
      }
      case 'deleteSpace':
        return void this.deleteSpace(cmd.id)
      case 'spaceMenu':
        return this.spaceMenu(cmd.id)
      case 'openPalette':
        // The overlay owns open/closed (it may be mid-animation), so it decides whether this toggles it shut.
        return this.openPalette()
      case 'paletteHidden':
        if (cmd.seq === this.paletteSeq) this.hidePalette()
        return
      case 'focusTab': {
        const found = this.find(cmd.id)
        if (!found) return
        if (found.loc.zone !== 'favorites' && found.space !== this.space)
          this.switchSpace(found.space.id)
        return this.activate(cmd.id)
      }
      case 'copyUrl':
        if (!active) return
        // The clipboard API is async in current Electron: only confirm once the write lands.
        clipboard.writeText(active.url).then(
          () => this.toast('Link copied'),
          () => this.toast('Couldn’t copy the link')
        )
        return
      case 'toggleDarkMode': {
        const dark = !nativeTheme.shouldUseDarkColors
        settings.update((s) => void (s.appearance = dark ? 'dark' : 'light'))
        return this.toast(dark ? 'Dark mode on' : 'Light mode on')
      }
      case 'clearHistory':
        return void this.clearHistory()
      case 'splitWith':
        return this.splitWith(cmd.id, cmd.edge, cmd.targetId)
      case 'resizeSplit': {
        const split = active && this.splitOf(active.id)
        const sum = cmd.sizes.reduce((a, b) => a + b, 0)
        if (!split || cmd.sizes.length !== split.sizes.length || Math.abs(sum - 1) > 0.01) return
        if (cmd.sizes.some((v) => v < MIN_PANE - 0.001)) return
        split.sizes = cmd.sizes
        this.layout()
        return this.push()
      }
      case 'unsplit': {
        const split = this.splitOf(cmd.id)
        if (!split) return
        if (cmd.all) this.space.splits.splice(this.space.splits.indexOf(split), 1)
        else this.removeFromSplit(cmd.id)
        this.present()
        return this.push()
      }
      case 'dragging':
        return void this.setDragging(cmd.on)
      case 'peekExpand':
        return this.expandPeek()
      case 'peekClose':
        return this.closePeek()
      case 'openFind':
        if (!wc || !active || pageKind(active.url) !== 'web') return
        this.closePeek()
        if (this.paletteOpen) this.closePalette()
        this.findOpen = true
        this.present()
        this.sendFind({ active: 0, total: 0 })
        this.overlay.webContents.focus()
        return
      case 'find':
        if (!wc) return
        if (!cmd.text) {
          wc.stopFindInPage('clearSelection')
          return this.sendFind({ active: 0, total: 0 })
        }
        wc.findInPage(cmd.text, { forward: cmd.forward, findNext: !cmd.next })
        return
      case 'closeFind':
        return this.closeFind()
      case 'zoom': {
        if (!wc || !active) return
        const host = hostOf(active.url)
        const current = wc.getZoomFactor()
        const i = ZOOM_STEPS.findIndex((z) => z >= current - 0.001)
        const next =
          cmd.delta === 0
            ? 1
            : ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 7 : i) + cmd.delta))]
        wc.setZoomFactor(next)
        if (host) {
          settings.update((s) => {
            if (next === 1) delete s.zoom[host]
            else s.zoom[host] = next
          })
        }
        return this.toast(`Zoom ${Math.round(next * 100)}%`)
      }
      case 'print':
        return wc?.print()
      case 'viewSource':
        if (active && /^https?:/.test(active.url))
          this.openTab(`view-source:${active.url}`, { activate: true })
        return
      case 'devtools':
        if (!wc) return
        return wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' })
      case 'openInternal': {
        const url = `vew://${cmd.page}/`
        const existing = tabsInOrder(this.zones).find((t) => t.url.startsWith(`vew://${cmd.page}`))
        if (existing) return this.activate(existing.id)
        this.openTab(url, {
          activate: true,
          title: cmd.page === 'history' ? 'History' : 'Settings'
        })
        return
      }
      case 'setPermission': {
        const origin = originOf(cmd.origin)
        if (!origin) return
        return settings.update((s) => {
          const p = (s.permissions[origin] ??= {})
          if (cmd.value === 'ask') delete p[cmd.kind]
          else p[cmd.kind] = cmd.value
          if (!Object.keys(p).length) delete s.permissions[origin]
        })
      }
      case 'setSiteBlocker': {
        settings.update((s) => {
          s.blockerAllowlist = s.blockerAllowlist.filter((h) => h !== cmd.host)
          if (!cmd.enabled) s.blockerAllowlist.push(cmd.host)
        })
        // Takes effect on the next load.
        if (active && hostOf(active.url) === cmd.host) wc?.reload()
        return
      }
      case 'download':
        return downloadAction(cmd.id, cmd.action)
      case 'clearDownloads':
        return clearDownloads()
      case 'extensionClick': {
        const ses = sessionFor(this.space.profileId)
        const url = clickAction(cmd.id, ses, wc)
        if (url) this.openPopup(url, cmd.anchor)
        return
      }
      case 'extensionMenu':
        return this.extensionMenu(cmd.id)
      case 'closePopup':
        return this.closePopup()
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
    const node = this.activeId === null ? null : locate(this.zones, this.activeId)?.node
    return node?.kind === 'tab' ? node : undefined
  }

  /** New tabs go to the top of Today (like Arc); tabs opened from a Today tab go right below it. */
  private openTab(
    url: string,
    opts: {
      activate: boolean
      opener?: Tab
      webContents?: WebContents | WebContentsView
      title?: string
      favicon?: string
    }
  ): Tab {
    const tab: Tab = {
      kind: 'tab',
      id: newId(),
      url,
      title: opts.title ?? url,
      favicon: opts.favicon,
      loading: false,
      profileId: opts.opener?.profileId ?? this.space.profileId,
      lastActive: Date.now(),
      view: null
    }
    const openerIndex = opts.opener ? this.zones.today.indexOf(opts.opener) : -1
    this.zones.today.splice(openerIndex + 1, 0, tab)
    if (opts.webContents) this.createView(tab, opts.webContents)
    if (opts.activate) this.activate(tab.id)
    else this.push()
    return tab
  }

  /** Give a tab its page view: a new one, one adopting a popup's WebContents, or an existing view (Peek). */
  private createView(tab: Tab, source?: WebContents | WebContentsView): WebContentsView {
    const view =
      source instanceof WebContentsView
        ? source
        : new WebContentsView(
            source
              ? { webContents: source }
              : {
                  webPreferences:
                    pageKind(tab.url) === 'internal'
                      ? {
                          ...secureWebPreferences,
                          session: session.defaultSession,
                          preload: join(__dirname, '../preload/internal.js')
                        }
                      : pageKind(tab.url) === 'web'
                        ? { ...secureWebPreferences, session: sessionFor(tab.profileId) }
                        : // An extension's own page (e.g. its options) opened as a tab.
                          {
                            ...secureWebPreferences,
                            session: sessionFor(tab.profileId),
                            preload: CRX_PRELOAD()
                          }
                }
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
    wc.on('page-title-updated', (_e, title) => {
      update({ title })
      history().setTitle(wc.getURL(), title)
    })
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] }))
    wc.on('did-navigate', (_e, url) => {
      update({ url, favicon: undefined })
      history().visit(url)
      this.applyZoom(wc, url)
    })
    wc.on('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isSameDocument) resetBlocked(wc.id)
    })
    // A page with a privileged preload (internal or extension) never shows a website, and vice versa.
    const kind = pageKind(tab.url)
    const internal = kind !== 'web'
    const guard = (e: Electron.Event<{ url: string; isMainFrame: boolean }>): void => {
      if (!e.isMainFrame || pageKind(e.url) === kind) return
      e.preventDefault()
      if (/^https?:/.test(e.url)) this.openTab(e.url, { activate: true })
    }
    if (kind === 'web') {
      watchTab(wc)
      wc.on('context-menu', (_e, params) => this.pageMenu(tab, wc, params))
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.on('found-in-page', (_e, result) => {
      if (result.finalUpdate && tab.id === this.activeId) {
        this.sendFind({ active: result.activeMatchOrdinal, total: result.matches })
      }
    })
    // A crashed page on screen reloads itself rather than leaving a blank pane.
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit' || !this.shown.includes(view)) return
      this.toast('The page crashed and was reloaded')
      wc.reload()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      update({ url })
      history().visit(url, tab.title)
    })
    wc.on('before-input-event', (e, input) => this.onInput(e, input))
    // Clicking into a split pane makes it the active tab (the URL pill and shortcuts follow it).
    wc.on('before-mouse-event', (_e, mouse) => {
      if (mouse.type !== 'mouseDown' || tab.id === this.activeId || !this.shown.includes(view))
        return
      this.activeId = tab.id
      tab.lastActive = Date.now()
      this.push()
    })
    // The page closed itself (e.g. an OAuth popup calling window.close()). Views we unload ourselves are detached first.
    wc.on('destroyed', () => tab.view === view && this.closeTab(tab.id))
    // window.open and target=_blank become Vew tabs. Adopting Chromium's WebContents keeps window.opener working.
    wc.setWindowOpenHandler((details) => {
      if (internal) {
        if (/^https?:/.test(details.url)) this.openTab(details.url, { activate: true })
        return { action: 'deny' }
      }
      // Links from pinned tabs and favorites that would open a new tab Peek instead, like Arc.
      // Popups (window.open with features, e.g. sign-in) stay real tabs so window.opener keeps working.
      const zone = this.find(tab.id)?.loc.zone
      if (details.disposition === 'foreground-tab' && (zone === 'pinned' || zone === 'favorites')) {
        this.openPeek(details.url, tab)
        return { action: 'deny' }
      }
      return this.allowAsTab(tab, details)
    })
    return view
  }

  /** window.open / target=_blank → a Vew tab that adopts Chromium's WebContents (keeps window.opener). */
  private allowAsTab(
    tab: Tab,
    details: Electron.HandlerDetails
  ): Electron.WindowOpenHandlerResponse {
    return {
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
    }
  }

  private activate(id: number): void {
    const node = locate(this.zones, id)?.node
    if (node?.kind !== 'tab') return
    const prev = this.active()
    const now = Date.now()
    if (prev) prev.lastActive = now
    if (prev !== node) this.closeFind()
    this.activeId = id
    node.lastActive = now
    this.present()
    // A video playing in the tab we just left keeps going in picture-in-picture.
    if (prev?.view && !this.shown.includes(prev.view)) inIsolation(prev.view.webContents, PIP_ENTER)
    if (node.view) {
      inIsolation(node.view.webContents, PIP_EXIT)
      tabActivated(node.view.webContents)
    }
    if (!this.paletteOpen && !this.peek) node.view?.webContents.focus()
    this.push()
  }

  private applyZoom(wc: WebContents, url: string): void {
    const factor = settings.get().zoom[hostOf(url)] ?? 1
    if (Math.abs(wc.getZoomFactor() - factor) > 0.001) wc.setZoomFactor(factor)
  }

  private sendFind(state: { active: number; total: number } | null): void {
    const wc = this.overlay.webContents
    if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.find, state))
    else wc.send(IPC.find, state)
  }

  private closeFind(): void {
    if (!this.findOpen) return
    this.findOpen = false
    this.active()?.view?.webContents.stopFindInPage('clearSelection')
    this.sendFind(null)
    this.present()
    this.active()?.view?.webContents.focus()
  }

  private tabById(id: number): Tab | undefined {
    const node = this.find(id)?.loc.node
    return node?.kind === 'tab' ? node : undefined
  }

  /** The split in the active Space that contains this tab. */
  private splitOf(id: number): Split | undefined {
    return this.space.splits.find((s) => s.tabIds.includes(id))
  }

  /** Take a tab out of its split; a split left with one tab dissolves. */
  private removeFromSplit(id: number, space = this.space): void {
    const split = space.splits.find((s) => s.tabIds.includes(id))
    if (!split) return
    split.tabIds.splice(split.tabIds.indexOf(id), 1)
    split.sizes = evenSizes(split.tabIds.length)
    if (split.tabIds.length < 2) space.splits.splice(space.splits.indexOf(split), 1)
  }

  /** Put `id` next to `targetId` (default: the active tab), creating the split if needed. */
  private splitWith(
    id: number,
    edge: 'left' | 'right' | 'top' | 'bottom',
    targetId?: number
  ): void {
    const active = this.active()
    const other = locate(this.zones, id)?.node
    if (!active || other?.kind !== 'tab' || other === active) return
    let split = this.splitOf(active.id)
    const target = targetId !== undefined && split?.tabIds.includes(targetId) ? targetId : active.id
    if (target === id) return
    if (split?.tabIds.includes(id)) {
      split.tabIds.splice(split.tabIds.indexOf(id), 1) // reorder within the same split
    } else {
      this.removeFromSplit(id)
      if (split && split.tabIds.length >= MAX_SPLIT)
        return this.toast('Split view holds up to 4 tabs')
    }
    const direction = edge === 'left' || edge === 'right' ? 'row' : 'column'
    if (!split) {
      split = { id: newId(), tabIds: [active.id], direction, sizes: [1] }
      this.space.splits.push(split)
    }
    const i = split.tabIds.indexOf(target)
    split.tabIds.splice(edge === 'left' || edge === 'top' ? i : i + 1, 0, id)
    split.sizes = evenSizes(split.tabIds.length)
    this.activate(id)
  }

  /** Tabs whose pages belong on screen: the active tab's split panes, or just the active tab. */
  private visibleTabs(): Tab[] {
    const active = this.active()
    if (!active) return []
    const split = this.splitOf(active.id)
    return split
      ? split.tabIds.map((id) => this.tabById(id)).filter((t) => t !== undefined)
      : [active]
  }

  /**
   * Attach exactly the views that should be visible, stacked page < overlay < Peek, then lay out.
   * Every change to what's on screen goes through here.
   */
  private present(): void {
    if (this.disposed) return
    const views = this.dragging ? [] : this.visibleTabs().map((t) => this.ensureView(t))
    for (const v of this.shown) if (!views.includes(v)) this.win.contentView.removeChildView(v)
    for (const v of views) this.win.contentView.addChildView(v)
    if (this.paletteOpen || this.peek || this.findOpen || this.popup) {
      this.win.contentView.addChildView(this.overlay)
    } else this.win.contentView.removeChildView(this.overlay)
    if (this.peek) this.win.contentView.addChildView(this.peek.view)
    if (this.popup) this.win.contentView.addChildView(this.popup.view)
    this.shown = views
    this.layout()
  }

  private ensureView(tab: Tab): WebContentsView {
    if (tab.view) return tab.view
    const view = this.createView(tab)
    load(view.webContents, tab.url)
    return view
  }

  /** While a tab is dragged from the sidebar, show pictures of the panes so the shell gets the pointer. */
  private async setDragging(on: boolean): Promise<void> {
    if (on === this.dragging) return
    if (!on) {
      this.dragging = false
      this.win.webContents.send(IPC.snapshot, [])
      return this.present()
    }
    const panes = this.shown.map((v) => ({ view: v, rect: v.getBounds() }))
    // A capture can fail (e.g. the display is asleep); the drag still works, just without the pictures.
    const snaps: Snapshot[] = (
      await Promise.all(
        panes.map(({ view, rect }) =>
          view.webContents
            .capturePage()
            .then((img) => ({ ...rect, src: img.toDataURL() }))
            .catch(() => null)
        )
      )
    ).filter((s) => s !== null)
    if (this.disposed) return
    this.win.webContents.send(IPC.snapshot, snaps)
    this.dragging = true
    this.present()
  }

  /** Drop a tab's page but keep its sidebar entry (URL, title, favicon). */
  private unload(tab: Tab): void {
    const view = tab.view
    if (!view) return
    tab.view = null
    tab.loading = false
    this.win.contentView.removeChildView(view)
    this.shown = this.shown.filter((v) => v !== view)
    closeView(view)
  }

  /** Today tabs are removed; pinned tabs and favorites just unload, like Arc. */
  private closeTab(id: number | null): void {
    if (this.disposed || id === null) return
    const found = this.find(id)
    if (found?.loc.node.kind !== 'tab') return
    const { loc, space } = found
    const tab = found.loc.node
    if (loc.zone === 'today') {
      loc.list.splice(loc.index, 1)
      this.closedUrls.push(tab.url)
      if (this.closedUrls.length > REOPEN_LIMIT) this.closedUrls.shift()
    }
    tab.lastActive = Date.now()
    const split = space.splits.find((s) => s.tabIds.includes(tab.id))
    const sibling = split?.tabIds.find((t) => t !== tab.id)
    this.removeFromSplit(tab.id, space)
    this.unload(tab)
    // A background Space just forgets a removed tab; it has nothing on screen to replace.
    if (space !== this.space) {
      if (loc.zone === 'today' && space.activeId === id) space.activeId = null
      return this.push()
    }
    if (this.activeId !== id) this.present()
    if (this.activeId === id) {
      this.activeId = null
      // Closing a split pane keeps the rest of the split on screen.
      if (sibling !== undefined) return this.activate(sibling)
      // Fall back to the most recently used tab that is still loaded.
      const next = tabsInOrder(this.zones)
        .filter((t) => t.view)
        .sort((a, b) => b.lastActive - a.lastActive)[0]
      if (next) return this.activate(next.id)
    }
    this.push()
  }

  /** Move Today tabs untouched for `archiveAfterMs` into the Archive. */
  private archiveIdle(): void {
    const cutoff = Date.now() - settings.get().archiveAfterHours * 3_600_000
    let archived = false
    for (const space of this.spaces) {
      const idle = onlyTabs(space.today).filter(
        (t) => t.id !== space.activeId && t.lastActive < cutoff
      )
      for (const tab of idle) {
        space.today.splice(space.today.indexOf(tab), 1)
        this.unload(tab)
        this.archive.unshift({
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
          archivedAt: Date.now()
        })
        archived = true
      }
    }
    if (!archived) return
    this.archive.length = Math.min(this.archive.length, ARCHIVE_LIMIT)
    this.push()
  }

  private switchSpace(id: number): void {
    const target = this.spaces.find((sp) => sp.id === id)
    if (!target || target === this.space) return
    const prev = this.active()
    if (prev) prev.lastActive = Date.now()
    this.closePeek()
    this.activeSpaceId = id
    if (this.activeId !== null && this.find(this.activeId)) this.activate(this.activeId)
    else {
      this.activeId = null
      this.present()
      this.push()
    }
  }

  private newSpace(): void {
    const n = this.spaces.length + 1
    const space: Space = {
      id: newId(),
      name: `Space ${n}`,
      icon: SPACE_ICONS[(n - 1) % SPACE_ICONS.length],
      theme: { colors: PRESETS[(n - 1) % PRESETS.length].colors, intensity: 0.5 },
      profileId: this.space.profileId,
      pinned: [],
      today: [],
      activeId: null,
      splits: []
    }
    this.spaces.push(space)
    this.switchSpace(space.id)
    this.editSpaceId = space.id
    this.push()
    this.editSpaceId = null
  }

  private updateSpace(cmd: Extract<Command, { type: 'updateSpace' }>): void {
    const space = this.spaces.find((sp) => sp.id === cmd.id)
    if (!space) return
    if (cmd.name !== undefined) space.name = cmd.name.trim() || space.name
    if (cmd.icon !== undefined) space.icon = cmd.icon.trim() || space.icon
    if (cmd.theme) space.theme = cmd.theme
    if (
      cmd.profileId !== undefined &&
      cmd.profileId !== space.profileId &&
      this.profiles.some((p) => p.id === cmd.profileId)
    ) {
      // The Space's tabs move to the new profile: unload them so they reopen in its session.
      space.profileId = cmd.profileId
      const none: Node[] = []
      for (const tab of tabsInOrder({
        favorites: none,
        pinned: space.pinned,
        today: space.today
      })) {
        tab.profileId = cmd.profileId
        this.unload(tab)
      }
      if (space === this.space && this.activeId !== null) return this.activate(this.activeId)
    }
    this.push()
  }

  private async deleteSpace(id: number): Promise<void> {
    const space = this.spaces.find((sp) => sp.id === id)
    if (!space || this.spaces.length === 1) return
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: `Delete “${space.name}”?`,
      detail: 'Its pinned and Today tabs will be closed. Favorites are kept.',
      buttons: ['Delete Space', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0 || this.disposed) return
    if (space === this.space) {
      const i = this.spaces.indexOf(space)
      this.switchSpace((this.spaces[i - 1] ?? this.spaces[i + 1]).id)
    }
    const none: Node[] = []
    for (const tab of tabsInOrder({ favorites: none, pinned: space.pinned, today: space.today })) {
      this.unload(tab)
    }
    this.spaces.splice(this.spaces.indexOf(space), 1)
    this.push()
  }

  private spaceMenu(id: number): void {
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Edit Space…',
        click: () => {
          this.switchSpace(id)
          this.editSpaceId = id
          this.push()
          this.editSpaceId = null
        }
      },
      { label: 'New Space', click: () => this.newSpace() },
      { type: 'separator' },
      {
        label: 'Delete Space…',
        enabled: this.spaces.length > 1,
        click: () => void this.deleteSpace(id)
      }
    ]
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  private newFolder(parent: Folder | null): void {
    const folder: Folder = {
      kind: 'folder',
      id: newId(),
      name: 'New Folder',
      open: true,
      children: []
    }
    ;(parent ? parent.children : this.zones.pinned).unshift(folder)
    this.startRename(folder.id)
  }

  /** Tell the shell to edit a folder name once; it keeps its own edit state after that. */
  private startRename(id: number): void {
    this.renameId = id
    this.push()
    this.renameId = null
  }

  private contextMenu(id: number): void {
    const loc = locate(this.zones, id)
    if (!loc) return
    const { node, zone } = loc
    const to = (target: 'favorites' | 'pinned' | 'today'): void => {
      if (
        move(this.zones, id, {
          zone: target,
          parent: null,
          index: target === 'favorites' ? Infinity : 0
        })
      )
        this.push()
    }
    const items: MenuItemConstructorOptions[] = []
    if (node.kind === 'folder') {
      items.push({ label: 'Rename Folder', click: () => this.startRename(id) })
      if (loc.ancestors.length === 0 && node.children.every((c) => c.kind === 'tab'))
        items.push({ label: 'New Subfolder', click: () => this.newFolder(node) })
      items.push(
        { type: 'separator' },
        {
          label: 'Delete Folder',
          // Keep the contents: they take the folder's place.
          click: () => {
            loc.list.splice(loc.index, 1, ...node.children)
            this.push()
          }
        }
      )
    } else {
      if (zone === 'today') items.push({ label: 'Pin Tab', click: () => to('pinned') })
      if (zone === 'pinned') items.push({ label: 'Unpin Tab', click: () => to('today') })
      items.push(
        zone === 'favorites'
          ? { label: 'Remove from Favorites', click: () => to('today') }
          : { label: 'Add to Favorites', click: () => to('favorites') }
      )
      if (zone === 'pinned') items.push({ label: 'New Folder', click: () => this.newFolder(null) })
      items.push({ type: 'separator' })
      const active = this.active()
      const split = this.splitOf(id)
      if (active && id !== active.id && !split?.tabIds.includes(active.id)) {
        items.push({ label: 'Open in Split View', click: () => this.splitWith(id, 'right') })
      }
      if (split) {
        items.push(
          { label: 'Remove from Split View', click: () => this.run({ type: 'unsplit', id }) },
          { label: 'Close Split View', click: () => this.run({ type: 'unsplit', id, all: true }) }
        )
      }
      items.push({ type: 'separator' })
      if (zone === 'today') items.push({ label: 'Close Tab', click: () => this.closeTab(id) })
      else if (node.view) items.push({ label: 'Unload Tab', click: () => this.closeTab(id) })
    }
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  private onInput(e: Event, input: Input): void {
    const shortcut = shortcutFor(input, process.platform)
    if (!shortcut) return
    e.preventDefault()
    if (shortcut.type !== 'focusUrl') return this.run(shortcut)
    if (this.paletteOpen) this.closePalette()
    // The URL pill lives in the sidebar, so reveal it while typing.
    if (this.sidebar.collapsed) this.run({ type: 'sidebar', peek: true })
    this.win.webContents.focus()
    this.win.webContents.send(IPC.focusUrl)
  }

  private toast(message: string): void {
    if (!this.disposed) this.win.webContents.send(IPC.toast, message)
  }

  private openPalette(): void {
    const tabs: PaletteTab[] = []
    const none: Node[] = []
    const add = (list: Node[], zone: Zone, space: Space): void => {
      for (const t of tabsInOrder({ favorites: list, pinned: none, today: none })) {
        tabs.push({
          id: t.id,
          title: t.title || t.url,
          url: t.url,
          favicon: t.favicon,
          zone,
          spaceId: space.id,
          spaceName: space.name,
          spaceIcon: space.icon,
          lastActive: t.lastActive,
          active: t.id === this.activeId
        })
      }
    }
    add(this.favorites, 'favorites', this.space)
    for (const sp of this.spaces) {
      add(sp.pinned, 'pinned', sp)
      add(sp.today, 'today', sp)
    }
    const data: PaletteData = {
      seq: ++this.paletteSeq,
      tabs,
      history: history().recent(5000),
      activeSpaceId: this.activeSpaceId,
      searchEngine: ENGINE_NAMES[engine()]
    }
    this.closePeek()
    this.closeFind()
    this.closePopup()
    this.paletteOpen = true
    this.present()
    const wc = this.overlay.webContents
    wc.focus()
    if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.paletteOpen, data))
    else wc.send(IPC.paletteOpen, data)
  }

  /** Ask the command bar to animate out; it reports back with paletteHidden. */
  private closePalette(): void {
    this.overlay.webContents.send(IPC.paletteClose)
    // If the overlay never answers (e.g. it crashed), don't leave an invisible layer eating clicks.
    clearTimeout(this.paletteFallback)
    const seq = this.paletteSeq
    this.paletteFallback = setTimeout(() => seq === this.paletteSeq && this.hidePalette(), 600)
  }

  private hidePalette(): void {
    clearTimeout(this.paletteFallback)
    if (!this.paletteOpen || this.disposed) return
    this.paletteOpen = false
    this.present()
    this.active()?.view?.webContents.focus()
  }

  private openPeek(url: string, from: Tab): void {
    this.closePeek()
    this.closeFind()
    const view = new WebContentsView({
      webPreferences: { ...secureWebPreferences, session: sessionFor(from.profileId) }
    })
    view.setBorderRadius(PAGE_RADIUS)
    view.setBackgroundColor('#ffffff')
    const wc = view.webContents
    const peek = { view, from, info: { url, title: url, favicon: undefined as string | undefined } }
    const update = (patch: Partial<typeof peek.info>): void => {
      if (this.peek?.view !== view) return // expanded into a tab or closed
      Object.assign(peek.info, patch)
      this.sendPeek()
    }
    wc.on('page-title-updated', (_e, title) => update({ title }))
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] }))
    wc.on('did-navigate', (_e, u) => {
      if (this.peek?.view !== view) return // now a tab, which records its own history
      update({ url: u })
      history().visit(u)
    })
    wc.on('before-input-event', (e, input) => {
      if (this.peek?.view !== view) return
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        return this.closePeek()
      }
      this.onInput(e, input)
    })
    // Links in Peek that want a new tab get one.
    wc.setWindowOpenHandler((details) => {
      this.openTab(details.url, { activate: true, opener: from })
      return { action: 'deny' }
    })
    load(wc, url)
    this.peek = peek
    this.present()
    this.sendPeek()
    wc.focus()
  }

  private sendPeek(): void {
    if (!this.peek) return this.overlay.webContents.send(IPC.peek, null)
    const [width, height] = this.win.getContentSize()
    const info: PeekInfo = {
      ...this.peek.info,
      rect: peekRect(pageBounds(width, height, process.platform, this.sidebar))
    }
    const wc = this.overlay.webContents
    if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.peek, info))
    else wc.send(IPC.peek, info)
  }

  private closePeek(): void {
    if (!this.peek) return
    const { view } = this.peek
    this.peek = null
    this.win.contentView.removeChildView(view)
    closeView(view)
    this.sendPeek()
    this.present()
    this.active()?.view?.webContents.focus()
  }

  /** Turn the Peek into a real tab, keeping the page as it is (same WebContents, no reload). */
  private expandPeek(): void {
    if (!this.peek) return
    const { view, from, info } = this.peek
    this.peek = null
    this.win.contentView.removeChildView(view)
    this.sendPeek()
    const tab = this.openTab(info.url, {
      activate: false,
      opener: from,
      webContents: view,
      title: info.title,
      favicon: info.favicon
    })
    this.activate(tab.id)
  }

  private async clearHistory(): Promise<void> {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: 'Clear all browsing history?',
      detail: 'This can’t be undone. Open tabs are not affected.',
      buttons: ['Clear History', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
    history().clear()
    this.toast('History cleared')
  }

  private updateTrafficLights(): void {
    if (isMac) this.win.setWindowButtonVisibility(!this.sidebar.collapsed || this.sidebar.peek)
  }

  /** Place the page card (or split panes) and Peek; `animate` eases panes over the sidebar animation. */
  private layout(animate = false): void {
    clearInterval(this.tween)
    const [width, height] = this.win.getContentSize()
    const card = pageBounds(width, height, process.platform, this.sidebar)
    const active = this.active()
    const split = active && this.splitOf(active.id)
    const rects: Rect[] = split ? splitRects(card, split.direction, split.sizes) : [card]
    // Full window for the command bar and Peek; just the bar (top-right of the active pane) for find.
    const pane = rects[this.shown.findIndex((v) => v === active?.view)] ?? card
    if (this.popup) {
      const { anchor, size } = this.popup
      this.popup.view.setBounds({
        x: Math.max(8, Math.min(anchor.x, width - size.width - 8)),
        y: Math.max(8, Math.min(anchor.y, height - size.height - 8)),
        width: size.width,
        height: size.height
      })
    }
    this.overlay.setBounds(
      this.paletteOpen || this.peek || this.popup
        ? { x: 0, y: 0, width, height }
        : {
            x: pane.x + pane.width - FIND_BAR.width - 12,
            y: pane.y + 12,
            width: FIND_BAR.width,
            height: FIND_BAR.height
          }
    )
    if (this.peek) {
      this.peek.view.setBounds(peekRect(card))
      this.sendPeek()
    }
    const targets = this.shown.map((view, i) => ({ view, to: rects[i] ?? card }))
    if (!animate) return targets.forEach(({ view, to }) => view.setBounds(to))
    const froms = targets.map(({ view }) => view.getBounds())
    const start = Date.now()
    const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t)
    this.tween = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / SIDEBAR_ANIM_MS)
      const t = 1 - (1 - p) ** 3 // ease-out cubic
      targets.forEach(({ view, to }, i) => {
        const from = froms[i]
        const r: Rectangle = {
          x: lerp(from.x, to.x, t),
          y: lerp(from.y, to.y, t),
          width: lerp(from.width, to.width, t),
          height: lerp(from.height, to.height, t)
        }
        view.setBounds(r)
      })
      if (p === 1) clearInterval(this.tween)
    }, 16)
  }

  private tabState(t: Tab): TabState {
    const history = t.view?.webContents.navigationHistory
    return {
      kind: 'tab',
      id: t.id,
      url: t.url,
      title: t.title || t.url,
      favicon: t.favicon,
      loaded: t.view !== null,
      loading: t.loading,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      inSplit: this.space.splits.some((s) => s.tabIds.includes(t.id))
    }
  }

  private push(): void {
    if (this.disposed || this.win.isDestroyed()) return
    const node = (n: Node): NodeState =>
      n.kind === 'tab'
        ? this.tabState(n)
        : { kind: 'folder', id: n.id, name: n.name, open: n.open, children: n.children.map(node) }
    const state: BrowserState = {
      favorites: onlyTabs(this.zones.favorites).map((t) => this.tabState(t)),
      pinned: this.zones.pinned.map(node),
      today: onlyTabs(this.zones.today).map((t) => this.tabState(t)),
      archive: this.archive,
      activeId: this.activeId,
      sidebar: this.sidebar,
      renameId: this.renameId,
      spaces: this.spaces.map(({ id, name, icon, theme, profileId }) => ({
        id,
        name,
        icon,
        theme,
        profileId
      })),
      activeSpaceId: this.activeSpaceId,
      profiles: this.profiles,
      editSpaceId: this.editSpaceId,
      split: (() => {
        const split = this.activeId === null ? undefined : this.splitOf(this.activeId)
        return split ? { ...split, tabIds: [...split.tabIds], sizes: [...split.sizes] } : null
      })(),
      downloads: downloadList(),
      site: this.siteInfo(),
      extensions: extensionStates(
        sessionFor(this.space.profileId),
        this.active()?.view?.webContents.id
      )
    }
    this.win.webContents.send(IPC.state, state)
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 500)
  }

  /** The extension system reaches Vew's tabs through this. */
  private registerExtensionHost(): void {
    // A view whose page was just destroyed has no webContents left (see closeView).
    const liveWc = (t: Tab): WebContents | undefined => {
      const wc = t.view?.webContents as WebContents | undefined
      return wc && !wc.isDestroyed() ? wc : undefined
    }
    const loaded = (ses: Electron.Session): Tab[] =>
      tabsInOrder(this.zones).filter((t) => liveWc(t)?.session === ses && pageKind(t.url) === 'web')
    const byWc = (wc: WebContents): Tab | undefined =>
      this.allTabs().find((t) => t.view?.webContents === wc)
    setExtensionHost({
      windowId: () => this.win.id,
      tabs: (ses) =>
        loaded(ses).map((t) => ({
          wc: liveWc(t)!,
          active: t.id === this.activeId,
          pinned: this.find(t.id)?.loc.zone !== 'today',
          title: t.title,
          url: t.url,
          favicon: t.favicon,
          loading: t.loading
        })),
      openTab: (url, active) => {
        const tab = this.openTab(url, { activate: active })
        return this.ensureView(tab).webContents
      },
      activateTab: (wc) => {
        const t = byWc(wc)
        if (t) this.activate(t.id)
      },
      closeTab: (wc) => {
        const t = byWc(wc)
        if (t) this.closeTab(t.id)
      },
      openPopup: (_extId, url) => this.openPopup(url, this.popup?.anchor ?? { x: 16, y: 120 }),
      changed: () => this.schedulePush()
    })
  }

  private openPopup(url: string, anchor: { x: number; y: number }): void {
    this.closePopup()
    this.closeFind()
    this.closePeek()
    if (this.paletteOpen) this.closePalette()
    const extId = hostOf(url)
    const view = new WebContentsView({
      webPreferences: {
        ...secureWebPreferences,
        session: sessionFor(this.space.profileId),
        preload: CRX_PRELOAD(),
        enablePreferredSizeMode: true
      }
    })
    view.setBorderRadius(PAGE_RADIUS)
    view.setBackgroundColor('#ffffff')
    const wc = view.webContents
    const popup = { view, anchor, size: { width: 320, height: 240 } }
    wc.on('preferred-size-changed', (_e, size) => {
      popup.size = {
        width: Math.min(POPUP_MAX.width, Math.max(25, size.width)),
        height: Math.min(POPUP_MAX.height, Math.max(25, size.height))
      }
      if (this.popup === popup) this.layout()
    })
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        this.closePopup()
      }
    })
    // The popup only ever shows its own extension's pages; links open as tabs.
    wc.on('will-navigate', (e) => {
      if (hostOf(e.url) === extId && e.url.startsWith('chrome-extension://')) return
      e.preventDefault()
      if (/^https?:/.test(e.url)) this.openTab(e.url, { activate: true })
    })
    wc.setWindowOpenHandler((details) => {
      if (/^https?:/.test(details.url) || details.url.startsWith(`chrome-extension://${extId}/`)) {
        this.openTab(details.url, { activate: true })
      }
      return { action: 'deny' }
    })
    wc.on('destroyed', () => this.popup === popup && this.closePopup())
    load(wc, url)
    this.popup = popup
    this.present()
    this.overlay.webContents.send(IPC.popup, true)
    wc.focus()
  }

  private closePopup(): void {
    if (!this.popup) return
    const { view } = this.popup
    this.popup = null
    this.win.contentView.removeChildView(view)
    closeView(view)
    this.overlay.webContents.send(IPC.popup, false)
    this.present()
  }

  private extensionMenu(id: string): void {
    const ses = sessionFor(this.space.profileId)
    const ext = ses.extensions.getExtension(id)
    if (!ext) return
    const options = optionsUrl(id, ses)
    const items: MenuItemConstructorOptions[] = [
      { label: ext.name, enabled: false },
      { type: 'separator' },
      ...(options
        ? [{ label: 'Options', click: () => this.openTab(options, { activate: true }) }]
        : []),
      {
        label: 'Remove Extension…',
        click: async () => {
          const { response } = await dialog.showMessageBox(this.win, {
            type: 'warning',
            message: `Remove “${ext.name}”?`,
            buttons: ['Remove', 'Cancel'],
            defaultId: 1,
            cancelId: 1
          })
          if (response === 0) await removeExtension(id)
        }
      },
      {
        label: 'Manage Extensions',
        click: () => this.run({ type: 'openInternal', page: 'settings' })
      }
    ]
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  /** Right-click menu for web pages, with extensions' items. */
  private pageMenu(tab: Tab, wc: WebContents, p: Electron.ContextMenuParams): void {
    const items: MenuItemConstructorOptions[] = []
    const sep = (): void => {
      if (items.length && items.at(-1)?.type !== 'separator') items.push({ type: 'separator' })
    }
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push(
        {
          label: 'Open Link in New Tab',
          click: () => this.openTab(p.linkURL, { activate: false, opener: tab })
        },
        { label: 'Copy Link', click: () => void clipboard.writeText(p.linkURL) }
      )
      sep()
    }
    if (p.mediaType === 'image' && /^(https?|data):/.test(p.srcURL)) {
      items.push(
        {
          label: 'Open Image in New Tab',
          click: () => this.openTab(p.srcURL, { activate: false, opener: tab })
        },
        { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) }
      )
      sep()
    }
    if (p.isEditable) {
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      )
      sep()
    } else if (p.selectionText.trim()) {
      const text = p.selectionText.trim()
      items.push(
        { role: 'copy' },
        {
          label: `Search ${ENGINE_NAMES[engine()]} for “${text.length > 24 ? text.slice(0, 24) + '…' : text}”`,
          click: () => this.openTab(toUrl(text, engine()), { activate: true })
        }
      )
      sep()
    }
    if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === 'none') {
      items.push(
        {
          label: 'Back',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward()
        },
        { label: 'Reload', click: () => wc.reload() }
      )
      sep()
    }
    const ext = extensionMenuItems(wc, p)
    if (ext.length) {
      items.push(...ext)
      sep()
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  /** For noisy sources (download progress, blocked requests): at most a few pushes a second. */
  private schedulePush(): void {
    this.pushTimer ??= setTimeout(() => {
      this.pushTimer = undefined
      this.push()
    }, 250)
  }

  private siteInfo(): SiteInfo | null {
    const active = this.active()
    const origin = active && originOf(active.url)
    if (!active || !origin) return null
    const s = settings.get()
    const host = new URL(origin).host
    return {
      origin,
      host,
      secure: origin.startsWith('https:'),
      permissions: s.permissions[origin] ?? {},
      blocker: s.blocker && !s.blockerAllowlist.includes(host),
      blocked: active.view ? blockedOn(active.view.webContents.id) : 0,
      zoomPercent: Math.round((active.view?.webContents.getZoomFactor() ?? 1) * 100)
    }
  }

  private save(): void {
    try {
      save(this.file, {
        ...fromLive({
          favorites: this.favorites,
          spaces: this.spaces,
          activeSpaceId: this.activeSpaceId
        }),
        profiles: this.profiles,
        archive: this.archive,
        sidebar: { width: this.sidebar.width, collapsed: this.sidebar.collapsed },
        archiveAfterHours: settings.get().archiveAfterHours
      })
    } catch (err) {
      console.error('saving sidebar failed:', err)
    }
  }
}
