export const SIDEBAR_WIDTH = 240
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

/** Top inset of the page card. On Windows the caption buttons sit top-right, over the page area. */
export const pageTop = (platform: string): number =>
  platform === 'win32' ? WIN_TITLEBAR_HEIGHT : PAGE_INSET

/** Bounds of the page card inside a window content area of the given size. */
export function pageBounds(width: number, height: number, platform: string): Rect {
  const x = SIDEBAR_WIDTH + PAGE_INSET
  const y = pageTop(platform)
  return {
    x,
    y,
    width: Math.max(0, width - x - PAGE_INSET),
    height: Math.max(0, height - y - PAGE_INSET)
  }
}
