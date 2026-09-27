import { BrowserWindow, dialog, type Session } from 'electron'
import type { PermissionKind } from '../shared/ipc'
import { settings } from './settings'

/** Harmless and expected by ordinary sites (video fullscreen, "copy" buttons). Everything else is denied. */
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write'])
const LABEL: Record<PermissionKind, string> = {
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'location',
  notifications: 'notifications'
}

function kindsFor(permission: string, mediaTypes: string[] = []): PermissionKind[] {
  if (permission === 'media') {
    const kinds: PermissionKind[] = []
    if (mediaTypes.includes('video')) kinds.push('camera')
    if (mediaTypes.includes('audio')) kinds.push('microphone')
    return kinds
  }
  if (permission === 'geolocation' || permission === 'notifications') return [permission]
  return []
}

/** Only http(s) pages can hold permissions. */
export function originOf(url: string | undefined): string | null {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/** Camera, microphone, location and notifications: ask once per site (remembered), deny everything unknown. */
export function installPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true)
    const kinds = kindsFor(permission, 'mediaTypes' in details ? details.mediaTypes : undefined)
    const origin = originOf(details.requestingUrl ?? wc.getURL())
    if (!kinds.length || !origin) return callback(false)
    const saved = settings.get().permissions[origin] ?? {}
    if (kinds.some((k) => saved[k] === 'block')) return callback(false)
    if (kinds.every((k) => saved[k] === 'allow')) return callback(true)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return callback(false)
    const what = kinds.map((k) => LABEL[k]).join(' and ')
    dialog
      .showMessageBox(win, {
        type: 'question',
        message: `Allow ${new URL(origin).host} to use your ${what}?`,
        buttons: ['Allow', 'Block'],
        defaultId: 1,
        cancelId: 1,
        checkboxLabel: 'Remember for this site',
        checkboxChecked: true
      })
      .then(({ response, checkboxChecked }) => {
        const allow = response === 0
        if (checkboxChecked) {
          settings.update((s) => {
            const p = (s.permissions[origin] ??= {})
            for (const k of kinds) p[k] = allow ? 'allow' : 'block'
          })
        }
        callback(allow)
      })
      .catch(() => callback(false))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (ALWAYS.has(permission)) return true
    const media =
      'mediaType' in details && details.mediaType ? [details.mediaType] : ['video', 'audio']
    const kinds = kindsFor(permission, permission === 'media' ? media : undefined)
    const origin = originOf(requestingOrigin)
    if (!kinds.length || !origin) return false
    const saved = settings.get().permissions[origin] ?? {}
    return kinds.every((k) => saved[k] === 'allow')
  })
}
