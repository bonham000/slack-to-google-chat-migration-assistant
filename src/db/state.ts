import { Database } from 'bun:sqlite';
import { SCHEMA_SQL } from './schema';
import { QUERIES } from './queries';
import type {
  SpaceRow,
  MigratedMessageRow,
  UserMappingRow,
  MigrationRunRow,
  MigrationSummary,
  MigrationStatus,
} from '../types';

export class MigrationStateDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(SCHEMA_SQL);
  }

  // ── Spaces ──────────────────────────────────────────────────────────

  getSpace(channelName: string): SpaceRow | null {
    return this.db.prepare(QUERIES.getSpace).get(channelName) as SpaceRow | null;
  }

  upsertSpace(channelName: string, googleSpaceId: string): void {
    this.db.prepare(QUERIES.upsertSpace).run(channelName, googleSpaceId);
  }

  markSpaceFinalized(channelName: string): void {
    this.db.prepare(QUERIES.markFinalized).run(channelName);
  }

  getUnfinalizedSpaces(): SpaceRow[] {
    return this.db.prepare(QUERIES.getUnfinalizedSpaces).all() as SpaceRow[];
  }

  getAllSpaces(): SpaceRow[] {
    return this.db.prepare(QUERIES.getAllSpaces).all() as SpaceRow[];
  }

  // ── Messages ────────────────────────────────────────────────────────

  isMessageMigrated(slackTs: string, slackChannel: string): boolean {
    const result = this.db.prepare(QUERIES.isMessageMigrated).get(slackTs, slackChannel);
    return result !== null;
  }

  recordMessage(row: MigratedMessageRow): void {
    this.db.prepare(QUERIES.insertMessage).run(
      row.slack_ts,
      row.slack_channel,
      row.google_space_id,
      row.google_message_name,
      row.thread_key,
    );
  }

  recordMessageBatch(rows: MigratedMessageRow[]): void {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare(QUERIES.insertMessage);
      for (const row of rows) {
        stmt.run(
          row.slack_ts,
          row.slack_channel,
          row.google_space_id,
          row.google_message_name,
          row.thread_key,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getMessageCount(slackChannel: string): number {
    const result = this.db.prepare(QUERIES.getMessageCount).get(slackChannel) as { count: number };
    return result.count;
  }

  getTotalMessageCount(): number {
    const result = this.db.prepare(QUERIES.getTotalMessageCount).get() as { count: number };
    return result.count;
  }

  // ── User Mappings ───────────────────────────────────────────────────

  upsertUserMapping(row: UserMappingRow): void {
    this.db.prepare(QUERIES.upsertUserMapping).run(
      row.slack_id,
      row.email,
      row.display_name,
      row.match_type,
      row.is_bot,
    );
  }

  getUserMapping(slackId: string): UserMappingRow | null {
    return this.db.prepare(QUERIES.getUserMapping).get(slackId) as UserMappingRow | null;
  }

  getAllUserMappings(): UserMappingRow[] {
    return this.db.prepare(QUERIES.getAllUserMappings).all() as UserMappingRow[];
  }

  // ── Migration Runs ──────────────────────────────────────────────────

  startRun(mode: string, dryRun: boolean, timeScope: string): number {
    const result = this.db.prepare(QUERIES.startRun).run(mode, dryRun ? 1 : 0, timeScope);
    return Number(result.lastInsertRowid);
  }

  completeRun(runId: number, summary: MigrationSummary): void {
    this.db.prepare(QUERIES.completeRun).run(
      summary.channelsProcessed.length,
      summary.messagesCreated,
      summary.messagesSkipped,
      summary.messagesFailed,
      runId,
    );
  }

  failRun(runId: number, error: string): void {
    const status = `failed: ${error}`;
    this.db.prepare(QUERIES.failRun).run(status, runId);
  }

  getLastRun(): MigrationRunRow | null {
    return this.db.prepare(QUERIES.getLastRun).get() as MigrationRunRow | null;
  }

  // ── Config State ────────────────────────────────────────────────────

  getConfigValue(key: string): string | null {
    const result = this.db.prepare(QUERIES.getConfigValue).get(key) as { value: string } | null;
    return result ? result.value : null;
  }

  setConfigValue(key: string, value: string): void {
    this.db.prepare(QUERIES.setConfigValue).run(key, value);
  }

  // ── Status ──────────────────────────────────────────────────────────

  getMigrationStatus(): MigrationStatus {
    const totalSpaces = (this.db.prepare('SELECT COUNT(*) AS count FROM spaces').get() as { count: number }).count;
    const totalMessages = this.getTotalMessageCount();
    const totalRuns = (this.db.prepare('SELECT COUNT(*) AS count FROM migration_runs').get() as { count: number }).count;
    const lastRun = this.getLastRun();
    const unfinalizedSpaces = this.getUnfinalizedSpaces();

    return {
      totalSpaces,
      totalMessages,
      totalRuns,
      lastRun,
      unfinalizedSpaces,
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
