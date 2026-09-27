import { motion } from 'motion/react'
import accountsIcon from '../../../resources/texor/accounts.svg'
import finvoiceIcon from '../../../resources/texor/finvoice.svg'
import notesIcon from '../../../resources/texor/notes.svg'
import talkIcon from '../../../resources/texor/talk.svg'
import wordmark from '../../../resources/texor/texor-wordmark.svg?raw'
import vewMark from '../../../resources/vew-mark.svg'
import type { Account } from '../../shared/ipc'

/** The fan in Texor's "o", for accents (confetti, bookmark chips). */
const FAN = ['#FB0102', '#FA5908', '#FAA813', '#F3F21B', '#72E52E', '#4ADDB1', '#5DAFD0', '#6766CC']
const APPS = [
  { name: 'Texor Account', src: accountsIcon },
  { name: 'Finvoice', src: finvoiceIcon },
  { name: 'Talk', src: talkIcon },
  { name: 'Notes', src: notesIcon }
]
const loop = { repeat: Infinity, ease: 'easeInOut' } as const

/** "Vew by texor": the product mark with Texor's wordmark (its black follows the text color). */
export function Lockup(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5" aria-label="Vew by Texor">
      <img src={vewMark} alt="" className="size-8" />
      <span className="text-[20px] font-semibold tracking-tight">Vew</span>
      <span className="text-[12px] text-neutral-400">by</span>
      <span
        aria-hidden
        className="h-[15px] [&>svg]:h-full [&>svg]:w-auto"
        dangerouslySetInnerHTML={{
          __html: wordmark.replaceAll('fill="black"', 'fill="currentColor"')
        }}
      />
    </div>
  )
}

/** A Texor app icon on its white tile. */
function Tile(props: { src: string; size: number; label?: string }): React.JSX.Element {
  return (
    <div
      className="grid place-items-center rounded-[28%] bg-white shadow-[0_8px_24px_rgb(0_0_0/0.14)] ring-1 ring-black/5"
      style={{ width: props.size, height: props.size }}
      title={props.label}
    >
      <img src={props.src} alt={props.label ?? ''} style={{ width: props.size * 0.62 }} />
    </div>
  )
}

/** The stage behind every scene: soft blobs in the Space's theme colors, drifting. */
export function Stage(props: { colors: string[]; children: React.ReactNode }): React.JSX.Element {
  const [a, b, c = props.colors[0]] = props.colors
  const blob = (color: string, x: string[], y: string[], d: number): React.JSX.Element => (
    <motion.div
      className="absolute size-[70%] rounded-full opacity-80 blur-3xl"
      animate={{ x, y, backgroundColor: color }}
      transition={{
        x: { duration: d, ...loop, repeatType: 'mirror' },
        y: { duration: d * 1.3, ...loop, repeatType: 'mirror' },
        backgroundColor: { duration: 0.6 }
      }}
    />
  )
  return (
    <div className="relative isolate h-full min-h-[320px] overflow-hidden rounded-[28px] bg-neutral-100 dark:bg-neutral-800">
      <div className="absolute inset-0">
        {blob(a, ['-20%', '10%'], ['-20%', '5%'], 9)}
        {blob(b, ['60%', '35%'], ['50%', '20%'], 11)}
        {blob(c, ['20%', '50%'], ['70%', '40%'], 13)}
      </div>
      <div className="absolute inset-0 bg-white/25 dark:bg-black/20" />
      <div className="relative grid h-full place-items-center p-8">{props.children}</div>
    </div>
  )
}

