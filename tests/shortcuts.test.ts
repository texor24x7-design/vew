import { expect, test } from 'vitest'
import { shortcutFor } from '../src/main/shortcuts'

const key = (
  k: string,
  mods: Partial<Record<'meta' | 'control' | 'shift' | 'alt', boolean>> = {}
) => ({
  type: 'keyDown' as const,
  key: k,
  meta: false,
  control: false,
  shift: false,
  alt: false,
  ...mods
})

for (const [platform, mod] of [
  ['darwin', 'meta'],
  ['win32', 'control']
] as const) {
  test(`${platform} shortcuts`, () => {
    const m = { [mod]: true }
    expect(shortcutFor(key('t', m), platform)).toEqual({ type: 'openPalette' })
    expect(shortcutFor(key('l', m), platform)).toEqual({ type: 'focusUrl' })
    expect(shortcutFor(key('w', m), platform)).toEqual({ type: 'close' })
    expect(shortcutFor(key('r', m), platform)).toEqual({ type: 'reload' })
    expect(shortcutFor(key('[', m), platform)).toEqual({ type: 'back' })
    expect(shortcutFor(key(']', m), platform)).toEqual({ type: 'forward' })
    expect(shortcutFor(key('s', m), platform)).toEqual({ type: 'toggleSidebar' })
    expect(shortcutFor(key('T', { ...m, shift: true }), platform)).toEqual({ type: 'reopen' })
    expect(shortcutFor(key('C', { ...m, shift: true }), platform)).toEqual({ type: 'copyUrl' })
    expect(shortcutFor(key('3', m), platform)).toEqual({ type: 'select', index: 2 })
    expect(shortcutFor(key('9', m), platform)).toEqual({ type: 'select', index: -1 })
    expect(shortcutFor(key('Tab', { control: true }), platform)).toEqual({
      type: 'cycle',
      delta: 1
    })
    expect(shortcutFor(key('Tab', { control: true, shift: true }), platform)).toEqual({
      type: 'cycle',
      delta: -1
    })
    expect(shortcutFor(key('t'), platform)).toBeNull()
    expect(shortcutFor({ ...key('t', m), type: 'keyUp' }, platform)).toBeNull()
  })
}

test('space shortcuts: Ctrl+digit on macOS, Alt+digit on Windows', () => {
  expect(shortcutFor(key('2', { control: true }), 'darwin')).toEqual({
    type: 'selectSpace',
    index: 1
  })
  expect(shortcutFor(key('2', { alt: true }), 'win32')).toEqual({ type: 'selectSpace', index: 1 })
  // On Windows Ctrl+digit stays tab selection; on macOS Alt+digit is left for typing.
  expect(shortcutFor(key('2', { control: true }), 'win32')).toEqual({ type: 'select', index: 1 })
  expect(shortcutFor(key('2', { alt: true }), 'darwin')).toBeNull()
})

test('browser essentials shortcuts on both platforms', () => {
  for (const [platform, mod] of [
    ['darwin', 'meta'],
    ['win32', 'control']
  ] as const) {
    const m = { [mod]: true }
    expect(shortcutFor(key('f', m), platform)).toEqual({ type: 'openFind' })
    expect(shortcutFor(key('p', m), platform)).toEqual({ type: 'print' })
    expect(shortcutFor(key('=', m), platform)).toEqual({ type: 'zoom', delta: 1 })
    expect(shortcutFor(key('+', { ...m, shift: true }), platform)).toEqual({
      type: 'zoom',
      delta: 1
    })
    expect(shortcutFor(key('-', m), platform)).toEqual({ type: 'zoom', delta: -1 })
    expect(shortcutFor(key('0', m), platform)).toEqual({ type: 'zoom', delta: 0 })
    expect(shortcutFor(key(',', m), platform)).toEqual({ type: 'openInternal', page: 'settings' })
    // Option/Alt changes the character on macOS, so match the physical key.
    expect(shortcutFor({ ...key('ˆ', { ...m, alt: true }), code: 'KeyI' }, platform)).toEqual({
      type: 'devtools'
    })
    expect(shortcutFor({ ...key('ü', { ...m, alt: true }), code: 'KeyU' }, platform)).toEqual({
      type: 'viewSource'
    })
  }
  expect(shortcutFor(key('y', { meta: true }), 'darwin')).toEqual({
    type: 'openInternal',
    page: 'history'
  })
  expect(shortcutFor(key('h', { control: true }), 'win32')).toEqual({
    type: 'openInternal',
    page: 'history'
  })
  expect(shortcutFor(key('h', { meta: true }), 'darwin')).toBeNull() // Cmd+H is "Hide" on macOS
})

test('F6 cycles focus between page and sidebar on both platforms', () => {
  expect(shortcutFor(key('F6'), 'darwin')).toEqual({ type: 'cycleFocus' })
  expect(shortcutFor(key('F6', { shift: true }), 'win32')).toEqual({ type: 'cycleFocus' })
})

test('the other platform’s modifier does nothing', () => {
  expect(shortcutFor(key('w', { control: true }), 'darwin')).toBeNull()
  expect(shortcutFor(key('w', { meta: true }), 'win32')).toBeNull()
})
