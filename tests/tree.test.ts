import { expect, test } from 'vitest'
import { move, tabsInOrder, type Folder, type Node, type Tab, type Zones } from '../src/main/tree'

const tab = (id: number): Tab => ({
  kind: 'tab',
  id,
  url: `u${id}`,
  title: `t${id}`,
  profileId: 'default',
  loading: false,
  lastActive: 0,
  view: null
})
const folder = (id: number, children: Node[] = []): Folder => ({
  kind: 'folder',
  id,
  name: `f${id}`,
  open: true,
  children
})
const ids = (list: Node[]): number[] => list.map((n) => n.id)
const setup = (): Zones => ({
  favorites: [tab(1)],
  pinned: [folder(10, [tab(2)]), tab(3)],
  today: [tab(4), tab(5), tab(6)]
})

test('reorder within a list, forward and backward', () => {
  const z = setup()
  expect(move(z, 4, { zone: 'today', parent: null, index: 3 })).toBe(true)
  expect(ids(z.today)).toEqual([5, 6, 4])
  expect(move(z, 4, { zone: 'today', parent: null, index: 0 })).toBe(true)
  expect(ids(z.today)).toEqual([4, 5, 6])
})

test('today → pinned, → folder, → favorites', () => {
  const z = setup()
  move(z, 4, { zone: 'pinned', parent: null, index: 0 })
  move(z, 5, { zone: 'pinned', parent: 10, index: 1 })
  move(z, 6, { zone: 'favorites', parent: null, index: 0 })
  expect(ids(z.pinned)).toEqual([4, 10, 3])
  expect(ids((z.pinned[1] as Folder).children)).toEqual([2, 5])
  expect(ids(z.favorites)).toEqual([6, 1])
  expect(z.today).toEqual([])
})

test('folders only live in pinned', () => {
  const z = setup()
  expect(move(z, 10, { zone: 'today', parent: null, index: 0 })).toBe(false)
  expect(move(z, 10, { zone: 'favorites', parent: null, index: 0 })).toBe(false)
  expect(ids(z.pinned)).toEqual([10, 3])
})

test('folders nest exactly one level', () => {
  const z = setup()
  z.pinned.push(folder(11), folder(12))
  expect(move(z, 11, { zone: 'pinned', parent: 10, index: 0 })).toBe(true) // subfolder: ok
  expect(move(z, 12, { zone: 'pinned', parent: 11, index: 0 })).toBe(false) // sub-subfolder: no
  expect(move(z, 10, { zone: 'pinned', parent: 12, index: 0 })).toBe(false) // folder with subfolder into folder: no
  expect(move(z, 4, { zone: 'pinned', parent: 11, index: 0 })).toBe(true) // tab into subfolder: ok
})

test('a folder cannot move into itself', () => {
  const z = setup()
  expect(move(z, 10, { zone: 'pinned', parent: 10, index: 0 })).toBe(false)
})

test('tabs into a non-pinned parent or unknown ids are rejected', () => {
  const z = setup()
  expect(move(z, 4, { zone: 'pinned', parent: 99, index: 0 })).toBe(false)
  expect(move(z, 99, { zone: 'today', parent: null, index: 0 })).toBe(false)
})

test('tabsInOrder follows the sidebar: favorites, pinned depth-first, today', () => {
  expect(ids(tabsInOrder(setup()))).toEqual([1, 2, 3, 4, 5, 6])
})
