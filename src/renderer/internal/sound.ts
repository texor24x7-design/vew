/**
 * Onboarding sound effects and ambient music, synthesized with Web Audio (no audio files). Quiet by default, and remembered as
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
  if (value) music.stop()
  else music.start()
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

/** Hz of a note: semitones from A4. */
const hz = (semitones: number): number => 440 * 2 ** (semitones / 12)
/** Slow, dreamy chords (Fmaj7 → Am7 → Cmaj7 → Gsus4), as semitones from A4. */
const CHORDS = [
  [-28, -16, -9, -5, 0], // F2 F3 C4 E4 A4
  [-24, -12, -5, -2, 3], // A2 A3 E4 G4 C5
  [-33, -21, -9, -2, 2], // C2 C3 C4 G4 B4
  [-26, -14, -7, -2, 3] // G2 G3 D4 G4 C5
]
/** C major pentatonic, high: the occasional bell. */
const BELLS = [3, 5, 7, 10, 12, 15, 17, 19, 22]
const CHORD_SECONDS = 9

/** A long, dark reverb tail made from decaying noise. */
function reverb(a: AudioContext): ConvolverNode {
  const length = a.sampleRate * 4.5
  const impulse = a.createBuffer(2, length, a.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  }
  const node = a.createConvolver()
  node.buffer = impulse
  return node
}

/**
 * Ambient background music: detuned pads drifting through four chords, a bell now and then, all through
 * a long reverb. Fades in on start and out on stop.
 */
export const music = ((): { start: () => void; stop: () => void } => {
  let master: GainNode | null = null
  let timers: ReturnType<typeof setTimeout>[] = []
  let chord = 0

  const pad = (a: AudioContext, out: AudioNode, notes: number[], at: number): void => {
    const len = CHORD_SECONDS + 4 // overlaps the next chord: a slow crossfade
    for (const n of notes) {
      for (const detune of [-6, 6]) {
        const osc = a.createOscillator()
        const gain = a.createGain()
        osc.type = n < -20 ? 'sine' : 'triangle'
        osc.frequency.value = hz(n)
        osc.detune.value = detune
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.linearRampToValueAtTime(n < -20 ? 0.05 : 0.018, at + 3.5)
        gain.gain.linearRampToValueAtTime(0.0001, at + len)
        osc.connect(gain).connect(out)
        osc.start(at)
        osc.stop(at + len + 0.1)
      }
    }
  }
  /** A soft bell: a pentatonic note and its octave, fading into the reverb. */
  const bell = (a: AudioContext, out: AudioNode): void => {
    const t = a.currentTime
    const f = hz(BELLS[Math.floor(Math.random() * BELLS.length)])
    for (const [mult, vol] of [
      [1, 0.03],
      [2.01, 0.008]
    ]) {
      const osc = a.createOscillator()
      const gain = a.createGain()
      osc.frequency.value = f * mult
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3)
      osc.connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + 3.1)
    }
  }

  return {
    start(): void {
      const a = audio()
      if (!a || master) return
      master = a.createGain()
      master.gain.setValueAtTime(0.0001, a.currentTime)
      master.gain.exponentialRampToValueAtTime(0.9, a.currentTime + 4)
      const tone = a.createBiquadFilter()
      tone.type = 'lowpass'
      tone.frequency.value = 2200
      const wet = a.createGain()
      wet.gain.value = 0.55
      const verb = reverb(a)
      tone.connect(master)
      tone.connect(verb).connect(wet).connect(master)
      master.connect(a.destination)
      const next = (): void => {
        const ac = ctx
        if (!ac || !master) return
        pad(ac, tone, CHORDS[chord % CHORDS.length], ac.currentTime + 0.05)
        chord++
        timers.push(setTimeout(next, CHORD_SECONDS * 1000))
      }
      const bells = (): void => {
        if (!ctx || !master) return
        bell(ctx, tone)
        timers.push(setTimeout(bells, 2200 + Math.random() * 3800))
      }
      next()
      timers.push(setTimeout(bells, 2500))
    },
    stop(): void {
      const m = master
      master = null
      timers.forEach(clearTimeout)
      timers = []
      if (!m || !ctx) return
      m.gain.cancelScheduledValues(ctx.currentTime)
      m.gain.setValueAtTime(m.gain.value, ctx.currentTime)
      m.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5)
      setTimeout(() => m.disconnect(), 1600)
    }
  }
})()
