import { expect, test } from 'vitest'
import {
  PAGE_INSET,
  RAIL_WIDTH,
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

test('collapsed sidebar leaves an icon rail; the page gets the rest', () => {
  const r = pageBounds(1280, 820, 'darwin', { ...open, collapsed: true })
  expect(r.x).toBe(RAIL_WIDTH + PAGE_INSET)
  expect(r.width).toBe(1280 - RAIL_WIDTH - 2 * PAGE_INSET)
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

import { MIN_PANE, evenSizes, peekRect, resizeSplit, splitRects } from '../src/shared/layout'

const card = { x: 248, y: 8, width: 1024, height: 720 }

test('split panes tile the card exactly, with one inset gap between them', () => {
  for (const dir of ['row', 'column'] as const) {
    for (const n of [2, 3, 4]) {
      const rects = splitRects(card, dir, evenSizes(n))
      const [pos, len] = dir === 'row' ? (['x', 'width'] as const) : (['y', 'height'] as const)
      expect(rects[0][pos]).toBe(card[pos])
      expect(rects.at(-1)![pos] + rects.at(-1)![len]).toBe(card[pos] + card[len])
      for (let i = 1; i < n; i++)
        expect(rects[i][pos] - (rects[i - 1][pos] + rects[i - 1][len])).toBe(PAGE_INSET)
    }
  }
})

test('dragging a divider moves only its two panes and respects the minimum', () => {
  const sizes = evenSizes(3)
  const moved = resizeSplit(card, 'row', sizes, 0, card.x + 500)
  expect(moved[2]).toBeCloseTo(sizes[2])
  expect(moved[0] + moved[1]).toBeCloseTo(sizes[0] + sizes[1])
  expect(moved[0]).toBeGreaterThan(sizes[0])
  const squashed = resizeSplit(card, 'row', sizes, 0, card.x - 999)
  expect(squashed[0]).toBeCloseTo(MIN_PANE)
})

test('peek card sits inside the page card with room for its toolbar', () => {
  const r = peekRect(card)
  expect(r.x).toBeGreaterThanOrEqual(card.x)
  expect(r.x + r.width).toBeLessThanOrEqual(card.x + card.width)
  expect(r.y - 40).toBeGreaterThanOrEqual(card.y)
  expect(r.y + r.height).toBeLessThanOrEqual(card.y + card.height)
})
