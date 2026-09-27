export const DISCARD_IDLE_MS = 30 * 60_000
/** Background tabs kept loaded; older ones beyond this are discarded (least recently used first). */
export const MAX_LOADED_BACKGROUND = 15

export interface DiscardCandidate {
  id: number
  lastActive: number
  loaded: boolean
  /** On screen (active tab or a pane of the active split). */
  visible: boolean
  /** Playing sound, capturing media, or being debugged: never discarded. */
  busy: boolean
}

/**
 * Which tabs to discard (unload, keeping their sidebar entry): background tabs idle for `idleMs`, plus
 * the least recently used ones beyond `maxLoaded`, so memory stays bounded however many tabs are open.
 */
export function tabsToDiscard(
  tabs: DiscardCandidate[],
  now: number,
  idleMs = DISCARD_IDLE_MS,
  maxLoaded = MAX_LOADED_BACKGROUND
): number[] {
  const background = tabs
    .filter((t) => t.loaded && !t.visible && !t.busy)
    .sort((a, b) => b.lastActive - a.lastActive)
  return background.filter((t, i) => i >= maxLoaded || now - t.lastActive > idleMs).map((t) => t.id)
}
