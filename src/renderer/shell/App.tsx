import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Globe, Plus, RotateCw, X } from 'lucide-react'
import type { BrowserState, TabState } from '../../shared/ipc'
import { PAGE_INSET, PAGE_RADIUS, SIDEBAR_WIDTH, pageTop } from '../../shared/layout'
import { displayHost } from '../../shared/url'

const platform = new URLSearchParams(location.search).get('platform') ?? ''
const isMac = platform === 'darwin'
const MOD = isMac ? '⌘' : 'Ctrl+'
const { send } = window.vew
const icon = { size: 16, strokeWidth: 1.5 }
const spring = { type: 'spring', stiffness: 500, damping: 40 } as const

export default function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>({ tabs: [], activeId: null })
  useEffect(() => window.vew.onState(setState), [])
  const active = state.tabs.find((t) => t.id === state.activeId)

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <div className="relative h-full text-[13px] text-neutral-800 dark:text-neutral-100">
        <aside className="flex h-full flex-col gap-2 px-2" style={{ width: SIDEBAR_WIDTH }}>
          <NavRow active={active} />
          <UrlPill active={active} />
          <button
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10"
            onClick={() => window.dispatchEvent(new CustomEvent('vew:new-tab'))}
          >
            <Plus {...icon} />
            New Tab
          </button>
          <div className="mx-2 h-px bg-black/10 dark:bg-white/10" />
          <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            <AnimatePresence initial={false}>
              {state.tabs.map((tab) => (
                <TabRow key={tab.id} tab={tab} active={tab.id === state.activeId} />
              ))}
            </AnimatePresence>
          </ul>
        </aside>
        {/* Soft shadow under the native page card, which Chromium paints on top of this. */}
        <div
          className="absolute grid place-items-center bg-white text-neutral-400 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] dark:bg-neutral-900 dark:text-neutral-500"
          style={{
            left: SIDEBAR_WIDTH + PAGE_INSET,
            top: pageTop(platform),
            right: PAGE_INSET,
            bottom: PAGE_INSET,
            borderRadius: PAGE_RADIUS
          }}
        >
          {!active && `Press ${MOD}T to open a tab`}
        </div>
      </div>
    </MotionConfig>
  )
}

function NavRow({ active }: { active?: TabState }): React.JSX.Element {
  const button =
    'grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-white/10'
  return (
    // Leaves room for the macOS traffic lights.
    <div className={`flex h-11 shrink-0 items-end justify-end gap-0.5 ${isMac ? 'pl-20' : ''}`}>
      <button
        className={button}
        aria-label="Back"
        disabled={!active?.canGoBack}
        onClick={() => send({ type: 'back' })}
      >
        <ArrowLeft {...icon} />
      </button>
      <button
        className={button}
        aria-label="Forward"
        disabled={!active?.canGoForward}
        onClick={() => send({ type: 'forward' })}
      >
        <ArrowRight {...icon} />
      </button>
      <button
        className={button}
        aria-label={active?.loading ? 'Stop' : 'Reload'}
        disabled={!active}
        onClick={() => send({ type: active?.loading ? 'stop' : 'reload' })}
      >
        {active?.loading ? <X {...icon} /> : <RotateCw {...icon} />}
      </button>
    </div>
  )
}

function UrlPill({ active }: { active?: TabState }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  // Refs mirror the mode synchronously: begin() calls focus(), whose handler runs before React re-renders.
  const newTab = useRef(false)
  const editingNow = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const begin = (openNewTab: boolean): void => {
    newTab.current = openNewTab
    editingNow.current = true
    setEditing(true)
    setDraft(openNewTab ? '' : (active?.url ?? ''))
    input.current?.focus()
    requestAnimationFrame(() => input.current?.select())
  }
  // Not left to onBlur alone: blur never fires while the window itself is unfocused.
  const end = (): void => {
    editingNow.current = false
    setEditing(false)
    input.current?.blur()
  }
  const beginFromEvent = useEffectEvent(begin)
  useEffect(() => window.vew.onFocusUrl(({ newTab }) => beginFromEvent(newTab)), [])
  useEffect(() => {
    const onNewTab = (): void => beginFromEvent(true)
    window.addEventListener('vew:new-tab', onNewTab)
    return () => window.removeEventListener('vew:new-tab', onNewTab)
  }, [])

  return (
    <input
      ref={input}
      className="h-8 shrink-0 rounded-lg bg-black/5 px-3 outline-none placeholder:text-neutral-400 focus:bg-white focus:shadow-sm focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:focus:bg-neutral-800 dark:focus:ring-white/10"
      placeholder="Search or enter URL"
      spellCheck={false}
      aria-label="Address"
      value={editing ? draft : active ? displayHost(active.url) : ''}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => !editingNow.current && begin(false)}
      onBlur={end}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) {
          send({ type: newTab.current || !active ? 'open' : 'navigate', input: draft })
          end()
        } else if (e.key === 'Escape') {
          end()
        }
      }}
    />
  )
}

function TabRow({ tab, active }: { tab: TabState; active: boolean }): React.JSX.Element {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 32 }}
      exit={{ opacity: 0, height: 0 }}
      className={`group relative flex shrink-0 cursor-default items-center gap-2 overflow-hidden rounded-lg px-2 ${
        active
          ? 'bg-white/80 shadow-sm dark:bg-white/15'
          : 'hover:bg-black/5 dark:hover:bg-white/10'
      } ${tab.loading ? 'shimmer' : ''}`}
      onClick={() => send({ type: 'activate', id: tab.id })}
      onAuxClick={(e) => e.button === 1 && send({ type: 'close', id: tab.id })}
      title={tab.title}
    >
      {tab.favicon ? (
        <img src={tab.favicon} alt="" className="size-4 shrink-0 rounded-sm" draggable={false} />
      ) : (
        <Globe {...icon} className="shrink-0 text-neutral-400" />
      )}
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <button
        className="grid size-5 shrink-0 place-items-center rounded text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/15"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          send({ type: 'close', id: tab.id })
        }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </motion.li>
  )
}
