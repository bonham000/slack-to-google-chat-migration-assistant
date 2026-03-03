import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { SlackChannel, SlackChannelType, SlackUser, ParsedExport } from '../../types';
import { ExportParseError } from '../../errors';
import {
  SLACK_GROUPS_FILE,
  SLACK_DMS_FILE,
  SLACK_MPIMS_FILE,
} from '../../constants';

/**
 * Parse an optional JSON file from the export, returning [] if missing.
 */
function parseOptionalJsonFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Find the message directory for a conversation.
 * Tries by channel ID first (DMs/MPIMs use ID-based dirs), then by name.
 */
function findConversationDir(
  rootDir: string,
  conversation: SlackChannel,
): string | null {
  // Try by ID first (DMs and MPIMs use channel ID as directory name)
  const byId = path.join(rootDir, conversation.id);
  if (fs.existsSync(byId) && fs.statSync(byId).isDirectory()) return byId;

  // Try by name (public/private channels in standard exports)
  if (conversation.name) {
    const byName = path.join(rootDir, conversation.name);
    if (fs.existsSync(byName) && fs.statSync(byName).isDirectory()) return byName;
  }

  return null;
}

/**
 * Parse a Slack export from a .zip file or an already-extracted directory.
 *
 * If the path points to a .zip file it will be extracted to a sibling
 * directory (e.g. `foo.zip` -> `foo_extracted/`).  If it points to a
 * directory it is used directly.
 *
 * Validates that `users.json` and `channels.json` exist and are parseable,
 * then discovers all conversation types (public, private, DMs, group DMs).
 */
export function parseExport(zipPathOrDir: string): ParsedExport {
  let rootDir: string;
  let wasExtracted = false;

  const resolved = path.resolve(zipPathOrDir);

  if (!fs.existsSync(resolved)) {
    throw new ExportParseError(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    if (!resolved.endsWith('.zip')) {
      throw new ExportParseError(
        `Expected a .zip file or directory, got: ${resolved}`,
      );
    }

    const baseName = path.basename(resolved, '.zip');
    rootDir = path.join(path.dirname(resolved), `${baseName}_extracted`);

    if (!fs.existsSync(rootDir)) {
      try {
        const zip = new AdmZip(resolved);
        zip.extractAllTo(rootDir, true);
      } catch (err) {
        throw new ExportParseError(
          `Failed to extract ZIP file: ${resolved}`,
          err instanceof Error ? err : undefined,
        );
      }
    }

    wasExtracted = true;
  } else if (stat.isDirectory()) {
    rootDir = resolved;
  } else {
    throw new ExportParseError(
      `Path is neither a file nor a directory: ${resolved}`,
    );
  }

  // --- Validate and parse users.json -----------------------------------------
  const usersPath = path.join(rootDir, 'users.json');
  if (!fs.existsSync(usersPath)) {
    throw new ExportParseError(
      `Missing users.json in export directory: ${rootDir}`,
    );
  }

  let users: SlackUser[];
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  } catch (err) {
    throw new ExportParseError(
      'Failed to parse users.json',
      err instanceof Error ? err : undefined,
    );
  }

  // --- Parse channels.json (required) ----------------------------------------
  const channelsPath = path.join(rootDir, 'channels.json');
  if (!fs.existsSync(channelsPath)) {
    throw new ExportParseError(
      `Missing channels.json in export directory: ${rootDir}`,
    );
  }

  let channels: SlackChannel[];
  try {
    channels = JSON.parse(fs.readFileSync(channelsPath, 'utf-8'));
  } catch (err) {
    throw new ExportParseError(
      'Failed to parse channels.json',
      err instanceof Error ? err : undefined,
    );
  }

  // Tag public channels
  for (const ch of channels) {
    ch.channelType = 'public_channel';
  }

  // --- Parse optional export files (compliance export) -----------------------
  const privateChannels = parseOptionalJsonFile<SlackChannel>(
    path.join(rootDir, SLACK_GROUPS_FILE),
  );
  for (const ch of privateChannels) {
    ch.channelType = 'private_channel';
  }

  const dms = parseOptionalJsonFile<SlackChannel>(
    path.join(rootDir, SLACK_DMS_FILE),
  );
  for (const ch of dms) {
    ch.channelType = 'dm';
  }

  const groupDms = parseOptionalJsonFile<SlackChannel>(
    path.join(rootDir, SLACK_MPIMS_FILE),
  );
  for (const ch of groupDms) {
    ch.channelType = 'group_dm';
  }

  // --- Build unified conversations list + directory map ----------------------
  const conversations: SlackChannel[] = [
    ...channels,
    ...privateChannels,
    ...dms,
    ...groupDms,
  ];

  const conversationDirMap = new Map<string, string>();
  for (const conv of conversations) {
    const dir = findConversationDir(rootDir, conv);
    if (dir) {
      conversationDirMap.set(conv.id, dir);
    }
  }

  // --- Backwards-compatible channelNames (public channels only) ---------------
  const channelNamesFromJson = new Set(channels.map((c) => c.name).filter(Boolean) as string[]);

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const channelNameSet = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (channelNamesFromJson.has(entry.name)) {
      channelNameSet.add(entry.name);
      continue;
    }

    // Include if the directory contains any .json files
    const dirPath = path.join(rootDir, entry.name);
    try {
      const files = fs.readdirSync(dirPath);
      if (files.some((f) => f.endsWith('.json'))) {
        channelNameSet.add(entry.name);
      }
    } catch {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  const channelNames = Array.from(channelNameSet).sort();

  return {
    rootDir,
    channels,
    users,
    channelNames,
    wasExtracted,
    conversations,
    conversationDirMap,
  };
}
