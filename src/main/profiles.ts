import { session, type Session } from 'electron'
import { installBlocker } from './adblock'
import { trackDownloads } from './downloads'
import { installPermissions } from './permissions'
import { settings } from './settings'

const configured = new WeakSet<Session>()

/** Is the blocker on for this page? (Global switch + per-site allowlist.) */
function blockerOn(pageUrl: string): boolean {
  const s = settings.get()
  if (!s.blocker) return false
  try {
    return !s.blockerAllowlist.includes(new URL(pageUrl).host)
  } catch {
    return true
  }
}

/** The Chromium session behind a profile: its own persistent cookies, storage and cache. */
export function sessionFor(profileId: string): Session {
  const ses = session.fromPartition(`persist:profile-${profileId}`)
  if (!configured.has(ses)) {
    configured.add(ses)
    // Every profile session gets the same guards, not just the default one.
    installPermissions(ses)
    installBlocker(ses, blockerOn)
    trackDownloads(ses)
  }
  return ses
}
