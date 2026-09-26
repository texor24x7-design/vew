import { expect, test } from 'vitest'
import { PAGE_INSET, SIDEBAR_WIDTH, WIN_TITLEBAR_HEIGHT, pageBounds } from '../src/shared/layout'

test('page card sits right of the sidebar with an even inset', () => {
  expect(pageBounds(1280, 820, 'darwin')).toEqual({
    x: SIDEBAR_WIDTH + PAGE_INSET,
    y: PAGE_INSET,
    width: 1280 - SIDEBAR_WIDTH - 2 * PAGE_INSET,
    height: 820 - 2 * PAGE_INSET
  })
})

test('windows leaves room for the caption buttons', () => {
  expect(pageBounds(1280, 820, 'win32').y).toBe(WIN_TITLEBAR_HEIGHT)
})

test('never negative when the window is tiny', () => {
  const r = pageBounds(100, 10, 'darwin')
  expect(r.width).toBe(0)
  expect(r.height).toBe(0)
})
