import { PAGE_INSET, PAGE_RADIUS, SIDEBAR_WIDTH, pageTop } from '../../shared/layout'

const platform = new URLSearchParams(location.search).get('platform') ?? ''

export default function App(): React.JSX.Element {
  return (
    <div className="relative h-full">
      {/* Empty sidebar; top padding clears the macOS traffic lights. */}
      <aside className="h-full pt-12" style={{ width: SIDEBAR_WIDTH }} />
      {/* Soft shadow under the native page card, which Chromium paints on top of this. */}
      <div
        className="absolute bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)]"
        style={{
          left: SIDEBAR_WIDTH + PAGE_INSET,
          top: pageTop(platform),
          right: PAGE_INSET,
          bottom: PAGE_INSET,
          borderRadius: PAGE_RADIUS
        }}
      />
    </div>
  )
}
