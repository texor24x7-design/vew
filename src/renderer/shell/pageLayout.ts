import { useSyncExternalStore } from 'react'
import type { BrowserState } from '../../shared/ipc'
import { pageBounds, splitRects, type Rect } from '../../shared/layout'

export const platform = new URLSearchParams(location.search).get('platform') ?? ''

const subscribe = (cb: () => void): (() => void) => {
  addEventListener('resize', cb)
  return () => removeEventListener('resize', cb)
}
let size = { w: innerWidth, h: innerHeight }
const getSize = (): typeof size => {
  if (size.w !== innerWidth || size.h !== innerHeight) size = { w: innerWidth, h: innerHeight }
  return size
}

/** The page card and split panes, computed exactly as main lays out the native views. */
export function usePageLayout(state: BrowserState): {
  card: Rect
  panes: { id: number; rect: Rect }[]
} {
  const { w, h } = useSyncExternalStore(subscribe, getSize)
  const card = pageBounds(w, h, platform, state.sidebar)
  const { split, activeId } = state
  const panes = split
    ? splitRects(card, split.direction, split.sizes).map((rect, i) => ({
        id: split.tabIds[i],
        rect
      }))
    : activeId === null
      ? []
      : [{ id: activeId, rect: card }]
  return { card, panes }
}
