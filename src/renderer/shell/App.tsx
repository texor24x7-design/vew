import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Archive, ArrowLeft, ArrowRight, PanelLeft, RotateCw, X } from 'lucide-react'
import { EMPTY_STATE, type BrowserState, type TabState } from '../../shared/ipc'
import { PAGE_INSET, PAGE_RADIUS, SIDEBAR_DEFAULT_WIDTH, pageTop } from '../../shared/layout'
import { DEFAULT_THEME, palette } from '../../shared/theme'
import { displayHost } from '../../shared/url'
import { ArchiveList, Tabs, findNode, icon } from './Sidebar'
import { SpaceEditor, SpaceSwitcher, themeVars, useSpaceSwipe, useSystemDark } from './Spaces'

const platform = new URLSearchParams(location.search).get('platform') ?? ''
const isMac = platform === 'darwin'
const hasMaterial = new URLSearchParams(location.search).get('material') !== '0'
const MOD = isMac ? '⌘' : 'Ctrl+'
const { send } = window.vew
const spring = { type: 'spring', stiffness: 500, damping: 40 } as const

export default function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  useEffect(() => window.vew.onState(setState), [])
  const [showArchive, setShowArchive] = useState(false)
  const systemDark = useSystemDark()
  const onWheel = useSpaceSwipe()
  const { sidebar } = state
  const space = state.spaces.find((sp) => sp.id === state.activeSpaceId)
  const colors = palette(space?.theme ?? DEFAULT_THEME, systemDark)

  // Main asks for the editor once (new Space / "Edit Space…"); after that it's local state.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [seenEditId, setSeenEditId] = useState<number | null>(null)
  if (state.editSpaceId !== seenEditId) {
    setSeenEditId(state.editSpaceId)
    if (state.editSpaceId !== null) {
      setEditingId(state.editSpaceId)
      setShowArchive(false)
    }
  }
  const editing = editingId !== null && editingId === state.activeSpaceId

  // Slide direction follows the Spaces' order in the switcher.
  const spaceIndex = state.spaces.findIndex((sp) => sp.id === state.activeSpaceId)
  const [slide, setSlide] = useState({ id: state.activeSpaceId, index: spaceIndex, dir: 0 })
  if (slide.id !== state.activeSpaceId) {
    setSlide({
      id: state.activeSpaceId,
      index: spaceIndex,
      dir: Math.sign(spaceIndex - slide.index)
    })
  }
  const found =
    state.activeId === null
      ? null
      : findNode([...state.favorites, ...state.pinned, ...state.today], state.activeId)
  const active = found?.kind === 'tab' ? found : undefined
  const hidden = sidebar.collapsed && !sidebar.peek
  // Mirrors pageBounds() in main so the shadow sits exactly under the native page card.
  const left = sidebar.collapsed ? 0 : sidebar.width
  const cardX = (sidebar.collapsed && sidebar.peek ? sidebar.width : left) + PAGE_INSET

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <div className="relative h-full text-[13px] text-(--fg)" style={themeVars(colors)}>
        {!hasMaterial && <div className="absolute inset-0" style={{ background: colors.base }} />}
        <AnimatePresence initial={false}>
          <motion.div
            key={state.activeSpaceId}
            className="absolute inset-0"
            style={{ background: colors.background }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        </AnimatePresence>
        {/* Soft shadow under the native page card, which Chromium paints on top of this. */}
        <div
          className="absolute grid place-items-center bg-white text-neutral-500 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] dark:bg-neutral-900 dark:text-neutral-400"
          style={{
            left: cardX,
            top: pageTop(platform),
            width: `calc(100% - ${left + 2 * PAGE_INSET}px)`,
            bottom: PAGE_INSET,
            borderRadius: PAGE_RADIUS
          }}
        >
          {!active && `Press ${MOD}T to open a tab`}
        </div>
        <motion.aside
          initial={false}
          animate={{ x: hidden ? -(sidebar.width + PAGE_INSET) : 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="absolute inset-y-0 left-0 flex flex-col gap-2 px-2"
          style={{ width: sidebar.width }}
          onWheel={onWheel}
          onMouseLeave={() => {
            // Keep a peeked sidebar open while the user is typing in it.
            if (sidebar.peek && document.activeElement?.tagName !== 'INPUT')
              send({ type: 'sidebar', peek: false })
          }}
        >
          <NavRow active={active} />
          <UrlPill active={active} collapsed={sidebar.collapsed} />
          {showArchive ? (
            <>
              <h2 className="px-2 pt-1 text-[12px] font-medium text-(--muted)">Archive</h2>
              <ArchiveList items={state.archive} />
            </>
          ) : editing && space ? (
            <SpaceEditor space={space} state={state} onDone={() => setEditingId(null)} />
          ) : (
            <div className="relative -mx-2 flex min-h-0 flex-1 flex-col overflow-hidden px-2">
              <AnimatePresence initial={false} custom={slide.dir} mode="popLayout">
                <motion.div
                  key={state.activeSpaceId}
                  custom={slide.dir}
                  variants={{
                    enter: (dir: number) => ({ x: `${dir * 100}%`, opacity: 0 }),
                    center: { x: 0, opacity: 1 },
                    exit: (dir: number) => ({ x: `${-dir * 100}%`, opacity: 0 })
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: 'spring', stiffness: 400, damping: 40 }}
                  className="flex min-h-0 flex-1 flex-col gap-2"
                >
                  <Tabs
                    state={state}
                    onNewTab={() => window.dispatchEvent(new CustomEvent('vew:new-tab'))}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          )}
          <div className="flex h-10 shrink-0 items-center justify-between">
            <button
              className={`${iconButton} ${showArchive ? 'bg-(--fill)' : ''}`}
              aria-label={showArchive ? 'Back to tabs' : 'Show archive'}
              aria-pressed={showArchive}
              title="Archive"
              onClick={() => setShowArchive(!showArchive)}
            >
              <Archive {...icon} />
            </button>
            <SpaceSwitcher
              spaces={state.spaces}
              activeSpaceId={state.activeSpaceId}
              onEdit={(id) => {
                if (id !== state.activeSpaceId) send({ type: 'switchSpace', id })
                setShowArchive(false)
                setEditingId(id)
              }}
            />
            <button
              className={iconButton}
              aria-label="Toggle sidebar"
              title={`Toggle sidebar (${MOD}S)`}
              onClick={() => send({ type: 'toggleSidebar' })}
            >
              <PanelLeft {...icon} />
            </button>
          </div>
        </motion.aside>
        {!sidebar.collapsed && <ResizeHandle width={sidebar.width} />}
        {hidden && (
          <div
            className="no-drag absolute inset-y-0 left-0 w-2"
            onMouseEnter={() => send({ type: 'sidebar', peek: true })}
          />
        )}
      </div>
    </MotionConfig>
  )
}

/** Drag the gap between sidebar and page to resize; double-click resets. */
function ResizeHandle({ width }: { width: number }): React.JSX.Element {
  const frame = useRef(0)
  return (
    <div
      className="no-drag absolute inset-y-0 w-2 cursor-col-resize"
      style={{ left: width }}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const x = e.clientX
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => send({ type: 'sidebar', width: x }))
      }}
      onDoubleClick={() => send({ type: 'sidebar', width: SIDEBAR_DEFAULT_WIDTH })}
    />
  )
}

const iconButton =
  'grid size-7 place-items-center rounded-md text-(--muted) hover:bg-(--hover) disabled:opacity-40 disabled:hover:bg-transparent'

function NavRow({ active }: { active?: TabState }): React.JSX.Element {
  const button = iconButton
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

function UrlPill({
  active,
  collapsed
}: {
  active?: TabState
  collapsed: boolean
}): React.JSX.Element {
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
    if (!editingNow.current) return
    editingNow.current = false
    setEditing(false)
    input.current?.blur()
    if (collapsed) send({ type: 'sidebar', peek: false })
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
      className="h-8 shrink-0 rounded-lg bg-(--fill) px-3 text-(--fg) outline-none placeholder:text-(--muted) focus:bg-white focus:text-neutral-900 focus:shadow-sm focus:ring-1 focus:ring-black/10 focus:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:text-neutral-100 dark:focus:ring-white/10 dark:focus:placeholder:text-neutral-400"
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
