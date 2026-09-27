import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { History, Search, Sparkles } from 'lucide-react'
import type {
  Command as VewCommand,
  PaletteData,
  PaletteHistory,
  PaletteTab
} from '../../shared/ipc'
import { rank, searchable, type Searchable } from '../../shared/fuzzy'
import { iconText } from '../../shared/theme'
import { displayHost, looksLikeUrl } from '../../shared/url'
import type { OverlayApi } from '../../preload/overlay'
import { Favicon, icon } from '../shared/ui'

// The overlay has its own preload; the shell's global `window.vew` typing doesn't apply here.
const vew = (window as unknown as { vew: OverlayApi }).vew
const isMac = new URLSearchParams(location.search).get('platform') === 'darwin'
const MOD = isMac ? '⌘' : 'Ctrl+'
const SHIFT = isMac ? '⇧' : 'Shift+'

interface Action {
  id: string
  title: string
  /** Extra words to match on (searched like a URL). */
  url: string
  hint?: string
  command: VewCommand
}

const ACTIONS: Action[] = [
  { id: 'new-space', title: 'New Space', url: 'create add space', command: { type: 'newSpace' } },
  {
    id: 'copy-url',
    title: 'Copy URL',
    url: 'link clipboard share',
    hint: `${MOD}${SHIFT}C`,
    command: { type: 'copyUrl' }
  },
  {
    id: 'dark',
    title: 'Toggle dark mode',
    url: 'theme appearance light',
    command: { type: 'toggleDarkMode' }
  },
  {
    id: 'clear-history',
    title: 'Clear history',
    url: 'delete browsing data',
    command: { type: 'clearHistory' }
  },
  {
    id: 'sidebar',
    title: 'Toggle sidebar',
    url: 'hide show collapse',
    hint: `${MOD}S`,
    command: { type: 'toggleSidebar' }
  },
  {
    id: 'reopen',
    title: 'Reopen closed tab',
    url: 'undo restore',
    hint: `${MOD}${SHIFT}T`,
    command: { type: 'reopen' }
  },
  {
    id: 'close',
    title: 'Close tab',
    url: 'close tab',
    hint: `${MOD}W`,
    command: { type: 'close' }
  },
  {
    id: 'reload',
    title: 'Reload page',
    url: 'refresh',
    hint: `${MOD}R`,
    command: { type: 'reload' }
  },
  { id: 'new-folder', title: 'New folder', url: 'pinned folder', command: { type: 'newFolder' } },
  {
    id: 'history',
    title: 'History',
    url: 'visited pages',
    hint: isMac ? '⌘Y' : 'Ctrl+H',
    command: { type: 'openInternal', page: 'history' }
  },
  {
    id: 'settings',
    title: 'Settings',
    url: 'preferences options',
    hint: `${MOD},`,
    command: { type: 'openInternal', page: 'settings' }
  },
  {
    id: 'find',
    title: 'Find in page',
    url: 'search text',
    hint: `${MOD}F`,
    command: { type: 'openFind' }
  },
  { id: 'print', title: 'Print', url: 'pdf', hint: `${MOD}P`, command: { type: 'print' } },
  {
    id: 'zoom-in',
    title: 'Zoom in',
    url: 'bigger larger',
    hint: `${MOD}+`,
    command: { type: 'zoom', delta: 1 }
  },
  {
    id: 'zoom-out',
    title: 'Zoom out',
    url: 'smaller',
    hint: `${MOD}−`,
    command: { type: 'zoom', delta: -1 }
  },
  {
    id: 'zoom-reset',
    title: 'Actual size',
    url: 'zoom reset 100',
    hint: `${MOD}0`,
    command: { type: 'zoom', delta: 0 }
  },
  {
    id: 'view-source',
    title: 'View page source',
    url: 'html code',
    hint: isMac ? '⌥⌘U' : 'Ctrl+Alt+U',
    command: { type: 'viewSource' }
  },
  {
    id: 'devtools',
    title: 'Developer tools',
    url: 'inspect console devtools',
    hint: isMac ? '⌥⌘I' : 'Ctrl+Alt+I',
    command: { type: 'devtools' }
  }
]

