import { existsSync } from 'fs';
import { ConfigError } from '../errors';
import type { MigrationConfig, MigrationMode, TimeScope } from '../types';

export function buildConfig(options: {
  serviceAccountKeyPath: string;
  workspaceAdminEmail: string;
  slackExportPath: string;
  databasePath: string;
  dryRun: boolean;
  mode: MigrationMode;
  timeScope: TimeScope;
}): MigrationConfig {
  if (!options.dryRun) {
    if (!existsSync(options.serviceAccountKeyPath)) {
      throw new ConfigError(
        `Service account key file not found: ${options.serviceAccountKeyPath}`,
      );
    }

    if (!options.workspaceAdminEmail.includes('@')) {
      throw new ConfigError(
        `Invalid admin email: ${options.workspaceAdminEmail}`,
      );
    }
  }

  if (!existsSync(options.slackExportPath)) {
    throw new ConfigError(
      `Slack export not found: ${options.slackExportPath}`,
    );
  }

  return {
    serviceAccountKeyPath: options.serviceAccountKeyPath,
    workspaceAdminEmail: options.workspaceAdminEmail,
    slackExportPath: options.slackExportPath,
    databasePath: options.databasePath,
    dryRun: options.dryRun,
    mode: options.mode,
    timeScope: options.timeScope,
  };
}
