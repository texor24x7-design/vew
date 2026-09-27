import { isTheme, type Theme } from './theme'

/** Every IPC channel and payload between main and the shell/overlay renderers. */
export const IPC = {
  /** shell → main: a Command */
  command: 'vew:command',
  /** main → shell: BrowserState */
  state: 'vew:state',
  /** main → shell: focus the URL pill */
  focusUrl: 'vew:focus-url',
  /** main → shell: a short message for the toast */
  toast: 'vew:toast',
  /** main → overlay: PaletteData, show the command bar */
  paletteOpen: 'vew:palette-open',
  /** main → overlay: animate the command bar out */
  paletteClose: 'vew:palette-close',
  /** overlay → main (invoke): search suggestions for a query → string[] */
  suggest: 'vew:suggest'
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
  editSpaceId: null
}
