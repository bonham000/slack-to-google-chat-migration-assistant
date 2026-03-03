import * as p from '@clack/prompts';
import type {
  MigrationSummary,
  MigrationStatus,
  ParsedExport,
  UserMapResult,
  TimeScope,
} from '../types';
import { countChannelMessages } from '../services/slack/message-reader';

/**
 * Display the pre-migration summary after parsing the export and resolving users.
 */
export function displayExportSummary(
  exportData: ParsedExport,
  userMapResult: UserMapResult,
  timeScope?: TimeScope,
): void {
  let totalMessages = 0;
  for (const conv of exportData.conversations) {
    const dirPath = exportData.conversationDirMap.get(conv.id);
    const key = conv.name ?? conv.id;
    totalMessages += countChannelMessages(exportData.rootDir, key, timeScope, dirPath);
  }

  // Count by conversation type
  const typeCounts = { public_channel: 0, private_channel: 0, dm: 0, group_dm: 0 };
  for (const conv of exportData.conversations) {
    const t = conv.channelType ?? 'public_channel';
    if (t in typeCounts) typeCounts[t as keyof typeof typeCounts]++;
  }

  const lines: string[] = [];

  if (typeCounts.public_channel > 0)
    lines.push(`Public channels:  ${typeCounts.public_channel}`);
  if (typeCounts.private_channel > 0)
    lines.push(`Private channels: ${typeCounts.private_channel}`);
  if (typeCounts.dm > 0)
    lines.push(`DMs:              ${typeCounts.dm}`);
  if (typeCounts.group_dm > 0)
    lines.push(`Group DMs:        ${typeCounts.group_dm}`);

  lines.push(`Total messages:   ${totalMessages.toLocaleString()}`);
  lines.push(`Users matched:    ${userMapResult.userMap.size} (by email)`);
  lines.push(`Users fallback:   ${userMapResult.unmappedUsers.length} (will use [Name]: prefix)`);
  lines.push(`Bots:             ${userMapResult.botUsers.length} (will use [Name]: prefix)`);

  p.note(lines.join('\n'), 'Export Summary');
}

/**
 * Display results after a migration run completes.
 */
export function displayPostMigrationSummary(
  summary: MigrationSummary,
  dryRun: boolean,
): void {
  const lines = [
    `Channels processed: ${summary.channelsProcessed.length}`,
    `Spaces created:     ${summary.spacesCreated}`,
    `Messages created:   ${summary.messagesCreated.toLocaleString()}`,
    `Messages skipped:   ${summary.messagesSkipped.toLocaleString()}`,
  ];

  if (summary.messagesFailed > 0) {
    lines.push(`Messages failed:    ${summary.messagesFailed.toLocaleString()}`);
    lines.push('');
    lines.push('Some messages failed. Re-run to retry failed messages.');
  }

  if (!dryRun && summary.messagesFailed === 0) {
    lines.push('');
    lines.push(
      'All messages migrated. Run again and choose "Finalize" to make spaces visible.',
    );
  }

  p.note(lines.join('\n'), dryRun ? 'Dry Run Summary' : 'Migration Summary');
}

/**
 * Display migration status from the database.
 */
export function displayMigrationStatus(status: MigrationStatus): void {
  const lines = [
    `Total spaces:     ${status.totalSpaces}`,
    `Total messages:   ${status.totalMessages.toLocaleString()}`,
    `Total runs:       ${status.totalRuns}`,
    `Unfinalized:      ${status.unfinalizedSpaces.length} spaces`,
  ];

  if (status.lastRun) {
    lines.push('');
    lines.push(`Last run: ${status.lastRun.started_at}`);
    lines.push(`  Mode:     ${status.lastRun.mode}`);
    lines.push(`  Status:   ${status.lastRun.status}`);
    lines.push(`  Created:  ${status.lastRun.messages_created}`);
    lines.push(`  Skipped:  ${status.lastRun.messages_skipped}`);
    lines.push(`  Failed:   ${status.lastRun.messages_failed}`);
  }

  if (status.unfinalizedSpaces.length > 0) {
    lines.push('');
    lines.push('Unfinalized spaces:');
    for (const space of status.unfinalizedSpaces) {
      lines.push(`  #${space.slack_channel_name} → ${space.google_space_id}`);
    }
  }

  p.note(lines.join('\n'), 'Migration Status');
}
