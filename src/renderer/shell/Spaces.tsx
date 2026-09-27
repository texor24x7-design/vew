import { useRef, useSyncExternalStore } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { BrowserState, SpaceState } from '../../shared/ipc'
import { PRESETS, palette, type Palette, type Theme } from '../../shared/theme'
import { icon } from './Sidebar'

const { send } = window.vew

const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const subscribeDark = (cb: () => void): (() => void) => {
  darkQuery.addEventListener('change', cb)
  return () => darkQuery.removeEventListener('change', cb)
}
export const useSystemDark = (): boolean =>
  useSyncExternalStore(subscribeDark, () => darkQuery.matches)

/** CSS variables the sidebar's Tailwind classes read (text-(--fg), bg-(--hover), …). */
export function themeVars(p: Palette): React.CSSProperties {
  return {
    '--fg': p.fg,
    '--muted': p.muted,
    '--hover': p.hover,
    '--fill': p.fill,
    '--line': p.line,
    '--active': p.active
  } as React.CSSProperties
}

/** Two-finger horizontal swipe on the sidebar steps between Spaces (trackpads send it as a wheel deltaX). */
export function useSpaceSwipe(): (e: React.WheelEvent) => void {
  const acc = useRef(0)
  const last = useRef(0)
  const lockedUntil = useRef(0)
  return (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const now = performance.now()
    if (now - last.current > 200) acc.current = 0 // a new gesture
    last.current = now
    if (now < lockedUntil.current) return // swallow the rest of this gesture's momentum
    acc.current += e.deltaX
    if (Math.abs(acc.current) > 60) {
      send({ type: 'stepSpace', delta: acc.current > 0 ? 1 : -1 })
      acc.current = 0
      lockedUntil.current = now + 450
    }
  }
}

export function SpaceSwitcher(props: {
  spaces: SpaceState[]
  activeSpaceId: number
  onEdit: (id: number) => void
}): React.JSX.Element {
  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden"
      role="tablist"
      aria-label="Spaces"
    >
      {props.spaces.map((sp) => {
        const active = sp.id === props.activeSpaceId
        return (
          <button
            key={sp.id}
            role="tab"
            aria-selected={active}
            aria-label={sp.name}
            title={sp.name}
            className={`grid size-7 shrink-0 place-items-center rounded-md text-[14px] transition-[opacity,transform] duration-150 hover:bg-(--hover) ${
              active ? 'bg-(--fill)' : 'opacity-60 hover:opacity-100'
            }`}
            onClick={() => send({ type: 'switchSpace', id: sp.id })}
            onDoubleClick={() => props.onEdit(sp.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              send({ type: 'spaceMenu', id: sp.id })
            }}
          >
            {sp.icon}
          </button>
        )
      })}
      <button
        className="grid size-7 shrink-0 place-items-center rounded-md text-(--muted) hover:bg-(--hover)"
        aria-label="New Space"
        title="New Space"
        onClick={() => send({ type: 'newSpace' })}
      >
        <Plus {...icon} />
      </button>
    </div>
  )
}

const field =
  'h-8 rounded-md bg-white/75 px-2 text-neutral-900 outline-none ring-1 ring-black/10 focus:ring-blue-500 dark:bg-neutral-800/80 dark:text-neutral-100 dark:ring-white/10'
const label = 'text-[12px] font-medium text-(--muted)'

/** Edits the active Space. Every change applies immediately, so the sidebar itself is the live preview. */
export function SpaceEditor(props: {
  space: SpaceState
  state: BrowserState
  onDone: () => void
}): React.JSX.Element {
  const { space, state } = props
  const update = (patch: Partial<Omit<SpaceState, 'id'>>): void =>
    send({ type: 'updateSpace', id: space.id, ...patch })
  const setTheme = (patch: Partial<Theme>): void => update({ theme: { ...space.theme, ...patch } })
  const effective = palette(space.theme, darkQuery.matches).intensity

  return (
    <div
      key={space.id}
      className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-[13px] font-semibold">Edit Space</h2>
        <button className="h-7 rounded-md px-2 hover:bg-(--hover)" onClick={props.onDone}>
          Done
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className={`${field} w-11 text-center text-[15px]`}
          defaultValue={space.icon}
          aria-label="Space icon (emoji)"
          onChange={(e) => e.target.value.trim() && update({ icon: e.target.value })}
        />
        <input
          className={`${field} min-w-0 flex-1`}
          defaultValue={space.name}
          aria-label="Space name"
          onChange={(e) => e.target.value.trim() && update({ name: e.target.value })}
        />
      </div>

      <section className="flex flex-col gap-2">
        <span className={label}>Theme</span>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => {
            const selected = p.colors.join() === space.theme.colors.join()
            return (
              <button
                key={p.name}
                aria-label={`${p.name} preset`}
                aria-pressed={selected}
                title={p.name}
                className={`h-8 rounded-md ring-offset-1 ${selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-black/10'}`}
                style={{ background: `linear-gradient(135deg, ${p.colors.join(', ')})` }}
                onClick={() => setTheme({ colors: p.colors })}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          {space.theme.colors.map((c, i) => (
            <input
              key={i}
              type="color"
              value={c}
              aria-label={`Gradient color ${i + 1}`}
              className="h-8 w-10 cursor-pointer rounded-md bg-transparent"
              onChange={(e) =>
                setTheme({
                  colors: space.theme.colors.map((x, j) => (j === i ? e.target.value : x))
                })
              }
            />
          ))}
          {space.theme.colors.length < 3 ? (
            <button
              className="grid size-8 place-items-center rounded-md text-(--muted) hover:bg-(--hover)"
              aria-label="Add a third color"
              onClick={() => setTheme({ colors: [...space.theme.colors, space.theme.colors[0]] })}
            >
              <Plus {...icon} />
            </button>
          ) : (
            <button
              className="grid size-8 place-items-center rounded-md text-(--muted) hover:bg-(--hover)"
              aria-label="Remove the third color"
              onClick={() => setTheme({ colors: space.theme.colors.slice(0, 2) })}
            >
              <Minus {...icon} />
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className={label}>
            Intensity
            {effective < space.theme.intensity && ' (softened for readable text)'}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={space.theme.intensity}
            className="accent-blue-500"
            onChange={(e) => setTheme({ intensity: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <span className={label}>Profile</span>
        <select
          className={field}
          value={space.profileId}
          aria-label="Profile"
          onChange={(e) => update({ profileId: e.target.value })}
        >
          {state.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="h-8 rounded-md text-left text-(--fg) hover:bg-(--hover) px-2"
          onClick={() => send({ type: 'newProfile', spaceId: space.id })}
        >
          New profile for “{space.name}”
        </button>
        <p className="px-2 text-[12px] text-(--muted)">
          Each profile keeps its own logins and cookies. Changing it reloads this Space’s tabs.
        </p>
      </section>

      {state.spaces.length > 1 && (
        <button
          className="mt-auto h-8 rounded-md px-2 text-left text-(--fg) hover:bg-(--hover)"
          onClick={() => send({ type: 'deleteSpace', id: space.id })}
        >
          Delete Space…
        </button>
      )}
    </div>
  )
}
