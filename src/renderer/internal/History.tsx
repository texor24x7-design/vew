import { useEffect, useState } from 'react'
import { Globe, Search, X } from 'lucide-react'
import type { HistoryEntry } from '../../shared/ipc'
import { displayHost } from '../../shared/url'
import { button, call, muted } from './api'

const PAGE = 100

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function HistoryPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [more, setMore] = useState(false)

  // Fresh results for each query (debounced); "Load more" pages back in time.
  useEffect(() => {
    let current = true
    const timer = setTimeout(async () => {
      const page = await call<HistoryEntry[]>({ method: 'historySearch', query, limit: PAGE })
      if (!current) return
      setItems(page)
      setMore(page.length === PAGE)
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  const loadMore = async (): Promise<void> => {
    const before = items.at(-1)?.lastVisit
    const page = await call<HistoryEntry[]>({ method: 'historySearch', query, limit: PAGE, before })
    setItems([...items, ...page])
    setMore(page.length === PAGE)
  }

  const groups: { day: string; entries: HistoryEntry[] }[] = []
  for (const entry of items) {
    const day = dayLabel(entry.lastVisit)
    if (groups.at(-1)?.day !== day) groups.push({ day, entries: [] })
    groups.at(-1)!.entries.push(entry)
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">History</h1>
        <button
          className={button}
          onClick={async () => {
            if (await call<boolean>({ method: 'historyClear' })) setItems([])
          }}
        >
          Clear history…
        </button>
      </header>
      <label className="mb-6 flex h-10 items-center gap-2 rounded-lg bg-black/5 px-3 dark:bg-white/10">
        <Search size={16} strokeWidth={1.5} className={muted} />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history"
          aria-label="Search history"
          className="h-full flex-1 bg-transparent outline-none"
        />
      </label>
      {!items.length && (
        <p className={`py-16 text-center ${muted}`}>
          {query ? 'No matches.' : 'Pages you visit will show up here.'}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.day} className="mb-6">
          <h2 className={`mb-1 px-2 text-[12px] font-medium ${muted}`}>{g.day}</h2>
          <ul>
            {g.entries.map((h) => (
              <li
                key={h.url}
                className="group flex h-10 items-center gap-3 rounded-lg px-2 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span className={`w-14 shrink-0 text-[12px] tabular-nums ${muted}`}>
                  {new Date(h.lastVisit).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </span>
                <Globe size={16} strokeWidth={1.5} className={`shrink-0 ${muted}`} />
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  title={h.url}
                  onClick={() => call({ method: 'open', url: h.url })}
                >
                  {h.title || displayHost(h.url)}
                  <span className={`ml-2 text-[12px] ${muted}`}>{displayHost(h.url)}</span>
                </button>
                <button
                  aria-label={`Remove ${h.title || h.url} from history`}
                  className="grid size-7 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/10 focus:opacity-100 dark:hover:bg-white/15"
                  onClick={async () => {
                    await call({ method: 'historyDelete', url: h.url })
                    setItems(items.filter((i) => i.url !== h.url))
                  }}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <div className="flex justify-center">
          <button className={button} onClick={loadMore}>
            Load more
          </button>
        </div>
      )}
    </main>
  )
}
