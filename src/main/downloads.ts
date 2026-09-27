import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { basename, join, parse } from 'node:path'
import { app, shell, type DownloadItem, type Session } from 'electron'
import type { DownloadState } from '../shared/ipc'

const items = new Map<string, { item: DownloadItem | null; state: DownloadState }>()
/** 'change' (throttled, for progress) and 'done' (per finished download). */
export const downloads = new EventEmitter()

let pending: NodeJS.Timeout | undefined
const changed = (): void => {
  pending ??= setTimeout(() => {
    pending = undefined
    downloads.emit('change')
  }, 200)
}

/** "report.pdf" → "report (1).pdf" … so nothing already in Downloads is overwritten. */
function uniquePath(dir: string, name: string): string {
  const { name: base, ext } = parse(name)
  const taken = (p: string): boolean =>
    existsSync(p) || [...items.values()].some((d) => d.state.path === p)
  let path = join(dir, name)
  for (let i = 1; taken(path); i++) path = join(dir, `${base} (${i})${ext}`)
  return path
}

/** Save downloads straight to the Downloads folder (like Chrome's default) and track their progress. */
export function trackDownloads(ses: Session): void {
  ses.on('will-download', (_e, item) => {
    const id = randomUUID()
    // basename: a server-supplied name must never climb out of the Downloads folder.
    const name = basename(item.getFilename()) || 'download'
    const path = uniquePath(app.getPath('downloads'), name)
    item.setSavePath(path)
    const entry = {
      item: item as DownloadItem | null,
      state: {
        id,
        filename: basename(path),
        path,
        received: 0,
        total: item.getTotalBytes(),
        state: 'progressing',
        startTime: Date.now()
      } as DownloadState
    }
    items.set(id, entry)
    item.on('updated', (_ev, state) => {
      entry.state.received = item.getReceivedBytes()
      entry.state.total = item.getTotalBytes()
      entry.state.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      changed()
    })
    item.once('done', (_ev, state) => {
      entry.state.received = item.getReceivedBytes()
      entry.state.state = state
      entry.item = null
      changed()
      downloads.emit('done', { ...entry.state })
    })
    changed()
  })
}

/** Newest first. */
export const downloadList = (): DownloadState[] =>
  [...items.values()].map((d) => ({ ...d.state })).reverse()

export function downloadAction(id: string, action: 'open' | 'show' | 'cancel' | 'remove'): void {
  const d = items.get(id)
  if (!d) return
  if (action === 'open' && d.state.state === 'completed') void shell.openPath(d.state.path)
  if (action === 'show') shell.showItemInFolder(d.state.path)
  if (action === 'cancel') d.item?.cancel()
  if (action === 'remove' && d.state.state !== 'progressing') items.delete(id)
  changed()
}

export function clearDownloads(): void {
  for (const [id, d] of items) if (d.state.state !== 'progressing') items.delete(id)
  changed()
}
