import * as p from '@clack/prompts';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { MigrationConfig, MigrationMode, TimeScope } from '../types';
import { buildConfig } from '../core/config';
import { validateServiceAccountKey } from '../services/google/auth';
import { DEFAULT_DB_FILENAME } from '../constants';

function cancelAndExit(): never {
  p.cancel('Migration cancelled.');
  process.exit(0);
}

function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) cancelAndExit();
  return value as T;
}

/**
 * Auto-detect a .zip file in the current directory.
 */
function findZipInCwd(): string | null {
  try {
    const files = readdirSync(process.cwd());
    const zips = files.filter((f) => f.endsWith('.zip'));
    return zips.length === 1 ? join(process.cwd(), zips[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Run the full interactive CLI flow.
 * Returns a MigrationConfig ready for the Migrator.
 */
export async function runCli(): Promise<MigrationConfig> {
  p.intro('Slack → Google Chat Migration Assistant');

  // --- Detect existing state -------------------------------------------------
  const dbPath = join(process.cwd(), DEFAULT_DB_FILENAME);
  const hasExistingState = existsSync(dbPath);

  if (hasExistingState) {
    p.log.info('Found existing migration state database.');
  }

  // --- Get export path -------------------------------------------------------
  let exportPath: string;
  const autoZip = findZipInCwd();

  if (autoZip) {
    const useDetected = handleCancel(
      await p.confirm({
        message: `Found ${autoZip}. Use this Slack export?`,
        initialValue: true,
      }),
    );

    if (useDetected) {
      exportPath = autoZip;
    } else {
      exportPath = handleCancel(
        await p.text({
          message: 'Path to Slack export (.zip file or extracted directory):',
          validate: (v) => {
            if (!v.trim()) return 'Path is required';
            if (!existsSync(v.trim())) return 'Path does not exist';
          },
        }),
      );
    }
  } else {
    exportPath = handleCancel(
      await p.text({
        message: 'Path to Slack export (.zip file or extracted directory):',
        validate: (v) => {
          if (!v.trim()) return 'Path is required';
          if (!existsSync(v.trim())) return 'Path does not exist';
        },
      }),
    );
  }

  // --- Select mode -----------------------------------------------------------
  const modeOptions: { value: MigrationMode; label: string; hint?: string }[] =
    [];

  if (hasExistingState) {
    modeOptions.push(
      {
        value: 'resume',
        label: 'Resume previous migration',
        hint: 'continue from where you left off',
      },
      {
        value: 'status',
        label: 'View migration status',
        hint: 'see what has been migrated',
      },
      {
        value: 'finalize',
        label: 'Finalize migration',
        hint: 'make spaces visible to users',
      },
    );
  }

  modeOptions.push({
    value: 'new',
    label: 'Start a new migration',
    hint: hasExistingState ? 'wipes previous state' : undefined,
  });

  const mode = handleCancel(
    await p.select({
      message: 'What would you like to do?',
      options: modeOptions,
    }),
  ) as MigrationMode;

  // --- For status/finalize, we don't need credentials or scope ---------------
  if (mode === 'status') {
    return buildConfig({
      serviceAccountKeyPath: '',
      workspaceAdminEmail: '',
      slackExportPath: exportPath,
      databasePath: dbPath,
      dryRun: true,
      mode,
      timeScope: { type: 'full' },
    });
  }

  // --- Get credentials -------------------------------------------------------
  let serviceAccountKeyPath = '';
  let adminEmail = '';

  // Check if we have saved config
  let savedKeyPath: string | null = null;
  let savedAdminEmail: string | null = null;

  if (hasExistingState) {
    try {
      const { MigrationStateDB } = await import('../db/state');
      const tempDb = new MigrationStateDB(dbPath);
      savedKeyPath = tempDb.getConfigValue('service_account_key_path');
      savedAdminEmail = tempDb.getConfigValue('admin_email');
      tempDb.close();
    } catch {
      // Ignore — we'll prompt for credentials
    }
  }

  if (mode === 'finalize' && savedKeyPath && savedAdminEmail) {
    serviceAccountKeyPath = savedKeyPath;
    adminEmail = savedAdminEmail;
    p.log.info(`Using saved credentials (${adminEmail})`);
  } else if (mode !== 'finalize' || !savedKeyPath) {
    // Ask for dry-run first (affects whether credentials are required)
    const dryRun = handleCancel(
      await p.confirm({
        message: 'Run in dry-run mode? (preview only, no Google API calls)',
        initialValue: true,
      }),
    );

    if (!dryRun) {
      serviceAccountKeyPath = handleCancel(
        await p.text({
          message: 'Path to Google service account key JSON:',
          initialValue: savedKeyPath ?? undefined,
          validate: (v) => {
            if (!v.trim()) return 'Path is required';
            if (!existsSync(v.trim())) return 'File not found';
            const validation = validateServiceAccountKey(v.trim());
            if (!validation.valid) return validation.error;
          },
        }),
      );

      adminEmail = handleCancel(
        await p.text({
          message: 'Google Workspace admin email (for impersonation):',
          initialValue: savedAdminEmail ?? undefined,
          validate: (v) => {
            if (!v.trim()) return 'Email is required';
            if (!v.includes('@')) return 'Must be a valid email address';
          },
        }),
      );
    }

    // --- Time scope ------------------------------------------------------------
    let timeScope: TimeScope = { type: 'full' };

    if (mode === 'new' || mode === 'resume') {
      const scopeChoice = handleCancel(
        await p.select({
          message: 'Migration scope:',
          options: [
            {
              value: '7',
              label: 'Last 7 days',
              hint: 'quick test',
            },
            {
              value: '30',
              label: 'Last 30 days',
              hint: 'broader test',
            },
            { value: 'full', label: 'Full history' },
            { value: 'custom', label: 'Custom date range' },
          ],
        }),
      );

      if (scopeChoice === 'custom') {
        const startStr = handleCancel(
          await p.text({
            message: 'Start date (YYYY-MM-DD):',
            validate: (v) => {
              if (isNaN(Date.parse(v))) return 'Invalid date format';
            },
          }),
        );
        const endStr = handleCancel(
          await p.text({
            message: 'End date (YYYY-MM-DD):',
            validate: (v) => {
              if (isNaN(Date.parse(v))) return 'Invalid date format';
            },
          }),
        );
        timeScope = {
          type: 'custom',
          startDate: new Date(startStr),
          endDate: new Date(endStr),
        };
      } else if (scopeChoice !== 'full') {
        timeScope = { type: 'last_n_days', days: parseInt(scopeChoice, 10) };
      }
    }

    return buildConfig({
      serviceAccountKeyPath,
      workspaceAdminEmail: adminEmail,
      slackExportPath: exportPath,
      databasePath: dbPath,
      dryRun,
      mode,
      timeScope,
    });
  }

  // Finalize with saved credentials
  return buildConfig({
    serviceAccountKeyPath,
    workspaceAdminEmail: adminEmail,
    slackExportPath: exportPath,
    databasePath: dbPath,
    dryRun: false,
    mode,
    timeScope: { type: 'full' },
  });
}
