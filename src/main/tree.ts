import type { WebContentsView } from 'electron'
import type { Where, Zone } from '../shared/ipc'
import type { SplitDirection } from '../shared/layout'
import type { Theme } from '../shared/theme'

export interface Tab {
  kind: 'tab'
  id: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  /** Profile (Chromium session) the page runs in. Kept when a tab moves, e.g. into Favorites. */
  profileId: string
  /** Last time this tab was the active one (ms). Drives auto-archiving. */
  lastActive: number
  /** Created lazily on first activation; null for unloaded tabs. */
  view: WebContentsView | null
}

export interface Folder {
  kind: 'folder'
  id: number
  name: string
  open: boolean
  children: Node[]
}

export type Node = Tab | Folder
export type Zones = Record<Zone, Node[]>

export interface Space {
  id: number
  name: string
  icon: string
  theme: Theme
  profileId: string
  pinned: Node[]
  today: Node[]
  /** The tab this Space shows; each Space remembers its own. */
  activeId: number | null
  /** Groups of 2–4 tabs shown side by side; a tab is in at most one. */
  splits: Split[]
}

export interface Split {
  id: number
  tabIds: number[]
  direction: SplitDirection
  /** Fractions of the split's length, one per pane, summing to 1. */
  sizes: number[]
}

/** A Space's view of the sidebar: shared favorites plus its own pinned and today lists (same arrays, not copies). */
export const zonesOf = (favorites: Node[], space: Space): Zones => ({
  favorites,
  pinned: space.pinned,
  today: space.today
})

/** Folders nest one level: a top-level folder may hold subfolders, which hold only tabs. */
const MAX_FOLDER_LEVEL = 2

export interface Location {
  node: Node
  list: Node[]
  index: number
  zone: Zone
  /** Chain of enclosing folders, outermost first. */
  ancestors: Folder[]
}

export function locate(zones: Zones, id: number): Location | null {
  const walk = (list: Node[], zone: Zone, ancestors: Folder[]): Location | null => {
    for (let index = 0; index < list.length; index++) {
      const node = list[index]
      if (node.id === id) return { node, list, index, zone, ancestors }
      if (node.kind === 'folder') {
        const found = walk(node.children, zone, [...ancestors, node])
        if (found) return found
      }
    }
    return null
  }
  for (const zone of Object.keys(zones) as Zone[]) {
    const found = walk(zones[zone], zone, [])
    if (found) return found
  }
  return null
}

/** Every tab in sidebar order: favorites, pinned (depth-first), today. */
export function tabsInOrder(zones: Zones): Tab[] {
  const out: Tab[] = []
  const walk = (list: Node[]): void => {
    for (const n of list) {
      if (n.kind === 'tab') out.push(n)
      else walk(n.children)
    }
  }
  walk(zones.favorites)
  walk(zones.pinned)
  walk(zones.today)
  return out
}

/** How many folder levels a node occupies: tab 0, folder 1, folder with subfolders 2. */
const depth = (n: Node): number =>
  n.kind === 'tab' ? 0 : 1 + Math.max(0, ...n.children.map(depth))

/** Move a tab or folder. Returns false (and changes nothing) if the move breaks a rule. */
export function move(zones: Zones, id: number, where: Where): boolean {
  const from = locate(zones, id)
  if (!from) return false
  const { node } = from

  let target = zones[where.zone]
  let level = 0
  if (where.parent !== null) {
    const parent = locate(zones, where.parent)
    if (!parent || parent.node.kind !== 'folder' || parent.zone !== 'pinned') return false
    // A folder can't go inside itself or its own subfolder.
    if (parent.node === node || parent.ancestors.includes(node as Folder)) return false
    target = parent.node.children
    level = parent.ancestors.length + 1
  }
  if (node.kind === 'folder' && where.zone !== 'pinned') return false
  if (level + depth(node) > MAX_FOLDER_LEVEL) return false

  from.list.splice(from.index, 1)
  let index = where.index
  if (target === from.list && from.index < index) index--
  target.splice(Math.max(0, Math.min(index, target.length)), 0, node)
  return true
}
