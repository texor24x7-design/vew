import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent
} from '@dnd-kit/core'
import { ChevronRight, Folder, Plus, X } from 'lucide-react'
import { Favicon, icon } from '../shared/ui'
import type {
  ArchivedTab,
  BrowserState,
  FolderState,
  NodeState,
  TabState,
  Where,
  Zone
} from '../../shared/ipc'

const { send } = window.vew

/** What a droppable represents: a row (tab/folder) at a position, or the end of a zone. */
interface Slot {
  kind: 'tab' | 'folder' | 'end'
  zone: Zone
  parent: number | null
  index: number
  id?: number
  grid?: boolean
  childCount?: number
}
interface Drop {
  where: Where
  target: string | number
  pos: 'before' | 'after' | 'into' | 'end'
}

const DropCtx = createContext<Drop | null>(null)
const StateCtx = createContext<{
  activeId: number | null
  renameId: number | null
  dragId: number | null
}>({
  activeId: null,
  renameId: null,
  dragId: null
})

// Rows win over the zone-level "end" targets they sit inside.
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const rows = hits.filter(
    (h) => (h.data?.droppableContainer.data.current as Slot | undefined)?.kind !== 'end'
  )
  return rows.length ? rows : hits
}

function dropFor(e: DragMoveEvent | DragEndEvent, dragged: NodeState | null): Drop | null {
  const { over } = e
  if (!over || !dragged) return null
  const slot = over.data.current as Slot
  // Only pinned can hold folders.
  if (dragged.kind === 'folder' && slot.zone !== 'pinned') return null
  if (slot.id === dragged.id) return null
  if (slot.kind === 'end') {
    return {
      where: { zone: slot.zone, parent: null, index: slot.index },
      target: over.id,
      pos: 'end'
    }
  }
  const start = e.activatorEvent as PointerEvent
  const r = over.rect
  const frac = slot.grid
    ? (start.clientX + e.delta.x - r.left) / r.width
    : (start.clientY + e.delta.y - r.top) / r.height
  if (slot.kind === 'folder' && frac > 0.25 && frac < 0.75) {
    return {
      where: { zone: 'pinned', parent: slot.id!, index: slot.childCount! },
      target: over.id,
      pos: 'into'
    }
  }
  const before = frac < 0.5
  return {
    where: { zone: slot.zone, parent: slot.parent, index: before ? slot.index : slot.index + 1 },
    target: over.id,
    pos: before ? 'before' : 'after'
  }
}

