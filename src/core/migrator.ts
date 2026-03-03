import type {
  MigrationConfig,
  MigrationSummary,
  MigrationStatus,
  ParsedExport,
  UserMapResult,
} from '../types';
import { MigrationStateDB } from '../db/state';
import { parseExport } from '../services/slack/export-parser';
import { buildUserMap } from '../services/slack/user-mapper';
import { readChannelMessages } from '../services/slack/message-reader';
import { ChatAPI } from '../services/google/chat-api';
import { DryRunChatAPI } from '../services/dry-run';
import { RateLimiter } from '../services/google/rate-limiter';
import {
  createChatClient,
  createDirectoryClient,
} from '../services/google/auth';
import { DirectoryAPI } from '../services/google/directory-api';
import { ChannelProcessor, type ProgressCallback, type ChannelLifecycleCallback } from './channel-processor';
import { info, warn, error as logError } from '../utils/logger';

export interface MigratorCallbacks {
  onProgress?: ProgressCallback;
  onChannelStart?: (channel: string, messageCount: number) => void;
  onChannelFinish?: (channel: string, result: import('../types').ChannelResult) => void;
  onUserResolution?: (matched: number, total: number) => void;
  onMembershipStart?: (channel: string, count: number) => void;
  onMembershipFinish?: (channel: string, added: number, failed: number) => void;
}

export class Migrator {
  private stateDb: MigrationStateDB;
  private chatApi: ChatAPI | DryRunChatAPI;
  private exportData: ParsedExport;
  private userMapResult: UserMapResult;
  private config: MigrationConfig;
  private channelProcessor: ChannelProcessor;
  private callbacks: MigratorCallbacks;

  private constructor(
    stateDb: MigrationStateDB,
    chatApi: ChatAPI | DryRunChatAPI,
    exportData: ParsedExport,
    userMapResult: UserMapResult,
    config: MigrationConfig,
    callbacks: MigratorCallbacks = {},
  ) {
    this.stateDb = stateDb;
    this.chatApi = chatApi;
    this.exportData = exportData;
    this.userMapResult = userMapResult;
    this.config = config;
    this.callbacks = callbacks;

    this.channelProcessor = new ChannelProcessor(
      chatApi,
      stateDb,
      config,
      userMapResult.userMap,
      userMapResult.displayNames,
      exportData.rootDir,
      callbacks.onProgress,
    );
  }

  /**
   * Factory method that wires up all dependencies.
   * Call this instead of the constructor.
   */
  static async create(
    config: MigrationConfig,
    callbacks: MigratorCallbacks = {},
  ): Promise<Migrator> {
    // 1. Open/create SQLite database
    const stateDb = new MigrationStateDB(config.databasePath);

    // 2. Parse Slack export
    const exportData = parseExport(config.slackExportPath);

    // 3. Build user map from Slack users
    const userMapResult = buildUserMap(exportData.users);

    // 4. Persist user mappings in DB
    for (const [slackId, email] of userMapResult.userMap) {
      const displayName = userMapResult.displayNames.get(slackId) ?? slackId;
      stateDb.upsertUserMapping({
        slack_id: slackId,
        email,
        display_name: displayName,
        match_type: 'email_match',
        is_bot: 0,
      });
    }
    for (const user of userMapResult.unmappedUsers) {
      stateDb.upsertUserMapping({
        slack_id: user.id,
        email: null,
        display_name: userMapResult.displayNames.get(user.id) ?? user.name,
        match_type: 'fallback',
        is_bot: 0,
      });
    }
    for (const bot of userMapResult.botUsers) {
      stateDb.upsertUserMapping({
        slack_id: bot.id,
        email: null,
        display_name: userMapResult.displayNames.get(bot.id) ?? bot.name,
        match_type: 'fallback',
        is_bot: 1,
      });
    }

    // 5. Create API clients (or dry-run stubs)
    let chatApi: ChatAPI | DryRunChatAPI;

    if (config.dryRun) {
      chatApi = new DryRunChatAPI();
    } else {
      // Optionally verify users against Google Directory API
      try {
        const dirClient = createDirectoryClient(
          config.serviceAccountKeyPath,
          config.workspaceAdminEmail,
        );
        const directoryApi = new DirectoryAPI(dirClient);
        const emails = Array.from(userMapResult.userMap.values());

        if (emails.length > 0) {
          const resolution = await directoryApi.resolveUsers(emails);
          let verified = 0;

          // Collect IDs to demote (don't mutate Map during iteration)
          const toDemote: string[] = [];
          for (const [slackId, email] of userMapResult.userMap) {
            if (!resolution.get(email)) {
              toDemote.push(slackId);
            } else {
              verified++;
            }
          }

          for (const slackId of toDemote) {
            const email = userMapResult.userMap.get(slackId)!;
            userMapResult.userMap.delete(slackId);
            const user = exportData.users.find((u) => u.id === slackId);
            if (user) {
              userMapResult.unmappedUsers.push(user);
            }
            // Update DB to reflect demotion
            stateDb.upsertUserMapping({
              slack_id: slackId,
              email,
              display_name: userMapResult.displayNames.get(slackId) ?? slackId,
              match_type: 'fallback',
              is_bot: 0,
            });
            warn(`User ${email} not found in Google Workspace, using fallback`);
          }

          callbacks.onUserResolution?.(verified, emails.length);
        }
      } catch (err) {
        warn('Could not verify users against Directory API, proceeding with email-based mapping', {
          error: err instanceof Error ? err.message : String(err),
        });
        callbacks.onUserResolution?.(userMapResult.userMap.size, userMapResult.userMap.size);
      }

      const rateLimiter = new RateLimiter();

      chatApi = new ChatAPI(
        (email?: string) =>
          createChatClient(
            config.serviceAccountKeyPath,
            email ?? config.workspaceAdminEmail,
          ),
        config.workspaceAdminEmail,
        rateLimiter,
      );
    }

    // Persist config for future runs
    stateDb.setConfigValue('export_root', exportData.rootDir);
    stateDb.setConfigValue('admin_email', config.workspaceAdminEmail);
    if (config.serviceAccountKeyPath) {
      stateDb.setConfigValue('service_account_key_path', config.serviceAccountKeyPath);
    }

    return new Migrator(
      stateDb,
      chatApi,
      exportData,
      userMapResult,
      config,
      callbacks,
    );
  }

