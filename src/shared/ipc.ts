import type { Rect, SplitDirection } from './layout'
import { isHexColor, isTheme, type Theme } from './theme'
import { SEARCH_ENGINES, type SearchEngine } from './url'

/** Every IPC channel and payload between main and the shell/overlay renderers. */
export const IPC = {
  /** shell → main: a Command */
  command: 'vew:command',
  /** main → shell: BrowserState */
  state: 'vew:state',
  /** main → shell: focus the URL pill */
  focusUrl: 'vew:focus-url',
  /** main → shell: move keyboard focus into the sidebar (F6) */
  focusSidebar: 'vew:focus-sidebar',
  /** main → shell: a short message for the toast */
  toast: 'vew:toast',
  /** main → overlay: PaletteData, show the command bar */
  paletteOpen: 'vew:palette-open',
  /** main → overlay: animate the command bar out */
  paletteClose: 'vew:palette-close',
  /** overlay → main (invoke): search suggestions for a query → string[] */
  suggest: 'vew:suggest',
  /** main → shell: Snapshot[] of the page panes while a tab is dragged (views are detached meanwhile) */
  snapshot: 'vew:snapshot',
  /** main → overlay: PeekInfo to show the Peek chrome, or null to hide it */
  peek: 'vew:peek',
  /** main → mini window toolbar: MiniInfo */
  miniInfo: 'vew:mini-info',
  /** mini window toolbar → main: MiniAction */
  miniAction: 'vew:mini-action',
  /** main → overlay: FindState to show the find bar, or null to hide it */
  find: 'vew:find',
  /** internal vew:// page → main (invoke): InternalRequest → result */
  internal: 'vew:internal',
  /** extension page / worker → main (invoke): (namespace, method, args[]) → result */
  crx: 'vew:crx',
  /** main → extension page / worker: (namespace, event, args[]) */
  crxEvent: 'vew:crx-event',
  /** main → overlay: an extension popup is open (true) or closed (false) */
  popup: 'vew:popup'
} as const

/** favorites: icon grid shared across Spaces; pinned: persistent tree with folders; today: auto-archiving. */
export type Zone = 'favorites' | 'pinned' | 'today'
export const ZONES: readonly Zone[] = ['favorites', 'pinned', 'today']

export interface TabState {
  kind: 'tab'
  id: number
  url: string
  title: string
  favicon?: string
  /** Has a live WebContentsView (pinned/favorite tabs can be unloaded). */
  loaded: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  inSplit: boolean
}

export interface FolderState {
  kind: 'folder'
  id: number
  name: string
  open: boolean
  children: NodeState[]
}

export type NodeState = TabState | FolderState

export interface ArchivedTab {
  url: string
  title: string
  favicon?: string
  archivedAt: number
}

export interface SidebarState {
  width: number
  collapsed: boolean
  /** Collapsed but temporarily revealed by hovering the left edge. */
  peek: boolean
}

export interface SpaceState {
  id: number
  name: string
  icon: string
  theme: Theme
  profileId: string
}

export interface Profile {
  id: string
  name: string
}

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface SplitState {
  id: number
  tabIds: number[]
  direction: SplitDirection
  sizes: number[]
}

/** A picture of a page pane, shown in its place while the real view is detached for a drag. */
export interface Snapshot extends Rect {
  src: string
}

/** What the overlay needs to draw Peek's backdrop and toolbar around the floating page. */
export interface PeekInfo {
  rect: Rect
  title: string
  url: string
  favicon?: string
}

/** The mini window's page, for its toolbar. */
export interface MiniInfo {
  title: string
  url: string
  favicon?: string
}

export type MiniAction = 'move' | 'close'
export const isMiniAction = (v: unknown): v is MiniAction => v === 'move' || v === 'close'

export type PermissionKind = 'camera' | 'microphone' | 'geolocation' | 'notifications'
export type PermissionValue = 'allow' | 'block'

export interface Settings {
  searchEngine: SearchEngine
  archiveAfterHours: number
  /** Built-in ad and tracker blocking. */
  blocker: boolean
  appearance: 'system' | 'light' | 'dark'
  /** Hosts where the blocker is turned off. */
  blockerAllowlist: string[]
  /** Zoom factor per host (1 = 100%). */
  zoom: Record<string, number>
  /** Remembered permission decisions per origin. */
  permissions: Record<string, Partial<Record<PermissionKind, PermissionValue>>>
}

