// =============================================================================
// Slack Export Types
// =============================================================================

export interface SlackUserProfile {
  real_name?: string;
  email?: string;
  display_name?: string;
  image_72?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
  team_id?: string;
  profile?: SlackUserProfile;
}

export interface SlackFile {
  id?: string;
  name: string;
  title?: string;
  user?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
}

export interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
  username?: string;
  edited?: { user?: string; ts?: string };
  files?: SlackFile[];
  reply_count?: number;
  reply_users_count?: number;
  parent_user_id?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  created?: number;
  creator?: string;
  is_archived?: boolean;
  is_general?: boolean;
  is_private?: boolean;
  members?: string[];
  topic?: { value: string; creator?: string; last_set?: number };
  purpose?: { value: string; creator?: string; last_set?: number };
}

// =============================================================================
// Migration Config
// =============================================================================

export interface MigrationConfig {
  serviceAccountKeyPath: string;
  workspaceAdminEmail: string;
  slackExportPath: string;
  databasePath: string;
  dryRun: boolean;
  mode: MigrationMode;
  timeScope: TimeScope;
}

export type MigrationMode = 'new' | 'resume' | 'status' | 'finalize';

export type TimeScope =
  | { type: 'last_n_days'; days: number }
  | { type: 'full' }
  | { type: 'custom'; startDate: Date; endDate: Date };

// =============================================================================
// Parsed Export
// =============================================================================

export interface ParsedExport {
  rootDir: string;
  channels: SlackChannel[];
  users: SlackUser[];
  channelNames: string[];
  wasExtracted: boolean;
}

// =============================================================================
// User Mapping
// =============================================================================

export interface UserMapResult {
  userMap: Map<string, string>;       // slackId -> email
  displayNames: Map<string, string>;  // slackId -> display name
  unmappedUsers: SlackUser[];
  botUsers: SlackUser[];
}

// =============================================================================
// DB Row Types
// =============================================================================

export interface SpaceRow {
  slack_channel_name: string;
  google_space_id: string;
  import_mode_active: number;
  created_at: string;
  finalized_at: string | null;
}

export interface MigratedMessageRow {
  slack_ts: string;
  slack_channel: string;
  google_space_id: string;
  google_message_name: string;
  thread_key: string | null;
  created_at: string;
}

export interface UserMappingRow {
  slack_id: string;
  email: string | null;
  display_name: string;
  match_type: string;
  is_bot: number;
}

export interface MigrationRunRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  mode: string;
  dry_run: number;
  time_scope: string | null;
  channels_processed: number;
  messages_created: number;
  messages_skipped: number;
  messages_failed: number;
  status: string;
}

// =============================================================================
// Google Chat API Payloads
// =============================================================================

export interface ChatSpacePayload {
  displayName: string;
  spaceType: string;
  importMode: boolean;
  spaceThreadingState: string;
  createTime?: string;
}

export interface ChatMessagePayload {
  text: string;
  createTime: string;
  thread?: { threadKey?: string };
}

// =============================================================================
// Migration Results
// =============================================================================

export interface ChannelResult {
  status: 'completed' | 'already_finalized' | 'failed';
  messagesCreated: number;
  messagesSkipped: number;
  messagesFailed: number;
}

export interface MigrationSummary {
  channelsProcessed: string[];
  spacesCreated: number;
  messagesCreated: number;
  messagesSkipped: number;
  messagesFailed: number;
  usersMatched: number;
  usersUnmatched: number;
}

export interface MigrationStatus {
  totalSpaces: number;
  totalMessages: number;
  totalRuns: number;
  lastRun: MigrationRunRow | null;
  unfinalizedSpaces: SpaceRow[];
}
