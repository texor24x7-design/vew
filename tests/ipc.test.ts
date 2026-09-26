import { expect, test } from 'vitest'
import { isCommand } from '../src/shared/ipc'

test('accepts well-formed commands', () => {
  expect(isCommand({ type: 'open', input: 'x' })).toBe(true)
  expect(isCommand({ type: 'close' })).toBe(true)
  expect(
    isCommand({ type: 'move', id: 1, where: { zone: 'pinned', parent: null, index: 0 } })
  ).toBe(true)
})

test('rejects malformed payloads', () => {
  for (const bad of [
    null,
    'open',
    {},
    { type: 'nope' },
    { type: 'toString' },
    { type: 'open', input: 1 },
    { type: 'activate', id: '1' },
    { type: 'cycle', delta: 2 },
    { type: 'open', input: 'x'.repeat(10_000) },
    { type: 'move', id: 1, where: { zone: 'elsewhere', parent: null, index: 0 } },
    { type: 'move', id: 1, where: { zone: 'today', parent: '1', index: 0 } },
    { type: 'sidebar', width: Infinity }
  ]) {
    expect(isCommand(bad)).toBe(false)
  }
})
