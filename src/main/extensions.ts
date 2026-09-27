import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  type ContextMenuParams,
  type Extension,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents
} from 'electron'
import { IPC, isExtensionId, type ExtensionInfo, type ExtensionState } from '../shared/ipc'
import { installFromWebStore } from './crx'

/** What the extension system needs from the browser window. */
export interface ExtensionHost {
  windowId(): number
  /** Loaded tabs (with a page) whose session is `ses`, in sidebar order. */
  tabs(ses: Session): HostTab[]
  openTab(url: string, active: boolean, ses: Session): WebContents | null
  activateTab(wc: WebContents): void
  closeTab(wc: WebContents): void
  openPopup(extensionId: string, url: string): void
  changed(): void
}
export interface HostTab {
  wc: WebContents
  active: boolean
  pinned: boolean
  title: string
  url: string
  favicon?: string
  loading: boolean
}

type Args = unknown[]
type Obj = Record<string, unknown>
interface Context {
  extId: string
  ses: Session
  subs: Set<string>
  send: (ns: string, name: string, args: Args) => void
}
interface MenuItem {
  id: string
  title: string
  contexts: string[]
  parentId?: string
  enabled: boolean
  type: string
}
interface ActionState {
  badge: Map<number | 'all', string>
  badgeColor: Map<number | 'all', string>
  title?: string
  icon?: string
  popup?: string
  enabled: boolean
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

let host: ExtensionHost | null = null
const sessions = new Set<Session>()
const contexts = new Map<string, Context>()
const menus = new Map<string, MenuItem[]>()
const actions = new Map<string, ActionState>()
const popupWindows = new Map<number, BrowserWindow>()

const dir = (): string => join(app.getPath('userData'), 'extensions')
const unpackedFile = (): string => join(app.getPath('userData'), 'extensions.json')
const preloadPath = (): string => join(__dirname, '../preload/crx.js')

function unpackedPaths(): string[] {
  try {
    const v: unknown = JSON.parse(readFileSync(unpackedFile(), 'utf8'))
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
const saveUnpacked = (paths: string[]): void =>
  writeFileSync(unpackedFile(), JSON.stringify(paths, null, 2))

/** Newest installed version folder of each Chrome Web Store extension. */
function storePaths(): string[] {
  if (!existsSync(dir())) return []
  return readdirSync(dir())
    .filter(isExtensionId)
    .flatMap((id) => {
      const versions = readdirSync(join(dir(), id))
        .filter((v) => existsSync(join(dir(), id, v, 'manifest.json')))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return versions.length ? [join(dir(), id, versions.at(-1)!)] : []
    })
}

const anySession = (): Session | undefined => sessions.values().next().value
const extensionOf = (id: string, ses?: Session): Extension | null =>
  (ses ?? anySession())?.extensions.getExtension(id) ?? null
const manifestOf = (id: string, ses?: Session): Obj => (extensionOf(id, ses)?.manifest ?? {}) as Obj
const actionManifest = (m: Obj): Obj =>
  isObj(m.action) ? m.action : isObj(m.browser_action) ? m.browser_action : {}

export function setExtensionHost(h: ExtensionHost): void {
  host = h
}

/** Give a profile session the compatibility layer and every installed extension. */
export async function attachExtensions(ses: Session): Promise<void> {
  if (sessions.has(ses)) return
  sessions.add(ses)
  // Only for service workers; the script exits at once unless the worker is an extension's.
  ses.registerPreloadScript({ id: 'vew-crx', type: 'service-worker', filePath: preloadPath() })
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    const key = `sw:${versionId}`
    if (runningStatus === 'stopped') return void contexts.delete(key)
    if (contexts.has(key)) return
    const sw = ses.serviceWorkers.getWorkerFromVersionID(versionId)
    if (!sw?.scope.startsWith('chrome-extension://')) return
    const extId = new URL(sw.scope).host
    const ctx: Context = {
      extId,
      ses,
      subs: new Set(),
      send: (ns, name, args) => !sw.isDestroyed() && sw.send(IPC.crxEvent, ns, name, args)
    }
    contexts.set(key, ctx)
    sw.ipc.handle(IPC.crx, (_e, ns: unknown, method: unknown, args: unknown) =>
      call(ctx, null, ns, method, args)
    )
  })
  for (const path of [...storePaths(), ...unpackedPaths()]) {
    await ses.extensions
      .loadExtension(path)
      .catch((err: Error) => console.warn(`extension ${path}: ${err.message}`))
  }
  host?.changed()
}

// Extension pages (popups, options) Vew opens get the shim as their own preload and call in here.
ipcMain.handle(IPC.crx, (e, ns: unknown, method: unknown, args: unknown) => {
  const url = e.senderFrame?.url ?? ''
  if (!url.startsWith('chrome-extension://') || !sessions.has(e.sender.session))
    throw new Error('not allowed')
  const key = `wc:${e.sender.id}`
  let ctx = contexts.get(key)
  if (!ctx) {
    const wc = e.sender
    ctx = {
      extId: new URL(url).host,
      ses: wc.session,
      subs: new Set(),
      send: (n, name, a) => !wc.isDestroyed() && wc.send(IPC.crxEvent, n, name, a)
    }
    contexts.set(key, ctx)
    wc.once('destroyed', () => contexts.delete(key))
  }
  return call(ctx, e.sender, ns, method, args)
})

/** Send an extension API event to every extension context in `ses` that listens for it. */
function dispatch(ses: Session, ns: string, name: string, args: Args, onlyExt?: string): void {
  for (const ctx of contexts.values()) {
    if (ctx.ses === ses && ctx.subs.has(`${ns}.${name}`) && (!onlyExt || ctx.extId === onlyExt)) {
      ctx.send(ns, name, args)
    }
  }
}

// --- Tabs ------------------------------------------------------------------------------------------

function canSeeUrls(extId: string, ses: Session): boolean {
  const m = manifestOf(extId, ses)
  const perms = Array.isArray(m.permissions) ? m.permissions : []
  const hosts = Array.isArray(m.host_permissions) ? m.host_permissions : []
  // ponytail: any host permission reveals every tab's URL; match patterns per tab if that matters.
  return (
    perms.includes('tabs') ||
    hosts.length > 0 ||
    perms.some((p) => typeof p === 'string' && p.includes('://'))
  )
}

function tabInfo(t: HostTab, index: number, extId: string, ses: Session): Obj {
  const reveal = canSeeUrls(extId, ses)
  const [width, height] = BrowserWindow.fromId(host?.windowId() ?? -1)?.getContentSize() ?? [0, 0]
  return {
    id: t.wc.id,
    index,
    windowId: host?.windowId() ?? 1,
    active: t.active,
    highlighted: t.active,
    selected: t.active,
    pinned: t.pinned,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    audible: t.wc.isCurrentlyAudible(),
    mutedInfo: { muted: t.wc.isAudioMuted() },
    status: t.loading ? 'loading' : 'complete',
    groupId: -1,
    width,
    height,
    ...(reveal && { url: t.url, title: t.title, favIconUrl: t.favicon })
  }
}

const hostTabs = (ses: Session): HostTab[] => host?.tabs(ses) ?? []
const findTab = (ses: Session, id: unknown): HostTab | undefined =>
  hostTabs(ses).find((t) => t.wc.id === id)

/** Chrome match patterns (e.g. "*://*.example.com/*") for tabs.query. */
function matches(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(url)
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace('://.*\\.', '://(.*\\.)?') +
      '$'
  )
  return re.test(url)
}

