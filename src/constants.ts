export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/chat.import',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
] as const;

export const CHAT_IMPORT_SCOPE = 'https://www.googleapis.com/auth/chat.import';
export const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

export const SPACE_TYPE = 'SPACE';
export const SPACE_THREADING_STATE = 'THREADED_MESSAGES';
export const SPACE_NAME_PREFIX = 'Slack #';

// Import mode rate limits
export const IMPORT_MODE_MESSAGES_PER_MINUTE = 600;
export const IMPORT_MODE_REACTIONS_PER_MINUTE = 300;

// Import mode window
export const IMPORT_MODE_DAYS_LIMIT = 90;

// Retry defaults
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_INITIAL_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 60_000;
export const DEFAULT_BACKOFF_FACTOR = 2;

// Directory API batch size for user resolution
export const DIRECTORY_BATCH_SIZE = 10;

// Slack message subtypes that are system/meta messages (skip during migration)
export const SYSTEM_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
  'pinned_item',
  'unpinned_item',
]);

// Slack message subtypes indicating bot/app messages
export const BOT_SUBTYPES = new Set([
  'bot_message',
  'bot_add',
  'bot_remove',
]);

// Default state database filename
export const DEFAULT_DB_FILENAME = 'migration-state.db';

// Directory to scan for Slack exports
export const SLACK_DATA_DIR = 'slack-data';

// Google Chat message reply option for thread replies
export const REPLY_MESSAGE_FALLBACK = 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
