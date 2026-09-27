import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Auto-updates from GitHub Releases (packaged builds only). Updates download in the background and install
 * when Vew quits; `onReady` lets the UI offer to restart sooner. Failures (offline, no release yet) are
 * only logged. macOS installs updates only into a signed app.
 */
export function startUpdates(onReady: (version: string) => void): void {
  if (!app.isPackaged) return
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.error('Update check failed:', err.message))
  autoUpdater.on('update-downloaded', (info) => onReady(info.version))
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_EVERY_MS)
}

export const installUpdate = (): void => autoUpdater.quitAndInstall()
