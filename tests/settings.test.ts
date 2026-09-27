import { expect, test } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/main/settings'
import { isInternalRequest } from '../src/shared/ipc'

test('settings sanitize: keeps valid values, drops everything else', () => {
  const s = sanitizeSettings({
    searchEngine: 'duckduckgo',
    archiveAfterHours: 24,
    blocker: false,
    appearance: 'dark',
    blockerAllowlist: ['news.example.com', '<script>', 42],
    zoom: { 'a.com': 1.25, 'b.com': 99, 'bad host!': 1.5 },
    permissions: {
      'https://a.com': { camera: 'allow', microphone: 'maybe', rootkit: 'allow' },
      'file:///etc': { camera: 'allow' },
      'javascript:alert(1)': { camera: 'allow' }
    }
  })
  expect(s).toEqual({
    searchEngine: 'duckduckgo',
    archiveAfterHours: 24,
    blocker: false,
    appearance: 'dark',
    blockerAllowlist: ['news.example.com'],
    zoom: { 'a.com': 1.25 },
    permissions: { 'https://a.com': { camera: 'allow' } }
  })
})

test('settings sanitize: garbage falls back to defaults', () => {
  expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
  expect(
    sanitizeSettings({ searchEngine: 'evil', appearance: 'neon', archiveAfterHours: -5 })
  ).toEqual(DEFAULT_SETTINGS)
})

test('internal page requests are shape-checked', () => {
  expect(isInternalRequest({ method: 'historySearch', query: 'x', limit: 50 })).toBe(true)
  expect(isInternalRequest({ method: 'historySearch', query: 'x', limit: 100000 })).toBe(false)
  expect(isInternalRequest({ method: 'setSettings', patch: { blocker: true } })).toBe(true)
  expect(isInternalRequest({ method: 'setSettings', patch: { searchEngine: 'evil' } })).toBe(false)
  expect(isInternalRequest({ method: 'setSettings', patch: { appearance: 'neon' } })).toBe(false)
  expect(isInternalRequest({ method: 'readFile', path: '/etc/passwd' })).toBe(false)
  expect(isInternalRequest(null)).toBe(false)
})
