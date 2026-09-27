import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  emptySaved,
  fromLive,
  load,
  newSavedSpace,
  sanitize,
  save,
  toLive
} from '../src/main/store'

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'vew-')), 'sidebar.json')

test('round-trips Spaces, profiles and per-Space active tabs through disk', () => {
  const s = emptySaved()
  s.profiles.push({ id: 'p-work', name: 'Work' })
  s.favorites = [
    {
      kind: 'tab',
      url: 'https://f',
      title: 'F',
      profileId: 'default',
      lastActive: 2,
      activeIn: [0, 1]
    }
  ]
  s.spaces = [
    newSavedSpace({
      pinned: [
        {
          kind: 'folder',
          name: 'Docs',
          open: false,
          children: [
            { kind: 'tab', url: 'https://a', title: 'A', profileId: 'default', lastActive: 1 }
          ]
        }
      ]
    }),
    newSavedSpace({
      name: 'Work',
      icon: '💼',
      theme: { colors: ['#000000', '#ffffff', '#ff0000'], intensity: 0.3 },
      profileId: 'p-work',
      today: [{ kind: 'tab', url: 'https://w', title: 'W', profileId: 'p-work', lastActive: 3 }]
    })
  ]
  s.activeSpace = 1
  const file = tmpFile()
  save(file, s)
  const loaded = load(file)!
  let id = 0
  const live = toLive(loaded, () => ++id)
  expect(live.spaces.map((sp) => sp.activeId)).toEqual([live.favorites[0].id, live.favorites[0].id])
  expect(live.activeSpaceId).toBe(live.spaces[1].id)
  const w = live.spaces[1].today[0]
  expect(w.kind === 'tab' && w.profileId).toBe('p-work')
  expect(fromLive(live)).toEqual({ favorites: s.favorites, spaces: s.spaces, activeSpace: 1 })
  expect(loaded.profiles).toEqual(s.profiles)
})

test('tabs without a profile inherit their Space’s (favorites: default)', () => {
  const s = sanitize({
    profiles: [{ id: 'p-work', name: 'Work' }],
    favorites: [{ url: 'https://f' }],
    spaces: [{ name: 'Work', profileId: 'p-work', today: [{ url: 'https://t' }] }]
  })
  const live = toLive(
    s,
    (() => {
      let i = 0
      return () => ++i
    })()
  )
  const t = live.spaces[0].today[0]
  const f = live.favorites[0]
  expect(t.kind === 'tab' && t.profileId).toBe('p-work')
  expect(f.kind === 'tab' && f.profileId).toBe('default')
})

test('migrates the Phase 2 single-sidebar format into one Space', () => {
  const s = sanitize({
    zones: {
      favorites: [{ kind: 'tab', url: 'https://f', active: true }],
      pinned: [{ kind: 'folder', name: 'Work', children: [{ url: 'https://p' }] }],
      today: [{ url: 'https://t' }]
    },
    sidebar: { width: 300 }
  })
  expect(s.spaces).toHaveLength(1)
  expect(s.favorites.map((n) => n.kind === 'tab' && n.activeIn)).toEqual([[0]])
  expect(s.spaces[0].pinned[0].kind).toBe('folder')
  expect(s.spaces[0].today).toHaveLength(1)
  expect(s.sidebar.width).toBe(300)
})

test('sanitize drops malformed entries and unsafe values', () => {
  const s = sanitize({
    profiles: [
      { id: '../../etc', name: 'x' },
      { id: 'ok-1', name: 'Ok' }
    ],
    favorites: [{ kind: 'folder', name: 'x', children: [] }, { url: 'https://ok' }, { url: 5 }],
    spaces: [
      {
        name: 'A',
        profileId: 'missing',
        theme: { colors: ['red', 'blue'], intensity: 9 },
        today: [null, { kind: 'folder' }]
      },
      'junk'
    ],
    activeSpace: 7,
    sidebar: { width: 9999 },
    archiveAfterHours: -1
  })
  expect(s.profiles.map((p) => p.id)).toEqual(['default', 'ok-1']) // unsafe partition name dropped
  expect(s.favorites.map((n) => n.kind === 'tab' && n.url)).toEqual(['https://ok'])
  expect(s.spaces).toHaveLength(1)
  expect(s.spaces[0].profileId).toBe('default')
  expect(s.spaces[0].theme.colors[0]).toMatch(/^#/)
  expect(s.spaces[0].today).toEqual([])
  expect(s.activeSpace).toBe(0)
  expect(s.sidebar.width).toBe(360)
  expect(s.archiveAfterHours).toBeGreaterThan(0)
})

test('a corrupt file is kept aside, not trusted', () => {
  const file = tmpFile()
  writeFileSync(file, '{not json')
  expect(load(file)).toBeNull()
  expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{not json')
})

test('splits survive a save/load round trip; broken ones are dropped', () => {
  const s = emptySaved()
  s.favorites = [] // split indexes below count Today tabs only
  s.spaces[0].today = ['a', 'b', 'c'].map((u) => ({
    kind: 'tab' as const,
    url: `https://${u}`,
    title: u,
    lastActive: 1
  }))
  s.spaces[0].splits = [
    { tabs: [2, 0], direction: 'column', sizes: [0.7, 0.3] },
    { tabs: [1, 9], direction: 'row', sizes: [0.5, 0.5] } // tab 9 doesn't exist
  ]
  let id = 100
  const live = toLive(sanitize(JSON.parse(JSON.stringify(s))), () => ++id)
  const [split] = live.spaces[0].splits
  expect(live.spaces[0].splits).toHaveLength(1)
  expect(split.tabIds).toEqual([live.spaces[0].today[2].id, live.spaces[0].today[0].id])
  expect(split).toMatchObject({ direction: 'column', sizes: [0.7, 0.3] })
  expect(fromLive(live).spaces[0].splits).toEqual([
    { tabs: [2, 0], direction: 'column', sizes: [0.7, 0.3] }
  ])
})
