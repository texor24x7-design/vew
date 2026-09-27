import type { SidebarState } from './ipc'

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 360
export const PAGE_INSET = 8
/** Width of the icon rail a collapsed sidebar shrinks to. */
export const RAIL_WIDTH = 52
export const PAGE_RADIUS = 10
/** Height of the Windows caption-button strip drawn by titleBarOverlay. */
export const WIN_TITLEBAR_HEIGHT = 40

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const clampSidebarWidth = (w: number): number =>
  Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)))

/** Top inset of the page card. On Windows the caption buttons sit top-right, over the page area. */
export const pageTop = (platform: string): number =>
  platform === 'win32' ? WIN_TITLEBAR_HEIGHT : PAGE_INSET

/**
 * Bounds of the page card inside a window content area of the given size. Collapsed, the sidebar leaves
 * an icon rail. While the full sidebar is revealed from the keyboard (Cmd+L, F6), the card slides right but
 * keeps its collapsed width, so the page doesn't reflow.
 */
export function pageBounds(
  width: number,
  height: number,
  platform: string,
  sidebar: SidebarState
): Rect {
  const left = sidebar.collapsed ? RAIL_WIDTH : sidebar.width
  const x = (sidebar.collapsed && sidebar.peek ? sidebar.width : left) + PAGE_INSET
  const y = pageTop(platform)
  return {
    x,
    y,
    width: Math.max(0, width - left - 2 * PAGE_INSET),
    height: Math.max(0, height - y - PAGE_INSET)
  }
}

export type SplitDirection = 'row' | 'column'
export const MAX_SPLIT = 4
/** No pane may shrink below this fraction of the split. */
export const MIN_PANE = 0.15

/** Pane rects inside the page card, separated by the same gap as the card inset. */
export function splitRects(card: Rect, direction: SplitDirection, sizes: number[]): Rect[] {
  const gap = PAGE_INSET
  const horizontal = direction === 'row'
  const total = (horizontal ? card.width : card.height) - gap * (sizes.length - 1)
  const rects: Rect[] = []
  let offset = horizontal ? card.x : card.y
  sizes.forEach((size, i) => {
    const last = i === sizes.length - 1
    const end = horizontal ? card.x + card.width : card.y + card.height
    const length = last ? end - offset : Math.round(total * size)
    rects.push(
      horizontal
        ? { x: offset, y: card.y, width: Math.max(0, length), height: card.height }
        : { x: card.x, y: offset, width: card.width, height: Math.max(0, length) }
    )
    offset += length + gap
  })
  return rects
}

/**
 * New sizes after dragging the divider after pane `index` to `position` (px along the split axis).
 * Only the two neighbouring panes change, and neither goes below MIN_PANE.
 */
export function resizeSplit(
  card: Rect,
  direction: SplitDirection,
  sizes: number[],
  index: number,
  position: number
): number[] {
  const rects = splitRects(card, direction, sizes)
  const horizontal = direction === 'row'
  const total = (horizontal ? card.width : card.height) - PAGE_INSET * (sizes.length - 1)
  const start = horizontal ? rects[index].x : rects[index].y
  const pair = sizes[index] + sizes[index + 1]
  const wanted = (position - start - PAGE_INSET / 2) / total
  const a = Math.min(pair - MIN_PANE, Math.max(MIN_PANE, wanted))
  const next = [...sizes]
  next[index] = a
  next[index + 1] = pair - a
  return next
}

export const evenSizes = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

/** The Peek card: a floating page centered over the page card, leaving room above for its toolbar. */
export const PEEK_TOOLBAR = 40
export function peekRect(card: Rect): Rect {
  const width = Math.round(Math.min(card.width - 48, Math.max(card.width * 0.8, 480)))
  const height = Math.round(card.height * 0.86) - PEEK_TOOLBAR
  return {
    x: Math.round(card.x + (card.width - width) / 2),
    y: Math.round(card.y + (card.height - height - PEEK_TOOLBAR) / 2) + PEEK_TOOLBAR,
    width,
    height
  }
}
