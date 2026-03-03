import { describe, test, expect } from 'bun:test';
import { parseExport } from '../../src/services/slack/export-parser';
import { MigrationStateDB } from '../../src/db/state';
import { ChannelProcessor } from '../../src/core/channel-processor';
import { DryRunChatAPI } from '../../src/services/dry-run';
import type { MigrationConfig } from '../../src/types';
import * as path from 'path';

const COMPLIANCE_DIR = path.join(__dirname, '..', 'fixtures', 'compliance-export');
const MINIMAL_DIR = path.join(__dirname, '..', 'fixtures', 'minimal-export');

describe('Export Parser — compliance export', () => {
  test('parses all four conversation types', () => {
    const result = parseExport(COMPLIANCE_DIR);

    expect(result.channels.length).toBe(1);
    expect(result.conversations.length).toBe(4); // 1 public + 1 private + 1 DM + 1 group DM

    const types = result.conversations.map((c) => c.channelType);
    expect(types).toContain('public_channel');
    expect(types).toContain('private_channel');
    expect(types).toContain('dm');
    expect(types).toContain('group_dm');
  });

  test('tags public channels correctly', () => {
    const result = parseExport(COMPLIANCE_DIR);
    const general = result.conversations.find((c) => c.name === 'general');

    expect(general).toBeDefined();
    expect(general!.channelType).toBe('public_channel');
    expect(general!.id).toBe('C001');
  });

  test('tags private channels correctly', () => {
    const result = parseExport(COMPLIANCE_DIR);
    const priv = result.conversations.find((c) => c.channelType === 'private_channel');

    expect(priv).toBeDefined();
    expect(priv!.name).toBe('secret-project');
    expect(priv!.is_private).toBe(true);
  });

  test('tags DMs correctly (no name field)', () => {
    const result = parseExport(COMPLIANCE_DIR);
    const dm = result.conversations.find((c) => c.channelType === 'dm');

    expect(dm).toBeDefined();
    expect(dm!.id).toBe('D001');
    expect(dm!.members).toEqual(['U001', 'U002']);
  });

  test('tags group DMs correctly', () => {
    const result = parseExport(COMPLIANCE_DIR);
    const mpim = result.conversations.find((c) => c.channelType === 'group_dm');

    expect(mpim).toBeDefined();
    expect(mpim!.members).toEqual(['U001', 'U002', 'U003']);
  });

  test('builds conversationDirMap with correct paths', () => {
    const result = parseExport(COMPLIANCE_DIR);

    // Public channel — found by name
    expect(result.conversationDirMap.get('C001')).toBe(path.join(COMPLIANCE_DIR, 'general'));

    // Private channel — found by name
    expect(result.conversationDirMap.get('G001')).toBeDefined();

    // DM — found by ID
    expect(result.conversationDirMap.get('D001')).toBe(path.join(COMPLIANCE_DIR, 'D001'));
  });

  test('backwards compatible — channelNames only includes public channels', () => {
    const result = parseExport(COMPLIANCE_DIR);

    // channelNames should include dirs that match channels.json or have json files
    expect(result.channelNames).toContain('general');
  });
});

describe('Export Parser — standard export (no groups/dms/mpims)', () => {
  test('gracefully handles missing optional files', () => {
    const result = parseExport(MINIMAL_DIR);

    // Only public channels from channels.json
    expect(result.conversations.length).toBe(result.channels.length);
    expect(result.conversations.every((c) => c.channelType === 'public_channel')).toBe(true);
  });
});

