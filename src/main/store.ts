import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { ArchivedTab, Zone } from '../shared/ipc'
import { ZONES } from '../shared/ipc'
import { SIDEBAR_DEFAULT_WIDTH, clampSidebarWidth } from '../shared/layout'
import type { Node, Zones } from './tree'

interface SavedTab {
  kind: 'tab'
  url: string
  title: string
  favicon?: string
  lastActive: number
  active?: boolean
}
interface SavedFolder {
  kind: 'folder'
  name: string
  open: boolean
  children: SavedNode[]
}
type SavedNode = SavedTab | SavedFolder

export interface Saved {
  zones: Record<Zone, SavedNode[]>
  archive: ArchivedTab[]
  sidebar: { width: number; collapsed: boolean }
  /** Hours of inactivity before a today tab is archived. Edited by hand until the Phase 6 settings page. */
  archiveAfterHours: number
}

export const ARCHIVE_LIMIT = 200

export const emptySaved = (): Saved => ({
  zones: { favorites: [], pinned: [], today: [] },
  archive: [],
  sidebar: { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false },
  archiveAfterHours: 12
})

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function sanitizeNode(v: unknown): SavedNode | null {
  if (!isObj(v)) return null
  if (v.kind === 'folder') {
    const children = arr(v.children)
      .map(sanitizeNode)
      .filter((n) => n !== null)
    return { kind: 'folder', name: text(v.name, 'Folder'), open: v.open !== false, children }
  }
  if (typeof v.url !== 'string' || !v.url) return null
  return {
    kind: 'tab',
    url: v.url,
    title: text(v.title, v.url),
    favicon: typeof v.favicon === 'string' ? v.favicon : undefined,
    lastActive: num(v.lastActive, Date.now()),
    active: v.active === true
  }
}

/** Parse the saved file defensively; anything malformed is dropped rather than trusted. */
export function sanitize(v: unknown): Saved {
  const s = emptySaved()
  if (!isObj(v)) return s
  const zones = isObj(v.zones) ? v.zones : {}
  for (const zone of ZONES) {
    s.zones[zone] = arr(zones[zone])
      .map(sanitizeNode)
      .filter((n) => n !== null)
  }
  // Only pinned may hold folders.
  s.zones.favorites = s.zones.favorites.filter((n) => n.kind === 'tab')
  s.zones.today = s.zones.today.filter((n) => n.kind === 'tab')
  s.archive = arr(v.archive)
    .filter((a): a is Obj => isObj(a) && typeof a.url === 'string')
    .slice(0, ARCHIVE_LIMIT)
    .map((a) => ({
      url: a.url as string,
      title: text(a.title, a.url as string),
      favicon: typeof a.favicon === 'string' ? a.favicon : undefined,
      archivedAt: num(a.archivedAt, Date.now())
    }))
  if (isObj(v.sidebar)) {
    s.sidebar = {
      width: clampSidebarWidth(num(v.sidebar.width, SIDEBAR_DEFAULT_WIDTH)),
      collapsed: v.sidebar.collapsed === true
    }
  }
  s.archiveAfterHours = Math.max(0.01, num(v.archiveAfterHours, 12))
  return s
}

export function load(file: string): Saved | null {
  if (!existsSync(file)) return null
  try {
    return sanitize(JSON.parse(readFileSync(file, 'utf8')))
  } catch (err) {
    // Keep the unreadable file for inspection instead of silently overwriting it.
    console.warn(`${file} unreadable, starting fresh:`, err)
    copyFileSync(file, `${file}.corrupt`)
    return null
  }
}

/** Atomic write: a crash mid-save never leaves a half-written file. */
export function save(file: string, s: Saved): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(s))
  renameSync(`${file}.tmp`, file)
}

/** Live tree → saved tree. */
export function fromZones(zones: Zones, activeId: number | null): Saved['zones'] {
  const conv = (n: Node): SavedNode =>
    n.kind === 'folder'
      ? { kind: 'folder', name: n.name, open: n.open, children: n.children.map(conv) }
      : {
          kind: 'tab',
          url: n.url,
          title: n.title,
          favicon: n.favicon,
          lastActive: n.lastActive,
          ...(n.id === activeId && { active: true })
        }
  return {
    favorites: zones.favorites.map(conv),
    pinned: zones.pinned.map(conv),
    today: zones.today.map(conv)
  }
}

/** Saved tree → live tree (all tabs unloaded). Returns the id of the tab that was active. */
export function toZones(
  saved: Saved['zones'],
  newId: () => number
): { zones: Zones; activeId: number | null } {
  let activeId: number | null = null
  const conv = (n: SavedNode): Node => {
    const id = newId()
    if (n.kind === 'folder') {
      return { kind: 'folder', id, name: n.name, open: n.open, children: n.children.map(conv) }
    }
    if (n.active) activeId = id
    const { url, title, favicon, lastActive } = n
    return { kind: 'tab', id, url, title, favicon, lastActive, loading: false, view: null }
  }
  return {
    zones: {
      favorites: saved.favorites.map(conv),
      pinned: saved.pinned.map(conv),
      today: saved.today.map(conv)
    },
    activeId
  }
}
