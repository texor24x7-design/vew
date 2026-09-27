import { app, BrowserWindow, nativeTheme, session } from 'electron'
import { loadBlocker } from './adblock'
import { registerInternalScheme, serveInternalPages } from './internal'
import { MiniWindow } from './mini'
import { settings } from './settings'
import { VewWindow } from './window'

registerInternalScheme()

let main: VewWindow | null = null
/** The browser window, created on demand (e.g. a link arrives while it's closed on macOS). */
const mainWindow = (): VewWindow => {
  if (!main) {
    const created = new VewWindow()
    created.win.on('closed', () => {
      if (main === created) main = null
    })
    main = created
  }
  return main
}

// Only real web links: never file:, javascript: or custom schemes passed in by other apps.
const isWebUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v)
const pending: string[] = []
/** Links from other apps open in a mini window (like Little Arc). */
const openLink = (url: string): void => {
  if (app.isReady()) new MiniWindow(url, mainWindow)
  else pending.push(url)
}

// macOS hands links over as 'open-url', possibly before the app is ready.
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (isWebUrl(url)) openLink(url)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows: opening a link while Vew runs starts a second instance with the URL in its arguments.
  app.on('second-instance', (_e, argv) => {
    const url = argv.find(isWebUrl)
    if (url) return openLink(url)
    const win = mainWindow().win
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    console.log(
      `Vew — Chromium ${process.versions.chrome}, Electron ${process.versions.electron}, ${process.platform}`
    )
    settings.load()
    const applyAppearance = (): void => {
      nativeTheme.themeSource = settings.get().appearance
    }
    applyAppearance()
    settings.subscribe(applyAppearance)
    // The default session only hosts Vew's own pages (websites use profile sessions): no permissions.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )
    serveInternalPages({
      openUrl: (url) => mainWindow().run({ type: 'open', input: url }),
      colors: () => mainWindow().spaceColors(),
      setColors: (colors) => mainWindow().setSpaceColors(colors),
      importBookmarks: (folder) => mainWindow().importBookmarks(folder),
      finishWelcome: () => mainWindow().finishWelcome()
    })
    void loadBlocker()
    mainWindow()
    // Launched to open a link (Windows passes it as an argument; macOS queued it above).
    for (const url of [...process.argv.slice(1).filter(isWebUrl), ...pending.splice(0)])
      openLink(url)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
