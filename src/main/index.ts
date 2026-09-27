import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import { loadBlocker } from './adblock'
import { registerInternalScheme, serveInternalPages } from './internal'
import { installMenu } from './menu'
import { MiniWindow } from './mini'
import { settings } from './settings'
import { refreshAccounts } from './texor'
import { installUpdate, startUpdates } from './updater'
import { VewWindow } from './window'

registerInternalScheme()

// `npm run dev:fresh` (or VEW_FRESH=1): a first-run Vew with throwaway data, beside your normal one.
if (
  !app.isPackaged &&
  (process.env['npm_lifecycle_event'] === 'dev:fresh' || process.env['VEW_FRESH'])
) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'vew-fresh-')))
}

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
/** An .html file handed over by the OS (Windows passes its path as an argument). */
const isHtmlFile = (v: unknown): v is string =>
  typeof v === 'string' && /\.x?html?$/i.test(v) && existsSync(v)
/** A link or an .html file from the command line (Windows), as a URL to open. */
const linkIn = (argv: string[]): string | undefined => {
  const file = argv.slice(1).find(isHtmlFile)
  return argv.find(isWebUrl) ?? (file && pathToFileURL(file).href)
}
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
// …and .html files opened with Vew (Finder, "Open With").
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (isHtmlFile(path)) openLink(pathToFileURL(path).href)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows: opening a link while Vew runs starts a second instance with the URL in its arguments.
  app.on('second-instance', (_e, argv) => {
    const url = linkIn(argv)
    if (url) return openLink(url)
    const win = mainWindow().win
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    console.log(
      `Vew — Chromium ${process.versions.chrome}, Electron ${process.versions.electron}, ${process.platform}`
    )
    // Packaged builds carry the icon in the app bundle; in development the Dock would show Electron's.
    if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
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
      finishWelcome: () => mainWindow().finishWelcome(),
      account: () => mainWindow().account,
      signIn: () => mainWindow().signIn(),
      signOut: () => mainWindow().signOut()
    })
    void loadBlocker()
    void refreshAccounts()
    const menu = (update?: { version: string; install: () => void }): void =>
      installMenu(
        (cmd) => mainWindow().run(cmd),
        (w) => main !== null && w === main.win,
        update
      )
    menu()
    startUpdates((version) => {
      menu({ version, install: installUpdate })
      mainWindow().toast(`Vew ${version} is ready. It installs when you quit.`)
    })
    // The footage's CC BY credits live here, in About Vew, rather than on onboarding.
    app.setAboutPanelOptions({
      applicationName: 'Vew',
      credits:
        'Vew by Texor.\n\nOnboarding footage from Wikimedia Commons: “Aerial view of sand beach” by Nature video, HD – 4K and “Aerial views of forest in Russia” by Flykit production (CC BY 3.0); “Ocean surface waves 06” by Mostafameraji (CC0); US Forest Service and BLM Oregon & Washington (public domain).'
    })
    mainWindow()
    // Launched to open a link (Windows passes it as an argument; macOS queued it above).
    const launchLink = linkIn(process.argv)
    for (const url of [...(launchLink ? [launchLink] : []), ...pending.splice(0)]) openLink(url)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