/** Only web pages, blank pages and the extension's own pages may be opened by an extension. */
function allowedUrl(url: unknown, extId: string): url is string {
  if (typeof url !== 'string') return false
  return (
    /^https?:\/\//i.test(url) ||
    url === 'about:blank' ||
    url.startsWith(`chrome-extension://${extId}/`)
  )
}
const resolveUrl = (url: unknown, extId: string): unknown =>
  typeof url === 'string' && !/^[a-z-]+:/i.test(url)
    ? `chrome-extension://${extId}/${url.replace(/^\//, '')}`
    : url

function tabsApi(ctx: Context, caller: WebContents | null, method: string, a: Args): unknown {
  const { ses, extId } = ctx
  const list = hostTabs(ses)
  const info = (t: HostTab): Obj => tabInfo(t, list.indexOf(t), extId, ses)
  const byId = (id: unknown): HostTab => {
    const t = id === undefined || id === null ? list.find((x) => x.active) : findTab(ses, id)
    if (!t) throw new Error(`No tab with id: ${String(id)}.`)
    return t
  }
  switch (method) {
    case 'query': {
      const q = isObj(a[0]) ? a[0] : {}
      const urls =
        typeof q.url === 'string'
          ? [q.url]
          : Array.isArray(q.url)
            ? q.url.filter((u) => typeof u === 'string')
            : null
      return list
        .filter(
          (t) =>
            (q.active === undefined || q.active === t.active) &&
            (q.pinned === undefined || q.pinned === t.pinned)
        )
        .filter((t) => q.status === undefined || q.status === (t.loading ? 'loading' : 'complete'))
        .filter((t) => q.audible === undefined || q.audible === t.wc.isCurrentlyAudible())
        .filter((t) => !urls || urls.some((u) => matches(u, t.url)))
        .filter((t) => typeof q.title !== 'string' || matches(q.title, t.title))
        .map(info)
    }
    case 'get':
      return info(byId(a[0]))
    case 'getCurrent': {
      const t = caller && list.find((x) => x.wc === caller)
      return t ? info(t) : undefined
    }
    case 'create': {
      const p = isObj(a[0]) ? a[0] : {}
      const url = resolveUrl(p.url ?? 'about:blank', extId)
      if (!allowedUrl(url, extId)) throw new Error('Cannot create a tab with that URL.')
      const wc = host?.openTab(url, p.active !== false, ses)
      const t = wc && hostTabs(ses).find((x) => x.wc === wc)
      return t ? tabInfo(t, hostTabs(ses).indexOf(t), extId, ses) : undefined
    }
    case 'update': {
      const [id, props] =
        typeof a[0] === 'number' || a[0] === undefined || a[0] === null
          ? [a[0], a[1]]
          : [undefined, a[0]]
      const t = byId(id)
      const p = isObj(props) ? props : {}
      if (p.url !== undefined) {
        const url = resolveUrl(p.url, extId)
        if (!allowedUrl(url, extId)) throw new Error('Cannot navigate to that URL.')
        void t.wc.loadURL(url).catch(() => {})
      }
      if (typeof p.muted === 'boolean') t.wc.setAudioMuted(p.muted)
      if (p.active === true || p.highlighted === true) host?.activateTab(t.wc)
      return info(t)
    }
    case 'remove':
      for (const id of Array.isArray(a[0]) ? a[0] : [a[0]]) {
        const t = findTab(ses, id)
        if (t) host?.closeTab(t.wc)
      }
      return undefined
    case 'reload':
      byId(typeof a[0] === 'number' ? a[0] : undefined).wc.reload()
      return undefined
    case 'goBack':
    case 'goForward': {
      const nav = byId(typeof a[0] === 'number' ? a[0] : undefined).wc.navigationHistory
      if (method === 'goBack') nav.goBack()
      else nav.goForward()
      return undefined
    }
    case 'getZoom':
      return byId(a[0]).wc.getZoomFactor()
    case 'setZoom': {
      const factor = num(typeof a[0] === 'number' && a.length > 1 ? a[1] : a[0])
      if (factor && factor >= 0.25 && factor <= 5)
        byId(typeof a[0] === 'number' && a.length > 1 ? a[0] : undefined).wc.setZoomFactor(factor)
      return undefined
    }
    case 'getZoomSettings':
      return { mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1 }
    case 'duplicate': {
      const t = byId(a[0])
      const wc = host?.openTab(t.url, true, ses)
      const copy = wc && hostTabs(ses).find((x) => x.wc === wc)
      return copy ? tabInfo(copy, hostTabs(ses).indexOf(copy), extId, ses) : undefined
    }
    default:
      // discard / highlight / move: nothing meaningful in Vew's sidebar model.
      return undefined
  }
}

