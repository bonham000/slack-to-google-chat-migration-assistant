import { describe, test, expect, beforeEach } from 'bun:test';
import { MigrationStateDB } from '../../src/db/state';
import type { MigratedMessageRow, UserMappingRow, MigrationSummary } from '../../src/types';

describe('MigrationStateDB', () => {
  let db: MigrationStateDB;

  beforeEach(() => {
    db = new MigrationStateDB(':memory:');
  });

  test('creates all tables on initialization', () => {
    // Verify tables exist by querying sqlite_master
    const rawDb = (db as any).db;
    const tables = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);

    expect(tables).toContain('spaces');
    expect(tables).toContain('migrated_messages');
    expect(tables).toContain('user_mappings');
    expect(tables).toContain('migration_runs');
    expect(tables).toContain('config_state');
  });

  test('upsertSpace + getSpace roundtrip', () => {
    expect(db.getSpace('general')).toBeNull();

    db.upsertSpace('general', 'spaces/AAAA');
    const space = db.getSpace('general');

    expect(space).not.toBeNull();
    expect(space!.slack_channel_name).toBe('general');
    expect(space!.google_space_id).toBe('spaces/AAAA');
    expect(space!.import_mode_active).toBe(1);
    expect(space!.finalized_at).toBeNull();

    // Upsert should update existing row
    db.upsertSpace('general', 'spaces/BBBB');
    const updated = db.getSpace('general');
    expect(updated!.google_space_id).toBe('spaces/BBBB');
  });

  test('isMessageMigrated returns false initially, true after recordMessage', () => {
    expect(db.isMessageMigrated('1234.5678', 'general')).toBe(false);

    const msg: MigratedMessageRow = {
      slack_ts: '1234.5678',
      slack_channel: 'general',
      google_space_id: 'spaces/AAAA',
      google_message_name: 'spaces/AAAA/messages/msg1',
      thread_key: null,
      created_at: new Date().toISOString(),
    };
    db.recordMessage(msg);

    expect(db.isMessageMigrated('1234.5678', 'general')).toBe(true);
    expect(db.isMessageMigrated('1234.5678', 'random')).toBe(false);
  });

  test('recordMessageBatch records multiple messages atomically', () => {
    const messages: MigratedMessageRow[] = [
      {
        slack_ts: '1000.0001',
        slack_channel: 'general',
        google_space_id: 'spaces/AAAA',
        google_message_name: 'spaces/AAAA/messages/m1',
        thread_key: null,
        created_at: new Date().toISOString(),
      },
      {
        slack_ts: '1000.0002',
        slack_channel: 'general',
        google_space_id: 'spaces/AAAA',
        google_message_name: 'spaces/AAAA/messages/m2',
        thread_key: 'thread-1',
        created_at: new Date().toISOString(),
      },
      {
        slack_ts: '1000.0003',
        slack_channel: 'random',
        google_space_id: 'spaces/BBBB',
        google_message_name: 'spaces/BBBB/messages/m3',
        thread_key: null,
        created_at: new Date().toISOString(),
      },
    ];

    db.recordMessageBatch(messages);

    expect(db.isMessageMigrated('1000.0001', 'general')).toBe(true);
    expect(db.isMessageMigrated('1000.0002', 'general')).toBe(true);
    expect(db.isMessageMigrated('1000.0003', 'random')).toBe(true);
    expect(db.getMessageCount('general')).toBe(2);
    expect(db.getMessageCount('random')).toBe(1);
    expect(db.getTotalMessageCount()).toBe(3);
  });

  test('getUnfinalizedSpaces returns spaces where import_mode_active=1', () => {
    db.upsertSpace('general', 'spaces/AAAA');
    db.upsertSpace('random', 'spaces/BBBB');
    db.upsertSpace('engineering', 'spaces/CCCC');

    db.markSpaceFinalized('random');

    const unfinalized = db.getUnfinalizedSpaces();
    const names = unfinalized.map((s) => s.slack_channel_name);

    expect(unfinalized).toHaveLength(2);
    expect(names).toContain('general');
    expect(names).toContain('engineering');
    expect(names).not.toContain('random');
  });

  test('markSpaceFinalized updates the space correctly', () => {
    db.upsertSpace('general', 'spaces/AAAA');
    db.markSpaceFinalized('general');

    const space = db.getSpace('general');
    expect(space).not.toBeNull();
    expect(space!.import_mode_active).toBe(0);
    expect(space!.finalized_at).not.toBeNull();
  });

  test('startRun + completeRun + getLastRun roundtrip', () => {
    const runId = db.startRun('full', false, '30d');

    expect(runId).toBeGreaterThan(0);

    const summary: MigrationSummary = {
      channelsProcessed: ['general', 'random'],
      spacesCreated: 2,
      messagesCreated: 150,
      messagesSkipped: 10,
      messagesFailed: 3,
      usersMatched: 20,
      usersUnmatched: 2,
    };

    db.completeRun(runId, summary);

    const lastRun = db.getLastRun();
    expect(lastRun).not.toBeNull();
    expect(lastRun!.id).toBe(runId);
    expect(lastRun!.mode).toBe('full');
    expect(lastRun!.dry_run).toBe(0);
    expect(lastRun!.time_scope).toBe('30d');
    expect(lastRun!.channels_processed).toBe(2);
    expect(lastRun!.messages_created).toBe(150);
    expect(lastRun!.messages_skipped).toBe(10);
    expect(lastRun!.messages_failed).toBe(3);
    expect(lastRun!.status).toBe('completed');
    expect(lastRun!.completed_at).not.toBeNull();
  });

  test('getMigrationStatus returns correct counts', () => {
    // Empty state
    let status = db.getMigrationStatus();
    expect(status.totalSpaces).toBe(0);
    expect(status.totalMessages).toBe(0);
    expect(status.totalRuns).toBe(0);
    expect(status.lastRun).toBeNull();
    expect(status.unfinalizedSpaces).toHaveLength(0);

    // Add data
    db.upsertSpace('general', 'spaces/AAAA');
    db.upsertSpace('random', 'spaces/BBBB');
    db.markSpaceFinalized('random');

    db.recordMessage({
      slack_ts: '1000.0001',
      slack_channel: 'general',
      google_space_id: 'spaces/AAAA',
      google_message_name: 'spaces/AAAA/messages/m1',
      thread_key: null,
      created_at: new Date().toISOString(),
    });

    db.startRun('full', false, '30d');

    status = db.getMigrationStatus();
    expect(status.totalSpaces).toBe(2);
    expect(status.totalMessages).toBe(1);
    expect(status.totalRuns).toBe(1);
    expect(status.lastRun).not.toBeNull();
    expect(status.unfinalizedSpaces).toHaveLength(1);
    expect(status.unfinalizedSpaces[0].slack_channel_name).toBe('general');
  });

  test('getConfigValue/setConfigValue roundtrip', () => {
    expect(db.getConfigValue('last_export_path')).toBeNull();

    db.setConfigValue('last_export_path', '/data/export');
    expect(db.getConfigValue('last_export_path')).toBe('/data/export');

    // Overwrite
    db.setConfigValue('last_export_path', '/data/export-v2');
    expect(db.getConfigValue('last_export_path')).toBe('/data/export-v2');
  });

  test('upsertUserMapping + getUserMapping roundtrip', () => {
    expect(db.getUserMapping('U123')).toBeNull();

    const mapping: UserMappingRow = {
      slack_id: 'U123',
      email: 'alice@example.com',
      display_name: 'Alice',
      match_type: 'email',
      is_bot: 0,
    };
    db.upsertUserMapping(mapping);

    const result = db.getUserMapping('U123');
    expect(result).not.toBeNull();
    expect(result!.slack_id).toBe('U123');
    expect(result!.email).toBe('alice@example.com');
    expect(result!.display_name).toBe('Alice');
    expect(result!.match_type).toBe('email');
    expect(result!.is_bot).toBe(0);

    // Upsert should update
    db.upsertUserMapping({ ...mapping, display_name: 'Alice W.', match_type: 'manual' });
    const updated = db.getUserMapping('U123');
    expect(updated!.display_name).toBe('Alice W.');
    expect(updated!.match_type).toBe('manual');

    // getAllUserMappings
    db.upsertUserMapping({
      slack_id: 'B001',
      email: null,
      display_name: 'SlackBot',
      match_type: 'bot',
      is_bot: 1,
    });
    const all = db.getAllUserMappings();
    expect(all).toHaveLength(2);
  });
});
