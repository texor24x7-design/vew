/** Every IPC channel and payload between main and the shell/overlay renderers. */
export const IPC = {
  /** shell → main: a Command */
  command: 'vew:command',
  /** main → shell: BrowserState */
  state: 'vew:state',
  /** main → shell: FocusUrl */
  focusUrl: 'vew:focus-url'
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

export interface BrowserState {
  favorites: TabState[]
  pinned: NodeState[]
  today: TabState[]
  archive: ArchivedTab[]
  activeId: number | null
  sidebar: SidebarState
  /** Folder whose name the shell should start editing. */
  renameId: number | null
}

/** Ask the shell to focus the URL pill; `newTab` means Enter opens a new tab. */
export interface FocusUrl {
  newTab: boolean
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
  renameId: null
}