function windowInfo(ctx: Context, populate: boolean): Obj {
  const win = BrowserWindow.getAllWindows().find((w) => w.id === host?.windowId())
  const b = win?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
  const list = hostTabs(ctx.ses)
  return {
    id: host?.windowId() ?? 1,
    focused: win?.isFocused() ?? false,
    top: b.y,
    left: b.x,
    width: b.width,
    height: b.height,
    incognito: false,
    type: 'normal',
    state: win?.isFullScreen() ? 'fullscreen' : win?.isMaximized() ? 'maximized' : 'normal',
    alwaysOnTop: false,
    ...(populate && { tabs: list.map((t, i) => tabInfo(t, i, ctx.extId, ctx.ses)) })
  }
}

function windowsApi(ctx: Context, method: string, a: Args): unknown {
  const populate = (v: unknown): boolean => isObj(v) && v.populate === true
  switch (method) {
    case 'get':
      return windowInfo(ctx, populate(a[1]))
    case 'getCurrent':
    case 'getLastFocused':
      return windowInfo(ctx, populate(a[0]))
    case 'getAll':
      return [windowInfo(ctx, populate(a[0]))]
    case 'create': {
      const p = isObj(a[0]) ? a[0] : {}
      const urls = (Array.isArray(p.url) ? p.url : [p.url ?? 'about:blank']).map((u) =>
        resolveUrl(u, ctx.extId)
      )
      // Extensions pop out their own UI (e.g. a password manager's "pop out") as a small window.
      if (
        p.type === 'popup' &&
        typeof urls[0] === 'string' &&
        urls[0].startsWith(`chrome-extension://${ctx.extId}/`)
      ) {
        const win = new BrowserWindow({
          width: Math.min(Math.max(num(p.width) ?? 380, 200), 1200),
          height: Math.min(Math.max(num(p.height) ?? 600, 200), 1000),
          title: extensionOf(ctx.extId, ctx.ses)?.name ?? 'Extension',
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            session: ctx.ses,
            preload: preloadPath()
          }
        })
        win.webContents.on('will-navigate', (e) => {
          if (!e.url.startsWith(`chrome-extension://${ctx.extId}/`)) e.preventDefault()
        })
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        void win.loadURL(urls[0])
        popupWindows.set(win.id, win)
        win.on('closed', () => popupWindows.delete(win.id))
        return { ...windowInfo(ctx, false), id: win.id, type: 'popup', tabs: [] }
      }
      for (const url of urls) if (allowedUrl(url, ctx.extId)) host?.openTab(url, true, ctx.ses)
      return windowInfo(ctx, true)
    }
    case 'update':
      return windowInfo(ctx, false)
    case 'remove':
      popupWindows.get(num(a[0]) ?? -1)?.close()
      return undefined
  }
  return undefined
}