export interface DownloadState {
  id: string
  filename: string
  path: string
  received: number
  total: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
}

/** The active page, for the site-info popover behind the lock icon. */
export interface SiteInfo {
  origin: string
  host: string
  secure: boolean
  permissions: Partial<Record<PermissionKind, PermissionValue>>
  blocker: boolean
  blocked: number
  zoomPercent: number
}

/** Find-in-page result for the find bar: match `active` of `total`. */
export interface FindState {
  active: number
  total: number
}

export interface HistoryEntry {
  url: string
  title: string
  visits: number
  lastVisit: number
}

/** Requests from the internal pages (vew://history, vew://settings). */
export type InternalRequest =
  | { method: 'historySearch'; query: string; before?: number; limit: number }
  | { method: 'historyDelete'; url: string }
  | { method: 'historyClear' }
  | { method: 'getSettings' }
  | {
      method: 'setSettings'
      patch: Partial<
        Pick<Settings, 'searchEngine' | 'archiveAfterHours' | 'blocker' | 'appearance'>
      >
    }
  | { method: 'makeDefaultBrowser' }
  | { method: 'open'; url: string }
  | { method: 'extList' }
  | { method: 'extInstall'; source: string }
  | { method: 'extLoadUnpacked' }
  | { method: 'extRemove'; id: string }
  | { method: 'welcomeState' }
  | { method: 'setColors'; colors: string[] }
  | { method: 'import'; source: string; bookmarks: boolean; history: boolean }
  | { method: 'welcomeDone' }

/** Another browser on this computer we can import from. */
export interface ImportSource {
  id: string
  name: string
  bookmarks: number
  history: boolean
}

export interface WelcomeState {
  sources: ImportSource[]
  colors: string[]
  isDefaultBrowser: boolean
}

export interface SettingsView {
  settings: Settings
  isDefaultBrowser: boolean
}

export function isInternalRequest(x: unknown): x is InternalRequest {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  switch (r.method) {
    case 'historySearch':
      return (
        str(r.query, 500) &&
        opt(r.before, (v) => typeof v === 'number') &&
        Number.isInteger(r.limit) &&
        (r.limit as number) > 0 &&
        (r.limit as number) <= 500
      )
    case 'historyDelete':
    case 'open':
      return str(r.url)
    case 'historyClear':
    case 'getSettings':
    case 'makeDefaultBrowser':
    case 'extList':
    case 'extLoadUnpacked':
      return true
    case 'welcomeState':
    case 'welcomeDone':
      return true
    case 'setColors':
      return (
        Array.isArray(r.colors) &&
        r.colors.length >= 2 &&
        r.colors.length <= 3 &&
        r.colors.every(isHexColor)
      )
    case 'import':
      return str(r.source, 20) && typeof r.bookmarks === 'boolean' && typeof r.history === 'boolean'
    case 'extInstall':
      return str(r.source, 500)
    case 'extRemove':
      return isExtensionId(r.id)
    case 'setSettings': {
      if (typeof r.patch !== 'object' || r.patch === null) return false
      const p = r.patch as Record<string, unknown>
      return (
        opt(p.searchEngine, (v) => typeof v === 'string' && Object.hasOwn(SEARCH_ENGINES, v)) &&
        opt(p.archiveAfterHours, (v) => typeof v === 'number' && v >= 0.01 && v <= 24 * 365) &&
        opt(p.blocker, (v) => typeof v === 'boolean') &&
        opt(p.appearance, (v) => v === 'system' || v === 'light' || v === 'dark')
      )
    }
  }
  return false
}

/** An installed extension as the sidebar's icon row shows it. */
export interface ExtensionState {
  id: string
  name: string
  /** data: URL of the toolbar icon */
  icon?: string
  badge: string
  badgeColor: string
  hasPopup: boolean
}

/** Installed extension, for the settings page. */
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  unpacked: boolean
  path: string
}

export interface BrowserState {
  /** Shared by every Space. */
  favorites: TabState[]
  /** Pinned and Today belong to the active Space. */
  pinned: NodeState[]
  today: TabState[]
  archive: ArchivedTab[]
  activeId: number | null
  sidebar: SidebarState
  /** Folder whose name the shell should start editing. */
  renameId: number | null
  spaces: SpaceState[]
  activeSpaceId: number
  profiles: Profile[]
  /** Space whose editor the shell should open. */
  editSpaceId: number | null
  /** The split view the active tab is in, if any. */
  split: SplitState | null
  downloads: DownloadState[]
  site: SiteInfo | null
  extensions: ExtensionState[]
}

