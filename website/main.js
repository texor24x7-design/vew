/**
 * Download links, OS detection and the little bits of motion. No dependencies, no tracking.
 *
 * Downloads come straight from GitHub Releases: /releases/latest/download/<file> always serves the newest
 * published release, because the installers have versionless names (see electron-builder.yml).
 */

// The GitHub repository Vew's releases are published to (the same one as package.json → repository).
const REPO = 'texor24x7-design/vew'

const latest = (file) => `https://github.com/${REPO}/releases/latest/download/${file}`
const LINKS = {
  mac: latest('Vew-mac.dmg'),
  win: latest('Vew-win-setup.exe'),
  'win-x64': latest('Vew-win-x64-setup.exe'),
  'win-arm64': latest('Vew-win-arm64-setup.exe'),
  releases: `https://github.com/${REPO}/releases`
}

/** 'mac', 'win' or null (phones, Linux: show both, prefer neither). */
function detectOS() {
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase()
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|android/.test(ua)) return null
  if (ua.includes('windows')) return 'win'
  if (ua.includes('mac os')) return 'mac'
  if (platform.includes('win')) return 'win'
  if (platform.includes('mac')) return 'mac'
  return null
}

const TIPS = {
  mac: 'Your download is starting. Open Vew-mac.dmg and drag Vew to Applications. If macOS says it can’t verify Vew, choose Done, then open System Settings → Privacy & Security and click Open Anyway.',
  win: 'Your download is starting. Run the installer; if Windows SmartScreen appears, choose More info → Run anyway.'
}

const os = detectOS()
const notice = document.querySelector('.lp__notice')
let noticeTimer

for (const link of document.querySelectorAll('[data-download]')) {
  const kind = link.dataset.download === 'auto' ? os : link.dataset.download
  if (!kind) continue // "auto" on an unknown OS keeps pointing at the download section
  link.href = LINKS[kind]
  if (link.dataset.download === 'auto')
    link.textContent = `Download for ${kind === 'mac' ? 'macOS' : 'Windows'}`
  const platform = kind.startsWith('win') ? 'win' : kind === 'mac' ? 'mac' : null
  if (!platform) continue
  link.addEventListener('click', () => {
    notice.textContent = TIPS[platform]
    notice.hidden = false
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice.hidden = true), 12000)
  })
}

// The visitor's own platform goes first and gets the primary button.
if (os) {
  const hero = document.getElementById('hero-downloads')
  const mine = hero.querySelector(`[data-download="${os}"]`)
  const other = hero.querySelector(`[data-download="${os === 'mac' ? 'win' : 'mac'}"]`)
  mine.className = 'lp__btn lp__btn--primary'
  other.className = 'lp__btn lp__btn--ghost'
  hero.prepend(mine)
  document.querySelector(`.lp__platform[data-platform="${os}"]`)?.classList.add('is-yours')
}

// A hairline under the header once the page scrolls.
const header = document.querySelector('.lp__header')
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8)
addEventListener('scroll', onScroll, { passive: true })
onScroll()

// Sections rise into place as they arrive.
const reveals = document.querySelectorAll('.reveal')
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-in')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  )
  reveals.forEach((el) => io.observe(el))
} else {
  reveals.forEach((el) => el.classList.add('is-in'))
}