// --- webNavigation -------------------------------------------------------------------------------

type Frame = Electron.WebFrameMain
const frameId = (wc: WebContents, f: Frame | null | undefined): number =>
  !f || f === wc.mainFrame ? 0 : f.routingId
const frameInfo = (wc: WebContents, f: Frame): Obj => ({
  frameId: frameId(wc, f),
  parentFrameId: f.parent ? frameId(wc, f.parent) : -1,
  url: f.url,
  processId: f.processId,
  errorOccurred: false
})

function webNavigationApi(ctx: Context, method: string, a: Args): unknown {
  const q = isObj(a[0]) ? a[0] : {}
  const t = findTab(ctx.ses, q.tabId)
  if (!t) return method === 'getAllFrames' ? [] : null
  const frames = t.wc.mainFrame.framesInSubtree
  if (method === 'getAllFrames') return frames.map((f) => frameInfo(t.wc, f))
  const f = frames.find((x) => frameId(t.wc, x) === q.frameId)
  return f ? frameInfo(t.wc, f) : null
}

/** Report a tab's navigation and state to extensions (tabs.* and webNavigation.* events). */
export function watchTab(wc: WebContents): void {
  const ses = wc.session
  if (!sessions.has(ses)) return
  const tabId = wc.id
  const nav = (name: string, details: Obj): void =>
    dispatch(ses, 'webNavigation', name, [{ tabId, timeStamp: Date.now(), ...details }])
  const updated = (change: Obj): void => {
    const list = hostTabs(ses)
    const t = list.find((x) => x.wc === wc)
    for (const ctx of contexts.values()) {
      if (ctx.ses !== ses || !ctx.subs.has('tabs.onUpdated') || !t) continue
      const reveal = canSeeUrls(ctx.extId, ses)
      const visible = reveal
        ? change
        : Object.fromEntries(
            Object.entries(change).filter(([k]) => !['url', 'title', 'favIconUrl'].includes(k))
          )
      if (Object.keys(visible).length)
        ctx.send('tabs', 'onUpdated', [tabId, visible, tabInfo(t, list.indexOf(t), ctx.extId, ses)])
    }
  }
  wc.on('did-start-navigation', (d) => {
    if (d.isSameDocument || !d.frame) return
    nav('onBeforeNavigate', {
      url: d.url,
      frameId: frameId(wc, d.frame),
      parentFrameId: d.frame.parent ? frameId(wc, d.frame.parent) : -1,
      processId: d.frame.processId
    })
  })
  wc.on('did-frame-navigate', (_e, url, _code, _text, isMainFrame, processId, routingId) => {
    nav('onCommitted', {
      url,
      frameId: isMainFrame ? 0 : routingId,
      processId,
      transitionType: 'link',
      transitionQualifiers: []
    })
    if (isMainFrame) updated({ url, status: 'loading' })
  })
  wc.on('dom-ready', () =>
    nav('onDOMContentLoaded', { url: wc.getURL(), frameId: 0, processId: wc.mainFrame.processId })
  )
  wc.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    const f = isMainFrame
      ? wc.mainFrame
      : wc.mainFrame.framesInSubtree.find((x) => x.routingId === routingId)
    nav('onCompleted', { url: f?.url ?? '', frameId: isMainFrame ? 0 : routingId, processId })
  })
  wc.on('did-navigate-in-page', (_e, url, isMainFrame, processId, routingId) => {
    nav('onHistoryStateUpdated', {
      url,
      frameId: isMainFrame ? 0 : routingId,
      processId,
      transitionType: 'link',
      transitionQualifiers: []
    })
    if (isMainFrame) updated({ url })
  })
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame, processId, routingId) => {
    if (code !== -3)
      nav('onErrorOccurred', {
        url,
        error: description,
        frameId: isMainFrame ? 0 : routingId,
        processId
      })
  })
  wc.on('did-start-loading', () => updated({ status: 'loading' }))
  wc.on('did-stop-loading', () => updated({ status: 'complete' }))
  wc.on('page-title-updated', (_e, title) => updated({ title }))
  wc.on('page-favicon-updated', (_e, icons) => updated({ favIconUrl: icons[0] }))
  wc.on('audio-state-changed', (e) => updated({ audible: e.audible }))
  wc.once('destroyed', () => {
    dispatch(ses, 'tabs', 'onRemoved', [
      tabId,
      { windowId: host?.windowId() ?? 1, isWindowClosing: false }
    ])
    for (const a of actions.values()) {
      a.badge.delete(tabId)
      a.badgeColor.delete(tabId)
    }
  })
  queueMicrotask(() => {
    for (const ctx of contexts.values()) {
      const list = hostTabs(ses)
      const t = list.find((x) => x.wc === wc)
      if (ctx.ses === ses && ctx.subs.has('tabs.onCreated') && t)
        ctx.send('tabs', 'onCreated', [tabInfo(t, list.indexOf(t), ctx.extId, ses)])
    }
  })
}

