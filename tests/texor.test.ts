import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'vew-texor-'))
const { fetch, cookies } = vi.hoisted(() => ({
  fetch: vi.fn(),
  cookies: {
    get: vi.fn(async () => [{ name: 'texor_sid', domain: '.texor.app', path: '/', secure: true }]),
    remove: vi.fn(async () => {})
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  net: { fetch },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))
vi.mock('../src/main/profiles', () => ({ sessionFor: () => ({ cookies }) }))

const { accountFor, beginSignIn, finishSignIn, isSignInRedirect, signOut } =
  await import('../src/main/texor')

const ISSUER = 'https://api.accounts.texor.app/oidc'
const jwt = (claims: object): string =>
  `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
const json = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Answers the token and userinfo endpoints; the ID token carries `nonce`. */
function server(nonce: () => string): void {
  fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('client_id')).toBe('vew')
      expect(body.get('code_verifier')).toMatch(/^[\w-]{43}$/)
      return json({
        access_token: 'at',
        refresh_token: 'rt',
        id_token: jwt({ iss: ISSUER, aud: 'vew', sub: 'u1', nonce: nonce(), exp: 9e9 })
      })
    }
    if (url === `${ISSUER}/me`) return json({ sub: 'u1', name: 'Ada', email: 'ada@texor.app' })
    if (url === `${ISSUER}/token/revocation`) return new Response(null, { status: 200 })
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => {
  fetch.mockReset()
})

test('signs a profile in with PKCE and signs it out again', async () => {
  const { url, done } = beginSignIn('p1')
  const auth = new URL(url)
  expect(auth.origin + auth.pathname).toBe(`${ISSUER}/auth`)
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
  const redirect = `${auth.searchParams.get('redirect_uri')}?code=c&state=${auth.searchParams.get('state')}`
  expect(isSignInRedirect(redirect)).toBe(true)

  server(() => auth.searchParams.get('nonce')!)
  expect(await finishSignIn(redirect)).toEqual({ name: 'Ada', email: 'ada@texor.app' })
  expect(await done).toEqual({ name: 'Ada', email: 'ada@texor.app' })
  expect(accountFor('p1')?.email).toBe('ada@texor.app')
  expect(accountFor('p2')).toBeNull()

  await signOut('p1')
  expect(accountFor('p1')).toBeNull()
  const revoke = fetch.mock.calls.find(([u]) => u === `${ISSUER}/token/revocation`)
  expect(new URLSearchParams(String(revoke?.[1]?.body)).get('token')).toBe('rt')
  expect(cookies.remove).toHaveBeenCalledWith('https://texor.app/', 'texor_sid')
})

test('rejects an ID token minted for another sign-in, and unknown states', async () => {
  const { url, done } = beginSignIn('p1')
  const auth = new URL(url)
  server(() => 'someone-elses-nonce')
  const redirect = `${auth.searchParams.get('redirect_uri')}?code=c&state=${auth.searchParams.get('state')}`
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await finishSignIn(redirect)).toBeNull()
  expect(await done).toBeNull()
  expect(accountFor('p1')).toBeNull()
  // Replaying the same redirect does nothing: the sign-in is used up.
  expect(await finishSignIn(redirect)).toBeNull()
  expect(isSignInRedirect('https://accounts.texor.app/browser/signed-in-not')).toBe(false)
})
