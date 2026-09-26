# Vew — Build Plan for Claude Code

> Put this file in the root of the `vew` repo as `CLAUDE.md`. Claude Code reads it automatically at the start of every session.
> Build **one phase at a time**. Don't start the next phase until the current one's acceptance checks pass.

---

## 1. What Vew is

Vew is a desktop web browser for **macOS and Windows** with an interface on the level of Arc: a vertical sidebar instead of a tab strip, color-themed Spaces, a keyboard-first command bar, split view, and a calm, polished, minimal look where the web page is the hero.

**Engine: Vew uses Chromium.** Every web page is rendered by Chromium through Electron, which bundles Chromium. Do NOT write a rendering engine, use a different engine, or use the deprecated `<webview>` tag or `BrowserView`. Every tab is an Electron **`WebContentsView`** (Chromium's WebContents) managed by the main process. Always target the **latest stable Electron release** so Vew ships a current, security-patched Chromium.

---

## 2. Tech stack

| Area                | Choice                                                                |
| ------------------- | --------------------------------------------------------------------- |
| Runtime / engine    | Electron (latest stable), which bundles Chromium                      |
| Build tooling       | `electron-vite`                                                       |
| Language            | TypeScript (strict mode) everywhere                                   |
| UI shell            | React + Tailwind CSS                                                  |
| Animation           | Framer Motion                                                         |
| State               | Zustand (renderer), single source of truth in main process            |
| Command bar         | `cmdk`                                                                |
| Persistence         | `better-sqlite3` (history, tabs, spaces), `electron-store` (settings) |
| Ad/tracker blocking | `@ghostery/adblocker-electron`                                        |
| Extensions (later)  | `electron-chrome-extensions`                                          |
| Packaging           | `electron-builder` (.dmg for macOS, NSIS .exe for Windows)            |
| Updates             | `electron-updater`                                                    |
| Testing             | Vitest (unit), Playwright for Electron (e2e)                          |
| Lint/format         | ESLint + Prettier                                                     |

---

## 3. Architecture

```
┌──────────────────── BrowserWindow (frameless) ─────────────────────┐
│ ┌──────────────┐ ┌──────────────────────────────────────────────┐ │
│ │  UI shell     │ │  Active tab = WebContentsView (Chromium)     │ │
│ │  (React)      │ │  positioned to the right of the sidebar,     │ │
│ │  sidebar,     │ │  inset with padding + rounded corners        │ │
│ │  spaces,      │ │                                              │ │
│ │  URL field    │ │  Split view = 2–4 WebContentsViews           │ │
│ └──────────────┘ └──────────────────────────────────────────────┘ │
│       ▲ Overlay WebContentsView (command bar, menus) on top        │
└────────────────────────────────────────────────────────────────────┘
```

- **Main process** owns all browser state: windows, spaces, tabs, their `WebContentsView`s, history, downloads, and settings. It is the single source of truth.
- **UI shell renderer** is the React app that draws the sidebar and chrome. It never touches web content directly; it sends commands over IPC and receives state updates.
- **Tab views**: one `WebContentsView` per open tab, created lazily. Only visible ones are attached to the window. Background tabs stay alive, and long-idle ones are discarded to save memory (keep URL + title + favicon; reload on focus).
- **Overlay view**: Chromium views always paint above the React shell, so the command bar, context menus, and popovers that must cover web content live in a separate transparent overlay `WebContentsView` that is added on top when opened and removed when closed.
- **Layout**: main process recalculates tab-view bounds on window resize, sidebar toggle, and split-view changes. The page area gets ~8px inset and a 10px corner radius (use `WebContentsView.setBorderRadius` when available) so pages look like cards floating on the themed background.

### Folder structure

```
vew/
  src/
    main/           # main process: windows, tabs, spaces, ipc, db, downloads, menus
    preload/        # contextBridge APIs (typed), one for shell, one for overlay
    renderer/
      shell/        # React sidebar + chrome UI
      overlay/      # React command bar, menus, popovers
      shared/       # design tokens, components, icons
    shared/         # types + IPC channel contracts used by all processes
  resources/        # app icons (icns, ico, png)
  build/            # electron-builder config, entitlements
  tests/
```

### Security rules (non-negotiable)

- Web content views: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, **no preload**.
- Shell and overlay: `contextIsolation: true`, `sandbox: true`, a minimal typed preload via `contextBridge`. Never expose raw `ipcRenderer`.
- Validate every IPC message in main (check sender + payload shape).
- Deny unknown permission requests by default; prompt the user for camera/mic/location/notifications per site.
- Open `window.open` / `target=_blank` as new Vew tabs via `setWindowOpenHandler`; never create unmanaged windows.
- Enable Electron fuses in packaged builds (disable `RunAsNode`, enable cookie encryption, ASAR integrity).

---

## 4. Design system (Arc-level UI)

The goal is a UI that feels **quiet, fluid, and premium**. Details matter more than feature count.

**Layout**

- Frameless window. The sidebar (default 240px, resizable 180–360px, collapsible with Cmd/Ctrl+S) holds everything: traffic lights (macOS), nav buttons, URL pill, favorites grid, pinned tabs, divider, today's tabs, space switcher at the bottom.
- No top toolbar. The web page fills the rest as a rounded card with a soft shadow.
- Hovering the left edge while the sidebar is collapsed slides it in as an overlay.

**Color & material**

- Each Space has a theme: a gradient of 2–3 colors chosen by the user (color picker + presets) with adjustable intensity. The sidebar and window background use this gradient; the page card sits on top.
- macOS: `vibrancy: 'sidebar'` for translucency. Windows 11: `backgroundMaterial: 'mica'`. Fall back to a solid tint elsewhere.
- Light and dark mode follow the system; text contrast must pass WCAG AA on every theme.

**Typography & spacing**

- System font stack (`-apple-system`, `Segoe UI Variable`, …). 13px base in the sidebar, 12px for secondary.
- 4px spacing grid. Rounded corners everywhere: 8px items, 10–12px cards, 14px overlays.
- Icons: Lucide, 16px, 1.5px stroke.

**Motion**

- Everything animates, briefly: 150–250ms, spring-based (Framer Motion). Tab open/close, reordering, space switching (horizontal slide of the whole sidebar), command bar (scale 0.97→1 + fade).
- Respect `prefers-reduced-motion`.
- The UI must never jank: 60fps drag-and-drop, no layout shift while pages load.

**Micro-details**

- Favicon + title per tab, with a subtle hover background and a close button that appears on hover.
- Loading state: a thin shimmer on the tab row, not a spinner.
- Audio-playing tabs show a speaker icon you can click to mute.
- Toasts (bottom of sidebar) for "Link copied", "Tab archived", etc.

---

## 5. Build phases

Each phase lists what to build and how to check it. Use plan mode at the start of each phase.

### Phase 0 — Scaffold

- `electron-vite` + React + TypeScript + Tailwind project named **Vew**, with ESLint, Prettier, Vitest.
- Frameless `BrowserWindow` with platform title-bar handling (`hiddenInset` on macOS, `titleBarOverlay` on Windows).
- Shell renders an empty sidebar; one `WebContentsView` loads `https://www.google.com` in the page area with rounded corners.
- ✅ Check: `npm run dev` opens Vew on Mac and Windows; the page is rendered by Chromium (`process.versions.chrome` logged at startup); resizing keeps the page card aligned.

### Phase 1 — Core browsing

- Tab manager in main: create / close / activate / reorder, lazy creation, each tab its own `WebContentsView`.
- URL pill: type a URL or search (default engine configurable), show the domain when not focused, full URL when focused.
- Back, forward, reload, stop; page title + favicon updates; loading state.
- `window.open` and target=_blank open new tabs; Ctrl/Cmd+click opens background tabs.
- Keyboard: Cmd/Ctrl+T, W, L, R, [, ], Shift+Cmd/Ctrl+T (reopen closed), Cmd/Ctrl+1–9, Ctrl+Tab.
- ✅ Check: browse normally across 20 tabs without errors; all shortcuts work on both OSes.

### Phase 2 — Arc-style sidebar

- Vertical tab list with drag-and-drop reorder (`@dnd-kit`).
- **Favorites**: top grid of icon-only tiles shared across all Spaces.
- **Pinned tabs**: persist across restarts, per Space.
- **Today tabs**: unpinned tabs auto-archive after 12h of inactivity (configurable), viewable in an Archive list.
- Folders for pinned tabs (collapsible, nestable one level).
- Collapsible / resizable sidebar with edge-hover reveal.
- ✅ Check: drag a tab into pinned, into a folder, into favorites; restart the app and everything is restored.

### Phase 3 — Spaces & profiles

- Spaces: each has name, emoji/icon, gradient theme, its own pinned + today tabs.
- Switch with the bottom switcher, Ctrl+1–9-style shortcuts, or two-finger swipe on macOS; animated slide.
- Each Space can be linked to a **profile**, backed by its own Chromium session partition (`session.fromPartition('persist:profile-<id>')`), so cookies and logins are separate (e.g. Work vs Personal).
- Theme editor: gradient picker with presets, intensity slider, live preview.
- ✅ Check: log into the same site with two accounts in two Spaces on different profiles.

### Phase 4 — Command bar

- Cmd/Ctrl+T opens a centered command bar in the overlay view (not a new tab page).
- Fuzzy-searches open tabs, pinned tabs, history, bookmarks, and actions (“New Space”, “Copy URL”, “Toggle dark mode”, “Clear history”), plus web search suggestions.
- Grouped results, keyboard navigation, instant (<16ms per keystroke from local data).
- Cmd/Ctrl+Shift+C copies the current URL with a toast.
- ✅ Check: with 1,000 history entries the bar stays instant.

### Phase 5 — Split view & peek

- Split view: 2–4 tabs side by side (horizontal or vertical), draggable dividers, drag a tab onto the page to split.
- **Peek**: links opened from pinned tabs/favorites open in a floating card over the current page; expand to a full tab or dismiss with Esc.
- **Mini window** (like Little Arc): a small, separate quick window for links opened from other apps, with a button to move it into a Space.
- ✅ Check: split 3 tabs, resize dividers, restart; the split restores.

### Phase 6 — Browser essentials

- History (SQLite) with a searchable history page.
- Downloads manager in the sidebar footer with progress, open, show in folder.
- Find in page (Cmd/Ctrl+F) using `webContents.findInPage`.
- Zoom per site, print, view source, DevTools (Cmd/Ctrl+Alt+I).
- Per-site permission prompts, and a site-info popover (lock icon) to manage them.
- Built-in ad/tracker blocking with a per-site toggle.
- Picture-in-picture for videos when switching away from a playing tab.
- Session restore after crash or restart.
- Settings page: search engine, default browser, archive timer, blocker, appearance.
- ✅ Check: download a file, find text, block ads on a news site, crash-restart restores tabs.

### Phase 7 — Extensions

- Load unpacked and Chrome Web Store extensions via `electron-chrome-extensions`.
- Extension icons in a compact sidebar row with popups rendered in the overlay.
- ✅ Check: uBlock Origin Lite and a password manager extension install and work.

### Phase 8 — Polish & performance

- Tab discarding for idle tabs; memory stays reasonable with 50+ tabs.
- Cold start under ~1.5s on a modern laptop.
- Audit every animation, empty state, hover state, focus ring, and dark-mode color.
- Onboarding: first-run flow to pick a theme, import bookmarks/history from Chrome, and set Vew as default browser.
- Accessibility pass: full keyboard navigation, screen-reader labels.

### Phase 9 — Packaging & release

- `electron-builder` config: macOS `.dmg` (universal: Apple Silicon + Intel) and Windows NSIS `.exe` (x64 + arm64).
- Register Vew as a browser (http/https protocols, .html file association) on both OSes.
- App icons, name "Vew", bundle id `app.vew.browser` (or your own domain).
- Code signing: Apple Developer ID + notarization on macOS; a code-signing certificate on Windows.
- Auto-updates via `electron-updater` from GitHub Releases.
- GitHub Actions workflow building both platforms on tagged releases.
- ✅ Check: install on a clean Mac and Windows machine with no security warnings; an update installs automatically.

---

## 6. Rules for Claude Code while working on Vew

- Read this file first. Stay inside the current phase.
- Keep TypeScript strict, no `any` without a comment explaining why.
- Every IPC channel is defined once in `src/shared/ipc.ts` with typed payloads.
- After changing main-process code, run the app and verify it launches before saying a task is done.
- Test platform-specific code paths for both `darwin` and `win32`.
- Write small commits with clear messages at the end of each task.
- When a UI decision is unclear, choose the calmer, more minimal option and match the design system in section 4.
- Keep Electron (and therefore Chromium) up to date; never pin an old version to dodge a breaking change.