export function tabActivated(wc: WebContents): void {
  if (!sessions.has(wc.session)) return
  dispatch(wc.session, 'tabs', 'onActivated', [{ tabId: wc.id, windowId: host?.windowId() ?? 1 }])
  host?.changed() // badges are per tab
}

// --- contextMenus, notifications, permissions, action ------------------------------------------------

function contextMenusApi(ctx: Context, method: string, a: Args): unknown {
  const items = menus.get(ctx.extId) ?? []
  menus.set(ctx.extId, items)
  switch (method) {
    case 'create': {
      const p = isObj(a[0]) ? a[0] : {}
      const id = str(p.id) ?? String(num(p.id) ?? `${ctx.extId}-${items.length + 1}-${Date.now()}`)
      if (items.some((i) => i.id === id))
        throw new Error(`Cannot create item with duplicate id ${id}`)
      items.push({
        id,
        title: (str(p.title) ?? '').slice(0, 300),
        contexts: Array.isArray(p.contexts)
          ? p.contexts.filter((c): c is string => typeof c === 'string')
          : ['page'],
        parentId: p.parentId === undefined ? undefined : String(p.parentId),
        enabled: p.enabled !== false,
        type: str(p.type) ?? 'normal'
      })
      return id
    }
    case 'update': {
      const item = items.find((i) => i.id === String(a[0]))
      const p = isObj(a[1]) ? a[1] : {}
      if (item) {
        if (typeof p.title === 'string') item.title = p.title.slice(0, 300)
        if (typeof p.enabled === 'boolean') item.enabled = p.enabled
        if (Array.isArray(p.contexts))
          item.contexts = p.contexts.filter((c): c is string => typeof c === 'string')
      }
      return undefined
    }
    case 'remove':
      menus.set(
        ctx.extId,
        items.filter((i) => i.id !== String(a[0]) && i.parentId !== String(a[0]))
      )
      return undefined
    case 'removeAll':
      menus.set(ctx.extId, [])
      return undefined
  }
  return undefined
}

