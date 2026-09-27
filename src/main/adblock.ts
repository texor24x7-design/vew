import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { FiltersEngine, Request, type ElectronRequestType } from '@ghostery/adblocker'
import { app, type Session } from 'electron'

const REFRESH_MS = 7 * 24 * 3600_000
let engine: FiltersEngine | null = null
const blocked = new Map<number, number>()
/** 'blocked' (webContents id) whenever a request is stopped. */
export const blockerEvents = new EventEmitter()

/** Load the cached filter lists, refreshing them weekly. Offline, the cache (if any) keeps working. */
export async function loadBlocker(): Promise<void> {
  const file = join(app.getPath('userData'), 'adblock.bin')
  let age = Infinity
  try {
    engine = FiltersEngine.deserialize(new Uint8Array(await readFile(file)))
    age = Date.now() - (await stat(file)).mtimeMs
  } catch {
    // no cache yet, or a stale engine version: fetch below
  }
  if (engine && age < REFRESH_MS) return
  try {
    const fresh = await FiltersEngine.fromPrebuiltAdsAndTracking(fetch)
    engine = fresh
    await writeFile(file, fresh.serialize())
  } catch (err) {
    console.warn('ad blocker lists unavailable:', (err as Error).message)
  }
}

export const blockedOn = (webContentsId: number): number => blocked.get(webContentsId) ?? 0
export const resetBlocked = (webContentsId: number): void => void blocked.delete(webContentsId)

/**
 * Network-level blocking of ads and trackers. Deliberately no cosmetic filtering: that needs a script
 * injected into every page, and web pages in Vew get no preload.
 */
export function installBlocker(ses: Session, enabledFor: (pageUrl: string) => boolean): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!engine || details.resourceType === 'mainFrame') return callback({})
    const page = details.webContents?.getURL() || details.referrer
    if (!enabledFor(page)) return callback({})
    const { match, redirect } = engine.match(
      Request.fromRawDetails({
        url: details.url,
        sourceUrl: page,
        type: details.resourceType as ElectronRequestType
      })
    )
    if (!match && !redirect) return callback({})
    const id = details.webContentsId
    if (id !== undefined) {
      blocked.set(id, blockedOn(id) + 1)
      blockerEvents.emit('blocked', id)
    }
    callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true })
  })
}
