import { expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/nowhere' } }))
const { CHROME_TIME_TO_MS, MAX_BOOKMARKS, parseBookmarks } = await import('../src/main/importer')

const url = (name: string, u = `https://${name}.example/`): object => ({
  type: 'url',
  name,
  url: u
})
const folder = (name: string, children: object[]): object => ({ type: 'folder', name, children })

test('Chrome bookmarks become one folder, with top-level folders flattened into subfolders', () => {
  const f = parseBookmarks(
    {
      roots: {
        bookmark_bar: {
          children: [
            url('news'),
            folder('Work', [
              url('jira'),
              folder('Deep', [url('wiki'), folder('Deeper', [url('api')])])
            ]),
            url('evil', 'javascript:alert(1)'),
            folder('Empty', [])
          ]
        },
        other: { children: [url('recipes')] }
      }
    },
    'Chrome bookmarks'
  )
  expect(f.bookmarks.map((b) => b.title)).toEqual(['news', 'recipes'])
  expect(f.folders).toEqual([
    {
      name: 'Work',
      bookmarks: [
        { title: 'jira', url: 'https://jira.example/' },
        { title: 'wiki', url: 'https://wiki.example/' },
        { title: 'api', url: 'https://api.example/' }
      ]
    }
  ])
})

test('imports are capped so the sidebar stays usable', () => {
  const many = Array.from({ length: MAX_BOOKMARKS + 50 }, (_, i) => url(`s${i}`))
  const f = parseBookmarks({ roots: { bookmark_bar: { children: [folder('All', many)] } } }, 'x')
  expect(f.folders[0].bookmarks).toHaveLength(MAX_BOOKMARKS)
})

test('Chrome timestamps (µs since 1601, beyond JS number precision) convert to Unix ms in SQLite', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE urls (last_visit_time INTEGER)')
  db.exec('INSERT INTO urls VALUES (13434972760299000)') // > 2^53: unreadable as a JS number
  const row = db.prepare(`SELECT ${CHROME_TIME_TO_MS} AS ms FROM urls`).get() as { ms: number }
  expect(new Date(row.ms).toISOString()).toBe('2026-09-27T08:52:40.299Z')
})
