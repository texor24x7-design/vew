import { join } from 'node:path'
import { BrowserWindow, ipcMain, Menu, WebContentsView, type IpcMainEvent } from 'electron'
import { IPC, isMiniAction, type MiniAction, type MiniInfo } from '../shared/ipc'
import { WIN_TITLEBAR_HEIGHT } from '../shared/layout'
import { sessionFor } from './profiles'
import { history } from './history'
import { closeView, load, loadPage, secureWebPreferences, type VewWindow } from './window'

const TOOLBAR = 40
const isMac = process.platform === 'darwin'

/**
 * A small quick window for links opened from other apps (like Little Arc). "Move to Space…" hands the
 * page to the main window as a normal tab.
 */
export class MiniWindow {
  private readonly win: BrowserWindow
  private readonly page: WebContentsView
  private readonly info: MiniInfo
  private moved = false

  constructor(
    url: string,
    private readonly main: () => VewWindow
  ) {
    const profileId = main().profileId
    this.info = { url, title: url }
    this.win = new BrowserWindow({
      title: 'Vew',
      width: 900,
      height: 640,
      minWidth: 420,
      minHeight: 300,
      show: false,
      ...(isMac
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
        : {
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: '#00000000', symbolColor: '#6b7280', height: TOOLBAR }
          }),
      webPreferences: { ...secureWebPreferences, preload: join(__dirname, '../preload/mini.js') }
    })
    const toolbar = this.win.webContents
    loadPage(toolbar, 'mini', { platform: process.platform })

    this.page = new WebContentsView({
      webPreferences: { ...secureWebPreferences, session: sessionFor(profileId) }
    })
    const wc = this.page.webContents
    const update = (patch: Partial<MiniInfo>): void => {
      Object.assign(this.info, patch)
      if (!toolbar.isDestroyed()) toolbar.send(IPC.miniInfo, this.info)
    }
    toolbar.on('did-finish-load', () => update({}))
    wc.on('page-title-updated', (_e, title) => {
      update({ title })
      history().setTitle(wc.getURL(), title)
    })
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] }))
    wc.on('did-navigate', (_e, u) => {
      update({ url: u })
      history().visit(u)
    })
    // Keep the mini window to one page: links that want a new window open right here.
    wc.setWindowOpenHandler(({ url: next }) => {
      load(wc, next)
      return { action: 'deny' }
    })
    for (const target of [wc, toolbar]) {
      target.on('before-input-event', (e, input) => {
        const mod = isMac ? input.meta : input.control
        if (input.type === 'keyDown' && mod && input.key.toLowerCase() === 'w') {
          e.preventDefault()
          this.win.close()
        }
      })
    }
    this.win.contentView.addChildView(this.page)
    this.layout()
    this.win.on('resize', () => this.layout())

    const onAction = (e: IpcMainEvent, action: unknown): void => {
      if (e.sender === toolbar && isMiniAction(action)) this.act(action, profileId)
    }
    ipcMain.on(IPC.miniAction, onAction)
    this.win.on('closed', () => {
      ipcMain.off(IPC.miniAction, onAction)
      if (!this.moved) closeView(this.page)
    })
    load(wc, url)
    this.win.once('ready-to-show', () => this.win.show())
  }

  private layout(): void {
    const [width, height] = this.win.getContentSize()
    const top = isMac ? TOOLBAR : Math.max(TOOLBAR, WIN_TITLEBAR_HEIGHT)
    this.page.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
  }

  private act(action: MiniAction, profileId: string): void {
    if (action === 'close') return this.win.close()
    const main = this.main()
    const items = main.spaceList.map((sp) => ({
      label: `${sp.icon}  ${sp.name}`,
      click: () => {
        this.moved = true
        this.win.contentView.removeChildView(this.page)
        main.adoptPage(this.page, this.info, sp.id, profileId)
        this.win.close()
      }
    }))
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }
}
