import { expect, test } from 'vitest'
import { tabsToDiscard, type DiscardCandidate } from '../src/main/discard'

const tab = (
  id: number,
  lastActive: number,
  extra: Partial<DiscardCandidate> = {}
): DiscardCandidate => ({
  id,
  lastActive,
  loaded: true,
  visible: false,
  busy: false,
  ...extra
})

test('idle background tabs are discarded; recent ones stay', () => {
  const now = 1_000_000
  expect(
    tabsToDiscard([tab(1, now - 10), tab(2, now - 100), tab(3, now - 5)], now, 50, 10)
  ).toEqual([2])
})

test('beyond the cap, the least recently used background tabs go first', () => {
  const now = 1000
  const tabs = Array.from({ length: 8 }, (_, i) => tab(i + 1, now - i)) // 1 is the most recent
  expect(tabsToDiscard(tabs, now, 1e9, 5).sort()).toEqual([6, 7, 8])
})

test('visible, busy and already-unloaded tabs are never picked', () => {
  const now = 1e6
  const tabs = [
    tab(1, 0, { visible: true }),
    tab(2, 0, { busy: true }),
    tab(3, 0, { loaded: false }),
    tab(4, 0)
  ]
  expect(tabsToDiscard(tabs, now, 10, 0)).toEqual([4])
})
