import { useEffect, useState } from 'react'
import type { OverlayApi } from '../../preload/overlay'

const vew = (window as unknown as { vew: OverlayApi }).vew

/** While an extension popup is open, a click anywhere else closes it (like a toolbar popup in Chrome). */
export function PopupCatcher(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  useEffect(() => vew.onPopup(setOpen), [])
  if (!open) return null
  return <div className="fixed inset-0" onMouseDown={() => vew.send({ type: 'closePopup' })} />
}
