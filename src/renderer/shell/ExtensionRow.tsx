import { Puzzle } from 'lucide-react'
import type { ExtensionState } from '../../shared/ipc'

const { send } = window.vew

/** A compact row of extension icons under the address field; each opens its popup below it. */
export function ExtensionRow({
  extensions
}: {
  extensions: ExtensionState[]
}): React.JSX.Element | null {
  if (!extensions.length) return null
  return (
    <div
      role="toolbar"
      aria-label="Extensions"
      className="-mt-1 flex shrink-0 flex-wrap gap-0.5 px-0.5"
    >
      {extensions.map((ext) => (
        <button
          key={ext.id}
          title={ext.name}
          aria-label={ext.badge ? `${ext.name} (${ext.badge})` : ext.name}
          className="relative grid size-7 place-items-center rounded-md hover:bg-(--hover)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            send({
              type: 'extensionClick',
              id: ext.id,
              anchor: { x: Math.round(r.left), y: Math.round(r.bottom + 6) }
            })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            send({ type: 'extensionMenu', id: ext.id })
          }}
        >
          {ext.icon ? (
            <img src={ext.icon} alt="" className="size-4" draggable={false} />
          ) : (
            <Puzzle size={16} strokeWidth={1.5} className="text-(--muted)" />
          )}
          {ext.badge && (
            <span
              className="absolute -right-0.5 -bottom-0.5 min-w-3.5 rounded-full px-0.5 text-center text-[9px] leading-3.5 font-semibold text-white"
              style={{ background: ext.badgeColor }}
            >
              {ext.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
