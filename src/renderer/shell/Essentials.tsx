import { useEffect, useRef } from 'react'
import { Download, FolderOpen, Info, Lock, X } from 'lucide-react'
import type { DownloadState, PermissionKind, SiteInfo } from '../../shared/ipc'
import { icon } from '../shared/ui'

const { send } = window.vew

const PERMISSIONS: { kind: PermissionKind; label: string }[] = [
  { kind: 'camera', label: 'Camera' },
  { kind: 'microphone', label: 'Microphone' },
  { kind: 'geolocation', label: 'Location' },
  { kind: 'notifications', label: 'Notifications' }
]

/** Lock (https) or info (http) icon inside the address field. */
export function SiteButton(props: {
  site: SiteInfo
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const Icon = props.site.secure ? Lock : Info
  return (
    <button
      className="absolute top-1/2 left-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-(--muted) hover:bg-(--hover)"
      aria-label={`Site information for ${props.site.host}`}
      aria-expanded={props.open}
      onClick={props.onToggle}
    >
      <Icon size={13} strokeWidth={1.75} />
    </button>
  )
}

/** Connection, per-site permissions, blocker and zoom for the active page. */
export function SitePopover(props: { site: SiteInfo; onClose: () => void }): React.JSX.Element {
  const { site, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('mousedown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('mousedown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const row = 'flex min-h-8 items-center gap-2'
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Site information for ${site.host}`}
      className="absolute top-full right-0 left-0 z-20 mt-1.5 flex flex-col gap-2 rounded-xl bg-white p-3 text-[13px] text-neutral-900 shadow-xl ring-1 ring-black/10 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-white/10"
    >
      <div>
        <div className="truncate font-medium">{site.host}</div>
        <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
          {site.secure ? 'Connection is secure' : 'Connection is not secure'}
        </div>
      </div>
      <div className="h-px bg-black/10 dark:bg-white/10" />
      {PERMISSIONS.map(({ kind, label }) => (
        <label key={kind} className={row}>
          <span className="flex-1">{label}</span>
          <select
            className="h-7 rounded-md bg-black/5 px-1.5 text-[12px] outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/10"
            value={site.permissions[kind] ?? 'ask'}
            onChange={(e) =>
              send({
                type: 'setPermission',
                origin: site.origin,
                kind,
                value: e.target.value as 'ask' | 'allow' | 'block'
              })
            }
          >
            <option value="ask">Ask</option>
            <option value="allow">Allow</option>
            <option value="block">Block</option>
          </select>
        </label>
      ))}
      <div className="h-px bg-black/10 dark:bg-white/10" />
      <label className={row}>
        <span className="flex-1">
          Block ads & trackers
          <span className="block text-[12px] text-neutral-500 dark:text-neutral-400">
            {site.blocker ? `${site.blocked} blocked on this page` : 'Off for this site'}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="size-4 accent-blue-500"
          checked={site.blocker}
          onChange={(e) =>
            send({ type: 'setSiteBlocker', host: site.host, enabled: e.target.checked })
          }
        />
      </label>
      {site.zoomPercent !== 100 && (
        <div className={row}>
          <span className="flex-1">Zoom {site.zoomPercent}%</span>
          <button
            className="h-7 rounded-md px-2 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => send({ type: 'zoom', delta: 0 })}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

const progressOf = (d: DownloadState): number => (d.total > 0 ? d.received / d.total : 0)

/** Footer button: a progress ring while anything downloads. */
export function DownloadsButton(props: {
  downloads: DownloadState[]
  open: boolean
  onToggle: () => void
  className: string
}): React.JSX.Element | null {
  const active = props.downloads.filter((d) => d.state === 'progressing')
  if (!props.downloads.length) return null
  const progress = active.length ? active.reduce((a, d) => a + progressOf(d), 0) / active.length : 0
  const r = 11
  return (
    <button
      className={`relative ${props.className} ${props.open ? 'bg-(--fill)' : ''}`}
      aria-label={active.length ? `Downloads, ${Math.round(progress * 100)}%` : 'Downloads'}
      aria-pressed={props.open}
      title="Downloads"
      onClick={props.onToggle}
    >
      <Download {...icon} />
      {active.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 -rotate-90"
          viewBox="0 0 28 28"
          aria-hidden
        >
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={1.5}
          />
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke="rgb(59 130 246)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * r}
            strokeDashoffset={2 * Math.PI * r * (1 - progress)}
          />
        </svg>
      )}
    </button>
  )
}

const size = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`

export function DownloadsList({ downloads }: { downloads: DownloadState[] }): React.JSX.Element {
  const iconButton =
    'grid size-6 shrink-0 place-items-center rounded-md text-(--muted) hover:bg-(--hover)'
  return (
    <>
      <div className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-[12px] font-medium text-(--muted)">Downloads</h2>
        <button
          className="rounded px-1.5 text-[12px] text-(--muted) hover:bg-(--hover)"
          onClick={() => send({ type: 'clearDownloads' })}
        >
          Clear
        </button>
      </div>
      <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {downloads.map((d) => (
          <li
            key={d.id}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-(--hover)"
          >
            <button
              className="min-w-0 flex-1 text-left disabled:cursor-default"
              disabled={d.state !== 'completed'}
              title={d.state === 'completed' ? `Open ${d.filename}` : d.filename}
              onClick={() => send({ type: 'download', id: d.id, action: 'open' })}
            >
              <div className="truncate">{d.filename}</div>
              <div className="text-[12px] text-(--muted)">
                {d.state === 'progressing'
                  ? `${size(d.received)}${d.total ? ` of ${size(d.total)}` : ''}`
                  : d.state === 'completed'
                    ? size(d.received)
                    : d.state === 'cancelled'
                      ? 'Cancelled'
                      : 'Failed'}
              </div>
              {d.state === 'progressing' && (
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-(--line)">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${progressOf(d) * 100}%` }}
                  />
                </div>
              )}
            </button>
            {d.state === 'completed' && (
              <button
                className={iconButton}
                aria-label={`Show ${d.filename} in folder`}
                onClick={() => send({ type: 'download', id: d.id, action: 'show' })}
              >
                <FolderOpen size={14} strokeWidth={1.5} />
              </button>
            )}
            <button
              className={iconButton}
              aria-label={
                d.state === 'progressing'
                  ? `Cancel ${d.filename}`
                  : `Remove ${d.filename} from the list`
              }
              onClick={() =>
                send({
                  type: 'download',
                  id: d.id,
                  action: d.state === 'progressing' ? 'cancel' : 'remove'
                })
              }
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
