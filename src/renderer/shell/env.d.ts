import type { VewApi } from '../../preload'

declare global {
  interface Window {
    vew: VewApi
  }
}
