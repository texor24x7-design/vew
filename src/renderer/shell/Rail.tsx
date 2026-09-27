import { useRef, useState } from 'react'
import { PanelLeft, Plus } from 'lucide-react'
import type { BrowserState, NodeState, TabState } from '../../shared/ipc'
import { Favicon, icon } from '../shared/ui'

const { send } = window.vew
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// Dock-like magnification: icons near the pointer swell and lean out sideways in a bell curve.
const MAX_GROWTH = 0.55
const SPREAD = 34 // px: how far along the rail the swell reaches
const LEAN = 14 // px an icon moves sideways at full size

const flatTabs = (nodes: NodeState[]): TabState[] =>
  nodes.flatMap((n) => (n.kind === 'tab' ? [n] : flatTabs(n.children)))

/**
 * The collapsed sidebar: a slim rail of tab icons. Hovering one shows its title in a pill beside it
 * (drawn by main above the page), and moving along the rail swells the icons like the Dock.
 */
export function Rail({ state }: { state: BrowserState }): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [growth, setGrowth] = useState<Record<number, number>>({})
  const groups = [state.favorites, flatTabs(state.pinned), state.today].filter((g) => g.length)

  const magnify = (clientY: number): void => {
    if (reducedMotion.matches || !list.current) return
    const box = list.current.getBoundingClientRect()
    const next: Record<number, number> = {}
    for (const el of list.current.querySelectorAll<HTMLElement>('[data-rail-tab]')) {
      // offsetTop ignores the transforms we apply, so the curve doesn't feed back on itself.
      const center = box.top + el.offsetTop - list.current.scrollTop + el.offsetHeight / 2
      const d = clientY - center
      next[Number(el.dataset.railTab)] = MAX_GROWTH * Math.exp(-(d * d) / (2 * SPREAD * SPREAD))
    }
    setGrowth(next)
  }

  return (
    <nav
      aria-label="Tabs (sidebar collapsed)"
      className="drag absolute inset-y-0 left-0 flex flex-col items-center gap-1 pt-3 pb-3"
      style={{ width: 52 }}
    >
      <button
        className="grid size-8 shrink-0 place-items-center rounded-lg text-(--muted) hover:bg-(--hover)"
        aria-label="Show sidebar"
        title="Show sidebar"
        onClick={() => send({ type: 'toggleSidebar' })}
      >
        <PanelLeft {...icon} />
      </button>
      <button
        className="grid size-8 shrink-0 place-items-center rounded-lg text-(--muted) hover:bg-(--hover)"
        aria-label="New tab"
        title="New tab"
        onClick={() => send({ type: 'openPalette' })}
      >
        <Plus {...icon} />
      </button>
      <div className="my-1 h-px w-6 shrink-0 bg-(--line)" />
      <div
        ref={list}
        className="no-drag relative flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-1"
        onMouseMove={(e) => {
          const y = e.clientY
          cancelAnimationFrame(frame.current)
          frame.current = requestAnimationFrame(() => magnify(y))
        }}
        onMouseLeave={() => {
          cancelAnimationFrame(frame.current)
          setGrowth({})
          send({ type: 'railHover', id: null })
        }}
      >
        {groups.map((tabs, g) => (
          <div key={g} className="contents">
            {g > 0 && <div className="my-1 h-px w-6 shrink-0 bg-(--line)" />}
            {tabs.map((tab) => {
              const grow = growth[tab.id] ?? 0
              const active = tab.id === state.activeId
              return (
                <button
                  key={tab.id}
                  data-rail-tab={tab.id}
                  aria-label={tab.title}
                  aria-current={active ? 'page' : undefined}
                  className={`grid size-8 shrink-0 origin-left place-items-center rounded-lg transition-transform duration-100 ease-out ${
                    active ? 'bg-(--active) shadow-sm' : 'hover:bg-(--hover)'
                  } ${tab.loaded || active ? '' : 'opacity-60'} ${tab.loading ? 'animate-pulse' : ''}`}
                  style={{ transform: `translateX(${grow * LEAN}px) scale(${1 + grow})` }}
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    send({ type: 'railHover', id: tab.id, y: Math.round(r.top + r.height / 2) })
                  }}
                  onFocus={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    send({ type: 'railHover', id: tab.id, y: Math.round(r.top + r.height / 2) })
                  }}
                  onBlur={() => send({ type: 'railHover', id: null })}
                  onClick={() => send({ type: 'activate', id: tab.id })}
                  onAuxClick={(e) => e.button === 1 && send({ type: 'close', id: tab.id })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    send({ type: 'contextMenu', id: tab.id })
                  }}
                >
                  <Favicon tab={tab} />
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
