import { app, BrowserWindow, session } from 'electron'
import { VewWindow } from './window'

app.whenReady().then(() => {
  console.log(
    `Vew — Chromium ${process.versions.chrome}, Electron ${process.versions.electron}, ${process.platform}`
  )
  // Deny everything until Phase 6 adds per-site prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  new VewWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) new VewWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
