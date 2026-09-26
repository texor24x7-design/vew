import { expect, test } from 'vitest'
import {
  PAGE_INSET,
  WIN_TITLEBAR_HEIGHT,
  clampSidebarWidth,
  pageBounds
} from '../src/shared/layout'

const open = { width: 240, collapsed: false, peek: false }

test('page card sits right of the sidebar with an even inset', () => {
  expect(pageBounds(1280, 820, 'darwin', open)).toEqual({
    x: 240 + PAGE_INSET,
    y: PAGE_INSET,
    width: 1280 - 240 - 2 * PAGE_INSET,
    height: 820 - 2 * PAGE_INSET
  })
})

test('windows leaves room for the caption buttons', () => {
  expect(pageBounds(1280, 820, 'win32', open).y).toBe(WIN_TITLEBAR_HEIGHT)
})

test('collapsed sidebar gives the page the full width', () => {
  const r = pageBounds(1280, 820, 'darwin', { ...open, collapsed: true })
  expect(r.x).toBe(PAGE_INSET)
  expect(r.width).toBe(1280 - 2 * PAGE_INSET)
})

test('peeking slides the card right without resizing it (no reflow)', () => {
  const collapsed = pageBounds(1280, 820, 'darwin', { ...open, collapsed: true })
  const peek = pageBounds(1280, 820, 'darwin', { ...open, collapsed: true, peek: true })
  expect(peek.x).toBe(240 + PAGE_INSET)
  expect(peek.width).toBe(collapsed.width)
})

test('never negative when the window is tiny', () => {
  const r = pageBounds(100, 10, 'darwin', open)
  expect(r.width).toBe(0)
  expect(r.height).toBe(0)
})

test('sidebar width is clamped to 180–360', () => {
  expect(clampSidebarWidth(50)).toBe(180)
  expect(clampSidebarWidth(1000)).toBe(360)
  expect(clampSidebarWidth(250.4)).toBe(250)
})