  /**
   * Run the migration for all conversations (channels, DMs, group DMs).
   */
  async migrate(): Promise<MigrationSummary> {
    const runId = this.stateDb.startRun(
      this.config.mode,
      this.config.dryRun,
      JSON.stringify(this.config.timeScope),
    );

    const summary: MigrationSummary = {
      channelsProcessed: [],
      spacesCreated: 0,
      messagesCreated: 0,
      messagesSkipped: 0,
      messagesFailed: 0,
      usersMatched: this.userMapResult.userMap.size,
      usersUnmatched: this.userMapResult.unmappedUsers.length,
    };

    try {
      for (const conversation of this.exportData.conversations) {
        const channelKey = conversation.name ?? conversation.id;
        const displayLabel = this.channelProcessor.getDisplayLabel(conversation);

        // Resolve message directory (may be by ID for DMs)
        const messageDirPath = this.exportData.conversationDirMap.get(conversation.id);
        if (!messageDirPath) {
          warn(`No message directory found for "${displayLabel}", skipping`);
          continue;
        }

        // Notify CLI of channel start
        const messageCount = readChannelMessages(
          this.exportData.rootDir,
          channelKey,
          this.config.timeScope,
          messageDirPath,
        ).length;
        this.callbacks.onChannelStart?.(displayLabel, messageCount);

        const result = await this.channelProcessor.processChannel(
          conversation,
          messageDirPath,
        );

        // Notify CLI of channel finish
        this.callbacks.onChannelFinish?.(displayLabel, result);

        summary.channelsProcessed.push(channelKey);
        summary.messagesCreated += result.messagesCreated;
        summary.messagesSkipped += result.messagesSkipped;
        summary.messagesFailed += result.messagesFailed;

        if (result.status === 'completed' && result.messagesCreated > 0) {
          summary.spacesCreated++;
        }
      }

      this.stateDb.completeRun(runId, summary);
      return summary;
    } catch (err) {
      this.stateDb.failRun(runId, err instanceof Error ? err.message : String(err));
      logError('Migration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Finalize all import-mode spaces, making them visible to users.
   * After finalizing, adds members to each space.
   */
  async finalize(): Promise<number> {
    const spaces = this.stateDb.getUnfinalizedSpaces();

    if (spaces.length === 0) {
      info('No unfinalized spaces found');
      return 0;
    }

    let finalized = 0;
    for (const space of spaces) {
      try {
        await this.chatApi.completeImport(space.google_space_id);
        this.stateDb.markSpaceFinalized(space.slack_channel_name);
        finalized++;
        info(`Finalized space for ${space.slack_channel_name}`);

        // Add members after finalization
        await this.addMembersToSpace(space.google_space_id, space.slack_channel_name);
      } catch (err) {
        logError(`Failed to finalize ${space.slack_channel_name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return finalized;
  }

  /**
   * Add planned members to a finalized space.
   */
  private async addMembersToSpace(
    googleSpaceId: string,
    channelName: string,
  ): Promise<void> {
    const pendingMembers = this.stateDb.getPendingMembers(googleSpaceId);
    if (pendingMembers.length === 0) return;

    this.callbacks.onMembershipStart?.(channelName, pendingMembers.length);

    let added = 0;
    let failed = 0;

    for (const member of pendingMembers) {
      // Resolve email — prefer what's in the member row, fall back to userMap
      const email = member.email ?? this.userMapResult.userMap.get(member.slack_user_id);
      if (!email) {
        this.stateDb.updateMemberStatus(googleSpaceId, member.slack_user_id, 'failed');
        failed++;
        continue;
      }

      try {
        await this.chatApi.addMember(googleSpaceId, email);
        this.stateDb.updateMemberStatus(googleSpaceId, member.slack_user_id, 'added');
        added++;
      } catch (err) {
        this.stateDb.updateMemberStatus(googleSpaceId, member.slack_user_id, 'failed');
        failed++;
        logError(`Failed to add member ${email} to ${channelName}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.stateDb.markMembersAdded(channelName);
    this.callbacks.onMembershipFinish?.(channelName, added, failed);
  }

  /**
   * Get current migration status.
   */
  getStatus(): MigrationStatus {
    return this.stateDb.getMigrationStatus();
  }

  /**
   * Get parsed export data (for CLI summary display).
   */
  getExportData(): ParsedExport {
    return this.exportData;
  }

  /**
   * Get user mapping result (for CLI summary display).
   */
  getUserMapResult(): UserMapResult {
    return this.userMapResult;
  }

  /**
   * Clean up resources.
   */
  close(): void {
    this.stateDb.close();
  }
}
