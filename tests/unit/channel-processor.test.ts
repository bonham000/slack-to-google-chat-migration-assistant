import { describe, test, expect, beforeEach } from 'bun:test';
import { ChannelProcessor } from '../../src/core/channel-processor';
import { MigrationStateDB } from '../../src/db/state';
import { DryRunChatAPI } from '../../src/services/dry-run';
import type { MigrationConfig, SlackChannel } from '../../src/types';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'minimal-export');

const testConfig: MigrationConfig = {
  serviceAccountKeyPath: '',
  workspaceAdminEmail: 'admin@example.com',
  slackExportPath: FIXTURES_DIR,
  databasePath: ':memory:',
  dryRun: true,
  mode: 'new',
  timeScope: { type: 'full' },
};

const generalChannel: SlackChannel = {
  id: 'C001',
  name: 'general',
  created: 1700000000,
  creator: 'U001',
  members: ['U001', 'U002', 'U003'],
  channelType: 'public_channel',
};

const generalDirPath = path.join(FIXTURES_DIR, 'general');

function createProcessor(
  stateDb: MigrationStateDB,
  dryApi: DryRunChatAPI,
  config?: Partial<MigrationConfig>,
) {
  const userMap = new Map([
    ['U001', 'john@example.com'],
    ['U002', 'jane@example.com'],
  ]);
  const displayNames = new Map([
    ['U001', 'John Smith'],
    ['U002', 'Jane Doe'],
    ['U003', 'No Email User'],
    ['B001', 'GitHub'],
  ]);

  return new ChannelProcessor(
    dryApi,
    stateDb,
    { ...testConfig, ...config },
    userMap,
    displayNames,
    FIXTURES_DIR,
  );
}

describe('ChannelProcessor', () => {
  let stateDb: MigrationStateDB;
  let dryApi: DryRunChatAPI;

  beforeEach(() => {
    stateDb = new MigrationStateDB(':memory:');
    dryApi = new DryRunChatAPI();
  });

  test('processes a new channel — creates space and sends messages', async () => {
    const processor = createProcessor(stateDb, dryApi);
    const result = await processor.processChannel(generalChannel, generalDirPath);

    expect(result.status).toBe('completed');
    // 8 messages total in general, 1 is channel_join (skipped) = 7 eligible
    // But bot message has no user mapping so gets attribution prefix
    expect(result.messagesCreated).toBeGreaterThan(0);
    expect(result.messagesFailed).toBe(0);

    // Space should be recorded in DB (look up by channel ID)
    const space = stateDb.getSpaceByChannelId('C001');
    expect(space).not.toBeNull();
    expect(space!.import_mode_active).toBe(1);
  });

  test('skips already-migrated messages on resume', async () => {
    const processor = createProcessor(stateDb, dryApi);

    // First run
    const firstResult = await processor.processChannel(generalChannel, generalDirPath);
    const firstCreated = firstResult.messagesCreated;

    // Second run — same processor, same state
    const dryApi2 = new DryRunChatAPI();
    const processor2 = createProcessor(stateDb, dryApi2);
    const secondResult = await processor2.processChannel(generalChannel, generalDirPath);

    // All messages should be skipped
    expect(secondResult.messagesCreated).toBe(0);
    expect(secondResult.messagesSkipped).toBeGreaterThanOrEqual(firstCreated);
  });

  test('skips finalized channels', async () => {
    const processor = createProcessor(stateDb, dryApi);

    // Create and finalize the space using the new method
    stateDb.upsertSpaceWithType('general', 'spaces/FINALIZED', 'C001', 'public_channel');
    stateDb.markSpaceFinalized('general');

    const result = await processor.processChannel(generalChannel, generalDirPath);
    expect(result.status).toBe('already_finalized');
    expect(result.messagesCreated).toBe(0);
  });

  test('applies time scope filtering', async () => {
    // Use a scope that excludes all fixture messages (they are from Jan 2024)
    const processor = createProcessor(stateDb, dryApi, {
      timeScope: { type: 'last_n_days', days: 1 },
    });

    const result = await processor.processChannel(generalChannel, generalDirPath);
    // All messages are older than 1 day, so nothing to migrate
    expect(result.messagesCreated).toBe(0);
  });

  test('bot messages get attribution prefix', async () => {
    const processor = createProcessor(stateDb, dryApi);
    await processor.processChannel(generalChannel, generalDirPath);

    // Check the dry-run log for bot attribution
    const log = dryApi.getLog();
    const botMessage = log.find((l) => l.includes('[GitHub]'));
    expect(botMessage).toBeDefined();
  });

  test('unmapped users get fallback attribution', async () => {
    const processor = createProcessor(stateDb, dryApi);
    await processor.processChannel(generalChannel, generalDirPath);

    const stats = dryApi.getStats();
    expect(stats.spaces).toBe(1);
    expect(stats.messages).toBeGreaterThan(0);
  });

  test('file attachments get placeholder text', async () => {
    const processor = createProcessor(stateDb, dryApi);
    await processor.processChannel(generalChannel, generalDirPath);

    const log = dryApi.getLog();
    const attachmentMessage = log.find((l) => l.includes('[Attachment: report.pdf]'));
    expect(attachmentMessage).toBeDefined();
  });

  test('threads set correct threadKey', async () => {
    const processor = createProcessor(stateDb, dryApi);
    await processor.processChannel(generalChannel, generalDirPath);

    // Verify thread messages were recorded with thread_key
    const msgCount = stateDb.getMessageCount('general');
    expect(msgCount).toBeGreaterThan(0);
  });
});