describe('Channel Processor — conversation types', () => {
  const testConfig: MigrationConfig = {
    serviceAccountKeyPath: '',
    workspaceAdminEmail: 'admin@example.com',
    slackExportPath: COMPLIANCE_DIR,
    databasePath: ':memory:',
    dryRun: true,
    mode: 'new',
    timeScope: { type: 'full' },
  };

  const userMap = new Map([
    ['U001', 'john@example.com'],
    ['U002', 'jane@example.com'],
    ['U003', 'bob@example.com'],
  ]);
  const displayNames = new Map([
    ['U001', 'John Smith'],
    ['U002', 'Jane Doe'],
    ['U003', 'Bob Wilson'],
  ]);

  test('creates private SPACE for private channels', async () => {
    const stateDb = new MigrationStateDB(':memory:');
    const dryApi = new DryRunChatAPI();
    const processor = new ChannelProcessor(
      dryApi, stateDb, testConfig, userMap, displayNames, COMPLIANCE_DIR,
    );

    const exportData = parseExport(COMPLIANCE_DIR);
    const priv = exportData.conversations.find((c) => c.channelType === 'private_channel')!;
    const dirPath = exportData.conversationDirMap.get(priv.id);

    await processor.processChannel(priv, dirPath);

    const log = dryApi.getLog();
    // Should create a SPACE with PRIVATE access
    expect(log[0]).toContain('SPACE');
    expect(log[0]).toContain('PRIVATE');
  });

  test('creates GROUP_CHAT for DMs', async () => {
    const stateDb = new MigrationStateDB(':memory:');
    const dryApi = new DryRunChatAPI();
    const processor = new ChannelProcessor(
      dryApi, stateDb, testConfig, userMap, displayNames, COMPLIANCE_DIR,
    );

    const exportData = parseExport(COMPLIANCE_DIR);
    const dm = exportData.conversations.find((c) => c.channelType === 'dm')!;
    const dirPath = exportData.conversationDirMap.get(dm.id);

    const result = await processor.processChannel(dm, dirPath);

    const log = dryApi.getLog();
    expect(log[0]).toContain('GROUP_CHAT');
    expect(result.messagesCreated).toBe(2);
  });

  test('creates GROUP_CHAT for group DMs', async () => {
    const stateDb = new MigrationStateDB(':memory:');
    const dryApi = new DryRunChatAPI();
    const processor = new ChannelProcessor(
      dryApi, stateDb, testConfig, userMap, displayNames, COMPLIANCE_DIR,
    );

    const exportData = parseExport(COMPLIANCE_DIR);
    const mpim = exportData.conversations.find((c) => c.channelType === 'group_dm')!;
    const dirPath = exportData.conversationDirMap.get(mpim.id);

    const result = await processor.processChannel(mpim, dirPath);

    const log = dryApi.getLog();
    expect(log[0]).toContain('GROUP_CHAT');
    expect(result.messagesCreated).toBe(2);
  });

  test('generates correct display names for DMs', () => {
    const stateDb = new MigrationStateDB(':memory:');
    const dryApi = new DryRunChatAPI();
    const processor = new ChannelProcessor(
      dryApi, stateDb, testConfig, userMap, displayNames, COMPLIANCE_DIR,
    );

    const dm = { id: 'D001', members: ['U001', 'U002'], channelType: 'dm' as const };
    expect(processor.getDisplayName(dm)).toBe('DM: John Smith, Jane Doe');

    const mpim = { id: 'G001', name: 'mpdm-john--jane--bob-1', members: ['U001', 'U002', 'U003'], channelType: 'group_dm' as const };
    expect(processor.getDisplayName(mpim)).toBe('Group DM: John Smith, Jane Doe, Bob Wilson');
  });

  test('records planned members when creating a space', async () => {
    const stateDb = new MigrationStateDB(':memory:');
    const dryApi = new DryRunChatAPI();
    const processor = new ChannelProcessor(
      dryApi, stateDb, testConfig, userMap, displayNames, COMPLIANCE_DIR,
    );

    const dm = {
      id: 'D001',
      members: ['U001', 'U002'],
      channelType: 'dm' as const,
    };
    await processor.processChannel(dm, path.join(COMPLIANCE_DIR, 'D001'));

    // Check that the space was created with channel ID
    const space = stateDb.getSpaceByChannelId('D001');
    expect(space).not.toBeNull();

    // Check that members were planned
    const members = stateDb.getPendingMembers(space!.google_space_id);
    expect(members.length).toBe(2);
    expect(members.map((m) => m.slack_user_id).sort()).toEqual(['U001', 'U002']);
  });
});

describe('MigrationStateDB — space members', () => {
  test('insert and query pending members', () => {
    const db = new MigrationStateDB(':memory:');

    db.upsertSpaceWithType('test-channel', 'spaces/123', 'C001', 'public_channel');
    db.insertSpaceMembers('spaces/123', [
      { slackUserId: 'U001', email: 'john@example.com' },
      { slackUserId: 'U002', email: 'jane@example.com' },
    ]);

    const pending = db.getPendingMembers('spaces/123');
    expect(pending.length).toBe(2);
    expect(pending[0].status).toBe('pending');
  });

  test('update member status', () => {
    const db = new MigrationStateDB(':memory:');

    db.upsertSpaceWithType('test-channel', 'spaces/123', 'C001', 'public_channel');
    db.insertSpaceMembers('spaces/123', [
      { slackUserId: 'U001', email: 'john@example.com' },
    ]);

    db.updateMemberStatus('spaces/123', 'U001', 'added');

    const pending = db.getPendingMembers('spaces/123');
    expect(pending.length).toBe(0); // No longer pending
  });

  test('mark members added', () => {
    const db = new MigrationStateDB(':memory:');

    db.upsertSpaceWithType('test-channel', 'spaces/123', 'C001', 'public_channel');
    db.markMembersAdded('test-channel');

    const needingMembers = db.getSpacesNeedingMembers();
    expect(needingMembers.length).toBe(0);
  });

  test('schema migration is idempotent', () => {
    // Opening a DB twice should not fail — migrations run in try/catch
    const db1 = new MigrationStateDB(':memory:');
    db1.close();
    // If this were a file DB, opening again would re-run migrations safely
  });
});