const sameDrop = (a: Drop | null, b: Drop | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function findNode(nodes: NodeState[], id: number): NodeState | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.kind === 'folder') {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

export function Tabs({ state }: { state: BrowserState }): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [dragged, setDragged] = useState<NodeState | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const all = [...state.favorites, ...state.pinned, ...state.today]

  const reset = (): void => {
    setDragged(null)
    setDrop(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      // Drop zones (e.g. "Drop here to pin") appear only once a drag starts, so keep measuring.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e) => setDragged(findNode(all, Number(e.active.id)))}
      onDragMove={(e) => {
        const next = dropFor(e, dragged)
        if (!sameDrop(next, drop)) setDrop(next)
      }}
      onDragEnd={(e) => {
        const d = dropFor(e, dragged)
        if (d && dragged) send({ type: 'move', id: dragged.id, where: d.where })
        reset()
      }}
      onDragCancel={reset}
    >
      <StateCtx.Provider
        value={{ activeId: state.activeId, renameId: state.renameId, dragId: dragged?.id ?? null }}
      >
        <DropCtx.Provider value={drop}>
          <Favorites tabs={state.favorites} dragging={dragged !== null} />
          <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            <Zone
              zone="pinned"
              count={state.pinned.length}
              dragging={dragged !== null}
              hint="Drop here to pin"
            >
              <NodeList nodes={state.pinned} zone="pinned" parent={null} />
            </Zone>
            <div className="mx-2 h-px shrink-0 bg-(--line)" />
            <button
              className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-(--muted) hover:bg-(--hover)"
              onClick={() => send({ type: 'openPalette' })}
            >
              <Plus {...icon} />
              New Tab
            </button>
            <Zone zone="today" count={state.today.length} dragging={dragged !== null} grow>
              <NodeList nodes={state.today} zone="today" parent={null} />
            </Zone>
          </div>
        </DropCtx.Provider>
      </StateCtx.Provider>
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="flex h-8 w-52 items-center gap-2 rounded-lg bg-white/90 px-2 text-[13px] text-neutral-800 shadow-lg dark:bg-neutral-800/90 dark:text-neutral-100">
            {dragged.kind === 'tab' ? <Favicon tab={dragged} /> : <Folder {...icon} />}
            <span className="truncate">
              {dragged.kind === 'tab' ? dragged.title : dragged.name}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/** A zone's list plus its "drop at the end" target, which also catches drops when it's empty. */
function Zone(props: {
  zone: Zone
  count: number
  dragging: boolean
  hint?: string
  grow?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const id = `end-${props.zone}`
  const { setNodeRef } = useDroppable({
    id,
    data: { kind: 'end', zone: props.zone, parent: null, index: props.count } satisfies Slot
  })
  const drop = useContext(DropCtx)
  const showHint = props.hint && props.dragging && props.count === 0
  return (
    <div ref={setNodeRef} className={`flex flex-col ${props.grow ? 'min-h-16 flex-1' : ''}`}>
      {props.children}
      {showHint && (
        <div
          className={`grid h-8 place-items-center rounded-lg border border-dashed text-[12px] text-(--muted) ${
            drop?.target === id ? 'border-blue-500 bg-blue-500/10' : 'border-(--line)'
          }`}
        >
          {props.hint}
        </div>
      )}
    </div>
  )
}

function NodeList(props: {
  nodes: NodeState[]
  zone: Zone
  parent: number | null
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      <AnimatePresence initial={false}>
        {props.nodes.map((n, index) => {
          const slot: Slot = {
            kind: n.kind,
            zone: props.zone,
            parent: props.parent,
            index,
            id: n.id
          }
          return n.kind === 'tab' ? (
            <TabRow key={n.id} tab={n} slot={slot} />
          ) : (
            <FolderItem key={n.id} folder={n} slot={{ ...slot, childCount: n.children.length }} />
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

/** Shared drag + drop wiring for a row or tile. */
function useRow(id: number, slot: Slot) {
  const drag = useDraggable({ id })
  const dropTarget = useDroppable({ id: `row-${id}`, data: slot })
  const drop = useContext(DropCtx)
  const { dragId } = useContext(StateCtx)
  return {
    setNodeRef: (el: HTMLElement | null) => {
      drag.setNodeRef(el)
      dropTarget.setNodeRef(el)
    },
    handlers: { ...drag.listeners, ...drag.attributes },
    pos: drop?.target === `row-${id}` ? drop.pos : null,
    isDragged: dragId === id
  }
}

function Indicator({
  pos,
  vertical
}: {
  pos: Drop['pos'] | null
  vertical?: boolean
}): React.JSX.Element | null {
  if (pos !== 'before' && pos !== 'after') return null
  const side = vertical
    ? pos === 'before'
      ? '-left-0.5'
      : '-right-0.5'
    : pos === 'before'
      ? '-top-px'
      : '-bottom-px'
  return (
    <span
      className={`pointer-events-none absolute rounded-full bg-blue-500 ${side} ${
        vertical ? 'inset-y-1 w-0.5' : 'inset-x-1 h-0.5'
      }`}
    />
  )
}

function TabRow({ tab, slot }: { tab: TabState; slot: Slot }): React.JSX.Element {
  const { activeId } = useContext(StateCtx)
  const { setNodeRef, handlers, pos, isDragged } = useRow(tab.id, slot)
  const active = tab.id === activeId
  // Today tabs close; pinned tabs only unload, so the X only shows while loaded.
  const closable = slot.zone === 'today' || tab.loaded
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: isDragged ? 0.4 : 1, height: 32 }}
      exit={{ opacity: 0, height: 0 }}
      ref={setNodeRef}
      {...handlers}
      className={`group relative flex shrink-0 cursor-default items-center gap-2 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
        active ? 'bg-(--active) shadow-sm' : 'hover:bg-(--hover)'
      } ${tab.loading ? 'shimmer overflow-hidden' : ''}`}
      onClick={() => send({ type: 'activate', id: tab.id })}
      onAuxClick={(e) => e.button === 1 && send({ type: 'close', id: tab.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        send({ type: 'contextMenu', id: tab.id })
      }}
      title={tab.title}
    >
      <Favicon tab={tab} />
      <span className={`min-w-0 flex-1 truncate ${tab.loaded || active ? '' : 'text-(--muted)'}`}>
        {tab.title}
      </span>
      {closable && (
        <button
          className="grid size-5 shrink-0 place-items-center rounded text-(--muted) opacity-0 group-hover:opacity-100 hover:bg-(--hover)"
          aria-label={slot.zone === 'today' ? 'Close tab' : 'Unload tab'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            send({ type: 'close', id: tab.id })
          }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
      <Indicator pos={pos} />
    </motion.li>
  )
}

function FolderItem({ folder, slot }: { folder: FolderState; slot: Slot }): React.JSX.Element {
  const { renameId } = useContext(StateCtx)
  const { setNodeRef, handlers, pos, isDragged } = useRow(folder.id, slot)
  const [editing, setEditing] = useState(false)
  // Start editing when main asks (new folder / "Rename Folder"); adjusting state during render, not in an effect.
  const [seenRenameId, setSeenRenameId] = useState<number | null>(null)
  if (renameId !== seenRenameId) {
    setSeenRenameId(renameId)
    if (renameId === folder.id) setEditing(true)
  }
  const commit = (name: string | null): void => {
    setEditing(false)
    if (name !== null) send({ type: 'renameFolder', id: folder.id, name })
  }

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: isDragged ? 0.4 : 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        ref={setNodeRef}
        {...handlers}
        className={`relative flex h-8 cursor-default items-center gap-1.5 rounded-lg px-2 text-(--fg) outline-none hover:bg-(--hover) focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
          pos === 'into' ? 'bg-blue-500/10 ring-1 ring-blue-500' : ''
        }`}
        onClick={() => !editing && send({ type: 'toggleFolder', id: folder.id })}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          send({ type: 'contextMenu', id: folder.id })
        }}
      >
        <motion.span
          animate={{ rotate: folder.open ? 90 : 0 }}
          className="grid shrink-0 place-items-center"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </motion.span>
        <Folder {...icon} className="shrink-0" />
        {editing ? (
          <RenameInput name={folder.name} onDone={commit} />
        ) : (
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        )}
        <Indicator pos={pos} />
      </div>
      <AnimatePresence initial={false}>
        {folder.open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pl-4"
          >
            <NodeList nodes={folder.children} zone="pinned" parent={folder.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** Inline name editor. Enter commits directly, since blur events don't fire while the window is unfocused. */
function RenameInput(props: {
  name: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    props.onDone(name)
  }
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      defaultValue={props.name}
      aria-label="Folder name"
      className="min-w-0 flex-1 rounded bg-white px-1 text-neutral-800 outline-none ring-1 ring-blue-500 dark:bg-neutral-800 dark:text-neutral-100"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

function Favorites({
  tabs,
  dragging
}: {
  tabs: TabState[]
  dragging: boolean
}): React.JSX.Element | null {
  const { setNodeRef } = useDroppable({
    id: 'end-favorites',
    data: { kind: 'end', zone: 'favorites', parent: null, index: tabs.length } satisfies Slot
  })
  const drop = useContext(DropCtx)
  if (!tabs.length && !dragging) return <div ref={setNodeRef} />
  return (
    <div
      ref={setNodeRef}
      className={`grid shrink-0 grid-cols-4 gap-1.5 rounded-xl ${
        !tabs.length ? 'min-h-10 border border-dashed border-(--line)' : ''
      } ${drop?.target === 'end-favorites' ? 'bg-blue-500/10 ring-1 ring-blue-500' : ''}`}
    >
      {tabs.map((tab, index) => (
        <FavoriteTile
          key={tab.id}
          tab={tab}
          slot={{ kind: 'tab', zone: 'favorites', parent: null, index, id: tab.id, grid: true }}
        />
      ))}
      {!tabs.length && (
        <span className="col-span-4 grid place-items-center text-[12px] text-(--muted)">
          Drop to add to Favorites
        </span>
      )}
    </div>
  )
}

function FavoriteTile({ tab, slot }: { tab: TabState; slot: Slot }): React.JSX.Element {
  const { activeId } = useContext(StateCtx)
  const { setNodeRef, handlers, pos, isDragged } = useRow(tab.id, slot)
  const active = tab.id === activeId
  return (
    <motion.button
      layout="position"
      ref={setNodeRef}
      {...handlers}
      animate={{ opacity: isDragged ? 0.4 : 1 }}
      aria-label={tab.title}
      title={tab.title}
      className={`relative grid h-10 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
        active ? 'bg-(--active) shadow-sm' : 'bg-(--fill) hover:bg-(--hover)'
      } ${tab.loading ? 'shimmer overflow-hidden' : ''}`}
      onClick={() => send({ type: 'activate', id: tab.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        send({ type: 'contextMenu', id: tab.id })
      }}
    >
      <Favicon tab={tab} />
      <Indicator pos={pos} vertical />
    </motion.button>
  )
}

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
function timeAgo(ms: number): string {
  const mins = Math.round((ms - Date.now()) / 60_000)
  if (mins > -60) return ago.format(mins, 'minute')
  if (mins > -60 * 24) return ago.format(Math.round(mins / 60), 'hour')
  return ago.format(Math.round(mins / 1440), 'day')
}

export function ArchiveList({ items }: { items: ArchivedTab[] }): React.JSX.Element {
  if (!items.length) {
    return (
      <p className="px-2 py-6 text-center text-[12px] text-(--muted)">
        Today tabs you haven’t used in a while move here.
      </p>
    )
  }
  return (
    <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
      {items.map((item, index) => (
        <li key={`${item.archivedAt}-${index}`}>
          <button
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-(--hover)"
            title={item.url}
            onClick={() => send({ type: 'restore', index })}
          >
            <Favicon tab={item} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 text-[12px] text-(--muted)">{timeAgo(item.archivedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
