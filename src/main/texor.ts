import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, safeStorage } from 'electron'
import type { Account } from '../shared/ipc'
import { sessionFor } from './profiles'

/**
 * Texor Account: Vew's browser account, like a Google Account in Chrome. Signing in happens in a normal tab
 * of the profile's session, so the Texor SSO cookie lands there too and every Texor app is signed in with it.
 * Vew is a public OIDC client ("vew", PKCE, no secret) registered by texor-accounts' seed script.
 */
const ISSUER = process.env['VEW_TEXOR_ISSUER'] ?? 'https://api.accounts.texor.app/oidc'
const ACCOUNTS = process.env['VEW_TEXOR_ACCOUNTS'] ?? 'https://accounts.texor.app'
const CLIENT_ID = 'vew'
/** Registered for the client; Vew catches the navigation to it before any request goes out. */
const REDIRECT_URI = `${ACCOUNTS}/browser/signed-in`
export const MANAGE_URL = `${ACCOUNTS}/`

interface Stored extends Account {
  sub: string
  /** Refresh token, encrypted with the OS keychain (safeStorage), base64. */
  refresh?: string
}

const file = (): string => join(app.getPath('userData'), 'accounts.json')
let accounts: Record<string, Stored> | null = null
const all = (): Record<string, Stored> => {
  if (!accounts) {
    try {
      accounts = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Stored>
    } catch {
      accounts = {}
    }
  }
  return accounts
}
const persist = (): void => {
  writeFileSync(file(), JSON.stringify(all()))
  texorEvents.emit('change')
}

/** Emits 'change' whenever an account signs in, out, or updates. */
export const texorEvents = new EventEmitter()

/** The account a profile is signed in with, as the UI shows it. */
export function accountFor(profileId: string): Account | null {
  const a = all()[profileId]
  return a ? { name: a.name, email: a.email, picture: a.picture } : null
}

const b64url = (buf: Buffer): string => buf.toString('base64url')
const pending = new Map<
  string,
  { profileId: string; verifier: string; nonce: string; done: (a: Account | null) => void }
>()

/** Start signing a profile in: the URL to open in one of its tabs, and the outcome. */
export function beginSignIn(profileId: string): {
  url: string
  state: string
  done: Promise<Account | null>
} {
  const state = b64url(randomBytes(16))
  const nonce = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  const url = new URL(`${ISSUER}/auth`)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256'
  }).toString()
  const done = new Promise<Account | null>((resolve) =>
    pending.set(state, { profileId, verifier, nonce, done: resolve })
  )
  return { url: url.toString(), state, done }
}

export function cancelSignIn(state: string): void {
  pending.get(state)?.done(null)
  pending.delete(state)
}

export const isSignInRedirect = (url: string): boolean => url.split(/[?#]/)[0] === REDIRECT_URI

async function post(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(`${ISSUER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok)
    throw Object.assign(new Error(String(json.error ?? res.status)), { code: json.error })
  return json
}

/** The ID token's claims. Its signature isn't checked: it came straight from the token endpoint over TLS (OIDC Core 3.1.3.7). */
export function idClaims(jwt: unknown): Record<string, unknown> {
  if (typeof jwt !== 'string') throw new Error('No ID token')
  return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

export function checkClaims(c: Record<string, unknown>, nonce: string, now = Date.now()): void {
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (c.iss !== ISSUER || !aud.includes(CLIENT_ID) || c.nonce !== nonce) {
    throw new Error('ID token isn’t for Vew')
  }
  if (typeof c.exp !== 'number' || c.exp * 1000 < now) throw new Error('ID token expired')
}

/** A small data: URL of the profile picture, so the sidebar shows it offline too. */
async function pictureData(url: unknown): Promise<string | undefined> {
  if (typeof url !== 'string' || !url.startsWith('https://')) return undefined
  try {
    const res = await net.fetch(url)
    const type = res.headers.get('content-type') ?? ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok || !type.startsWith('image/') || buf.length > 1_000_000) return undefined
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** Save an account from a token response (sign-in or refresh). */
async function store(
  profileId: string,
  tokens: Record<string, unknown>,
  sub: string
): Promise<Account> {
  const res = await net.fetch(`${ISSUER}/me`, {
    headers: { authorization: `Bearer ${String(tokens.access_token)}` }
  })
  if (!res.ok) throw new Error(`userinfo ${res.status}`)
  const info = (await res.json()) as Record<string, unknown>
  if (info.sub !== sub) throw new Error('Account mismatch')
  const previous = all()[profileId]
  const refresh =
    typeof tokens.refresh_token === 'string' && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(tokens.refresh_token).toString('base64')
      : previous?.sub === sub
        ? previous.refresh // not rotated this time
        : undefined
  const email = typeof info.email === 'string' ? info.email : ''
  const account: Stored = {
    sub,
    name: typeof info.name === 'string' && info.name ? info.name : email || 'Texor Account',
    email,
    picture: await pictureData(info.picture),
    refresh
  }
  all()[profileId] = account
  persist()
  return accountFor(profileId)!
}

/** The sign-in tab reached the redirect URI: swap the code for tokens. */
export async function finishSignIn(url: string): Promise<Account | null> {
  const params = new URL(url).searchParams
  const state = params.get('state') ?? ''
  const p = pending.get(state)
  if (!p) return null
  pending.delete(state)
  try {
    const code = params.get('code')
    if (!code) throw new Error(params.get('error_description') ?? params.get('error') ?? 'No code')
    const tokens = await post('/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: p.verifier
    })
    const claims = idClaims(tokens.id_token)
    checkClaims(claims, p.nonce)
    const account = await store(p.profileId, tokens, String(claims.sub))
    p.done(account)
    return account
  } catch (err) {
    console.error('Texor sign-in failed:', err)
    p.done(null)
    return null
  }
}

const refreshToken = (a: Stored): string | null => {
  try {
    return a.refresh ? safeStorage.decryptString(Buffer.from(a.refresh, 'base64')) : null
  } catch {
    return null
  }
}

/** Sign a profile out of Vew and of every Texor app in it. */
export async function signOut(profileId: string): Promise<void> {
  const a = all()[profileId]
  if (!a) return
  // Cookies first, so by the time the UI shows "signed out" the Texor apps are signed out too.
  const cookies = sessionFor(profileId).cookies
  // accounts.texor.app → the Texor-wide texor.app cookies (SSO), which every Texor app shares.
  const domain = new URL(ACCOUNTS).hostname.replace(/^accounts\./, '')
  for (const c of await cookies.get({ domain })) {
    const host = (c.domain ?? domain).replace(/^\./, '')
    const scheme = c.secure ? 'https' : 'http' // cookies are bound to the scheme that set them
    await cookies.remove(`${scheme}://${host}${c.path ?? '/'}`, c.name).catch(() => {})
  }
  delete all()[profileId]
  persist()
  // Best effort, in the background: offline, the token just expires on its own.
  const token = refreshToken(a)
  if (token) void post('/token/revocation', { token }).catch(() => {})
}

/** On launch: pick up name and picture changes, and drop accounts whose sign-in was revoked. */
export async function refreshAccounts(): Promise<void> {
  for (const [profileId, a] of Object.entries(all())) {
    const token = refreshToken(a)
    if (!token) continue
    try {
      const tokens = await post('/token', { grant_type: 'refresh_token', refresh_token: token })
      await store(profileId, tokens, a.sub)
    } catch (err) {
      // Revoked or expired: signed out elsewhere. Anything else (offline) keeps the account.
      if ((err as { code?: unknown }).code === 'invalid_grant') {
        delete all()[profileId]
        persist()
      }
    }
  }
}
