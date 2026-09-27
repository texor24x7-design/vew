import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { ArchivedTab, Profile } from '../shared/ipc'
import {
  MAX_SPLIT,
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
  evenSizes,
  type SplitDirection
} from '../shared/layout'
import { DEFAULT_THEME, isTheme, type Theme } from '../shared/theme'
import { TEXOR_APPS } from '../shared/url'
import type { Node, Space, Split } from './tree'

interface SavedTab {
  kind: 'tab'
  url: string
  title: string
  favicon?: string
  profileId?: string
  lastActive: number
  /** Indexes of the Spaces showing this tab (a favorite can be active in several). */
  activeIn?: number[]
}
interface SavedFolder {
  kind: 'folder'
  name: string
  open: boolean
  children: SavedNode[]
}
type SavedNode = SavedTab | SavedFolder

/** A split refers to its tabs by their position in save order (tab ids aren't stable across launches). */
interface SavedSplit {
  tabs: number[]
  direction: SplitDirection
  sizes: number[]
}

interface SavedSpace {
  name: string
  icon: string
  theme: Theme
  profileId: string
  pinned: SavedNode[]
  today: SavedNode[]
  splits: SavedSplit[]
}

export interface Saved {
  favorites: SavedNode[]
  spaces: SavedSpace[]
  activeSpace: number
  profiles: Profile[]
  archive: ArchivedTab[]
  sidebar: { width: number; collapsed: boolean }
  /** Hours of inactivity before a today tab is archived. Edited by hand until the Phase 6 settings page. */
  archiveAfterHours: number
}

export const ARCHIVE_LIMIT = 200
export const DEFAULT_PROFILE: Profile = { id: 'default', name: 'Personal' }

export const newSavedSpace = (overrides: Partial<SavedSpace> = {}): SavedSpace => ({
  name: 'Personal',
  icon: '🏠',
  theme: DEFAULT_THEME,
  profileId: DEFAULT_PROFILE.id,
  pinned: [],
  today: [],
  splits: [],
  ...overrides
})

/** Favorites on a fresh install: the Texor apps (their icons load from the sites). */
const TEXOR_FAVORITES: SavedNode[] = TEXOR_APPS.map((a) => ({
  kind: 'tab',
  title: a.name,
  url: a.url,
  favicon: a.url + a.icon,
  lastActive: 0
}))

export const emptySaved = (): Saved => ({
  favorites: TEXOR_FAVORITES.map((f) => ({ ...f })),
  spaces: [newSavedSpace()],
  activeSpace: 0,
  profiles: [DEFAULT_PROFILE],
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
/** Profile ids become partition names, so keep them to a safe alphabet. */
export const isProfileId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v)

function sanitizeNode(v: unknown): SavedNode | null {
  if (!isObj(v)) return null
  if (v.kind === 'folder') {
    const children = arr(v.children)
      .map(sanitizeNode)
      .filter((n) => n !== null)
    return { kind: 'folder', name: text(v.name, 'Folder'), open: v.open !== false, children }
  }
  if (typeof v.url !== 'string' || !v.url) return null
  const activeIn = v.active === true ? [0] : arr(v.activeIn).filter(Number.isInteger)
  return {
    kind: 'tab',
    url: v.url,
    title: text(v.title, v.url),
    favicon: typeof v.favicon === 'string' ? v.favicon : undefined,
    profileId: isProfileId(v.profileId) ? v.profileId : undefined,
    lastActive: num(v.lastActive, Date.now()),
    ...(activeIn.length && { activeIn: activeIn as number[] })
  }
}

const nodes = (v: unknown): SavedNode[] =>
  arr(v)
    .map(sanitizeNode)
    .filter((n) => n !== null)
const tabsOnly = (v: unknown): SavedNode[] => nodes(v).filter((n) => n.kind === 'tab')

const validSizes = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) &&
  v.length === n &&
  v.every((x) => typeof x === 'number' && x > 0 && x < 1) &&
  Math.abs(v.reduce((a: number, b: number) => a + b, 0) - 1) < 0.01

function splits(v: unknown): SavedSplit[] {
  return arr(v)
    .filter(isObj)
    .map((sp) => {
      const tabs = arr(sp.tabs).filter(Number.isInteger) as number[]
      return {
        tabs,
        direction: (sp.direction === 'column' ? 'column' : 'row') as SplitDirection,
        sizes: validSizes(sp.sizes, tabs.length) ? sp.sizes : evenSizes(tabs.length)
      }
    })
    .filter((sp) => sp.tabs.length >= 2 && sp.tabs.length <= MAX_SPLIT)
}

