import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { History } from '../src/main/history'

test('records visits, counts repeats, keeps titles, orders by recency, clears', () => {
  const h = new History(join(mkdtempSync(join(tmpdir(), 'vew-')), 'history.db'))
  h.visit('https://a.com/', 'A', 1)
  h.visit('https://b.com/', '', 2)
  h.visit('https://a.com/', '', 3) // revisit without a title keeps the old one
  h.setTitle('https://b.com/', 'B')
  h.visit('about:blank', 'x', 4) // not recorded
  h.visit('file:///etc/passwd', 'x', 5) // not recorded
  expect(h.recent()).toEqual([
    { url: 'https://a.com/', title: 'A', visits: 2, lastVisit: 3 },
    { url: 'https://b.com/', title: 'B', visits: 1, lastVisit: 2 }
  ])
  expect(h.search('b', 10).map((i) => i.url)).toEqual(['https://b.com/'])
  expect(h.search('', 1).map((i) => i.url)).toEqual(['https://a.com/'])
  expect(h.search('', 10, 3).map((i) => i.url)).toEqual(['https://b.com/']) // paging by time
  expect(h.search('100%_', 10)).toEqual([]) // LIKE wildcards in the query are literal
  h.delete('https://a.com/')
  expect(h.recent().map((i) => i.url)).toEqual(['https://b.com/'])
  h.clear()
  expect(h.recent()).toEqual([])
  h.close()
})
