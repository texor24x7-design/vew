import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { Command } from '../shared/ipc'

/**
 * The application menu. Electron's default one has Zoom/Reload/Close items that act on the sidebar's own
 * view (or close the whole window); these act on the page, through the same commands as Vew's shortcuts.
 * Keys pressed in Vew's views are handled by the shortcuts first, which stops the menu firing twice.
 */
export function installMenu(
  run: (cmd: Command) => void,
  isVewWindow: (w: BrowserWindow | null) => boolean
): void {
  const isMac = process.platform === 'darwin'
  // Page actions only make sense in the browser window; other windows (mini window, pop-outs) ignore them.
  const act = (cmd: Command) => (): void => {
    if (isVewWindow(BrowserWindow.getFocusedWindow())) run(cmd)
  }
  const closeTabOrWindow = (): void => {
    const w = BrowserWindow.getFocusedWindow()
    if (isVewWindow(w)) run({ type: 'close' })
    else w?.close()
  }
  const settings = act({ type: 'openInternal', page: 'settings' })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Vew',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: settings },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: act({ type: 'openPalette' }) },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: act({ type: 'reopen' })
        },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: closeTabOrWindow },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => BrowserWindow.getFocusedWindow()?.close()
        },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: act({ type: 'print' }) },
        ...(isMac
          ? []
          : ([
              { type: 'separator' },
              { label: 'Settings', accelerator: 'Ctrl+,', click: settings },
              { role: 'quit' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: act({ type: 'openFind' }) },
        { label: 'Copy URL', accelerator: 'CmdOrCtrl+Shift+C', click: act({ type: 'copyUrl' }) }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+S',
          click: act({ type: 'toggleSidebar' })
        },
        { type: 'separator' },
        { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: act({ type: 'reload' }) },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: act({ type: 'zoom', delta: 0 })
        },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: act({ type: 'zoom', delta: 1 }) },
        // "Cmd +" is typed with Shift on most layouts: same action, not shown twice.
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: act({ type: 'zoom', delta: 1 }),
          visible: false,
          acceleratorWorksWhenHidden: true
        },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: act({ type: 'zoom', delta: -1 }) },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: act({ type: 'devtools' })
        },
        {
          label: 'View Source',
          accelerator: 'Alt+CmdOrCtrl+U',
          click: act({ type: 'viewSource' })
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: act({ type: 'back' }) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: act({ type: 'forward' }) },
        { type: 'separator' },
        {
          label: 'Show All History',
          accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H',
          click: act({ type: 'openInternal', page: 'history' })
        }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
