import type { Input } from 'electron'
import type { Command, FocusUrl } from '../shared/ipc'

export type Shortcut = Command | ({ type: 'focusUrl' } & FocusUrl)

/** Map a keydown to a browser shortcut. Cmd on macOS, Ctrl on Windows; Ctrl+Tab on both. */
export function shortcutFor(
  input: Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'shift' | 'alt'>,
  platform: string
): Shortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const key = input.key.toLowerCase()
  if (input.control && key === 'tab') return { type: 'cycle', delta: input.shift ? -1 : 1 }
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!mod) return null
  if (input.shift) return key === 't' ? { type: 'reopen' } : null
  if (/^[1-9]$/.test(key)) return { type: 'select', index: key === '9' ? -1 : Number(key) - 1 }
  switch (key) {
    case 't':
      return { type: 'focusUrl', newTab: true }
    case 'l':
      return { type: 'focusUrl', newTab: false }
    case 'w':
      return { type: 'close' }
    case 'r':
      return { type: 'reload' }
    case '[':
      return { type: 'back' }
    case ']':
      return { type: 'forward' }
  }
  return null
}
