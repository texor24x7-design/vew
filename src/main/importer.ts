import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import type { ImportSource } from '../shared/ipc'
import { history } from './history'

/** Chromium-based browsers share Chrome's profile format. Paths are relative to the per-OS data folder. */
const BROWSERS: { id: string; name: string; mac?: string; win?: string }[] = [
  { id: 'chrome', name: 'Google Chrome', mac: 'Google/Chrome', win: 'Google/Chrome/User Data' },
  { id: 'arc', name: 'Arc', mac: 'Arc/User Data' },
  {
    id: 'brave',
    name: 'Brave',
    mac: 'BraveSoftware/Brave-Browser',
    win: 'BraveSoftware/Brave-Browser/User Data'
  },
  { id: 'edge', name: 'Microsoft Edge', mac: 'Microsoft Edge', win: 'Microsoft/Edge/User Data' }
]
export const BROWSER_IDS = BROWSERS.map((b) => b.id)
/** Keep an import from flooding the sidebar. */
export const MAX_BOOKMARKS = 2000
const MAX_HISTORY = 20_000

export interface ImportedBookmark {
  title: string
  url: string
}
/** Two levels at most, like Vew's pinned folders: a folder of bookmarks and subfolders of bookmarks. */
export interface ImportedFolder {
  name: string
  bookmarks: ImportedBookmark[]
  folders: { name: string; bookmarks: ImportedBookmark[] }[]
}

function profileDir(id: string): string | null {
  const b = BROWSERS.find((x) => x.id === id)
  const rel =
    process.platform === 'darwin' ? b?.mac : process.platform === 'win32' ? b?.win : undefined
  const base = process.platform === 'darwin' ? app.getPath('appData') : process.env.LOCALAPPDATA
  if (!rel || !base) return null
  // ponytail: the "Default" profile only; list other Chromium profiles if people ask.
  const dir = join(base, rel, 'Default')
  return existsSync(dir) ? dir : null
}

type Node = { type?: string; name?: string; url?: string; children?: Node[] }
const isWeb = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)

/** Every bookmark under a node, depth-first (nested folders flattened). */
function flatten(node: Node, out: ImportedBookmark[] = []): ImportedBookmark[] {
  for (const child of node.children ?? []) {
    if (child.type === 'url' && isWeb(child.url))
      out.push({ title: child.name || child.url, url: child.url })
    else if (child.type === 'folder') flatten(child, out)
  }
  return out
}

/** Chrome's Bookmarks file → one folder: top-level bookmarks, and each top-level folder as a subfolder. */
export function parseBookmarks(json: unknown, name: string): ImportedFolder {
  const roots = (json as { roots?: Record<string, Node> })?.roots ?? {}
  const folder: ImportedFolder = { name, bookmarks: [], folders: [] }
  let count = 0
  const take = (list: ImportedBookmark[]): ImportedBookmark[] => {
    const room = Math.max(0, MAX_BOOKMARKS - count)
    count += Math.min(room, list.length)
    return list.slice(0, room)
  }
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    const root = roots[key]
    for (const child of root?.children ?? []) {
      if (child.type === 'url' && isWeb(child.url))
        folder.bookmarks.push(...take([{ title: child.name || child.url, url: child.url }]))
      else if (child.type === 'folder') {
        const bookmarks = take(flatten(child))
        if (bookmarks.length) folder.folders.push({ name: child.name || 'Folder', bookmarks })
      }
    }
  }
  return folder
}

/**
 * Chrome stores times as microseconds since 1601-01-01 — too big for a JS number, so the query converts
 * to Unix milliseconds in SQLite (integer math) before the value reaches JavaScript.
 */
export const CHROME_TIME_TO_MS = 'last_visit_time / 1000 - 11644473600000'

export function detectSources(): ImportSource[] {
  return BROWSERS.flatMap((b) => {
    const dir = profileDir(b.id)
    if (!dir) return []
    const bookmarks = ((): number => {
      try {
        const f = parseBookmarks(JSON.parse(readFileSync(join(dir, 'Bookmarks'), 'utf8')), b.name)
        return f.bookmarks.length + f.folders.reduce((n, x) => n + x.bookmarks.length, 0)
      } catch {
        return 0 // no Bookmarks file, or unreadable
      }
    })()
    const hasHistory = existsSync(join(dir, 'History'))
    return bookmarks || hasHistory
      ? [{ id: b.id, name: b.name, bookmarks, history: hasHistory }]
      : []
  })
}

export function readBookmarks(id: string): ImportedFolder | null {
  const dir = profileDir(id)
  const name = BROWSERS.find((b) => b.id === id)?.name ?? 'Browser'
  if (!dir || !existsSync(join(dir, 'Bookmarks'))) return null
  return parseBookmarks(
    JSON.parse(readFileSync(join(dir, 'Bookmarks'), 'utf8')),
    `${name} bookmarks`
  )
}

/** Merge the browser's history into Vew's. Reads a copy: the original is locked while that browser runs. */
export function importHistory(id: string): number {
  const dir = profileDir(id)
  if (!dir || !existsSync(join(dir, 'History'))) return 0
  const tmp = mkdtempSync(join(tmpdir(), 'vew-import-'))
  try {
    copyFileSync(join(dir, 'History'), join(tmp, 'History'))
    const db = new DatabaseSync(join(tmp, 'History'), { readOnly: true })
    const rows = db
      .prepare(
        `SELECT url, title, visit_count AS visits, ${CHROME_TIME_TO_MS} AS lastVisit FROM urls
         WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`
      )
      .all(MAX_HISTORY) as { url: string; title: string; visits: number; lastVisit: number }[]
    db.close()
    const items = rows
      .filter((r) => isWeb(r.url))
      .map((r) => ({
        url: r.url,
        title: r.title ?? '',
        visits: Math.max(1, r.visits),
        lastVisit: r.lastVisit
      }))
    history().importItems(items)
    return items.length
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
