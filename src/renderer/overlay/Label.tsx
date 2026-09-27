import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { RailLabel } from '../../shared/ipc'
import { displayHost } from '../../shared/url'
import type { OverlayApi } from '../../preload/overlay'
import { Favicon } from '../shared/ui'

const vew = (window as unknown as { vew: OverlayApi }).vew

/** The pill beside a hovered icon in the collapsed rail (main sizes the overlay to just this). */
export function Label(): React.JSX.Element {
  const [label, setLabel] = useState<RailLabel | null>(null)
  useEffect(() => vew.onLabel(setLabel), [])
  return (
    <AnimatePresence>
      {label && (
        <motion.div
          key={label.id}
          role="tooltip"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ type: 'spring', stiffness: 700, damping: 40 }}
          className="fixed top-1.5 left-1.5 flex h-8 max-w-[300px] items-center gap-2 rounded-full bg-white/95 pr-3.5 pl-2.5 text-[13px] text-neutral-900 shadow-lg ring-1 ring-black/10 backdrop-blur dark:bg-neutral-800/95 dark:text-neutral-100 dark:ring-white/10"
        >
          <Favicon tab={label} />
          <span className="min-w-0 truncate font-medium">{label.title}</span>
          <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
            {displayHost(label.url)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
