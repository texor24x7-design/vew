/** Every IPC channel and payload between main and the shell/overlay renderers. */
export const IPC = {
  /** shell → main: a Command */
  command: 'vew:command',
  /** main → shell: BrowserState */
  state: 'vew:state',
  /** main → shell: FocusUrl */
  focusUrl: 'vew:focus-url'
} as const

export interface TabState {
  id: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserState {
  tabs: TabState[]
  activeId: number | null
}

/** Ask the shell to focus the URL pill; `newTab` means Enter opens a new tab. */
export interface FocusUrl {
  newTab: boolean
}

export type Command =
  | { type: 'open'; input: string }
  | { type: 'navigate'; input: string }
  | { type: 'close'; id?: number }
  | { type: 'activate'; id: number }
  | { type: 'select'; index: number } // -1 = last tab
  | { type: 'cycle'; delta: 1 | -1 }
  | { type: 'reorder'; id: number; index: number }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'reopen' }

const str = (v: unknown): boolean => typeof v === 'string' && v.length <= 8192
const int = (v: unknown): boolean => Number.isInteger(v)
const bare = (): boolean => true

const validators: { [K in Command['type']]: (c: Record<string, unknown>) => boolean } = {
  open: (c) => str(c.input),
  navigate: (c) => str(c.input),
  close: (c) => c.id === undefined || int(c.id),
  activate: (c) => int(c.id),
  select: (c) => int(c.index),
  cycle: (c) => c.delta === 1 || c.delta === -1,
  reorder: (c) => int(c.id) && int(c.index),
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
