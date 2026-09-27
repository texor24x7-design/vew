import { expect, test } from 'vitest'
import { PRESETS, contrast, contrastOver, palette, stopsFor, type Theme } from '../src/shared/theme'

type RGB = [number, number, number]
const rgbOf = (css: string): RGB =>
  css
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number) as RGB
/** Opaque color of a translucent rgb(... / a) layer over `stop`. */
const contrastSurface = (css: string, stop: RGB): RGB => {
  const [r, g, b, a] = css.match(/[\d.]+/g)!.map(Number)
  return [r, g, b].map((v, i) => v * a + stop[i] * (1 - a)) as RGB
}

// A deterministic spread of hostile themes on top of the presets: pure black→white, mid greys, neon.
const hostile: string[][] = [
  ['#000000', '#ffffff'],
  ['#777777', '#888888'],
  ['#ff00ff', '#00ff00', '#0000ff'],
  ['#ffff00', '#000080'],
  ['#808080', '#ff0000']
]
let seed = 7
const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
const randomHex = (): string =>
  '#' +
  Math.floor(rand() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
const randoms = Array.from({ length: 200 }, () => [
  randomHex(),
  randomHex(),
  ...(rand() > 0.5 ? [randomHex()] : [])
])

test('text meets WCAG AA (4.5:1) on every stop, for every theme, intensity and system mode', () => {
  for (const colors of [...PRESETS.map((p) => p.colors), ...hostile, ...randoms]) {
    for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
      for (const dark of [false, true]) {
        const theme: Theme = { colors, intensity }
        const p = palette(theme, dark)
        for (const stop of stopsFor(theme, dark, p.intensity)) {
          const label = `${colors} @${intensity} dark=${dark}`
          expect(contrastOver(p.fg, stop), label).toBeGreaterThanOrEqual(4.5)
          expect(contrastOver(p.muted, stop), `${label} muted`).toBeGreaterThanOrEqual(4.5)
          // Active row: the highlight is laid over the stop, then text over that.
          const activeBg = contrastSurface(p.active, stop)
          expect(contrast(rgbOf(p.fg), activeBg), `${label} active`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  }
})

test('intensity is only reduced when needed', () => {
  expect(palette({ colors: PRESETS[0].colors, intensity: 0.5 }, false).intensity).toBe(0.5)
  expect(palette({ colors: ['#000000', '#ffffff'], intensity: 1 }, false).intensity).toBeLessThan(1)
})

test('dark themes get light text', () => {
  expect(palette({ colors: ['#182848', '#134e5e'], intensity: 1 }, false).darkText).toBe(false)
  expect(palette({ colors: ['#ffd3a5', '#dcedc1'], intensity: 1 }, true).darkText).toBe(true)
})
