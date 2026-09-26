import { join } from 'node:path'
import { app, BrowserWindow, session, WebContentsView } from 'electron'
import { PAGE_RADIUS, WIN_TITLEBAR_HEIGHT, pageBounds } from '../shared/layout'

const secureWebPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false }

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    title: 'Vew',
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: '#00000000',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 16 },
          vibrancy: 'sidebar',
          visualEffectState: 'active'
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#6b7280',
            height: WIN_TITLEBAR_HEIGHT
          },
          backgroundMaterial: 'mica'
        }),
    webPreferences: secureWebPreferences
  })

  // Web content: no preload, fully sandboxed.
  const page = new WebContentsView({ webPreferences: secureWebPreferences })
  page.setBorderRadius(PAGE_RADIUS)
  page.setBackgroundColor('#ffffff')
  // Phase 1 turns these into Vew tabs; until then never spawn unmanaged windows.
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.contentView.addChildView(page)

  const layout = (): void => {
    const [width, height] = win.getContentSize()
    page.setBounds(pageBounds(width, height, process.platform))
  }
  win.on('resize', layout)
  layout()

  const query = { platform: process.platform }
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  page.webContents.loadURL('https://www.google.com')
  win.once('ready-to-show', () => win.show())
}

app.whenReady().then(() => {
  console.log(
    `Vew — Chromium ${process.versions.chrome}, Electron ${process.versions.electron}, ${process.platform}`
  )
  // Deny everything until Phase 6 adds per-site prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
