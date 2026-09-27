import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PermissionKind, PermissionValue, Settings } from '../shared/ipc'
import { SEARCH_ENGINES, type SearchEngine } from '../shared/url'

export const PERMISSION_KINDS: readonly PermissionKind[] = [
  'camera',
  'microphone',
  'geolocation',
  'notifications'
]
const APPEARANCES = ['system', 'light', 'dark'] as const

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  archiveAfterHours: 12,
  blocker: true,
  appearance: 'system',
  blockerAllowlist: [],
  zoom: {},
  permissions: {}
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isHost = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 253 && /^[a-z0-9.:[\]-]+$/i.test(v)
const isOrigin = (v: string): boolean => /^https?:\/\/[a-z0-9.:[\]-]+$/i.test(v)

/** Anything malformed in the file is dropped, never trusted. */
export function sanitizeSettings(v: unknown, legacyArchiveHours?: number): Settings {
  const s: Settings = structuredClone(DEFAULT_SETTINGS)
  if (legacyArchiveHours) s.archiveAfterHours = legacyArchiveHours
  if (!isObj(v)) return s
  if (typeof v.searchEngine === 'string' && Object.hasOwn(SEARCH_ENGINES, v.searchEngine)) {
    s.searchEngine = v.searchEngine as SearchEngine
  }
  if (
    typeof v.archiveAfterHours === 'number' &&
    v.archiveAfterHours >= 0.01 &&
    v.archiveAfterHours <= 24 * 365
  ) {
    s.archiveAfterHours = v.archiveAfterHours
  }
  if (typeof v.blocker === 'boolean') s.blocker = v.blocker
  if (APPEARANCES.includes(v.appearance as never))
    s.appearance = v.appearance as Settings['appearance']
  if (Array.isArray(v.blockerAllowlist))
    s.blockerAllowlist = v.blockerAllowlist.filter(isHost).slice(0, 5000)
  if (isObj(v.zoom)) {
    for (const [host, level] of Object.entries(v.zoom)) {
      if (isHost(host) && typeof level === 'number' && level >= 0.25 && level <= 5)
        s.zoom[host] = level
    }
  }
  if (isObj(v.permissions)) {
    for (const [origin, perms] of Object.entries(v.permissions)) {
      if (!isOrigin(origin) || !isObj(perms)) continue
      const clean: Partial<Record<PermissionKind, PermissionValue>> = {}
      for (const kind of PERMISSION_KINDS) {
        if (perms[kind] === 'allow' || perms[kind] === 'block') clean[kind] = perms[kind]
      }
      if (Object.keys(clean).length) s.permissions[origin] = clean
    }
  }
  return s
}

/** App-wide settings in userData/settings.json; every change is saved atomically and announced. */
class SettingsStore {
  private file = ''
  private value: Settings = structuredClone(DEFAULT_SETTINGS)
  private readonly listeners = new Set<(s: Settings) => void>()

  load(legacyArchiveHours?: number): void {
    this.file = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(this.file)) {
      this.value = sanitizeSettings(null, legacyArchiveHours)
      return
    }
    try {
      this.value = sanitizeSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (err) {
      console.warn('settings.json unreadable, using defaults:', err)
      copyFileSync(this.file, `${this.file}.corrupt`)
    }
  }

  get(): Settings {
    return this.value
  }

  update(change: (s: Settings) => void): void {
    const next = structuredClone(this.value)
    change(next)
    this.value = sanitizeSettings(next)
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.value, null, 2))
      renameSync(`${this.file}.tmp`, this.file)
    } catch (err) {
      console.error('saving settings failed:', err)
    }
    this.listeners.forEach((cb) => cb(this.value))
  }

  subscribe(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

export const settings = new SettingsStore()
