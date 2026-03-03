import * as fs from 'fs';
import * as path from 'path';
import type { SlackMessage, TimeScope } from '../../types';

/**
 * Apply a TimeScope filter to a numeric timestamp (seconds since epoch).
 * Returns `true` if the message should be kept.
 */
function passesTimeScope(ts: number, timeScope: TimeScope): boolean {
  switch (timeScope.type) {
    case 'full':
      return true;

    case 'last_n_days': {
      const cutoff = Date.now() / 1000 - timeScope.days * 86400;
      return ts >= cutoff;
    }

    case 'custom': {
      const start = timeScope.startDate.getTime() / 1000;
      const end = timeScope.endDate.getTime() / 1000;
      return ts >= start && ts <= end;
    }
  }
}

/**
 * Read all messages from a channel directory, sort by timestamp, deduplicate
 * by `ts`, and optionally filter by a TimeScope.
 */
export function readChannelMessages(
  exportRoot: string,
  channelName: string,
  timeScope?: TimeScope,
  /** Override the default directory path (for DMs that use channel IDs) */
  dirPath?: string,
): SlackMessage[] {
  const channelDir = dirPath ?? path.join(exportRoot, channelName);

  if (!fs.existsSync(channelDir)) {
    return [];
  }

  const files = fs
    .readdirSync(channelDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const allMessages: SlackMessage[] = [];

  for (const file of files) {
    const filePath = path.join(channelDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const messages: SlackMessage[] = JSON.parse(raw);
    allMessages.push(...messages);
  }

  // Sort by timestamp ascending
  allMessages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  // Deduplicate by ts
  const seen = new Set<string>();
  const deduped: SlackMessage[] = [];
  for (const msg of allMessages) {
    if (!seen.has(msg.ts)) {
      seen.add(msg.ts);
      deduped.push(msg);
    }
  }

  // Apply time scope filter
  if (timeScope && timeScope.type !== 'full') {
    return deduped.filter((msg) => passesTimeScope(parseFloat(msg.ts), timeScope));
  }

  return deduped;
}

/**
 * Count messages in a channel, optionally filtered by a TimeScope.
 */
export function countChannelMessages(
  exportRoot: string,
  channelName: string,
  timeScope?: TimeScope,
  dirPath?: string,
): number {
  return readChannelMessages(exportRoot, channelName, timeScope, dirPath).length;
}
