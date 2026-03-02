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
import { ChatAPI } from '../services/google/chat-api';
import { DryRunChatAPI } from '../services/dry-run';
import { RateLimiter } from '../services/google/rate-limiter';
import {
  createChatClient,
  createDirectoryClient,
} from '../services/google/auth';
import { DirectoryAPI } from '../services/google/directory-api';
import { ChannelProcessor, type ProgressCallback } from './channel-processor';
import { info, warn, error as logError } from '../utils/logger';

export class Migrator {
  private stateDb: MigrationStateDB;
  private chatApi: ChatAPI | DryRunChatAPI;
  private exportData: ParsedExport;
  private userMapResult: UserMapResult;
  private config: MigrationConfig;
  private channelProcessor: ChannelProcessor;

  private constructor(
    stateDb: MigrationStateDB,
    chatApi: ChatAPI | DryRunChatAPI,
    exportData: ParsedExport,
    userMapResult: UserMapResult,
    config: MigrationConfig,
    onProgress?: ProgressCallback,
  ) {
    this.stateDb = stateDb;
    this.chatApi = chatApi;
    this.exportData = exportData;
    this.userMapResult = userMapResult;
    this.config = config;

    this.channelProcessor = new ChannelProcessor(
      chatApi,
      stateDb,
      config,
      userMapResult.userMap,
      userMapResult.displayNames,
      exportData.rootDir,
      onProgress,
    );
  }

  /**
   * Factory method that wires up all dependencies.
   * Call this instead of the constructor.
   */
  static async create(
    config: MigrationConfig,
    onProgress?: ProgressCallback,
    onUserResolution?: (matched: number, total: number) => void,
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

          for (const [slackId, email] of userMapResult.userMap) {
            if (!resolution.get(email)) {
              // Email not found in Google Workspace — demote to fallback
              userMapResult.userMap.delete(slackId);
              userMapResult.unmappedUsers.push(
                exportData.users.find((u) => u.id === slackId)!,
              );
              warn(`User ${email} not found in Google Workspace, using fallback`);
            } else {
              verified++;
            }
          }

          onUserResolution?.(verified, emails.length);
        }
      } catch (err) {
        warn('Could not verify users against Directory API, proceeding with email-based mapping', {
          error: err instanceof Error ? err.message : String(err),
        });
        onUserResolution?.(userMapResult.userMap.size, userMapResult.userMap.size);
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
      onProgress,
    );
  }

  /**
   * Run the migration for all channels.
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
      for (const channelName of this.exportData.channelNames) {
        const channelMeta = this.exportData.channels.find(
          (c) => c.name === channelName,
        );
        if (!channelMeta) {
          warn(`No metadata found for channel "${channelName}", skipping`);
          continue;
        }

        info(`Processing channel #${channelName}`);

        const result = await this.channelProcessor.processChannel(
          channelName,
          channelMeta,
        );

        summary.channelsProcessed.push(channelName);
        summary.messagesCreated += result.messagesCreated;
        summary.messagesSkipped += result.messagesSkipped;
        summary.messagesFailed += result.messagesFailed;

        if (result.status === 'completed' && result.messagesCreated > 0) {
          summary.spacesCreated++;
        }

        info(
          `#${channelName}: ${result.messagesCreated} created, ` +
            `${result.messagesSkipped} skipped, ${result.messagesFailed} failed`,
        );
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
        info(`Finalized space for #${space.slack_channel_name}`);
      } catch (err) {
        logError(`Failed to finalize #${space.slack_channel_name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return finalized;
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