interface Row {
  value: string
  title: string
  subtitle?: string
  hint?: string
  lead: React.ReactNode
  run: () => void
}
interface Group {
  heading?: string
  rows: Row[]
}

interface Prepared {
  data: PaletteData
  tabs: Searchable<PaletteTab>[]
  bookmarks: Searchable<PaletteTab>[]
  history: Searchable<PaletteHistory>[]
  actions: Searchable<Action>[]
}

/** Done once per open: split and lowercase everything so each keystroke only scores. */
function prepare(data: PaletteData): Prepared {
  const open = new Set(data.tabs.map((t) => t.url))
  return {
    data,
    tabs: searchable(data.tabs.filter((t) => t.zone === 'today')),
    bookmarks: searchable(data.tabs.filter((t) => t.zone !== 'today')),
    history: searchable(data.history.filter((h) => !open.has(h.url))),
    actions: searchable(ACTIONS)
  }
}

const send = (cmd: VewCommand) => (): void => vew.send(cmd)

function tabRow(t: PaletteTab, activeSpaceId: number): Row {
  const elsewhere = t.spaceId !== activeSpaceId && t.zone !== 'favorites'
  return {
    value: `tab-${t.id}`,
    title: t.title,
    subtitle: elsewhere
      ? `${[iconText(t.spaceIcon), t.spaceName].filter(Boolean).join(' ')} · ${displayHost(t.url)}`
      : displayHost(t.url),
    hint: t.active ? 'Current tab' : 'Switch to tab',
    lead: <Favicon tab={t} />,
    run: send({ type: 'focusTab', id: t.id })
  }
}

/** Results for a query, grouped. Pure and synchronous: this is the per-keystroke path. */
function results(p: Prepared, query: string, suggestions: string[]): Group[] {
  const q = query.trim()
  const { data } = p
  const actionRows = (limit: number): Row[] =>
    rank(q, p.actions, limit).map((a) => ({
      value: `act-${a.id}`,
      title: a.title,
      hint: a.hint,
      lead: <Sparkles {...icon} className="shrink-0 opacity-60" />,
      run: send(a.command)
    }))

  if (!q) {
    const recent = p.tabs
      .map((s) => s.item)
      .filter((t) => !t.active)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, 5)
    return [
      { heading: 'Recent tabs', rows: recent.map((t) => tabRow(t, data.activeSpaceId)) },
      { heading: 'Actions', rows: actionRows(5) }
    ].filter((g) => g.rows.length)
  }

  const isUrl = looksLikeUrl(q)
  const go: Row = {
    value: 'go',
    title: q,
    subtitle: isUrl ? 'Open in a new tab' : `Search ${data.searchEngine}`,
    lead: isUrl ? <Favicon tab={{}} /> : <Search {...icon} className="shrink-0 opacity-60" />,
    run: send({ type: 'open', input: q })
  }
  // Tabs in the current Space come first on equal matches.
  const here = (t: PaletteTab): number => (t.spaceId === data.activeSpaceId ? 5 : 0)
  return [
    { rows: [go] },
    { heading: 'Tabs', rows: rank(q, p.tabs, 5, here).map((t) => tabRow(t, data.activeSpaceId)) },
    {
      heading: 'Pinned & Favorites',
      rows: rank(q, p.bookmarks, 4, here).map((t) => tabRow(t, data.activeSpaceId))
    },
    {
      heading: 'History',
      rows: rank(q, p.history, 6, (h) => Math.log2(1 + h.visits) * 4).map((h) => ({
        value: `hist-${h.url}`,
        title: h.title || displayHost(h.url),
        subtitle: displayHost(h.url),
        lead: <History {...icon} className="shrink-0 opacity-60" />,
        run: send({ type: 'open', input: h.url })
      }))
    },
    {
      heading: `${data.searchEngine} suggestions`,
      rows: suggestions
        .filter((s) => s.toLowerCase() !== q.toLowerCase())
        .slice(0, 4)
        .map((s) => ({
          value: `sug-${s}`,
          title: s,
          lead: <Search {...icon} className="shrink-0 opacity-60" />,
          run: send({ type: 'open', input: s })
        }))
    },
    { heading: 'Actions', rows: actionRows(4) }
  ].filter((g) => g.rows.length)
}

