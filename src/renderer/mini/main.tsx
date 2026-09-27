import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUpRight } from 'lucide-react'
import type { MiniInfo } from '../../shared/ipc'
import { displayHost } from '../../shared/url'
import type { MiniApi } from '../../preload/mini'
import { Favicon, icon } from '../shared/ui'
import './index.css'

const vew = (window as unknown as { vew: MiniApi }).vew
const platform = new URLSearchParams(location.search).get('platform')

/** Toolbar of the mini window: what's open, and a way to move it into a Space. */
function Toolbar(): React.JSX.Element {
  const [info, setInfo] = useState<MiniInfo | null>(null)
  useEffect(() => vew.onInfo(setInfo), [])
  return (
    <div
      className={`flex h-full items-center gap-2 bg-neutral-100 text-[13px] text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 ${
        platform === 'darwin' ? 'pr-2 pl-20' : 'pr-36 pl-3' // traffic lights / caption buttons
      }`}
    >
      {info && <Favicon tab={info} />}
      <span className="min-w-0 truncate font-medium">{info?.title}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500 dark:text-neutral-400">
        {info && displayHost(info.url)}
      </span>
      <button
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => vew.act('move')}
      >
        <ArrowUpRight {...icon} />
        Move to Space…
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toolbar />
  </StrictMode>
)
