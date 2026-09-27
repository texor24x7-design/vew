const isWordChar = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 97 && c <= 122)
const isUpper = (c: number): boolean => c >= 65 && c <= 90

/** Does a word start at `i`? After a separator, or a camelCase hump in the original text ("YouTube"). */
const wordStart = (hay: string, orig: string, i: number): boolean =>
  i === 0 ||
  !isWordChar(hay.charCodeAt(i - 1)) ||
  (isUpper(orig.charCodeAt(i)) && !isUpper(orig.charCodeAt(i - 1)))

/** One lowercase term against lowercase text: substring matches beat scattered (subsequence) ones. */
function termScore(term: string, hay: string, orig: string): number {
  const idx = hay.indexOf(term)
  if (idx >= 0) {
    const end = idx + term.length
    const wholeWord = end === hay.length || !isWordChar(hay.charCodeAt(end))
    return (
      100 +
      (idx === 0 ? 30 : wordStart(hay, orig, idx) ? 20 : 0) +
      (wholeWord ? 15 : 0) -
      Math.min(idx, 50) * 0.2 +
      (term.length / hay.length) * 20
    )
  }
  let score = 0
  let prev = -2
  let ti = 0
  for (let i = 0; i < hay.length && ti < term.length; i++) {
    if (hay.charCodeAt(i) !== term.charCodeAt(ti)) continue
    score += 1 + (i === prev + 1 ? 3 : 0) + (wordStart(hay, orig, i) ? 4 : 0)
    prev = i
    ti++
  }
  // Mostly-random letter hits across a long URL are noise, not a match.
  if (ti < term.length || score < term.length * 2.5) return 0
  return Math.min(90, score * 2)
}

const terms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

function scoreTerms(ts: string[], hay: string, orig: string): number {
  let total = 0
  for (const term of ts) {
    const s = termScore(term, hay, orig)
    if (!s) return 0
    total += s
  }
  return total
}

/** How well `query` matches `text` (0 = no match). Case-insensitive; every space-separated term must match. */
export const fuzzyScore = (query: string, text: string): number =>
  scoreTerms(terms(query), text.toLowerCase(), text)

/** URL as people type it: no scheme, no www. */
export const bareUrl = (url: string): string => url.replace(/^[a-z]+:\/\/(www\.)?/i, '')

/** Items with their match text lowercased once, so each keystroke only scores. */
export interface Searchable<T> {
  item: T
  title: string
  titleLower: string
  url: string
  urlLower: string
}

export function searchable<T extends { title: string; url: string }>(
  items: readonly T[]
): Searchable<T>[] {
  return items.map((item) => {
    const url = bareUrl(item.url)
    return {
      item,
      title: item.title,
      titleLower: item.title.toLowerCase(),
      url,
      urlLower: url.toLowerCase()
    }
  })
}

/** Top `limit` items by match against title and URL. Ties keep the input order (callers pre-sort by recency). */
export function rank<T>(
  query: string,
  items: readonly Searchable<T>[],
  limit: number,
  boost: (item: T) => number = () => 0
): T[] {
  const ts = terms(query)
  if (!ts.length) return items.slice(0, limit).map((s) => s.item)
  // Keep only the best `limit` (sorted, best first) instead of sorting every match.
  const top: { item: T; score: number }[] = []
  for (const s of items) {
    const m = Math.max(
      scoreTerms(ts, s.titleLower, s.title),
      scoreTerms(ts, s.urlLower, s.url) * 0.95
    )
    if (!m) continue
    const score = m + boost(s.item)
    if (top.length === limit && score <= top[limit - 1].score) continue
    let i = top.length
    while (i > 0 && top[i - 1].score < score) i--
    top.splice(i, 0, { item: s.item, score })
    if (top.length > limit) top.pop()
  }
  return top.map((x) => x.item)
}
