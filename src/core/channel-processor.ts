import type {
  SlackChannel,
  SlackMessage,
  MigrationConfig,
  ChannelResult,
  ChatMessagePayload,
} from '../types';
import type { MigrationStateDB } from '../db/state';
import type { ChatAPI } from '../services/google/chat-api';
import type { DryRunChatAPI } from '../services/dry-run';
import { readChannelMessages } from '../services/slack/message-reader';
import {
  convertSlackToGChat,
  formatAttachmentPlaceholders,
  formatBotAttribution,
} from '../services/formatting';
import { slackTsToRfc3339, ensureUniqueTimestamp } from '../utils/timestamp';
import {
  SYSTEM_SUBTYPES,
  SPACE_TYPE,
  SPACE_THREADING_STATE,
  SPACE_NAME_PREFIX,
  REPLY_MESSAGE_FALLBACK,
} from '../constants';
import { error as logError } from '../utils/logger';

export type ProgressCallback = (
  channel: string,
  current: number,
  total: number,
) => void;

export type ChannelLifecycleCallback = {
  onChannelStart?: (channel: string, messageCount: number) => void;
  onChannelFinish?: (channel: string, result: ChannelResult) => void;
};

export class ChannelProcessor {
  constructor(
    private chatApi: ChatAPI | DryRunChatAPI,
    private stateDb: MigrationStateDB,
    private config: MigrationConfig,
    private userMap: Map<string, string>,
    private displayNames: Map<string, string>,
    private exportRoot: string,
    private onProgress?: ProgressCallback,
  ) {}

  async processChannel(
    channelName: string,
    channelMeta: SlackChannel,
  ): Promise<ChannelResult> {
    // 1. Resolve or create the Google Chat space
    let spaceName: string;
    const spaceRow = this.stateDb.getSpace(channelName);

    if (spaceRow && !spaceRow.import_mode_active) {
      return {
        status: 'already_finalized',
        messagesCreated: 0,
        messagesSkipped: 0,
        messagesFailed: 0,
      };
    }

    if (spaceRow) {
      // Resume: space exists and is still in import mode
      spaceName = spaceRow.google_space_id;
    } else {
      // Create new import-mode space
      const createTime = channelMeta.created
        ? slackTsToRfc3339(`${channelMeta.created}.000000`)
        : undefined;

      const result = await this.chatApi.createImportSpace({
        displayName: `${SPACE_NAME_PREFIX}${channelName}`,
        spaceType: SPACE_TYPE,
        importMode: true,
        spaceThreadingState: SPACE_THREADING_STATE,
        createTime,
      });

      spaceName = result.name;
      this.stateDb.upsertSpace(channelName, spaceName);
    }

    // 2. Load messages filtered by time scope
    const messages = readChannelMessages(
      this.exportRoot,
      channelName,
      this.config.timeScope,
    );

    // 3. Process each message
    const usedTimestamps = new Set<string>();
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      this.onProgress?.(channelName, i + 1, messages.length);

      // Idempotency: skip if already migrated
      if (this.stateDb.isMessageMigrated(msg.ts, channelName)) {
        skipped++;
        continue;
      }

      // Skip system messages (joins, leaves, topic changes, etc.)
      if (msg.subtype && SYSTEM_SUBTYPES.has(msg.subtype)) {
        skipped++;
        continue;
      }

      try {
        const sent = await this.sendMessage(
          spaceName,
          channelName,
          msg,
          usedTimestamps,
        );
        if (sent) {
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;
        logError(`Failed to send message ${msg.ts} in #${channelName}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      status: 'completed',
      messagesCreated: created,
      messagesSkipped: skipped,
      messagesFailed: failed,
    };
  }

  private async sendMessage(
    spaceName: string,
    channelName: string,
    msg: SlackMessage,
    usedTimestamps: Set<string>,
  ): Promise<boolean> {
    // Build text content
    let text = msg.text ?? '';
    text = convertSlackToGChat(text, this.userMap, this.displayNames);

    // Determine sender
    const senderEmail = msg.user
      ? this.userMap.get(msg.user) ?? null
      : null;

    // Fallback attribution for unmapped users and bots
    if (!senderEmail) {
      const displayName =
        (msg.user ? this.displayNames.get(msg.user) : null) ??
        msg.username ??
        'Unknown';
      text = formatBotAttribution(displayName, text);
    }

    // Attachment placeholders
    if (msg.files && msg.files.length > 0) {
      text += '\n' + formatAttachmentPlaceholders(msg.files);
    }

    // Skip empty messages
    if (!text.trim()) return false;

    // Ensure unique timestamp for Google Chat
    const uniqueTs = ensureUniqueTimestamp(msg.ts, usedTimestamps);

    // Build payload
    const payload: ChatMessagePayload = {
      text,
      createTime: slackTsToRfc3339(uniqueTs),
    };

    // Threading: only set threadKey for messages that are part of a thread
    const isThreadParent = msg.thread_ts && msg.thread_ts === msg.ts;
    const isThreadReply = msg.thread_ts && msg.thread_ts !== msg.ts;

    if (isThreadParent || isThreadReply) {
      payload.thread = { threadKey: msg.thread_ts };
    }

    // Generate a deterministic message ID from the Slack timestamp
    const messageId = `slack-${msg.ts.replace('.', '-')}`;

    // Reply option for thread replies
    const messageReplyOption = isThreadReply ? REPLY_MESSAGE_FALLBACK : undefined;

    // Send
    const result = await this.chatApi.createMessage(
      spaceName,
      payload,
      messageId,
      senderEmail,
      messageReplyOption,
    );

    // Record in state DB
    this.stateDb.recordMessage({
      slack_ts: msg.ts,
      slack_channel: channelName,
      google_space_id: spaceName,
      google_message_name: result.name,
      thread_key: msg.thread_ts ?? msg.ts,
      created_at: new Date().toISOString(),
    });

    return true;
  }
}
