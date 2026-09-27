import type { Input } from 'electron'
import type { Command } from '../shared/ipc'

export type Shortcut = Command | { type: 'focusUrl' }

/**
 * Map a keydown to a browser shortcut. Cmd on macOS, Ctrl on Windows; Ctrl+Tab on both.
 * Spaces: Ctrl+1–9 on macOS, Alt+1–9 on Windows (where Ctrl+1–9 already selects tabs).
 */
export function shortcutFor(
  input: Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'shift' | 'alt'> & { code?: string },
  platform: string
): Shortcut | null {
  if (input.type !== 'keyDown') return null
  const spaceMod =
    platform === 'darwin'
      ? input.control && !input.meta && !input.alt
      : input.alt && !input.control && !input.meta
  if (spaceMod && !input.shift && /^[1-9]$/.test(input.key)) {
    return { type: 'selectSpace', index: Number(input.key) - 1 }
  }
  const isMac = platform === 'darwin'
  const modOnly = isMac ? input.meta && !input.control : input.control && !input.meta
  // Cmd/Ctrl+Alt: by physical key, since Option changes the typed character on macOS.
  if (modOnly && input.alt && !input.shift) {
    if (input.code === 'KeyI') return { type: 'devtools' }
    if (input.code === 'KeyU') return { type: 'viewSource' }
    return null
  }
  if (input.alt) return null
  const key = input.key.toLowerCase()
  if (input.control && key === 'tab') return { type: 'cycle', delta: input.shift ? -1 : 1 }
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!mod) return null
  if (input.shift) {
    if (key === 't') return { type: 'reopen' }
    if (key === 'c') return { type: 'copyUrl' }
    if (key === '+') return { type: 'zoom', delta: 1 } // "+" needs Shift on most layouts
    return null
  }
  if (/^[1-9]$/.test(key)) return { type: 'select', index: key === '9' ? -1 : Number(key) - 1 }
  switch (key) {
    case 't':
      return { type: 'openPalette' }
    case 's':
      return { type: 'toggleSidebar' }
    case 'f':
      return { type: 'openFind' }
    case 'p':
      return { type: 'print' }
    case '=':
    case '+':
      return { type: 'zoom', delta: 1 }
    case '-':
      return { type: 'zoom', delta: -1 }
    case '0':
      return { type: 'zoom', delta: 0 }
    case ',':
      return { type: 'openInternal', page: 'settings' }
    case 'y':
      return isMac ? { type: 'openInternal', page: 'history' } : null
    case 'h':
      return isMac ? null : { type: 'openInternal', page: 'history' }
    case 'l':
      return { type: 'focusUrl' }
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
