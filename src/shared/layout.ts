import type { SidebarState } from './ipc'

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 360
export const PAGE_INSET = 8
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
 * Bounds of the page card inside a window content area of the given size.
 * While peeking, the card slides right but keeps its collapsed width, so the page doesn't reflow.
 */
export function pageBounds(
  width: number,
  height: number,
  platform: string,
  sidebar: SidebarState
): Rect {
  const left = sidebar.collapsed ? 0 : sidebar.width
  const x = (sidebar.collapsed && sidebar.peek ? sidebar.width : left) + PAGE_INSET
  const y = pageTop(platform)
  return {
    x,
    y,
    width: Math.max(0, width - left - 2 * PAGE_INSET),
    height: Math.max(0, height - y - PAGE_INSET)
  }
}