/** Parse the saved file defensively; anything malformed is dropped rather than trusted. */
export function sanitize(v: unknown): Saved {
  const s = emptySaved()
  if (!isObj(v)) return s

  s.profiles = arr(v.profiles)
    .filter((p): p is Obj => isObj(p) && isProfileId(p.id))
    .map((p) => ({ id: p.id as string, name: text(p.name, 'Profile') }))
  if (!s.profiles.some((p) => p.id === DEFAULT_PROFILE.id)) s.profiles.unshift(DEFAULT_PROFILE)
  const profileIds = new Set(s.profiles.map((p) => p.id))

  if (Array.isArray(v.spaces)) {
    s.favorites = tabsOnly(v.favorites)
    s.spaces = v.spaces.filter(isObj).map((sp) =>
      newSavedSpace({
        name: text(sp.name, 'Space').slice(0, 100),
        icon: text(sp.icon, '✨').slice(0, 16),
        theme: isTheme(sp.theme) ? sp.theme : DEFAULT_THEME,
        profileId: profileIds.has(sp.profileId as string) ? (sp.profileId as string) : 'default',
        pinned: nodes(sp.pinned),
        today: tabsOnly(sp.today),
        splits: splits(sp.splits)
      })
    )
  } else if (isObj(v.zones)) {
    // Phase 2 format: one implicit Space.
    s.favorites = tabsOnly(v.zones.favorites)
    s.spaces = [newSavedSpace({ pinned: nodes(v.zones.pinned), today: tabsOnly(v.zones.today) })]
  }
  if (!s.spaces.length) s.spaces = [newSavedSpace()]
  s.activeSpace = Math.min(Math.max(0, Math.trunc(num(v.activeSpace, 0))), s.spaces.length - 1)

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

type Live = { favorites: Node[]; spaces: Space[]; activeSpaceId: number }

/** Live model → saved shape (everything except profiles/archive/sidebar settings). */
export function fromLive(live: Live): Pick<Saved, 'favorites' | 'spaces' | 'activeSpace'> {
  // Same traversal order as toLive, so ordinals line up on load.
  const ordinal = new Map<number, number>()
  const conv = (n: Node): SavedNode => {
    if (n.kind === 'folder') {
      return { kind: 'folder', name: n.name, open: n.open, children: n.children.map(conv) }
    }
    const activeIn = live.spaces.flatMap((sp, i) => (sp.activeId === n.id ? [i] : []))
    ordinal.set(n.id, ordinal.size)
    return {
      kind: 'tab',
      url: n.url,
      title: n.title,
      favicon: n.favicon,
      profileId: n.profileId,
      lastActive: n.lastActive,
      ...(activeIn.length && { activeIn })
    }
  }
  const favorites = live.favorites.map(conv)
  const spaces = live.spaces.map((sp) => ({
    name: sp.name,
    icon: sp.icon,
    theme: sp.theme,
    profileId: sp.profileId,
    pinned: sp.pinned.map(conv),
    today: sp.today.map(conv),
    splits: [] as SavedSplit[]
  }))
  // Every tab has an ordinal now; splits can refer to them.
  live.spaces.forEach((sp, i) => {
    spaces[i].splits = sp.splits
      .map((split) => ({
        tabs: split.tabIds.map((id) => ordinal.get(id)).filter((o) => o !== undefined),
        direction: split.direction,
        sizes: split.sizes
      }))
      .filter((split) => split.tabs.length === split.sizes.length && split.tabs.length >= 2)
  })
  return {
    favorites,
    spaces,
    activeSpace: Math.max(
      0,
      live.spaces.findIndex((sp) => sp.id === live.activeSpaceId)
    )
  }
}

/** Saved shape → live model, all tabs unloaded. */
export function toLive(saved: Saved, newId: () => number): Live {
  const spaces: Space[] = saved.spaces.map((sp) => ({
    id: newId(),
    name: sp.name,
    icon: sp.icon,
    theme: sp.theme,
    profileId: sp.profileId,
    pinned: [],
    today: [],
    activeId: null,
    splits: []
  }))
  const byOrdinal: number[] = []
  const conv =
    (fallbackProfile: string) =>
    (n: SavedNode): Node => {
      const id = newId()
      if (n.kind === 'folder') {
        return {
          kind: 'folder',
          id,
          name: n.name,
          open: n.open,
          children: n.children.map(conv(fallbackProfile))
        }
      }
      for (const i of n.activeIn ?? []) if (spaces[i]) spaces[i].activeId = id
      byOrdinal.push(id)
      const { url, title, favicon, lastActive } = n
      const profileId =
        n.profileId && saved.profiles.some((p) => p.id === n.profileId)
          ? n.profileId
          : fallbackProfile
      return {
        kind: 'tab',
        id,
        url,
        title,
        favicon,
        profileId,
        lastActive,
        loading: false,
        view: null
      }
    }
  const favorites = saved.favorites.map(conv(DEFAULT_PROFILE.id))
  saved.spaces.forEach((sp, i) => {
    spaces[i].pinned = sp.pinned.map(conv(sp.profileId))
    spaces[i].today = sp.today.map(conv(sp.profileId))
  })
  // Rebuild splits from ordinals; skip any that point at missing or already-split tabs.
  saved.spaces.forEach((sp, i) => {
    const used = new Set<number>()
    for (const saved of sp.splits) {
      const tabIds = saved.tabs.map((o) => byOrdinal[o])
      if (
        tabIds.some((id) => id === undefined || used.has(id)) ||
        new Set(tabIds).size !== tabIds.length
      )
        continue
      tabIds.forEach((id) => used.add(id))
      const split: Split = { id: newId(), tabIds, direction: saved.direction, sizes: saved.sizes }
      spaces[i].splits.push(split)
    }
  })
  return { favorites, spaces, activeSpaceId: spaces[saved.activeSpace].id }
}
