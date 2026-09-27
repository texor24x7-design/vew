/**
 * Chrome extension API compatibility layer for Electron's built-in extension support (Vew's own, MIT).
 *
 * Runs in extension service workers and in extension pages Vew opens (popups, options pages). It does nothing
 * anywhere else: website frames never get this script (they have no preload), and in a website's own service
 * worker the protocol check in installShim removes the bridge before the site's code runs. Main only answers
 * workers whose scope is chrome-extension://.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

// In pages the preload can see the URL. In service workers it runs in a separate realm without `location`,
// so the check happens again inside the worker's own realm (installShim), before any worker code runs.
const isExtensionPage = ((): boolean => {
  try {
    return globalThis.location?.protocol === 'chrome-extension:'
  } catch {
    return false
  }
})()
const isWorker = process.type === 'service-worker'

if (isExtensionPage || isWorker) {
  const listeners = new Set<(ns: string, name: string, args: unknown[]) => void>()
  ipcRenderer.on(IPC.crxEvent, (_e, ns: string, name: string, args: unknown[]) => {
    listeners.forEach((cb) => cb(ns, name, args))
  })
  // A worker can call APIs before main has wired up its IPC; retry briefly instead of failing.
  const invoke = async (ns: string, method: string, args: unknown[]): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ipcRenderer.invoke(IPC.crx, ns, method, args)
      } catch (err) {
        if (attempt < 60 && /No handler registered/.test(String(err))) {
          await new Promise((r) => setTimeout(r, 50))
          continue
        }
        throw err
      }
    }
  }
  contextBridge.exposeInMainWorld('__vewCrx', {
    invoke,
    subscribe: (ns: string, name: string) =>
      void invoke('_', 'subscribe', [ns, name]).catch(() => {}),
    onEvent: (cb: (ns: string, name: string, args: unknown[]) => void) => void listeners.add(cb)
  })
  contextBridge.executeInMainWorld({ func: installShim })
}

/**
 * Runs in the extension's own world. Self-contained (it's serialized): no imports or outer variables.
 * Every method and event listed is Vew's, replacing any partial version Electron provides: Electron's own
 * tabs/action objects exist but know nothing about Vew's tabs, so they would silently do nothing.
 * Namespaces not listed (runtime, storage, scripting, i18n, …) stay native.
 */
