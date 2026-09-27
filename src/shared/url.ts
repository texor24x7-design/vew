export const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  bing: 'https://www.bing.com/search?q=%s'
} as const
export type SearchEngine = keyof typeof SEARCH_ENGINES

// javascript: is deliberately absent, so typing it searches instead of running script.
const SCHEME = /^(https?|file|about|chrome|view-source|data|vew):/i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?$/i
const DOMAIN = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]+(:\d+)?$/i

/** Whether typed text is an address (vs. a search), and the URL it means. */
function asAddress(text: string): string | null {
  if (SCHEME.test(text)) return text
  if (/\s/.test(text)) return null
  const host = text.split(/[/?#]/)[0]
  if (LOCAL_HOST.test(host)) return `http://${text}`
  if (DOMAIN.test(host)) return `https://${text}`
  return null
}

export const looksLikeUrl = (input: string): boolean => asAddress(input.trim()) !== null

/** Turn whatever was typed into the URL pill into a URL to load. */
export function toUrl(input: string, engine: SearchEngine = 'google'): string {
  const text = input.trim()
  return asAddress(text) ?? SEARCH_ENGINES[engine].replace('%s', encodeURIComponent(text))
}

/** What the URL pill shows while unfocused: the bare domain. */
export function displayHost(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol.startsWith('http') ? u.host.replace(/^www\./, '') : url
  } catch {
    return url
  }
}
