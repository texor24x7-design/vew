import { Globe } from 'lucide-react'

/** Lucide defaults from the design system: 16px, 1.5px stroke. */
export const icon = { size: 16, strokeWidth: 1.5 }

export function Favicon({ tab }: { tab: { favicon?: string } }): React.JSX.Element {
  return tab.favicon ? (
    <img src={tab.favicon} alt="" className="size-4 shrink-0 rounded-sm" draggable={false} />
  ) : (
    <Globe {...icon} className="shrink-0 opacity-60" />
  )
}
