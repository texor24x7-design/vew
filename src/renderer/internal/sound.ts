/**
 * Onboarding sound effects, synthesized with Web Audio (no audio files). Quiet by default, and remembered as
 * muted per viewer. Every call is best-effort: no audio device, or a blocked AudioContext, just means silence.
 */
const KEY = 'vew:sound-muted'
let ctx: AudioContext | null = null
let muted = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

export const isMuted = (): boolean => muted
export function setMuted(value: boolean): void {
  muted = value
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    // private storage: stays for this page only
  }
}

function audio(): AudioContext | null {
  if (muted) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** One soft note: a quick attack and an exponential fade, like a mallet. */
function note(
  a: AudioContext,
  freq: number,
  at: number,
  length: number,
  volume: number,
  type: OscillatorType = 'sine'
): void {
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(gain).connect(a.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

export const sound = {
  /** Buttons and choices: a short, bright tick. */
  tap(): void {
    const a = audio()
    if (!a) return
    const t = a.currentTime
    note(a, 880, t, 0.08, 0.05)
    note(a, 1320, t + 0.015, 0.06, 0.02)
  },
  /** Picking something (a theme, a browser): two rising notes. */
  select(): void {
    const a = audio()
    if (!a) return
    const t = a.currentTime
    note(a, 659.25, t, 0.12, 0.05, 'triangle')
    note(a, 987.77, t + 0.06, 0.16, 0.045, 'triangle')
  },
  /** Moving between steps: a soft filtered-noise swoosh. */
  whoosh(): void {
    const a = audio()
    if (!a) return
    const t = a.currentTime
    const length = 0.35
    const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = a.createBufferSource()
    noise.buffer = buffer
    const filter = a.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.2
    filter.frequency.setValueAtTime(400, t)
    filter.frequency.exponentialRampToValueAtTime(2400, t + length)
    const gain = a.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    noise.connect(filter).connect(gain).connect(a.destination)
    noise.start(t)
    noise.stop(t + length)
  },
  /** Something worked (signed in, imported, all set): a warm major arpeggio. */
  success(): void {
    const a = audio()
    if (!a) return
    const t = a.currentTime
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      note(a, f, t + i * 0.07, 0.5, 0.05, 'sine')
      note(a, f * 2, t + i * 0.07, 0.25, 0.012, 'triangle')
    })
  }
}
