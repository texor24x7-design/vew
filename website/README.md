# vew.texor.app

Vew's landing page: static HTML, CSS and a little JavaScript, no build step. Host this folder anywhere that
serves static files (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3, nginx…).

## Before publishing

Set the GitHub repository that Vew's releases are published to, in **two** places:

- `website/main.js` → `const REPO = 'owner/repo'` (the download buttons)
- `package.json` → `repository.url` (the app's auto-updater)

Download buttons point at `https://github.com/<REPO>/releases/latest/download/…`, which always serves the
newest **published** release (draft releases don't count). File names are fixed in `electron-builder.yml`:
`Vew-mac.dmg`, `Vew-win-setup.exe`, `Vew-win-x64-setup.exe`, `Vew-win-arm64-setup.exe`.

## Local preview

`python3 -m http.server -d website 8080` and open http://localhost:8080.

## Screenshots

`assets/screens/*.webp` are real Vew windows (2400 px wide). Retake them whenever the UI changes noticeably.
