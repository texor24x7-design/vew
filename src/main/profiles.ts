import { session, type Session } from 'electron'

const configured = new WeakSet<Session>()

/** The Chromium session behind a profile: its own persistent cookies, storage and cache. */
export function sessionFor(profileId: string): Session {
  const ses = session.fromPartition(`persist:profile-${profileId}`)
  if (!configured.has(ses)) {
    configured.add(ses)
    // Deny everything until Phase 6 adds per-site prompts. Must be set on every session, not just the default.
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return ses
}
