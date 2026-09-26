import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { emptySaved, fromZones, load, sanitize, save, toZones } from '../src/main/store'

test('round-trips the sidebar tree through disk, restoring the active tab', () => {
  const s = emptySaved()
  s.zones.pinned = [
    {
      kind: 'folder',
      name: 'Work',
      open: false,
      children: [{ kind: 'tab', url: 'https://a', title: 'A', lastActive: 1 }]
    }
  ]
  s.zones.favorites = [{ kind: 'tab', url: 'https://f', title: 'F', lastActive: 2, active: true }]
  s.sidebar = { width: 300, collapsed: true }
  const file = join(mkdtempSync(join(tmpdir(), 'vew-')), 'sidebar.json')
  save(file, s)
  const loaded = load(file)!
  let id = 0
  const { zones, activeId } = toZones(loaded.zones, () => ++id)
  expect(zones.favorites[0].id).toBe(activeId)
  expect(fromZones(zones, activeId)).toEqual(s.zones)
  expect(loaded.sidebar).toEqual({ width: 300, collapsed: true })
})

test('sanitize drops malformed entries and keeps folders out of favorites/today', () => {
  const s = sanitize({
    zones: {
      favorites: [{ kind: 'folder', name: 'x', children: [] }, { url: 'https://ok' }, { url: 5 }],
      today: [null, 'junk', { url: '' }],
      pinned: 'nope'
    },
    sidebar: { width: 9999 },
    archiveAfterHours: -1
  })
  expect(s.zones.favorites.map((n) => n.kind === 'tab' && n.url)).toEqual(['https://ok'])
  expect(s.zones.today).toEqual([])
  expect(s.zones.pinned).toEqual([])
  expect(s.sidebar.width).toBe(360)
  expect(s.archiveAfterHours).toBeGreaterThan(0)
})

test('a corrupt file is kept aside, not trusted', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'vew-')), 'sidebar.json')
  writeFileSync(file, '{not json')
  expect(load(file)).toBeNull()
  expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{not json')
})
