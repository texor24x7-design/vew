import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
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
  type Profile,
  type TabState
} from '../shared/ipc'
import { PAGE_RADIUS, WIN_TITLEBAR_HEIGHT, clampSidebarWidth, pageBounds } from '../shared/layout'
import { PRESETS } from '../shared/theme'
import { toUrl, type SearchEngine } from '../shared/url'
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
  type Tab,
  type Zones
} from './tree'

const secureWebPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false }
const HOME_URL = 'https://www.google.com'
// ponytail: fixed engine; the Phase 6 settings page will store the user's choice.
const SEARCH_ENGINE: SearchEngine = 'google'
const REOPEN_LIMIT = 25
const ARCHIVE_CHECK_MS = 60_000
const SIDEBAR_ANIM_MS = 180
const isMac = process.platform === 'darwin'
/** Default icons for new Spaces, so they're distinguishable in the switcher before being customized. */
const SPACE_ICONS = ['🏠', '💼', '🌿', '🔥', '🌊', '🎨', '📚', '🚀', '⭐️']

let nextId = 1
const newId = (): number => nextId++

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

const onlyTabs = (list: Node[]): Tab[] => list.filter((n): n is Tab => n.kind === 'tab')

/** One browser window: its shell UI plus the tabs it owns. */
export class VewWindow {
  readonly win: BrowserWindow
  private readonly file = join(app.getPath('userData'), 'sidebar.json')
  private favorites: Node[]
  private spaces: Space[]
  private activeSpaceId: number
  private profiles: Profile[]
  private archive: ArchivedTab[]
  private archiveAfterMs: number
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
    this.archiveAfterMs = initial.archiveAfterHours * 3_600_000
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
    const onCommand = (e: IpcMainEvent, cmd: unknown): void => {
      if (e.sender === shell && isCommand(cmd)) this.run(cmd)
    }
    ipcMain.on(IPC.command, onCommand)
    shell.on('before-input-event', (e, input) => this.onInput(e, input))
    shell.on('did-finish-load', () => this.push())
    this.win.on('resize', () => this.layout())
    this.win.once('ready-to-show', () => this.win.show())
    const archiveTimer = setInterval(() => this.archiveIdle(), ARCHIVE_CHECK_MS)
    this.win.on('closed', () => {
      ipcMain.off(IPC.command, onCommand)
      clearInterval(archiveTimer)
      clearTimeout(this.saveTimer)
      clearInterval(this.tween)
      this.save()
      this.disposed = true
      for (const t of this.allTabs()) if (t.view) closeView(t.view)
    })

    // macOS vibrancy and Windows 11 Mica show through; elsewhere (Windows 10) the shell paints a solid tint.
    const hasMaterial =
      isMac ||
      (process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2]) >= 22000)
    const query = { platform: process.platform, material: hasMaterial ? '1' : '0' }
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      this.win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
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
      webContents?: WebContents
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

  private createView(tab: Tab, webContents?: WebContents): WebContentsView {
    const view = new WebContentsView(
      webContents
        ? { webContents }
        : { webPreferences: { ...secureWebPreferences, session: sessionFor(tab.profileId) } }
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
    // The page closed itself (e.g. an OAuth popup calling window.close()). Views we unload ourselves are detached first.
    wc.on('destroyed', () => tab.view === view && this.closeTab(tab.id))
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
    const node = locate(this.zones, id)?.node
    if (node?.kind !== 'tab') return
    const prev = this.active()
    const now = Date.now()
    if (prev) prev.lastActive = now
    if (prev?.view && prev !== node) this.win.contentView.removeChildView(prev.view)
    this.activeId = id
    node.lastActive = now
    let view = node.view
    if (!view) {
      view = this.createView(node)
      load(view.webContents, node.url)
    }
    this.win.contentView.addChildView(view)
    this.layout()
    view.webContents.focus()
    this.push()
  }

  /** Drop a tab's page but keep its sidebar entry (URL, title, favicon). */
  private unload(tab: Tab): void {
    const view = tab.view
    if (!view) return
    tab.view = null
    tab.loading = false
    this.win.contentView.removeChildView(view)
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
    this.unload(tab)
    // A background Space just forgets a removed tab; it has nothing on screen to replace.
    if (space !== this.space) {
      if (loc.zone === 'today' && space.activeId === id) space.activeId = null
      return this.push()
    }
    if (this.activeId === id) {
      this.activeId = null
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
    const cutoff = Date.now() - this.archiveAfterMs
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
    if (prev?.view) this.win.contentView.removeChildView(prev.view)
    this.activeSpaceId = id
    if (this.activeId !== null && this.find(this.activeId)) this.activate(this.activeId)
    else {
      this.activeId = null
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
      activeId: null
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
    // The URL pill lives in the sidebar, so reveal it while typing.
    if (this.sidebar.collapsed) this.run({ type: 'sidebar', peek: true })
    this.win.webContents.focus()
    this.win.webContents.send(IPC.focusUrl, { newTab: shortcut.newTab })
  }

  private updateTrafficLights(): void {
    if (isMac) this.win.setWindowButtonVisibility(!this.sidebar.collapsed || this.sidebar.peek)
  }

  /** Place the active page card; `animate` eases it over the sidebar animation's duration. */
  private layout(animate = false): void {
    clearInterval(this.tween)
    const view = this.active()?.view
    if (!view) return
    const [width, height] = this.win.getContentSize()
    const to = pageBounds(width, height, process.platform, this.sidebar)
    if (!animate) return view.setBounds(to)
    const from = view.getBounds()
    const start = Date.now()
    const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t)
    this.tween = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / SIDEBAR_ANIM_MS)
      const t = 1 - (1 - p) ** 3 // ease-out cubic
      const r: Rectangle = {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        width: lerp(from.width, to.width, t),
        height: lerp(from.height, to.height, t)
      }
      view.setBounds(r)
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
      canGoForward: history?.canGoForward() ?? false
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
      editSpaceId: this.editSpaceId
    }
    this.win.webContents.send(IPC.state, state)
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 500)
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
        archiveAfterHours: this.archiveAfterMs / 3_600_000
      })
    } catch (err) {
      console.error('saving sidebar failed:', err)
    }
  }
}
