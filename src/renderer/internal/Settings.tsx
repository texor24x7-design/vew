import { useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import texorIcon from '../../../resources/texor/accounts.png'
import type { Account, ExtensionInfo, InternalRequest, SettingsView } from '../../shared/ipc'
import { button, call, muted } from './api'

type Patch = Extract<InternalRequest, { method: 'setSettings' }>['patch']

const ENGINES = [
  { value: 'google', label: 'Google' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'bing', label: 'Bing' }
] as const
const ARCHIVE = [
  { value: 6, label: 'After 6 hours' },
  { value: 12, label: 'After 12 hours' },
  { value: 24, label: 'After a day' },
  { value: 24 * 7, label: 'After a week' },
  { value: 24 * 30, label: 'After 30 days' }
]
const select =
  'h-8 rounded-md bg-black/5 px-2 text-[13px] outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/10'

function Row(props: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-14 items-center gap-4 border-b border-black/5 py-3 last:border-0 dark:border-white/10">
      <div className="flex-1">
        <div>{props.label}</div>
        {props.hint && <div className={`text-[12px] ${muted}`}>{props.hint}</div>}
      </div>
      {props.children}
    </div>
  )
}

function AccountRow(props: {
  account: Account | null
  onChange: (a: Account | null) => void
}): React.JSX.Element {
  const { account } = props
  return (
    <div className="flex min-h-16 items-center gap-3 py-3">
      <img
        src={account?.picture ?? texorIcon}
        alt=""
        className={`size-9 object-cover ${account?.picture ? 'rounded-full' : 'rounded-lg'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{account ? account.name : 'Not signed in'}</div>
        <div className={`truncate text-[12px] ${muted}`}>
          {account
            ? account.email
            : 'Sign in to use Finvoice, Talk and Notes in this profile without signing in again.'}
        </div>
      </div>
      <button
        className={button}
        onClick={async () =>
          props.onChange(
            await call<Account | null>({ method: account ? 'texorSignOut' : 'texorSignIn' })
          )
        }
      >
        {account ? 'Sign out' : 'Sign in'}
      </button>
    </div>
  )
}

function Section(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-8">
      <h2 className={`mb-1 text-[12px] font-medium tracking-wide uppercase ${muted}`}>
        {props.title}
      </h2>
      <div className="rounded-xl px-4 ring-1 ring-black/10 dark:ring-white/10">
        {props.children}
      </div>
    </section>
  )
}

export function SettingsPage(): React.JSX.Element {
  const [view, setView] = useState<SettingsView | null>(null)
  useEffect(() => {
    void call<SettingsView>({ method: 'getSettings' }).then(setView)
  }, [])
  const set = async (patch: Patch): Promise<void> =>
    setView(await call<SettingsView>({ method: 'setSettings', patch }))
  if (!view) return <main />
  const s = view.settings

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-2xl font-semibold">Settings</h1>
      <Section title="Texor Account">
        <AccountRow account={view.account} onChange={(account) => setView({ ...view, account })} />
      </Section>
      <Section title="General">
        <Row label="Search engine" hint="Used by the command bar and the address field.">
          <select
            className={select}
            aria-label="Search engine"
            value={s.searchEngine}
            onChange={(e) => set({ searchEngine: e.target.value as Patch['searchEngine'] })}
          >
            {ENGINES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Default browser"
          hint={
            view.isDefaultBrowser
              ? 'Vew opens your links.'
              : 'Links from other apps open in another browser.'
          }
        >
          {view.isDefaultBrowser ? (
            <span className={`text-[13px] ${muted}`}>Vew is your default</span>
          ) : (
            <button
              className={button}
              onClick={async () =>
                setView(await call<SettingsView>({ method: 'makeDefaultBrowser' }))
              }
            >
              Make default
            </button>
          )}
        </Row>
      </Section>
      <Section title="Tabs">
        <Row label="Archive Today tabs" hint="Unpinned tabs you haven’t used move to the Archive.">
          <select
            className={select}
            aria-label="Archive Today tabs"
            value={ARCHIVE.some((a) => a.value === s.archiveAfterHours) ? s.archiveAfterHours : ''}
            onChange={(e) => set({ archiveAfterHours: Number(e.target.value) })}
          >
            {!ARCHIVE.some((a) => a.value === s.archiveAfterHours) && (
              <option value="">After {s.archiveAfterHours} hours</option>
            )}
            {ARCHIVE.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Privacy">
        <Row
          label="Block ads and trackers"
          hint="Turn it off for one site from the lock icon in the address field."
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="Block ads and trackers"
            className="size-5 accent-blue-500"
            checked={s.blocker}
            onChange={(e) => set({ blocker: e.target.checked })}
          />
        </Row>
        <Row label="Browsing history">
          <button className={button} onClick={() => call({ method: 'historyClear' })}>
            Clear history…
          </button>
        </Row>
      </Section>
      <ExtensionsSection />
      <Section title="Appearance">
        <Row label="Theme">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex rounded-md bg-black/5 p-0.5 dark:bg-white/10"
          >
            {(['system', 'light', 'dark'] as const).map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={s.appearance === a}
                className={`h-7 rounded px-3 text-[13px] capitalize ${
                  s.appearance === a ? 'bg-white shadow-sm dark:bg-neutral-700' : ''
                }`}
                onClick={() => set({ appearance: a })}
              >
                {a}
              </button>
            ))}
          </div>
        </Row>
      </Section>
    </main>
  )
}

/** Installed extensions; add from the Chrome Web Store (link or id) or from a folder. */
function ExtensionsSection(): React.JSX.Element {
  const [list, setList] = useState<ExtensionInfo[]>([])
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void call<ExtensionInfo[]>({ method: 'extList' }).then(setList)
  }, [])
  const run = async (req: InternalRequest): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setList(await call<ExtensionInfo[]>(req))
      setSource('')
    } catch (err) {
      // Errors from main arrive as "Error invoking remote method …: Error: <message>".
      setError(String(err).replace(/^.*Error: /, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Extensions">
      {list.map((ext) => (
        <Row
          key={ext.id}
          label={`${ext.name} ${ext.version}`}
          hint={ext.unpacked ? `Unpacked · ${ext.path}` : ext.description}
        >
          <button
            className={button}
            disabled={busy}
            onClick={() => run({ method: 'extRemove', id: ext.id })}
          >
            Remove
          </button>
        </Row>
      ))}
      {!list.length && (
        <div className={`flex items-center gap-2 py-4 text-[13px] ${muted}`}>
          <Puzzle size={16} strokeWidth={1.5} /> No extensions yet.
        </div>
      )}
      <form
        className="flex items-center gap-2 border-t border-black/5 py-3 dark:border-white/10"
        onSubmit={(e) => {
          e.preventDefault()
          if (source.trim()) void run({ method: 'extInstall', source: source.trim() })
        }}
      >
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Chrome Web Store link or extension ID"
          aria-label="Chrome Web Store link or extension ID"
          className={`${select} min-w-0 flex-1`}
        />
        <button className={button} disabled={busy || !source.trim()} type="submit">
          {busy ? 'Installing…' : 'Add'}
        </button>
        <button
          className={button}
          disabled={busy}
          type="button"
          onClick={() => run({ method: 'extLoadUnpacked' })}
        >
          Load unpacked…
        </button>
      </form>
      {error && (
        <p role="alert" className="pb-3 text-[13px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </Section>
  )
}
