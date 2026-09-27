import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FindState } from '../../shared/ipc'
import type { OverlayApi } from '../../preload/overlay'
import { icon } from '../shared/ui'

const vew = (window as unknown as { vew: OverlayApi }).vew

/** Find in page. Main shrinks the overlay to exactly this bar, so the page underneath stays usable. */
export function FindBar(): React.JSX.Element | null {
  const [state, setState] = useState<FindState | null>(null)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(
    () =>
      vew.onFind((next) => {
        setState(next)
        if (next) requestAnimationFrame(() => input.current?.select())
      }),
    []
  )
  if (!state) return null

  const find = (forward: boolean, next: boolean): void =>
    vew.send({ type: 'find', text, forward, next })
  const button =
    'grid size-7 place-items-center rounded-md hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10'
  return (
    <div
      role="search"
      className="fixed inset-0 flex items-center gap-1 rounded-xl bg-white/95 pr-1.5 pl-3 text-[13px] text-neutral-900 shadow-lg ring-1 ring-black/10 backdrop-blur dark:bg-neutral-800/95 dark:text-neutral-100 dark:ring-white/10"
    >
      <input
        ref={input}
        autoFocus
        value={text}
        aria-label="Find in page"
        placeholder="Find in page"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-500"
        onChange={(e) => {
          setText(e.target.value)
          vew.send({ type: 'find', text: e.target.value, forward: true, next: false })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(!e.shiftKey, true)
          if (e.key === 'Escape') vew.send({ type: 'closeFind' })
        }}
      />
      <span
        aria-live="polite"
        className="shrink-0 px-1 text-[12px] text-neutral-500 tabular-nums dark:text-neutral-400"
      >
        {text ? `${state.active}/${state.total}` : ''}
      </span>
      <button
        className={button}
        aria-label="Previous match"
        disabled={!state.total}
        onClick={() => find(false, true)}
      >
        <ChevronUp {...icon} />
      </button>
      <button
        className={button}
        aria-label="Next match"
        disabled={!state.total}
        onClick={() => find(true, true)}
      >
        <ChevronDown {...icon} />
      </button>
      <button
        className={button}
        aria-label="Close find"
        onClick={() => vew.send({ type: 'closeFind' })}
      >
        <X {...icon} />
      </button>
    </div>
  )
}
