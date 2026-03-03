import type {
  SlackChannel,
  SlackChannelType,
  SlackMessage,
  MigrationConfig,
  ChannelResult,
  ChatMessagePayload,
  ChatSpacePayload,
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
  SPACE_TYPE_GROUP_CHAT,
  SPACE_THREADING_STATE,
  SPACE_NAME_PREFIX,
  DM_DISPLAY_PREFIX,
  GROUP_DM_DISPLAY_PREFIX,
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

  /**
   * Build a display name for a conversation based on its type.
   */
  getDisplayName(channelMeta: SlackChannel): string {
    const channelType = channelMeta.channelType ?? 'public_channel';

    switch (channelType) {
      case 'dm': {
        const names = (channelMeta.members ?? []).map(
          (id) => this.displayNames.get(id) ?? id,
        );
        return `${DM_DISPLAY_PREFIX}${names.join(', ')}`;
      }
      case 'group_dm': {
        const names = (channelMeta.members ?? []).map(
          (id) => this.displayNames.get(id) ?? id,
        );
        if (names.length > 4) {
          return `${GROUP_DM_DISPLAY_PREFIX}${names.slice(0, 3).join(', ')} +${names.length - 3} others`;
        }
        return `${GROUP_DM_DISPLAY_PREFIX}${names.join(', ')}`;
      }
      case 'private_channel':
      case 'public_channel':
      default:
        return `${SPACE_NAME_PREFIX}${channelMeta.name ?? channelMeta.id}`;
    }
  }

  /**
   * Build the space creation payload based on channel type.
   */
  private buildSpacePayload(
    channelMeta: SlackChannel,
    displayName: string,
  ): ChatSpacePayload {
    const channelType = channelMeta.channelType ?? 'public_channel';
    const createTime = channelMeta.created
      ? slackTsToRfc3339(`${channelMeta.created}.000000`)
      : undefined;

    const payload: ChatSpacePayload = {
      displayName,
      spaceType: SPACE_TYPE,
      importMode: true,
      spaceThreadingState: SPACE_THREADING_STATE,
      createTime,
    };

    switch (channelType) {
      case 'private_channel':
        payload.accessSettings = { accessState: 'PRIVATE' };
        break;
      case 'dm':
      case 'group_dm':
        payload.spaceType = SPACE_TYPE_GROUP_CHAT;
        break;
    }

    return payload;
  }

  /**
   * Get a label for CLI display (channel name or DM description).
   */
  getDisplayLabel(channelMeta: SlackChannel): string {
    const channelType = channelMeta.channelType ?? 'public_channel';
    if (channelType === 'dm' || channelType === 'group_dm') {
      return this.getDisplayName(channelMeta);
    }
    return `#${channelMeta.name ?? channelMeta.id}`;
  }

  async processChannel(
    channelMeta: SlackChannel,
    messageDirPath?: string,
  ): Promise<ChannelResult> {
    const channelKey = channelMeta.name ?? channelMeta.id;
    const channelType = channelMeta.channelType ?? 'public_channel';

    // 1. Resolve or create the Google Chat space
    let spaceName: string;

    // Look up by channel ID first, then fall back to name (backwards compat)
    const spaceRow =
      this.stateDb.getSpaceByChannelId(channelMeta.id) ??
      this.stateDb.getSpace(channelKey);

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
      const displayName = this.getDisplayName(channelMeta);
      const payload = this.buildSpacePayload(channelMeta, displayName);
      const result = await this.chatApi.createImportSpace(payload);

      spaceName = result.name;
      this.stateDb.upsertSpaceWithType(
        channelKey,
        spaceName,
        channelMeta.id,
        channelType,
      );

      // Plan membership for post-finalization
      if (channelMeta.members && channelMeta.members.length > 0) {
        const members = channelMeta.members.map((slackUserId) => ({
          slackUserId,
          email: this.userMap.get(slackUserId) ?? null,
        }));
        this.stateDb.insertSpaceMembers(spaceName, members);
      }
    }

    // 2. Load messages filtered by time scope
    const messages = readChannelMessages(
      this.exportRoot,
      channelKey,
      this.config.timeScope,
      messageDirPath,
    );

    // 3. Process each message
    const usedTimestamps = new Set<string>();
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      this.onProgress?.(channelKey, i + 1, messages.length);

      // Idempotency: skip if already migrated
      if (this.stateDb.isMessageMigrated(msg.ts, channelKey)) {
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
          channelKey,
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
        logError(`Failed to send message ${msg.ts} in ${channelKey}`, {
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
    channelKey: string,
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
      slack_channel: channelKey,
      google_space_id: spaceName,
      google_message_name: result.name,
      thread_key: msg.thread_ts ?? msg.ts,
      created_at: new Date().toISOString(),
    });

    return true;
  }
}