/** Extension items for a page's right-click menu. */
export function extensionMenuItems(
  wc: WebContents,
  params: ContextMenuParams
): MenuItemConstructorOptions[] {
  const ses = wc.session
  if (!sessions.has(ses)) return []
  const kinds = new Set(['all', 'page', 'frame'])
  if (params.selectionText) kinds.add('selection')
  if (params.linkURL) kinds.add('link')
  if (params.isEditable) kinds.add('editable')
  if (params.mediaType === 'image') kinds.add('image')
  if (params.mediaType === 'video') kinds.add('video')
  if (params.mediaType === 'audio') kinds.add('audio')
  const out: MenuItemConstructorOptions[] = []
  for (const [extId, items] of menus) {
    if (!extensionOf(extId, ses)) continue
    const build = (parent?: string): MenuItemConstructorOptions[] =>
      items
        .filter((i) => i.parentId === parent && i.contexts.some((c) => kinds.has(c)))
        .map((i) => {
          if (i.type === 'separator') return { type: 'separator' as const }
          const children = build(i.id)
          return {
            label: i.title.replace(/%s/g, params.selectionText.slice(0, 40)),
            enabled: i.enabled,
            ...(children.length
              ? { submenu: children }
              : {
                  click: () =>
                    dispatch(
                      ses,
                      'contextMenus',
                      'onClicked',
                      [
                        {
                          menuItemId: i.id,
                          parentMenuItemId: i.parentId,
                          pageUrl: params.pageURL,
                          frameUrl: params.frameURL || undefined,
                          linkUrl: params.linkURL || undefined,
                          srcUrl: params.srcURL || undefined,
                          selectionText: params.selectionText || undefined,
                          editable: params.isEditable,
                          mediaType: params.mediaType === 'none' ? undefined : params.mediaType,
                          frameId: 0
                        },
                        (() => {
                          const list = hostTabs(ses)
                          const t = list.find((x) => x.wc === wc)
                          return t ? tabInfo(t, list.indexOf(t), extId, ses) : undefined
                        })()
                      ],
                      extId
                    )
                })
          }
        })
    const top = build()
    if (!top.length) continue
    const name = extensionOf(extId, ses)?.name ?? 'Extension'
    // Chrome groups several items from one extension under its name.
    out.push(...(top.length > 1 ? [{ label: name, submenu: top }] : top))
  }
  return out
}

const notifications = new Map<string, Notification>()
function notificationsApi(ctx: Context, method: string, a: Args): unknown {
  switch (method) {
    case 'create': {
      const [id, opts] = typeof a[0] === 'string' ? [a[0], a[1]] : [`${Date.now()}`, a[0]]
      const o = isObj(opts) ? opts : {}
      const n = new Notification({
        title: str(o.title) ?? '',
        body: str(o.message) ?? '',
        silent: o.silent === true
      })
      n.on('click', () => dispatch(ctx.ses, 'notifications', 'onClicked', [id], ctx.extId))
      n.on('close', () => dispatch(ctx.ses, 'notifications', 'onClosed', [id, true], ctx.extId))
      notifications.get(`${ctx.extId}/${id}`)?.close()
      notifications.set(`${ctx.extId}/${id}`, n)
      n.show()
      return id
    }
    case 'clear': {
      const n = notifications.get(`${ctx.extId}/${String(a[0])}`)
      n?.close()
      return Boolean(n)
    }
    case 'getAll':
      return Object.fromEntries(
        [...notifications.keys()]
          .filter((k) => k.startsWith(`${ctx.extId}/`))
          .map((k) => [k.slice(ctx.extId.length + 1), true])
      )
    case 'getPermissionLevel':
      return 'granted'
  }
  return undefined
}

function permissionsApi(ctx: Context, method: string, a: Args): unknown {
  const m = manifestOf(ctx.extId, ctx.ses)
  const granted = {
    permissions: (Array.isArray(m.permissions) ? m.permissions : []).filter(
      (p) => typeof p === 'string' && !p.includes('://')
    ),
    origins: [
      ...(Array.isArray(m.host_permissions) ? m.host_permissions : []),
      ...(Array.isArray(m.permissions)
        ? m.permissions.filter((p) => typeof p === 'string' && p.includes('://'))
        : [])
    ]
  }
  const q = isObj(a[0]) ? a[0] : {}
  const has = (): boolean =>
    (Array.isArray(q.permissions) ? q.permissions : []).every((p) =>
      granted.permissions.includes(p)
    ) &&
    (Array.isArray(q.origins) ? q.origins : []).every(
      (o) => granted.origins.includes(o) || granted.origins.includes('<all_urls>')
    )
  switch (method) {
    case 'getAll':
      return granted
    case 'contains':
    case 'request': // ponytail: optional permissions aren't granted at runtime; only what the manifest declares
      return has()
    case 'remove':
      return false
  }
  return undefined
}

