import { expect, test } from 'vitest'
import { fuzzyScore, rank, searchable } from '../src/shared/fuzzy'

test('substring, word-start and prefix matches rank above scattered ones', () => {
  expect(fuzzyScore('git', 'github.com')).toBeGreaterThan(fuzzyScore('git', 'digital things'))
  expect(fuzzyScore('hub', 'GitHub Issues')).toBeGreaterThan(0)
  expect(fuzzyScore('gh iss', 'github.com/vew/issues')).toBeGreaterThan(0) // every term must match
  expect(fuzzyScore('gh zzz', 'github.com/vew/issues')).toBe(0)
  expect(fuzzyScore('ytb', 'YouTube')).toBeGreaterThan(0) // subsequence on word parts
  expect(fuzzyScore('oe', 'github.com/some/long/path')).toBe(0) // scattered mid-word letters: noise
  expect(fuzzyScore('slp', 'github.com/some/long/path')).toBeGreaterThan(0) // word-start acronym: a match
})

test('rank prefers title/url matches and keeps input order on ties', () => {
  const items = [
    { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { title: 'React docs', url: 'https://react.dev' },
    { title: 'Reactions', url: 'https://example.com/reactions' }
  ]
  expect(rank('react', searchable(items), 5).map((i) => i.title)).toEqual([
    'React docs',
    'Reactions'
  ])
  expect(rank('', searchable(items), 5)).toHaveLength(3)
})

test('ranking 5,000 history entries stays well inside a 16ms frame per keystroke', () => {
  const words = [
    'react',
    'docs',
    'github',
    'news',
    'mail',
    'calendar',
    'rust',
    'vite',
    'issues',
    'pull',
    'maps',
    'weather'
  ]
  let seed = 1
  const pick = (): string => words[(seed = (seed * 16807) % 2147483647) % words.length]
  const items = Array.from({ length: 5000 }, (_, i) => ({
    title: `${pick()} ${pick()} — ${pick()} page ${i}`,
    url: `https://www.${pick()}.com/${pick()}/${pick()}/${i}?ref=${pick()}`
  }))
  const prepared = searchable(items) // done once when the bar opens
  rank('warm', prepared, 8) // JIT warm-up, not a keystroke the user sees
  const times: number[] = []
  for (const query of [
    'g',
    'gi',
    'git',
    'gith',
    'githu',
    'github',
    'github i',
    'github is',
    'github iss',
    'r',
    're',
    'rea',
    'reac',
    'react d',
    'zzz'
  ]) {
    // Best of 3: measures the ranking itself, not a parallel test worker preempting it.
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now()
      rank(query, prepared, 8)
      best = Math.min(best, performance.now() - t0)
    }
    times.push(best)
  }
  times.sort((a, b) => a - b)
  expect(times[Math.floor(times.length / 2)]).toBeLessThan(8) // median
  expect(times.at(-1)!).toBeLessThan(16) // worst keystroke
})
