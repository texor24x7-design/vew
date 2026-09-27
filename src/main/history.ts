import { DatabaseSync, type StatementSync } from 'node:sqlite'

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

  clear(): void {
    this.db.exec('DELETE FROM history')
  }

  close(): void {
    this.db.close()
  }
}