/** Step 1: Vew at the center of the Texor family, the apps orbiting it. */
export function FamilyScene({ account }: { account: Account | null }): React.JSX.Element {
  const r = 150
  return (
    <div className="relative grid size-[380px] max-w-full place-items-center">
      <div className="absolute size-[300px] rounded-full border-2 border-dashed border-white/70" />
      <motion.div
        className="absolute size-[300px]"
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
      >
        {APPS.map((app, i) => {
          const angle = (i / APPS.length) * Math.PI * 2 - Math.PI / 2
          return (
            <motion.div
              key={app.name}
              className="absolute"
              style={{ left: r + Math.cos(angle) * r - 30, top: r + Math.sin(angle) * r - 30 }}
              animate={{ rotate: -360 }}
              transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
            >
              <Tile src={app.src} size={60} label={app.name} />
            </motion.div>
          )
        })}
      </motion.div>
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, y: [0, -6, 0] }}
        transition={{
          scale: { type: 'spring', stiffness: 260, damping: 18 },
          y: { duration: 4, ...loop }
        }}
      >
        <Tile src={vewMark} size={120} label="Vew" />
      </motion.div>
      {account && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute bottom-6 flex items-center gap-2 rounded-full bg-white/90 py-1.5 pr-4 pl-1.5 text-[13px] text-neutral-900 shadow-lg"
        >
          {account.picture ? (
            <img src={account.picture} alt="" className="size-6 rounded-full object-cover" />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-[#226DB4] text-[11px] font-semibold text-white">
              {account.name.charAt(0).toUpperCase()}
            </span>
          )}
          {account.email}
          <span className="text-emerald-600" aria-hidden>
            ✓
          </span>
        </motion.div>
      )}
    </div>
  )
}

