import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react'
import type { Account, SettingsView, WelcomeState } from '../../shared/ipc'
import { PRESETS } from '../../shared/theme'
import { button, call, muted } from './api'
import {
  DefaultScene,
  DoneScene,
  FamilyScene,
  ImportScene,
  Lockup,
  Stage,
  ThemeScene
} from './Scenes'
import { isMuted, setMuted, sound } from './sound'

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'
const primary =
  'h-10 rounded-xl bg-neutral-900 px-5 text-[14px] font-medium text-white shadow-sm transition-transform hover:bg-neutral-800 active:scale-[0.97] disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
const secondary = `${button} h-10 rounded-xl px-4 transition-transform active:scale-[0.97]`
const STEPS = ['Account', 'Theme', 'Import', 'Default browser', 'Done'] as const
const SHORTCUTS: [string, string][] = [
  [`${MOD}T`, 'Command bar: search, open, run actions'],
  [`${MOD}L`, 'Edit the address'],
  [`${MOD}S`, 'Show or hide the sidebar'],
  [isMac ? 'Ctrl+1–9' : 'Alt+1–9', 'Switch Spaces'],
  ['F6', 'Move between page and sidebar']
]

/**
 * First run, Arc-style: content on the left, a live illustration on the right (in the theme being picked).
 * Sign in with Texor, pick a look, bring bookmarks and history, make Vew the default. Every step can be skipped.
 */
export function WelcomePage(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WelcomeState | null>(null)
  const [quiet, setQuiet] = useState(isMuted())
  useEffect(() => {
    void call<WelcomeState>({ method: 'welcomeState' }).then(setState)
  }, [])
  const last = STEPS.length - 1
  const go = (to: number): void => {
    sound.whoosh()
    if (to === last) setTimeout(() => sound.success(), 180)
    setStep(to)
  }
  const next = (): void => go(Math.min(step + 1, last))
  const colors = state?.colors ?? PRESETS[0].colors

  const scenes = [
    <FamilyScene key="family" account={state?.account ?? null} />,
    <ThemeScene key="theme" colors={colors} />,
    <ImportScene key="import" names={state?.sources.map((s) => s.name) ?? []} />,
    <DefaultScene key="default" />,
    <DoneScene key="done" keys={[`${MOD}T`, `${MOD}L`, `${MOD}S`]} />
  ]

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid min-h-screen grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(360px,440px)_1fr]">
        <div className="flex flex-col px-2 lg:px-6">
          <header className="flex items-center justify-between pt-2">
            <Lockup />
            <button
              className="grid size-9 place-items-center rounded-lg text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label={quiet ? 'Turn sounds on' : 'Turn sounds off'}
              aria-pressed={!quiet}
              title={quiet ? 'Sounds off' : 'Sounds on'}
              onClick={() => {
                setMuted(!quiet)
                setQuiet(!quiet)
                if (quiet) sound.tap()
              }}
            >
              {quiet ? (
                <VolumeX size={18} strokeWidth={1.5} />
              ) : (
                <Volume2 size={18} strokeWidth={1.5} />
              )}
            </button>
          </header>

          <main className="flex flex-1 flex-col justify-center py-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {step === 0 && (
                  <SignInStep
                    account={state?.account ?? null}
                    onAccount={(account) => setState(state && { ...state, account })}
                    onNext={next}
                  />
                )}
                {step === 1 && (
                  <Step
                    title="Make it yours"
                    lead="Pick a look for your first Space. Each Space can have its own, and you can change it any time."
                  >
                    <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Theme">
                      {PRESETS.map((p) => {
                        const selected = colors.join() === p.colors.join()
                        return (
                          <motion.button
                            key={p.name}
                            role="radio"
                            aria-checked={selected}
                            aria-label={p.name}
                            title={p.name}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.94 }}
                            className={`h-14 rounded-xl ring-offset-2 dark:ring-offset-neutral-900 ${selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-black/10 dark:ring-white/15'}`}
                            style={{
                              background: `linear-gradient(135deg, ${p.colors.join(', ')})`
                            }}
                            onClick={async () => {
                              sound.select()
                              setState(state && { ...state, colors: p.colors })
                              await call({ method: 'setColors', colors: p.colors })
                            }}
                          />
                        )
                      })}
                    </div>
                    <Actions onNext={next} />
                  </Step>
                )}
                {step === 2 && <ImportStep state={state} onNext={next} />}
                {step === 3 && (
                  <Step
                    title="Make Vew your default"
                    lead="Links from Talk, Notes, email and every other app open in a small Vew window, ready to move into a Space."
                  >
                    <DefaultBrowser initial={state?.isDefaultBrowser ?? false} onNext={next} />
                  </Step>
                )}
                {step === 4 && (
                  <Step title="You’re all set" lead="A few keys worth knowing:">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[14px]">
                      {SHORTCUTS.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt>
                            <kbd className="rounded-md bg-black/5 px-1.5 py-0.5 font-sans text-[13px] font-medium dark:bg-white/10">
                              {k}
                            </kbd>
                          </dt>
                          <dd className={muted}>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-8">
                      <button
                        autoFocus
                        className={primary}
                        onClick={() => {
                          sound.tap()
                          void call({ method: 'welcomeDone' })
                        }}
                      >
                        Start browsing
                      </button>
                    </div>
                  </Step>
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          <footer className="flex h-10 items-center justify-between">
            <ol className="flex gap-1.5" aria-label="Setup steps">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s}
                  aria-current={i === step ? 'step' : undefined}
                  aria-label={`${s}${i < step ? ' (done)' : ''}`}
                  className={`h-1.5 rounded-full ${i <= step ? 'bg-neutral-900 dark:bg-white' : 'bg-black/10 dark:bg-white/15'}`}
                  animate={{ width: i === step ? 28 : 8 }}
                />
              ))}
            </ol>
            {step > 0 && step < last && (
              <button
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => go(step - 1)}
              >
                <ArrowLeft size={14} strokeWidth={1.5} /> Back
              </button>
            )}
          </footer>
        </div>

        <div className="order-first h-[42vh] lg:order-none lg:h-auto" aria-hidden>
          <Stage colors={colors}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.04, y: -16 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="grid place-items-center"
              >
                {scenes[step]}
              </motion.div>
            </AnimatePresence>
          </Stage>
        </div>
      </div>
    </MotionConfig>
  )
}