/** A tab as the command bar sees it (from any Space). */
export interface PaletteTab {
  id: number
  title: string
  url: string
  favicon?: string
  zone: Zone
  spaceId: number
  spaceName: string
  spaceIcon: string
  lastActive: number
  active: boolean
}

export interface PaletteHistory {
  url: string
  title: string
  visits: number
  lastVisit: number
}

/** Snapshot sent when the command bar opens; it searches this locally so every keystroke is instant. */
export interface PaletteData {
  /** Identifies this opening; echoed back in paletteHidden so a late "hidden" from an earlier one is ignored. */
  seq: number
  tabs: PaletteTab[]
  history: PaletteHistory[]
  activeSpaceId: number
  searchEngine: string
}

/** A drop position: `parent` is a pinned folder id, or null for the zone's top level. */
export interface Where {
  zone: Zone
  parent: number | null
  index: number
}

export type Command =
  | { type: 'open'; input: string }
  | { type: 'navigate'; input: string }
  | { type: 'close'; id?: number }
  | { type: 'activate'; id: number }
  | { type: 'select'; index: number } // -1 = last tab
  | { type: 'cycle'; delta: 1 | -1 }
  | { type: 'move'; id: number; where: Where }
  | { type: 'contextMenu'; id: number }
  | { type: 'newFolder' }
  | { type: 'renameFolder'; id: number; name: string }
  | { type: 'toggleFolder'; id: number }
  | { type: 'restore'; index: number }
  | { type: 'toggleSidebar' }
  | { type: 'sidebar'; width?: number; peek?: boolean }
  | { type: 'switchSpace'; id: number }
  | { type: 'selectSpace'; index: number }
  | { type: 'stepSpace'; delta: 1 | -1 }
  | { type: 'newSpace' }
  | {
      type: 'updateSpace'
      id: number
      name?: string
      icon?: string
      theme?: Theme
      profileId?: string
    }
  | { type: 'newProfile'; spaceId: number }
  | { type: 'deleteSpace'; id: number }
  | { type: 'spaceMenu'; id: number }
  | { type: 'openPalette' }
  | { type: 'paletteHidden'; seq: number }
  | { type: 'focusTab'; id: number }
  | { type: 'copyUrl' }
  | { type: 'toggleDarkMode' }
  | { type: 'clearHistory' }
  | { type: 'splitWith'; id: number; edge: Edge; targetId?: number }
  | { type: 'resizeSplit'; sizes: number[] }
  | { type: 'unsplit'; id: number; all?: boolean }
  | { type: 'dragging'; on: boolean }
  | { type: 'peekExpand' }
  | { type: 'peekClose' }
  | { type: 'openFind' }
  | { type: 'find'; text: string; forward: boolean; next: boolean }
  | { type: 'closeFind' }
  | { type: 'zoom'; delta: 1 | -1 | 0 }
  | { type: 'print' }
  | { type: 'viewSource' }
  | { type: 'devtools' }
  | { type: 'openInternal'; page: 'history' | 'settings' }
  | { type: 'setPermission'; origin: string; kind: PermissionKind; value: PermissionValue | 'ask' }
  | { type: 'setSiteBlocker'; host: string; enabled: boolean }
  | { type: 'download'; id: string; action: 'open' | 'show' | 'cancel' | 'remove' }
  | { type: 'clearDownloads' }
  | { type: 'extensionClick'; id: string; anchor: { x: number; y: number } }
  | { type: 'extensionMenu'; id: string }
  | { type: 'closePopup' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'reopen' }

const str = (v: unknown, max = 8192): boolean => typeof v === 'string' && v.length <= max
const int = (v: unknown): boolean => Number.isInteger(v)
const opt = (v: unknown, check: (v: unknown) => boolean): boolean => v === undefined || check(v)
const bare = (): boolean => true
const isWhere = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false
  const w = v as Record<string, unknown>
  return ZONES.includes(w.zone as Zone) && (w.parent === null || int(w.parent)) && int(w.index)
}