function installShim(): void {
  type Bridge = {
    invoke: (ns: string, method: string, args: unknown[]) => Promise<unknown>
    subscribe: (ns: string, name: string) => void
    onEvent: (cb: (ns: string, name: string, args: unknown[]) => void) => void
  }
  type AnyFn = (...args: unknown[]) => unknown
  const g = globalThis as unknown as {
    __vewCrx?: Bridge
    chrome?: Record<string, Record<string, unknown>>
  }
  const bridge = g.__vewCrx
  delete g.__vewCrx
  const chrome = g.chrome
  if (!bridge || !chrome) return

  const events = new Map<string, Set<AnyFn>>()
  bridge.onEvent((ns, name, args) => {
    for (const fn of [...(events.get(`${ns}.${name}`) ?? [])]) {
      try {
        fn(...args)
      } catch (err) {
        console.error(err)
      }
    }
  })
  const makeEvent = (ns: string, name: string): Record<string, AnyFn> => {
    const set = new Set<AnyFn>()
    events.set(`${ns}.${name}`, set)
    return {
      addListener: (fn) => {
        if (!set.size) bridge.subscribe(ns, name)
        set.add(fn as AnyFn)
      },
      removeListener: (fn) => void set.delete(fn as AnyFn),
      hasListener: (fn) => set.has(fn as AnyFn),
      hasListeners: () => set.size > 0
    }
  }
  // Chrome APIs take an optional trailing callback, or return a promise.
  const method =
    (ns: string, name: string): AnyFn =>
    (...args) => {
      const cb = typeof args.at(-1) === 'function' ? (args.pop() as AnyFn) : null
      const result = bridge.invoke(ns, name, args)
      if (!cb) return result
      result.then(
        (value) => cb(value),
        (err: unknown) => {
          const runtime = chrome.runtime as { lastError?: { message: string } }
          runtime.lastError = { message: err instanceof Error ? err.message : String(err) }
          try {
            cb()
          } finally {
            delete runtime.lastError
          }
        }
      )
      return undefined
    }

  const API: Record<string, { methods?: string[]; events?: string[] }> = {
    tabs: {
      // sendMessage/connect/executeScript stay native: content-script messaging uses the same tab ids.
      methods: [
        'query',
        'get',
        'getCurrent',
        'create',
        'update',
        'remove',
        'reload',
        'goBack',
        'goForward',
        'getZoom',
        'setZoom',
        'getZoomSettings',
        'discard',
        'duplicate',
        'highlight',
        'move'
      ],
      events: [
        'onCreated',
        'onUpdated',
        'onRemoved',
        'onActivated',
        'onHighlighted',
        'onMoved',
        'onReplaced',
        'onAttached',
        'onDetached',
        'onZoomChange'
      ]
    },
    windows: {
      methods: ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove'],
      events: ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']
    },
    webNavigation: {
      methods: ['getFrame', 'getAllFrames'],
      events: [
        'onBeforeNavigate',
        'onCommitted',
        'onDOMContentLoaded',
        'onCompleted',
        'onErrorOccurred',
        'onHistoryStateUpdated',
        'onReferenceFragmentUpdated',
        'onCreatedNavigationTarget',
        'onTabReplaced'
      ]
    },
    contextMenus: {
      methods: ['create', 'update', 'remove', 'removeAll'],
      events: ['onClicked', 'onShown', 'onHidden']
    },
    notifications: {
      methods: ['create', 'update', 'clear', 'getAll', 'getPermissionLevel'],
      events: [
        'onClicked',
        'onClosed',
        'onButtonClicked',
        'onShowSettings',
        'onPermissionLevelChanged'
      ]
    },
    permissions: {
      methods: ['contains', 'getAll', 'request', 'remove'],
      events: ['onAdded', 'onRemoved']
    },
    action: {
      methods: [
        'setBadgeText',
        'getBadgeText',
        'setBadgeBackgroundColor',
        'getBadgeBackgroundColor',
        'setBadgeTextColor',
        'setTitle',
        'getTitle',
        'setIcon',
        'setPopup',
        'getPopup',
        'openPopup',
        'enable',
        'disable',
        'isEnabled',
        'getUserSettings'
      ],
      events: ['onClicked', 'onUserSettingsChanged']
    },
    sidePanel: {
      methods: ['setOptions', 'getOptions', 'setPanelBehavior', 'getPanelBehavior', 'open']
    },
    commands: { methods: ['getAll'], events: ['onCommand'] }
  }
  // MV2 extensions use browserAction for the same thing.
  API.browserAction = API.action
  for (const [ns, spec] of Object.entries(API)) {
    const target = (chrome[ns] ??= {})
    for (const m of spec.methods ?? []) target[m] = method(ns, m)
    for (const e of spec.events ?? []) target[e] = makeEvent(ns, e)
  }
  const tabs = chrome.tabs as Record<string, unknown>
  tabs.TAB_ID_NONE ??= -1
  const windows = chrome.windows as Record<string, unknown>
  windows.WINDOW_ID_NONE ??= -1
  windows.WINDOW_ID_CURRENT ??= -2
  const menus = chrome.contextMenus as Record<string, unknown>
  menus.ACTION_MENU_TOP_LEVEL_LIMIT ??= 6

  // chrome.privacy.* are ChromeSetting objects; Vew keeps its own settings, so these are inert.
  const setting = (): Record<string, unknown> => ({
    get: (_d: unknown, cb?: AnyFn) =>
      cb
        ? cb({ value: false, levelOfControl: 'controllable_by_this_extension' })
        : Promise.resolve({ value: false, levelOfControl: 'controllable_by_this_extension' }),
    set: (_d: unknown, cb?: AnyFn) => (cb ? cb() : Promise.resolve()),
    clear: (_d: unknown, cb?: AnyFn) => (cb ? cb() : Promise.resolve()),
    onChange: makeEvent('privacy', 'onChange')
  })
  const settingsGroup = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (obj, key: string) => (obj[key] ??= setting())
    })
  chrome.privacy ??= {
    services: settingsGroup(),
    websites: settingsGroup(),
    network: settingsGroup()
  }

  // Extension popups close themselves with window.close(), which Chromium ignores for pages it didn't open
  // by script; route it to Vew.
  if (typeof window !== 'undefined') window.close = () => void bridge.invoke('_', 'closeSelf', [])
}