function Step(props: {
  title: string
  lead: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-labelledby="step-title">
      <h1 id="step-title" className="mb-3 text-[34px] leading-tight font-semibold tracking-tight">
        {props.title}
      </h1>
      <p className={`mb-8 text-[15px] leading-relaxed ${muted}`}>{props.lead}</p>
      {props.children}
    </section>
  )
}

function Actions(props: { onNext: () => void; label?: string }): React.JSX.Element {
  return (
    <div className="mt-8 flex gap-2">
      <button autoFocus className={primary} onClick={props.onNext}>
        {props.label ?? 'Continue'}
      </button>
    </div>
  )
}

/** Texor Account first, like a Google Account in Chrome. Optional: Vew works fully without one. */
function SignInStep(props: {
  account: Account | null
  onAccount: (a: Account | null) => void
  onNext: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const { account } = props
  return (
    <Step
      title={account ? `Welcome, ${account.name.split(' ')[0]}` : 'Welcome to Vew'}
      lead={
        account
          ? `You’re signed in as ${account.email}. Finvoice, Talk and Notes are signed in too, right from the sidebar.`
          : 'The browser for the Texor family. Sign in with your Texor Account and Finvoice, Talk and Notes are ready without signing in again.'
      }
    >
      {account ? (
        <Actions onNext={props.onNext} />
      ) : (
        <div className="mt-8 flex gap-2">
          <button
            autoFocus
            className={primary}
            disabled={busy}
            onClick={async () => {
              sound.tap()
              setBusy(true)
              try {
                const a = await call<Account | null>({ method: 'texorSignIn' })
                if (a) sound.success()
                props.onAccount(a)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Waiting for sign-in…' : 'Sign in with Texor'}
          </button>
          <button className={secondary} onClick={props.onNext}>
            Not now
          </button>
        </div>
      )}
    </Step>
  )
}

function ImportStep({
  state,
  onNext
}: {
  state: WelcomeState | null
  onNext: () => void
}): React.JSX.Element {
  const sources = state?.sources ?? []
  const [source, setSource] = useState<string | null>(null)
  const chosen = sources.find((s) => s.id === (source ?? sources[0]?.id))
  const [what, setWhat] = useState({ bookmarks: true, history: true })
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!sources.length) {
    return (
      <Step
        title="Bring your stuff"
        lead="No other browsers were found on this computer, so there’s nothing to import."
      >
        <Actions onNext={onNext} />
      </Step>
    )
  }
  return (
    <Step
      title="Bring your stuff"
      lead="Import bookmarks and history. Bookmarks become a pinned folder in this Space."
    >
      {sources.length > 1 && (
        <div role="radiogroup" aria-label="Browser" className="mb-4 flex flex-wrap gap-2">
          {sources.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={chosen?.id === s.id}
              className={`${button} ${chosen?.id === s.id ? 'bg-black/5 dark:bg-white/10' : ''}`}
              onClick={() => {
                sound.select()
                setSource(s.id)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {chosen && (
        <fieldset className="flex flex-col gap-2 text-[14px]">
          <legend className="sr-only">What to import from {chosen.name}</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-blue-500"
              checked={what.bookmarks && chosen.bookmarks > 0}
              disabled={!chosen.bookmarks}
              onChange={(e) => {
                sound.tap()
                setWhat({ ...what, bookmarks: e.target.checked })
              }}
            />
            Bookmarks from {chosen.name} {chosen.bookmarks ? `(${chosen.bookmarks})` : '(none)'}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-blue-500"
              checked={what.history && chosen.history}
              disabled={!chosen.history}
              onChange={(e) => {
                sound.tap()
                setWhat({ ...what, history: e.target.checked })
              }}
            />
            Browsing history
          </label>
        </fieldset>
      )}
      {result && (
        <p role="status" className={`mt-4 text-[14px] ${muted}`}>
          {result}
        </p>
      )}
      <div className="mt-8 flex gap-2">
        {result ? (
          <button autoFocus className={primary} onClick={onNext}>
            Continue
          </button>
        ) : (
          <>
            <button
              className={primary}
              disabled={busy || !chosen}
              onClick={async () => {
                if (!chosen) return
                sound.tap()
                setBusy(true)
                try {
                  const r = await call<{ bookmarks: number; history: number }>({
                    method: 'import',
                    source: chosen.id,
                    bookmarks: what.bookmarks && chosen.bookmarks > 0,
                    history: what.history && chosen.history
                  })
                  sound.success()
                  setResult(`Imported ${r.bookmarks} bookmarks and ${r.history} history entries.`)
                } catch (err) {
                  setResult(`Import didn’t work: ${String(err).replace(/^.*Error: /, '')}`)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button className={secondary} onClick={onNext}>
              Skip
            </button>
          </>
        )}
      </div>
    </Step>
  )
}

function DefaultBrowser({
  initial,
  onNext
}: {
  initial: boolean
  onNext: () => void
}): React.JSX.Element {
  const [isDefault, setIsDefault] = useState(initial)
  if (isDefault) return <Actions onNext={onNext} />
  return (
    <div className="mt-8 flex gap-2">
      <button
        autoFocus
        className={primary}
        onClick={async () => {
          sound.tap()
          const v = await call<SettingsView>({ method: 'makeDefaultBrowser' })
          if (v.isDefaultBrowser) sound.success()
          setIsDefault(v.isDefaultBrowser)
          onNext()
        }}
      >
        Make Vew default
      </button>
      <button className={secondary} onClick={onNext}>
        Not now
      </button>
    </div>
  )
}
