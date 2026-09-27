import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2, X } from 'lucide-react'
import type { PeekInfo } from '../../shared/ipc'
import { PAGE_RADIUS, PEEK_TOOLBAR } from '../../shared/layout'
import { displayHost } from '../../shared/url'
import type { OverlayApi } from '../../preload/overlay'
import { Favicon, icon } from '../shared/ui'

const vew = (window as unknown as { vew: OverlayApi }).vew

/** Chrome around the Peek page (the page itself is a native view main stacks above this overlay). */
export function Peek(): React.JSX.Element {
  const [info, setInfo] = useState<PeekInfo | null>(null)
  useEffect(() => vew.onPeek(setInfo), [])
  useEffect(() => {
    if (!info) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') vew.send({ type: 'peekClose' })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [info])

  const r = info?.rect
  return (
    <AnimatePresence>
      {info && r && (
        <motion.div
          key="peek"
          className="fixed inset-0 bg-black/20 dark:bg-black/35"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && vew.send({ type: 'peekClose' })}
        >
          {/* Shadow under the native page, plus the toolbar right above it. */}
          <div
            className="absolute bg-white shadow-2xl dark:bg-neutral-900"
            style={{
              left: r.x,
              top: r.y - PEEK_TOOLBAR,
              width: r.width,
              height: r.height + PEEK_TOOLBAR,
              borderRadius: PAGE_RADIUS + 2
            }}
          />
          <div
            className="absolute flex items-center gap-2 px-3 text-[13px] text-neutral-900 dark:text-neutral-100"
            style={{ left: r.x, top: r.y - PEEK_TOOLBAR, width: r.width, height: PEEK_TOOLBAR }}
          >
            <Favicon tab={info} />
            <span className="min-w-0 truncate font-medium">{info.title}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500 dark:text-neutral-400">
              {displayHost(info.url)}
            </span>
            <button
              className="flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-black/5 dark:hover:bg-white/10"
              title="Open as a tab"
              onClick={() => vew.send({ type: 'peekExpand' })}
            >
              <Maximize2 {...icon} />
              <span>Open as tab</span>
            </button>
            <button
              className="grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Close Peek"
              title="Close (Esc)"
              onClick={() => vew.send({ type: 'peekClose' })}
            >
              <X {...icon} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