/** Step 2: a little Vew window wearing the chosen theme, live. */
export function ThemeScene({ colors }: { colors: string[] }): React.JSX.Element {
  const bar = 'h-2 rounded-full bg-white/60'
  return (
    <motion.div
      className="flex h-[260px] w-[400px] max-w-full gap-2 rounded-[18px] p-2 shadow-2xl ring-1 ring-black/10"
      animate={{ background: `linear-gradient(135deg, ${colors.join(', ')})`, y: [0, -8, 0] }}
      transition={{ background: { duration: 0.5 }, y: { duration: 5, ...loop } }}
      style={{ transform: 'perspective(900px) rotateY(-10deg) rotateX(6deg)' }}
    >
      <div className="flex w-[118px] flex-col gap-2 p-1.5">
        <div className="flex gap-1">
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} className="size-2 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <div className="h-5 rounded-md bg-white/50" />
        <div className="grid grid-cols-3 gap-1">
          {APPS.slice(1).map((app) => (
            <div key={app.name} className="grid h-7 place-items-center rounded-md bg-white/60">
              <img src={app.src} alt="" className="size-4" />
            </div>
          ))}
        </div>
        {[80, 64, 72, 56, 68].map((w, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 rounded-md p-1 ${i === 1 ? 'bg-white/70' : ''}`}
          >
            <span className="size-2.5 rounded-sm bg-white/80" />
            <span className={bar} style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 rounded-xl bg-white p-3 shadow-md">
        <div
          className="h-16 rounded-lg"
          style={{ background: `linear-gradient(135deg, ${colors.join(', ')})`, opacity: 0.55 }}
        />
        {[90, 70, 84, 60].map((w, i) => (
          <div key={i} className="h-2 rounded-full bg-neutral-200" style={{ width: `${w}%` }} />
        ))}
      </div>
    </motion.div>
  )
}

/** Step 3: bookmarks streaming from other browsers into Vew. */
export function ImportScene({ names }: { names: string[] }): React.JSX.Element {
  const from = (names.length ? names : ['Chrome', 'Arc', 'Brave']).slice(0, 4)
  return (
    <div className="relative flex w-[400px] max-w-full items-center justify-between">
      <div className="flex flex-col gap-3">
        {from.map((name) => (
          <div
            key={name}
            className="rounded-full bg-white/90 px-4 py-2 text-[13px] font-medium text-neutral-800 shadow-md"
          >
            {name}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-24 top-1/2 h-0">
        {FAN.map((color, i) => (
          <motion.span
            key={color}
            className="absolute -top-2 left-0 flex h-4 items-center gap-1 rounded-full bg-white/95 px-1.5 shadow"
            initial={{ x: 0, opacity: 0 }}
            animate={{
              x: [0, 190],
              y: [((i % 4) - 1.5) * 34, 0],
              opacity: [0, 1, 1, 0],
              scale: [0.8, 1, 0.6]
            }}
            transition={{ duration: 2.2, delay: i * 0.35, repeat: Infinity, ease: 'easeInOut' }}
          >
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="h-1 w-6 rounded-full bg-neutral-300" />
          </motion.span>
        ))}
      </div>
      <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.1, ...loop }}>
        <Tile src={vewMark} size={96} label="Vew" />
      </motion.div>
    </div>
  )
}

/** Step 4: a link in Talk opens straight into a small Vew window. */
export function DefaultScene(): React.JSX.Element {
  const cycle = { duration: 4, repeat: Infinity, ease: 'easeInOut' } as const
  return (
    <div className="relative h-[260px] w-[400px] max-w-full">
      <div className="absolute top-4 left-0 w-[250px] rounded-2xl bg-white p-3 text-[13px] text-neutral-800 shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <img src={talkIcon} alt="" className="size-5" />
          <span className="font-medium">Talk</span>
        </div>
        <p className="mb-2">Have a look at this before the call 👀</p>
        <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-600 underline">
          notes.texor.app/plan
        </span>
      </div>
      <motion.svg
        viewBox="0 0 24 24"
        className="absolute size-6 drop-shadow"
        animate={{ left: [220, 110, 110, 220], top: [200, 112, 112, 200], scale: [1, 1, 0.8, 1] }}
        transition={{ ...cycle, times: [0, 0.3, 0.38, 1] }}
      >
        <path
          d="M4 2l16 10-7 1-3 7z"
          fill="#111"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </motion.svg>
      <motion.div
        className="absolute right-0 bottom-0 w-[210px] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10"
        animate={{ scale: [0.6, 0.6, 1, 1, 0.6], opacity: [0, 0, 1, 1, 0] }}
        transition={{ ...cycle, times: [0, 0.38, 0.5, 0.9, 1] }}
        style={{ originX: 0.2, originY: 0.1 }}
      >
        <div className="flex items-center gap-1.5 border-b border-black/5 px-2 py-1.5">
          <img src={vewMark} alt="" className="size-3.5" />
          <span className="h-1.5 w-20 rounded-full bg-neutral-200" />
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <div className="h-10 rounded-md bg-gradient-to-br from-amber-200 to-orange-300" />
          {[90, 70, 80].map((w) => (
            <div key={w} className="h-1.5 rounded-full bg-neutral-200" style={{ width: `${w}%` }} />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

/** Step 5: the keys worth knowing, bobbing, with a burst of Texor-colored confetti. */
export function DoneScene({ keys }: { keys: string[] }): React.JSX.Element {
  return (
    <div className="relative grid place-items-center">
      {Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2
        const dist = 140 + (i % 5) * 22
        return (
          <motion.span
            key={i}
            className="absolute h-2.5 w-1.5 rounded-sm"
            style={{ background: FAN[i % FAN.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist + 40,
              opacity: 0,
              rotate: 360
            }}
            transition={{ duration: 1.4, ease: 'easeOut', delay: 0.1 }}
          />
        )
      })}
      <div className="flex gap-3">
        {keys.map((k, i) => (
          <motion.kbd
            key={k}
            className="grid h-16 min-w-16 place-items-center rounded-2xl border-b-4 border-neutral-300 bg-white px-4 font-sans text-[22px] font-semibold text-neutral-800 shadow-xl"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: [0, -10, 0], opacity: 1 }}
            transition={{
              opacity: { delay: i * 0.08 },
              y: { duration: 2.4, delay: i * 0.2, ...loop }
            }}
          >
            {k}
          </motion.kbd>
        ))}
      </div>
    </div>
  )
}
