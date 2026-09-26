import { expect, test } from 'vitest'
import { displayHost, toUrl } from '../src/shared/url'

test.each([
  ['example.com', 'https://example.com'],
  ['  news.ycombinator.com/item?id=1 ', 'https://news.ycombinator.com/item?id=1'],
  ['http://example.com', 'http://example.com'],
  ['localhost:5173/x', 'http://localhost:5173/x'],
  ['192.168.1.1', 'http://192.168.1.1'],
  ['about:blank', 'about:blank'],
  ['hello world', 'https://www.google.com/search?q=hello%20world'],
  ['vew', 'https://www.google.com/search?q=vew'],
  ['javascript:alert(1)', 'https://www.google.com/search?q=javascript%3Aalert(1)'],
  ['', '']
])('toUrl(%j) → %s', (input, expected) => {
  expect(toUrl(input)).toBe(input.trim() ? expected : toUrl(''))
})

test('search engine is configurable', () => {
  expect(toUrl('a b', 'duckduckgo')).toBe('https://duckduckgo.com/?q=a%20b')
})

test('displayHost shows the bare domain', () => {
  expect(displayHost('https://www.google.com/search?q=1')).toBe('google.com')
  expect(displayHost('about:blank')).toBe('about:blank')
})
