import { PanelLeft, Plus } from 'lucide-react'
import type { BrowserState, NodeState, TabState } from '../../shared/ipc'
import { Favicon, icon } from '../shared/ui'
import { AccountButton } from './Essentials'

const { send } = window.vew

const flatTabs = (nodes: NodeState[]): TabState[] =>
  nodes.flatMap((n) => (n.kind === 'tab' ? [n] : flatTabs(n.children)))

/**
 * The collapsed sidebar: a slim rail of tab icons. Hovering one shows its title in a pill beside it
 * (drawn by main above the page).
 */
export function Rail({ state }: { state: BrowserState }): React.JSX.Element {
  const groups = [state.favorites, flatTabs(state.pinned), state.today].filter((g) => g.length)

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
        className="no-drag relative flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-1"
        onMouseLeave={() => {
          send({ type: 'railHover', id: null })
        }}
      >
        {groups.map((tabs, g) => (
          <div key={g} className="contents">
            {g > 0 && <div className="my-1 h-px w-6 shrink-0 bg-(--line)" />}
            {tabs.map((tab) => {
              const active = tab.id === state.activeId
              return (
                <button
                  key={tab.id}
                  data-rail-tab={tab.id}
                  aria-label={tab.title}
                  aria-current={active ? 'page' : undefined}
                  className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                    active ? 'bg-(--active) shadow-sm' : 'hover:bg-(--hover)'
                  } ${tab.loaded || active ? '' : 'opacity-60'} ${tab.loading ? 'animate-pulse' : ''}`}
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
      <AccountButton
        account={state.account}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-(--muted) hover:bg-(--hover)"
      />
    </nav>
  )
}