const actionState = (extId: string): ActionState => {
  let s = actions.get(extId)
  if (!s) {
    s = { badge: new Map(), badgeColor: new Map(), enabled: true }
    actions.set(extId, s)
  }
  return s
}
const colorOf = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length >= 3)
    return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${(num(v[3]) ?? 255) / 255})`
  return undefined
}
function iconDataUrl(extId: string, ses: Session, icon: unknown): string | undefined {
  const ext = extensionOf(extId, ses)
  if (!ext) return undefined
  const pick = (v: unknown): string | undefined =>
    typeof v === 'string'
      ? v
      : isObj(v)
        ? (Object.entries(v)
            .filter(([, p]) => typeof p === 'string')
            .sort(([a], [b]) => Math.abs(Number(a) - 32) - Math.abs(Number(b) - 32))[0]?.[1] as
            string | undefined)
        : undefined
  const rel = pick(icon)
  if (!rel) return undefined
  const file = join(ext.path, rel.replace(/^\//, ''))
  if (!file.startsWith(ext.path)) return undefined // no ../ out of the extension
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? undefined : img.resize({ width: 32 }).toDataURL()
}

function actionApi(ctx: Context, method: string, a: Args): unknown {
  const s = actionState(ctx.extId)
  const d = isObj(a[0]) ? a[0] : {}
  const key = (num(d.tabId) ?? 'all') as number | 'all'
  const read = <T>(map: Map<number | 'all', T>): T | undefined => map.get(key) ?? map.get('all')
  switch (method) {
    case 'setBadgeText':
      s.badge.set(key, (str(d.text) ?? '').slice(0, 4))
      break
    case 'getBadgeText':
      return read(s.badge) ?? ''
    case 'setBadgeBackgroundColor':
      s.badgeColor.set(key, colorOf(d.color) ?? '#d93025')
      break
    case 'getBadgeBackgroundColor':
      return [217, 48, 37, 255]
    case 'setTitle':
      s.title = str(d.title)
      break
    case 'getTitle':
      return s.title ?? extensionOf(ctx.extId, ctx.ses)?.name ?? ''
    case 'setIcon':
      s.icon = d.path !== undefined ? iconDataUrl(ctx.extId, ctx.ses, d.path) : s.icon
      break
    case 'setPopup':
      s.popup = str(d.popup)
      break
    case 'getPopup':
      return popupUrl(ctx.extId, ctx.ses) ?? ''
    case 'enable':
    case 'disable':
      s.enabled = method === 'enable'
      break
    case 'isEnabled':
      return s.enabled
    case 'openPopup': {
      const url = popupUrl(ctx.extId, ctx.ses)
      if (url) host?.openPopup(ctx.extId, url)
      break
    }
    case 'getUserSettings':
      return { isOnToolbar: true }
  }
  host?.changed()
  return undefined
}

function popupUrl(extId: string, ses: Session): string | undefined {
  const override = actions.get(extId)?.popup
  const popup = override ?? str(actionManifest(manifestOf(extId, ses)).default_popup)
  return popup ? `chrome-extension://${extId}/${popup.replace(/^\//, '')}` : undefined
}

function call(
  ctx: Context,
  caller: WebContents | null,
  ns: unknown,
  method: unknown,
  rawArgs: unknown
): unknown {
  if (typeof ns !== 'string' || typeof method !== 'string') throw new Error('bad call')
  const args = Array.isArray(rawArgs) ? rawArgs : []
  switch (ns) {
    case '_':
      if (method === 'subscribe' && typeof args[0] === 'string' && typeof args[1] === 'string') {
        ctx.subs.add(`${args[0] === 'browserAction' ? 'action' : args[0]}.${args[1]}`)
      }
      // Destroying the page lets its owner (popup, pop-out window or tab) clean up as usual.
      if (method === 'closeSelf' && caller)
        setImmediate(() => !caller.isDestroyed() && caller.close())
      return undefined
    case 'tabs':
      return tabsApi(ctx, caller, method, args)
    case 'windows':
      return windowsApi(ctx, method, args)
    case 'webNavigation':
      return webNavigationApi(ctx, method, args)
    case 'contextMenus':
      return contextMenusApi(ctx, method, args)
    case 'notifications':
      return notificationsApi(ctx, method, args)
    case 'permissions':
      return permissionsApi(ctx, method, args)
    case 'action':
    case 'browserAction':
      return actionApi(ctx, method, args)
    case 'commands':
      return method === 'getAll' ? [] : undefined
    case 'sidePanel':
      return method === 'getOptions'
        ? { enabled: false }
        : method === 'getPanelBehavior'
          ? { openPanelOnActionClick: false }
          : undefined
  }
  throw new Error(`chrome.${ns}.${method} is not supported in Vew`)
}

