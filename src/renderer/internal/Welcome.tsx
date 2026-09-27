import { useEffect, useState } from 'react'
import texorIcon from '../../../resources/texor/accounts.png'
import type { Account, SettingsView, WelcomeState } from '../../shared/ipc'
import { PRESETS } from '../../shared/theme'
import { button, call, muted } from './api'

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'
const primary =
  'h-9 rounded-lg bg-neutral-900 px-4 text-[14px] text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
const STEPS = ['Account', 'Theme', 'Import', 'Default browser', 'Done'] as const

/** First run: sign in with Texor, pick a look, bring bookmarks and history, make Vew the default. Every step can be skipped. */
export function WelcomePage(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WelcomeState | null>(null)
  useEffect(() => {
    void call<WelcomeState>({ method: 'welcomeState' }).then(setState)
  }, [])
  const next = (): void => setStep(Math.min(step + 1, STEPS.length - 1))

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <ol className="mb-10 flex gap-2" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            aria-label={`${s}${i < step ? ' (done)' : ''}`}
            className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-neutral-900 dark:bg-white' : 'bg-black/10 dark:bg-white/15'}`}
          />
        ))}
      </ol>
      {step === 0 && (
        <SignInStep
          account={state?.account ?? null}
          onAccount={(account) => setState(state && { ...state, account })}
          onNext={next}
        />
      )}
      {step === 1 && (
        <Step title="Pick a look" lead="A theme for your first Space. You can change it any time.">
          <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Theme">
            {PRESETS.map((p) => {
              const selected = state?.colors.join() === p.colors.join()
              return (
                <button
                  key={p.name}
                  role="radio"
                  aria-checked={selected}
                  aria-label={p.name}
                  className={`h-16 rounded-xl ring-offset-2 ${selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-black/10 dark:ring-white/15'}`}
                  style={{ background: `linear-gradient(135deg, ${p.colors.join(', ')})` }}
                  onClick={async () => {
                    await call({ method: 'setColors', colors: p.colors })
                    setState(state && { ...state, colors: p.colors })
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
          title="Make Vew your default browser"
          lead="Links from other apps will open in a small Vew window."
        >
          <DefaultBrowser initial={state?.isDefaultBrowser ?? false} onNext={next} />
        </Step>
      )}
      {step === 4 && (
        <Step title="You’re all set" lead="A few keys worth knowing:">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
            {[
              [`${MOD}T`, 'Command bar: search, open, run actions'],
              [`${MOD}L`, 'Edit the address'],
              [`${MOD}S`, 'Show or hide the sidebar'],
              [isMac ? 'Ctrl+1–9' : 'Alt+1–9', 'Switch Spaces'],
              ['F6', 'Move between page and sidebar']
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[13px]">{k}</dt>
                <dd className={muted}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8">
            <button autoFocus className={primary} onClick={() => call({ method: 'welcomeDone' })}>
              Start browsing
            </button>
          </div>
        </Step>
      )}
    </main>
  )
}

function Step(props: {
  title: string
  lead: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-labelledby="step-title">
      <h1 id="step-title" className="mb-2 text-3xl font-semibold">
        {props.title}
      </h1>
      <p className={`mb-8 text-[15px] ${muted}`}>{props.lead}</p>
      {props.children}
    </section>
  )
}

function Actions(props: { onNext: () => void; label?: string; skip?: boolean }): React.JSX.Element {
  return (
    <div className="mt-8 flex gap-2">
      <button autoFocus className={primary} onClick={props.onNext}>
        {props.label ?? 'Continue'}
      </button>
      {props.skip && (
        <button className={button} onClick={props.onNext}>
          Skip
        </button>
      )}
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
    <section aria-labelledby="step-title">
      <img src={texorIcon} alt="" className="mb-6 size-14 rounded-2xl" />
      <h1 id="step-title" className="mb-2 text-3xl font-semibold">
        {account ? `Welcome, ${account.name.split(' ')[0]}` : 'Welcome to Vew'}
      </h1>
      <p className={`mb-8 text-[15px] ${muted}`}>
        {account
          ? `Signed in as ${account.email}. Finvoice, Talk and Notes are signed in too.`
          : 'Sign in with your Texor Account to use Finvoice, Talk and Notes without signing in again.'}
      </p>
      {account ? (
        <Actions onNext={props.onNext} />
      ) : (
        <div className="mt-8 flex gap-2">
          <button
            autoFocus
            className={primary}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const a = await call<Account | null>({ method: 'texorSignIn' })
                props.onAccount(a)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Waiting for sign-in…' : 'Sign in with Texor'}
          </button>
          <button className={button} onClick={props.onNext}>
            Not now
          </button>
        </div>
      )}
    </section>
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
              onClick={() => setSource(s.id)}
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
              onChange={(e) => setWhat({ ...what, bookmarks: e.target.checked })}
            />
            Bookmarks from {chosen.name} {chosen.bookmarks ? `(${chosen.bookmarks})` : '(none)'}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-blue-500"
              checked={what.history && chosen.history}
              disabled={!chosen.history}
              onChange={(e) => setWhat({ ...what, history: e.target.checked })}
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
                setBusy(true)
                try {
                  const r = await call<{ bookmarks: number; history: number }>({
                    method: 'import',
                    source: chosen.id,
                    bookmarks: what.bookmarks && chosen.bookmarks > 0,
                    history: what.history && chosen.history
                  })
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
            <button className={button} onClick={onNext}>
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
          const v = await call<SettingsView>({ method: 'makeDefaultBrowser' })
          setIsDefault(v.isDefaultBrowser)
          onNext()
        }}
      >
        Make Vew default
      </button>
      <button className={button} onClick={onNext}>
        Not now
      </button>
    </div>
  )
}
