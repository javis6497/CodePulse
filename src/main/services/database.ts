import Database from 'better-sqlite3'
import type { DashboardSnapshot, ProviderId, RuntimeType, UsageBreakdown } from '../../shared/contracts'

export class HistoryDatabase {
  private readonly database: Database.Database

  constructor(path: string) {
    this.database = new Database(path)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.database.close()
  }

  saveSnapshot(snapshot: DashboardSnapshot): void {
    const date = new Date().toLocaleDateString('en-CA')
    const saveUsage = this.database.prepare(`
      INSERT INTO usage_daily (
        date, provider, runtime, distro, model, input_tokens, output_tokens,
        cached_tokens, reasoning_tokens, total_tokens, updated_at
      ) VALUES (?, ?, ?, ?, '', 0, 0, 0, 0, ?, ?)
      ON CONFLICT(date, provider, runtime, distro, model) DO UPDATE SET
        total_tokens = excluded.total_tokens,
        updated_at = excluded.updated_at
    `)
    const transaction = this.database.transaction(() => {
      this.saveBreakdown(saveUsage, date, 'windows', '', snapshot.usage.windows)
      for (const [distro, breakdown] of Object.entries(snapshot.usage.wslDistros)) {
        this.saveBreakdown(saveUsage, date, 'wsl', distro, breakdown)
      }

      const saveQuota = this.database.prepare(`
        INSERT INTO quota_snapshot (
          provider, limit_id, window_minutes, used_percent, resets_at, timestamp
        )
        SELECT 'codex', ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM quota_snapshot
          WHERE provider = 'codex' AND limit_id = ? AND timestamp > ?
            AND used_percent = ? AND IFNULL(resets_at, 0) = IFNULL(?, 0)
        )
      `)
      const now = Date.now()
      for (const quota of snapshot.quota) {
        saveQuota.run(
          quota.limitId,
          quota.windowDurationMinutes ?? null,
          quota.usedPercent,
          quota.resetsAt ?? null,
          now,
          quota.limitId,
          now - 5 * 60_000,
          quota.usedPercent,
          quota.resetsAt ?? null
        )
      }
    })
    transaction()
  }

  private saveBreakdown(
    statement: Database.Statement,
    date: string,
    runtime: RuntimeType,
    distro: string,
    breakdown: UsageBreakdown
  ): void {
    for (const provider of ['codex', 'claude'] satisfies ProviderId[]) {
      statement.run(date, provider, runtime, distro, breakdown.providers[provider], Date.now())
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        date TEXT NOT NULL,
        provider TEXT NOT NULL,
        runtime TEXT NOT NULL,
        distro TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (date, provider, runtime, distro, model)
      );

      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        runtime TEXT NOT NULL,
        distro TEXT,
        project TEXT,
        model TEXT,
        source_path TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        provider TEXT NOT NULL,
        runtime TEXT NOT NULL,
        distro TEXT,
        project TEXT,
        event TEXT NOT NULL,
        tool_category TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quota_snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        account_id TEXT,
        limit_id TEXT,
        window_minutes INTEGER,
        used_percent REAL,
        resets_at INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_quota_latest
        ON quota_snapshot(provider, limit_id, timestamp DESC);
    `)
  }
}
