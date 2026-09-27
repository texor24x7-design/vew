import { useEffect, useRef, useState } from 'react'
import type { BrowserState, Snapshot } from '../../shared/ipc'
import { PAGE_INSET, PAGE_RADIUS, resizeSplit, type Rect } from '../../shared/layout'
import { platform, usePageLayout } from './pageLayout'

const { send } = window.vew
const MOD = platform === 'darwin' ? '⌘' : 'Ctrl+'
const box = (r: Rect): React.CSSProperties => ({
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height
})

/**
 * What the shell draws around the native page views: a soft shadow card per pane, a ring on the
 * focused pane, draggable dividers in the gaps, and pictures of the panes while a tab is being dragged.
 */
export function PageArea({ state }: { state: BrowserState }): React.JSX.Element {
  const { card, panes } = usePageLayout(state)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  useEffect(() => window.vew.onSnapshot(setSnapshots), [])
  const cards = panes.length ? panes.map((p) => p.rect) : [card]
  const split = state.split

  return (
    <>
      {cards.map((r, i) => (
        <div
          key={i}
          className="absolute grid place-items-center bg-white text-neutral-500 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] dark:bg-neutral-900 dark:text-neutral-400"
          style={{ ...box(r), borderRadius: PAGE_RADIUS }}
        >
          {!panes.length && `Press ${MOD}T to open a tab`}
        </div>
      ))}
      {split &&
        panes.map(
          (p) =>
            p.id === state.activeId && (
              // Sits in the inset around the native view, so it reads as a focus ring.
              <div
                key="ring"
                className="pointer-events-none absolute ring-2 ring-blue-500/50"
                style={{
                  ...box({
                    x: p.rect.x - 2,
                    y: p.rect.y - 2,
                    width: p.rect.width + 4,
                    height: p.rect.height + 4
                  }),
                  borderRadius: PAGE_RADIUS + 2
                }}
              />
            )
        )}
      {split &&
        panes
          .slice(0, -1)
          .map((p, i) => <Divider key={i} index={i} rect={p.rect} card={card} split={split} />)}
      {snapshots.map((s, i) => (
        <img
          key={i}
          src={s.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute object-cover"
          style={{ ...box(s), borderRadius: PAGE_RADIUS }}
        />
      ))}
    </>
  )
}

/** The gap after a pane: drag to resize its neighbours, double-click to even them out. */
function Divider(props: {
  index: number
  rect: Rect
  card: Rect
  split: NonNullable<BrowserState['split']>
}): React.JSX.Element {
  const { index, rect, card, split } = props
  const row = split.direction === 'row'
  const frame = useRef(0)
  const gap: Rect = row
    ? { x: rect.x + rect.width, y: rect.y, width: PAGE_INSET, height: rect.height }
    : { x: rect.x, y: rect.y + rect.height, width: rect.width, height: PAGE_INSET }
  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label="Resize split"
      aria-valuenow={Math.round(split.sizes[index] * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        const back = row ? 'ArrowLeft' : 'ArrowUp'
        const fwd = row ? 'ArrowRight' : 'ArrowDown'
        if (e.key !== back && e.key !== fwd) return
        e.preventDefault()
        const edge = (row ? rect.x + rect.width : rect.y + rect.height) + (e.key === fwd ? 24 : -24)
        send({
          type: 'resizeSplit',
          sizes: resizeSplit(card, split.direction, split.sizes, index, edge)
        })
      }}
      className={`no-drag group absolute grid place-items-center ${row ? 'cursor-col-resize' : 'cursor-row-resize'}`}
      style={box(gap)}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const pos = row ? e.clientX : e.clientY
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() =>
          send({
            type: 'resizeSplit',
            sizes: resizeSplit(card, split.direction, split.sizes, index, pos)
          })
        )
      }}
      onDoubleClick={() =>
        send({ type: 'resizeSplit', sizes: split.sizes.map(() => 1 / split.sizes.length) })
      }
    >
      <span
        className={`rounded-full bg-(--muted) opacity-0 transition-opacity group-hover:opacity-60 ${row ? 'h-8 w-0.5' : 'h-0.5 w-8'}`}
      />
    </div>
  )
}
