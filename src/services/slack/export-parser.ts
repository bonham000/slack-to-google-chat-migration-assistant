import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { SlackChannel, SlackUser, ParsedExport } from '../../types';
import { ExportParseError } from '../../errors';

/**
 * Parse a Slack export from a .zip file or an already-extracted directory.
 *
 * If the path points to a .zip file it will be extracted to a sibling
 * directory (e.g. `foo.zip` -> `foo_extracted/`).  If it points to a
 * directory it is used directly.
 *
 * Validates that `users.json` and `channels.json` exist and are parseable,
 * then discovers channel directories.
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

  // --- Validate and parse channels.json --------------------------------------
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

  // --- Discover channel directories ------------------------------------------
  const channelNamesFromJson = new Set(channels.map((c) => c.name));

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const channelNameSet = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Include if the directory name matches a channel in channels.json
    if (channelNamesFromJson.has(entry.name)) {
      channelNameSet.add(entry.name);
      continue;
    }

    // Otherwise include if the directory contains any .json files
    const dirPath = path.join(rootDir, entry.name);
    const files = fs.readdirSync(dirPath);
    if (files.some((f) => f.endsWith('.json'))) {
      channelNameSet.add(entry.name);
    }
  }

  const channelNames = Array.from(channelNameSet).sort();

  return {
    rootDir,
    channels,
    users,
    channelNames,
    wasExtracted,
  };
}