// --- UI + management ---------------------------------------------------------------------------------

/** Icon row state for the sidebar (only extensions with a toolbar action). */
export function extensionStates(ses: Session, activeTabId: number | undefined): ExtensionState[] {
  if (!sessions.has(ses)) return []
  return ses.extensions
    .getAllExtensions()
    .filter((e) => Object.keys(actionManifest(e.manifest as Obj)).length > 0 || popupUrl(e.id, ses))
    .map((e) => {
      const s = actionState(e.id)
      const m = e.manifest as Obj
      const at = <T>(map: Map<number | 'all', T>): T | undefined =>
        (activeTabId !== undefined ? map.get(activeTabId) : undefined) ?? map.get('all')
      return {
        id: e.id,
        name: s.title ?? e.name,
        icon: s.icon ?? iconDataUrl(e.id, ses, actionManifest(m).default_icon ?? m.icons),
        badge: at(s.badge) ?? '',
        badgeColor: at(s.badgeColor) ?? '#d93025',
        hasPopup: Boolean(popupUrl(e.id, ses))
      }
    })
}

/** Toolbar click: the popup URL to show, or (no popup) action.onClicked for the active tab. */
export function clickAction(
  extId: string,
  ses: Session,
  activeWc: WebContents | undefined
): string | undefined {
  const url = popupUrl(extId, ses)
  if (url) return url
  const list = hostTabs(ses)
  const t = list.find((x) => x.wc === activeWc)
  if (t) {
    dispatch(ses, 'action', 'onClicked', [tabInfo(t, list.indexOf(t), extId, ses)], extId)
    dispatch(ses, 'browserAction', 'onClicked', [tabInfo(t, list.indexOf(t), extId, ses)], extId)
  }
  return undefined
}

export function optionsUrl(extId: string, ses: Session): string | undefined {
  const m = manifestOf(extId, ses)
  const page = str(isObj(m.options_ui) ? m.options_ui.page : undefined) ?? str(m.options_page)
  return page ? `chrome-extension://${extId}/${page.replace(/^\//, '')}` : undefined
}

export function listExtensions(): ExtensionInfo[] {
  const unpacked = new Set(unpackedPaths())
  return (anySession()?.extensions.getAllExtensions() ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    version: e.version,
    description: str((e.manifest as Obj).description) ?? '',
    unpacked: unpacked.has(e.path),
    path: e.path
  }))
}

/** Chrome Web Store URL or bare id → install into every profile. */
export async function installFromStore(source: string): Promise<ExtensionInfo[]> {
  const id = /[a-p]{32}/.exec(source)?.[0]
  if (!id) throw new Error('That isn’t a Chrome Web Store link or extension id.')
  if (!sessions.size) throw new Error('No profile is ready yet.')
  const path = await installFromWebStore(id, dir())
  for (const ses of sessions) {
    if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id) // an update replaces it
    await ses.extensions.loadExtension(path)
  }
  host?.changed()
  return listExtensions()
}

export async function loadUnpacked(): Promise<ExtensionInfo[]> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Load unpacked extension',
    properties: ['openDirectory']
  })
  const path = filePaths[0]
  if (canceled || !path) return listExtensions()
  if (!existsSync(join(path, 'manifest.json'))) throw new Error('That folder has no manifest.json.')
  for (const ses of sessions) await ses.extensions.loadExtension(path)
  saveUnpacked([...new Set([...unpackedPaths(), path])])
  host?.changed()
  return listExtensions()
}

export async function removeExtension(id: string): Promise<ExtensionInfo[]> {
  const ext = extensionOf(id)
  for (const ses of sessions) ses.extensions.removeExtension(id)
  menus.delete(id)
  actions.delete(id)
  if (ext) {
    if (unpackedPaths().includes(ext.path))
      saveUnpacked(unpackedPaths().filter((p) => p !== ext.path))
    // Store installs live under our folder and are deleted; an unpacked folder is the user's and stays.
    else rmSync(join(dir(), id), { recursive: true, force: true })
  }
  host?.changed()
  return listExtensions()
}