export function Palette(): React.JSX.Element {
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [suggested, setSuggested] = useState<{ q: string; list: string[] }>({ q: '', list: [] })
  /** Latest "open" main sent, including one that toggled the bar shut; echoed back when hidden. */
  const [seq, setSeq] = useState(0)

  // Cmd+T toggles: main always sends "open"; if the bar is showing, that means close. While it's
  // animating out, "open" brings it straight back.
  const onOpen = useEffectEvent((data: PaletteData) => {
    setSeq(data.seq)
    if (open) return setOpen(false)
    setPrepared(prepare(data))
    setQuery('')
    setSelected('')
    setSuggested({ q: '', list: [] })
    setOpen(true)
  })
  useEffect(() => vew.onOpen((data) => onOpen(data)), [])
  useEffect(() => vew.onClose(() => setOpen(false)), [])

  // Web suggestions arrive asynchronously and never hold up local results.
  useEffect(() => {
    const q = query.trim()
    if (!q || looksLikeUrl(q)) return
    const timer = setTimeout(() => {
      void vew.suggest(q).then((list) => setSuggested({ q, list }))
    }, 120)
    return () => clearTimeout(timer)
  }, [query])
  const groups = useMemo(() => {
    if (!prepared) return []
    // Keep the last suggestions while they still fit what's typed, so the list doesn't flicker.
    const q = query.trim().toLowerCase()
    const fits = suggested.q && q.startsWith(suggested.q.toLowerCase())
    return results(prepared, query, fits ? suggested.list : [])
  }, [prepared, query, suggested])
  const rows = groups.flatMap((g) => g.rows)
  // The first row is selected until the user moves; a new query resets to it.
  const current = rows.some((r) => r.value === selected) ? selected : (rows[0]?.value ?? '')

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence onExitComplete={() => vew.send({ type: 'paletteHidden', seq })}>
        {open && prepared && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 bg-black/10 dark:bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.15 }}
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <motion.div
              className="mx-auto mt-[18vh] w-[640px] max-w-[calc(100vw-32px)]"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              // Closing should feel instant: a short fixed fade, not a settling spring.
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            >
              <Command
                label="Command bar"
                shouldFilter={false}
                loop
                value={current}
                onValueChange={setSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
                className="overflow-hidden rounded-[14px] bg-white/95 text-[13px] text-neutral-900 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:bg-neutral-900/95 dark:text-neutral-100 dark:ring-white/10"
              >
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={(v) => {
                    setQuery(v)
                    setSelected('')
                  }}
                  placeholder="Search tabs, history, or type a URL…"
                  className="h-12 w-full border-b border-black/10 bg-transparent px-4 text-[15px] outline-none placeholder:text-neutral-500 dark:border-white/10 dark:placeholder:text-neutral-400"
                />
                <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5">
                  {groups.map((g, i) => (
                    <Command.Group key={g.heading ?? i} heading={g.heading}>
                      {g.rows.map((r) => (
                        <Command.Item
                          key={r.value}
                          value={r.value}
                          onSelect={() => {
                            r.run()
                            setOpen(false)
                          }}
                          className="flex h-10 cursor-default items-center gap-3 rounded-lg px-3 data-[selected=true]:bg-black/5 dark:data-[selected=true]:bg-white/10"
                        >
                          {r.lead}
                          <span className="min-w-0 flex-1 truncate">
                            {r.title}
                            {r.subtitle && (
                              <span className="ml-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                                {r.subtitle}
                              </span>
                            )}
                          </span>
                          {r.hint && (
                            <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
                              {r.hint}
                            </span>
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))}
                </Command.List>
              </Command>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