/** Chrome extension ids: 32 letters a–p. */
export const isExtensionId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-p]{32}$/.test(v)
const isPoint = (v: unknown): boolean =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as Record<string, unknown>).x) &&
  Number.isFinite((v as Record<string, unknown>).y)

const EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom']

const validators: { [K in Command['type']]: (c: Record<string, unknown>) => boolean } = {
  open: (c) => str(c.input),
  navigate: (c) => str(c.input),
  close: (c) => opt(c.id, int),
  activate: (c) => int(c.id),
  select: (c) => int(c.index),
  cycle: (c) => c.delta === 1 || c.delta === -1,
  move: (c) => int(c.id) && isWhere(c.where),
  contextMenu: (c) => int(c.id),
  newFolder: bare,
  renameFolder: (c) => int(c.id) && str(c.name, 200),
  toggleFolder: (c) => int(c.id),
  restore: (c) => int(c.index),
  toggleSidebar: bare,
  sidebar: (c) =>
    opt(c.width, (v) => typeof v === 'number' && Number.isFinite(v)) &&
    opt(c.peek, (v) => typeof v === 'boolean'),
  switchSpace: (c) => int(c.id),
  selectSpace: (c) => int(c.index),
  stepSpace: (c) => c.delta === 1 || c.delta === -1,
  newSpace: bare,
  updateSpace: (c) =>
    int(c.id) &&
    opt(c.name, (v) => str(v, 100)) &&
    opt(c.icon, (v) => str(v, 16)) &&
    opt(c.theme, isTheme) &&
    opt(c.profileId, (v) => str(v, 100)),
  newProfile: (c) => int(c.spaceId),
  deleteSpace: (c) => int(c.id),
  spaceMenu: (c) => int(c.id),
  openPalette: bare,
  paletteHidden: (c) => int(c.seq),
  focusTab: (c) => int(c.id),
  copyUrl: bare,
  toggleDarkMode: bare,
  clearHistory: bare,
  splitWith: (c) => int(c.id) && EDGES.includes(c.edge as Edge) && opt(c.targetId, int),
  resizeSplit: (c) =>
    Array.isArray(c.sizes) &&
    c.sizes.length >= 2 &&
    c.sizes.length <= 4 &&
    c.sizes.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1),
  unsplit: (c) => int(c.id) && opt(c.all, (v) => typeof v === 'boolean'),
  dragging: (c) => typeof c.on === 'boolean',
  peekExpand: bare,
  peekClose: bare,
  openFind: bare,
  find: (c) => str(c.text, 1000) && typeof c.forward === 'boolean' && typeof c.next === 'boolean',
  closeFind: bare,
  zoom: (c) => c.delta === 1 || c.delta === -1 || c.delta === 0,
  print: bare,
  viewSource: bare,
  devtools: bare,
  openInternal: (c) => c.page === 'history' || c.page === 'settings',
  setPermission: (c) =>
    str(c.origin, 300) &&
    ['camera', 'microphone', 'geolocation', 'notifications'].includes(c.kind as string) &&
    ['allow', 'block', 'ask'].includes(c.value as string),
  setSiteBlocker: (c) => str(c.host, 253) && typeof c.enabled === 'boolean',
  download: (c) =>
    str(c.id, 64) && ['open', 'show', 'cancel', 'remove'].includes(c.action as string),
  clearDownloads: bare,
  extensionClick: (c) => isExtensionId(c.id) && isPoint(c.anchor),
  extensionMenu: (c) => isExtensionId(c.id),
  closePopup: bare,
  back: bare,
  forward: bare,
  reload: bare,
  stop: bare,
  reopen: bare
}

/** Payload-shape check for anything arriving on IPC.command. */
export function isCommand(x: unknown): x is Command {
  if (typeof x !== 'object' || x === null) return false
  const c = x as Record<string, unknown>
  return typeof c.type === 'string' && Object.hasOwn(validators, c.type)
    ? validators[c.type as Command['type']](c)
    : false
}

export const EMPTY_STATE: BrowserState = {
  favorites: [],
  pinned: [],
  today: [],
  archive: [],
  activeId: null,
  sidebar: { width: 240, collapsed: false, peek: false },
  renameId: null,
  spaces: [],
  activeSpaceId: 0,
  profiles: [],
  editSpaceId: null,
  split: null,
  downloads: [],
  site: null,
  extensions: []
}
