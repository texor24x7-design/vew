/** A Space's look: a 2–3 color gradient laid over the window material at `intensity` (0–1). */
export interface Theme {
  colors: string[]
  intensity: number
}

export const PRESETS: { name: string; colors: string[] }[] = [
  { name: 'Lavender', colors: ['#c9b8ff', '#ffc9e3'] },
  { name: 'Ocean', colors: ['#8ec5fc', '#e0c3fc'] },
  { name: 'Mint', colors: ['#a8e6cf', '#dcedc1'] },
  { name: 'Peach', colors: ['#ffd3a5', '#fd6585'] },
  { name: 'Sunset', colors: ['#f6d365', '#fda085', '#f5576c'] },
  { name: 'Dusk', colors: ['#4b6cb7', '#182848'] },
  { name: 'Forest', colors: ['#134e5e', '#71b280'] },
  { name: 'Graphite', colors: ['#bdc3c7', '#2c3e50'] }
]

export const DEFAULT_THEME: Theme = { colors: PRESETS[0].colors, intensity: 0.5 }

type RGB = [number, number, number]

export const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function isTheme(v: unknown): v is Theme {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return (
    Array.isArray(t.colors) &&
    t.colors.length >= 2 &&
    t.colors.length <= 3 &&
    t.colors.every(isHexColor) &&
    typeof t.intensity === 'number' &&
    t.intensity >= 0 &&
    t.intensity <= 1
  )
}

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
/** `a` over `b` at opacity `t`. */
const over = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v * t + b[i] * (1 - t)) as RGB
const css = ([r, g, b]: RGB, alpha = 1): string =>
  `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${+alpha.toFixed(3)})`

function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two opaque colors. */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ponytail: the macOS vibrancy / Windows mica material is approximated as a flat grey; exact only on the fallback tint.
const BASE_LIGHT: RGB = [236, 236, 236]
const BASE_DARK: RGB = [30, 30, 30]
const INK_DARK: RGB = [17, 17, 17]
const INK_LIGHT: RGB = [255, 255, 255]
const AA = 4.5
const ACTIVE_ON_DARK = 0.16

export interface Palette {
  background: string
  /** Solid fallback tint, used where there is no window material. */
  base: string
  fg: string
  muted: string
  hover: string
  fill: string
  line: string
  active: string
  /** Effective intensity after any reduction needed to keep text at AA contrast. */
  intensity: number
  /** Text is dark (light-looking sidebar). */
  darkText: boolean
}

/**
 * Colors for the sidebar on top of a theme. Text is near-black or white, whichever reads better on every
 * gradient stop; if neither reaches WCAG AA the gradient is toned down until one does, so every theme passes.
 */
export function palette(theme: Theme, systemDark: boolean): Palette {
  const base = systemDark ? BASE_DARK : BASE_LIGHT
  const colors = theme.colors.map(rgb)
  const stopsAt = (i: number): RGB[] => colors.map((c) => over(c, base, i))
  const worst = (fg: RGB, stops: RGB[]): number => Math.min(...stops.map((s) => contrast(fg, s)))
  const pick = (stops: RGB[]): { ink: RGB; ratio: number } => {
    const dark = worst(INK_DARK, stops)
    // Light text must also read on the active row, whose highlight lightens the background.
    const light = worst(INK_LIGHT, [
      ...stops,
      ...stops.map((s) => over(INK_LIGHT, s, ACTIVE_ON_DARK))
    ])
    return dark >= light ? { ink: INK_DARK, ratio: dark } : { ink: INK_LIGHT, ratio: light }
  }

  let intensity = Math.min(1, Math.max(0, theme.intensity))
  let stops = stopsAt(intensity)
  let { ink, ratio } = pick(stops)
  while (ratio < AA && intensity > 0) {
    intensity = Math.max(0, intensity - 0.05)
    stops = stopsAt(intensity)
    ;({ ink, ratio } = pick(stops))
  }

  // Muted text: the faintest opacity of the ink that still meets AA on every stop.
  let mutedAlpha = 0.6
  const mutedOk = (a: number): boolean => stops.every((s) => contrast(over(ink, s, a), s) >= AA)
  while (mutedAlpha < 1 && !mutedOk(mutedAlpha)) mutedAlpha = Math.min(1, mutedAlpha + 0.05)

  const darkText = ink === INK_DARK
  return {
    background: `linear-gradient(160deg, ${colors.map((c) => css(c, intensity)).join(', ')})`,
    base: css(base),
    fg: css(ink),
    muted: css(ink, mutedAlpha),
    hover: css(ink, 0.08),
    fill: css(ink, 0.06),
    line: css(ink, 0.12),
    active: darkText ? css(INK_LIGHT, 0.75) : css(INK_LIGHT, ACTIVE_ON_DARK),
    intensity,
    darkText
  }
}

/** For tests: the contrast of translucent `fg` (an rgb(... / a) string from palette) over an opaque stop. */
export function contrastOver(fgCss: string, stop: RGB): number {
  const [r, g, b, a] = fgCss.match(/[\d.]+/g)!.map(Number)
  return contrast(over([r, g, b], stop, a), stop)
}

/** For tests: the opaque gradient stops the text actually sits on. */
export function stopsFor(theme: Theme, systemDark: boolean, intensity: number): RGB[] {
  const base = systemDark ? BASE_DARK : BASE_LIGHT
  return theme.colors.map((c) => over(rgb(c), base, intensity))
}

/** Space icons are an emoji, or `icon:<Name>` from the icon library (src/renderer/shared/spaceIcons.tsx). */
export const ICON_PREFIX = 'icon:'
/** A Space icon as plain text, for native menus and text: emoji only. */
export const iconText = (icon: string): string => (icon.startsWith(ICON_PREFIX) ? '' : icon)
