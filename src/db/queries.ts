export const QUERIES = {
  // Spaces
  getSpace: `SELECT * FROM spaces WHERE slack_channel_name = ?`,

  upsertSpace: `
    INSERT INTO spaces (slack_channel_name, google_space_id)
    VALUES (?, ?)
    ON CONFLICT(slack_channel_name) DO UPDATE SET
      google_space_id = excluded.google_space_id
  `,

  markFinalized: `
    UPDATE spaces
    SET import_mode_active = 0, finalized_at = datetime('now')
    WHERE slack_channel_name = ?
  `,

  getUnfinalizedSpaces: `SELECT * FROM spaces WHERE import_mode_active = 1`,

  getAllSpaces: `SELECT * FROM spaces`,

  getSpaceByChannelId: `SELECT * FROM spaces WHERE slack_channel_id = ?`,

  upsertSpaceWithType: `
    INSERT INTO spaces (slack_channel_name, google_space_id, slack_channel_id, slack_channel_type)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slack_channel_name) DO UPDATE SET
      google_space_id = excluded.google_space_id,
      slack_channel_id = excluded.slack_channel_id,
      slack_channel_type = excluded.slack_channel_type
  `,

  getSpacesNeedingMembers: `SELECT * FROM spaces WHERE import_mode_active = 0 AND members_added = 0`,

  markMembersAdded: `UPDATE spaces SET members_added = 1 WHERE slack_channel_name = ?`,

  // Messages
  isMessageMigrated: `SELECT 1 FROM migrated_messages WHERE slack_ts = ? AND slack_channel = ? LIMIT 1`,

  insertMessage: `
    INSERT INTO migrated_messages (slack_ts, slack_channel, google_space_id, google_message_name, thread_key)
    VALUES (?, ?, ?, ?, ?)
  `,

  getMessageCount: `SELECT COUNT(*) AS count FROM migrated_messages WHERE slack_channel = ?`,

  getTotalMessageCount: `SELECT COUNT(*) AS count FROM migrated_messages`,

  // User Mappings
  upsertUserMapping: `
    INSERT INTO user_mappings (slack_id, email, display_name, match_type, is_bot)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slack_id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      match_type = excluded.match_type,
      is_bot = excluded.is_bot
  `,

  getUserMapping: `SELECT * FROM user_mappings WHERE slack_id = ?`,

  getAllUserMappings: `SELECT * FROM user_mappings`,

  // Migration Runs
  startRun: `
    INSERT INTO migration_runs (mode, dry_run, time_scope)
    VALUES (?, ?, ?)
  `,

  completeRun: `
    UPDATE migration_runs
    SET completed_at = datetime('now'),
        channels_processed = ?,
        messages_created = ?,
        messages_skipped = ?,
        messages_failed = ?,
        status = 'completed'
    WHERE id = ?
  `,

  failRun: `
    UPDATE migration_runs
    SET completed_at = datetime('now'),
        status = ?
    WHERE id = ?
  `,

  getLastRun: `SELECT * FROM migration_runs ORDER BY id DESC LIMIT 1`,

  // Space Members
  insertSpaceMember: `
    INSERT OR IGNORE INTO space_members (google_space_id, slack_user_id, email)
    VALUES (?, ?, ?)
  `,

  getPendingMembers: `SELECT * FROM space_members WHERE google_space_id = ? AND status = 'pending'`,

  updateMemberStatus: `
    UPDATE space_members
    SET status = ?, added_at = datetime('now')
    WHERE google_space_id = ? AND slack_user_id = ?
  `,

  // Config State
  getConfigValue: `SELECT value FROM config_state WHERE key = ?`,

  setConfigValue: `
    INSERT INTO config_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value
  `,
} as const;
