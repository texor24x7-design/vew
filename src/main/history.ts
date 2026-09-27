import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { app } from 'electron'

export interface HistoryItem {
  url: string
  title: string
  visits: number
  lastVisit: number
}

const RECORDABLE = /^https?:/i

/** Browsing history in SQLite (Node's built-in driver: no native module to rebuild per Electron release). */
export class History {
  private readonly db: DatabaseSync
  private readonly visitStmt: StatementSync
  private readonly titleStmt: StatementSync
  private readonly recentStmt: StatementSync
  private readonly searchStmt: StatementSync
  private readonly deleteStmt: StatementSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS history (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visits INTEGER NOT NULL DEFAULT 0,
        last_visit INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_last_visit ON history (last_visit DESC);
    `)
    this.visitStmt = this.db.prepare(`
      INSERT INTO history (url, title, visits, last_visit) VALUES (?, ?, 1, ?)
      ON CONFLICT (url) DO UPDATE SET
        visits = visits + 1,
        last_visit = excluded.last_visit,
        title = CASE WHEN excluded.title = '' THEN title ELSE excluded.title END
    `)
    this.titleStmt = this.db.prepare(`UPDATE history SET title = ? WHERE url = ?`)
    this.searchStmt = this.db.prepare(
      `SELECT url, title, visits, last_visit AS lastVisit FROM history
       WHERE last_visit < ? AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
       ORDER BY last_visit DESC LIMIT ?`
    )
    this.deleteStmt = this.db.prepare(`DELETE FROM history WHERE url = ?`)
    this.recentStmt = this.db.prepare(
      `SELECT url, title, visits, last_visit AS lastVisit FROM history ORDER BY last_visit DESC LIMIT ?`
    )
  }

  visit(url: string, title = '', at = Date.now()): void {
    if (RECORDABLE.test(url)) this.visitStmt.run(url, title, at)
  }

  setTitle(url: string, title: string): void {
    if (RECORDABLE.test(url) && title) this.titleStmt.run(title, url)
  }

  /** Most recent first. */
  recent(limit = 5000): HistoryItem[] {
    return this.recentStmt.all(limit) as unknown as HistoryItem[]
  }

  /** Newest first; `before` pages further back in time. Matches title or URL. */
  search(query: string, limit: number, before = Number.MAX_SAFE_INTEGER): HistoryItem[] {
    const like = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`
    return this.searchStmt.all(before, like, like, limit) as unknown as HistoryItem[]
  }

  delete(url: string): void {
    this.deleteStmt.run(url)
  }

  /** Merge history from elsewhere (an import): keeps the higher visit count and the latest visit. */
  importItems(items: HistoryItem[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO history (url, title, visits, last_visit) VALUES (?, ?, ?, ?)
      ON CONFLICT (url) DO UPDATE SET
        visits = MAX(visits, excluded.visits),
        last_visit = MAX(last_visit, excluded.last_visit),
        title = CASE WHEN title = '' THEN excluded.title ELSE title END
    `)
    this.db.exec('BEGIN')
    try {
      for (const i of items) upsert.run(i.url, i.title, i.visits, i.lastVisit)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  clear(): void {
    this.db.exec('DELETE FROM history')
  }

  close(): void {
    this.db.close()
  }
}

let historyDb: History | undefined
/** One history database for the app, opened on first use. */
export const history = (): History => {
  if (!historyDb) {
    historyDb = new History(join(app.getPath('userData'), 'history.db'))
    app.once('will-quit', () => historyDb?.close())
  }
  return historyDb
}
