import { expect, test } from 'vitest'
import { isCommand } from '../src/shared/ipc'

test('accepts well-formed commands', () => {
  expect(isCommand({ type: 'open', input: 'x' })).toBe(true)
  expect(isCommand({ type: 'close' })).toBe(true)
  expect(isCommand({ type: 'reorder', id: 1, index: 0 })).toBe(true)
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
    { type: 'open', input: 'x'.repeat(10_000) }
  ]) {
    expect(isCommand(bad)).toBe(false)
  }
})
