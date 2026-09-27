import type { InternalApi } from '../../preload/internal'

export const { call } = (window as unknown as { vew: InternalApi }).vew

export const muted = 'text-neutral-500 dark:text-neutral-400'
export const button =
  'h-8 rounded-md px-3 text-[13px] ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10'
