import * as p from '@clack/prompts';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { MigrationConfig, MigrationMode, TimeScope } from '../types';
import { buildConfig } from '../core/config';
import { validateServiceAccountKey } from '../services/google/auth';
import { DEFAULT_DB_FILENAME, SLACK_DATA_DIR } from '../constants';

function cancelAndExit(): never {
  p.cancel('Migration cancelled.');
  process.exit(0);
}

function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) cancelAndExit();
  return value as T;
}

/**
 * Find .zip files and directories inside the slack-data/ folder.
 */
function findExportsInSlackData(): { value: string; label: string; hint?: string }[] {
  const dir = join(process.cwd(), SLACK_DATA_DIR);
  if (!existsSync(dir)) return [];

  try {
    const entries = readdirSync(dir);
    const options: { value: string; label: string; hint?: string }[] = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (entry.endsWith('.zip') && stat.isFile()) {
        options.push({ value: fullPath, label: entry, hint: 'zip archive' });
      } else if (stat.isDirectory()) {
        options.push({ value: fullPath, label: entry, hint: 'extracted directory' });
      }
    }

    return options;
  } catch {
    return [];
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
  const slackDataExports = findExportsInSlackData();

  if (slackDataExports.length > 0) {
    const options = [
      ...slackDataExports,
      { value: '__manual__', label: 'Enter path manually' },
    ];

    const selected = handleCancel(
      await p.select({
        message: 'Select a Slack export:',
        options,
      }),
    ) as string;

    if (selected === '__manual__') {
      exportPath = handleCancel(
        await p.text({
          message: 'Path to Slack export (.zip file or extracted directory):',
          validate: (v) => {
            if (!v.trim()) return 'Path is required';
            if (!existsSync(v.trim())) return 'Path does not exist';
          },
        }),
      );
    } else {
      exportPath = selected;
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

  // --- Status mode: no credentials needed ------------------------------------
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

  // --- Load saved credentials if available -----------------------------------
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

  // --- Finalize mode: requires live credentials, no dry-run ------------------
  if (mode === 'finalize') {
    const { keyPath, email } = await promptForCredentials(savedKeyPath, savedAdminEmail);
    return buildConfig({
      serviceAccountKeyPath: keyPath,
      workspaceAdminEmail: email,
      slackExportPath: exportPath,
      databasePath: dbPath,
      dryRun: false,
      mode,
      timeScope: { type: 'full' },
    });
  }

  // --- New / Resume migration ------------------------------------------------

  // Ask for dry-run first (affects whether credentials are required)
  const dryRun = handleCancel(
    await p.confirm({
      message: 'Run in dry-run mode? (preview only, no Google API calls)',
      initialValue: true,
    }),
  );

  let serviceAccountKeyPath = '';
  let adminEmail = '';

  if (!dryRun) {
    const creds = await promptForCredentials(savedKeyPath, savedAdminEmail);
    serviceAccountKeyPath = creds.keyPath;
    adminEmail = creds.email;
  }

  // --- Time scope ------------------------------------------------------------
  let timeScope: TimeScope = { type: 'full' };

  const scopeChoice = handleCancel(
    await p.select({
      message: 'Migration scope:',
      options: [
        { value: '7', label: 'Last 7 days', hint: 'quick test' },
        { value: '30', label: 'Last 30 days', hint: 'broader test' },
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
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim()))
            return 'Use YYYY-MM-DD format';
          if (isNaN(Date.parse(v.trim()))) return 'Invalid date';
        },
      }),
    );
    const endStr = handleCancel(
      await p.text({
        message: 'End date (YYYY-MM-DD):',
        validate: (v) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim()))
            return 'Use YYYY-MM-DD format';
          if (isNaN(Date.parse(v.trim()))) return 'Invalid date';
          if (new Date(v.trim()) < new Date(startStr))
            return 'End date must be after start date';
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

/**
 * Prompt for Google service account credentials, reusing saved values if available.
 */
async function promptForCredentials(
  savedKeyPath: string | null,
  savedAdminEmail: string | null,
): Promise<{ keyPath: string; email: string }> {
  if (savedKeyPath && savedAdminEmail && existsSync(savedKeyPath)) {
    const reuse = handleCancel(
      await p.confirm({
        message: `Use saved credentials? (${savedAdminEmail})`,
        initialValue: true,
      }),
    );
    if (reuse) {
      return { keyPath: savedKeyPath, email: savedAdminEmail };
    }
  }

  const keyPath = handleCancel(
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

  const email = handleCancel(
    await p.text({
      message: 'Google Workspace admin email (for impersonation):',
      initialValue: savedAdminEmail ?? undefined,
      validate: (v) => {
        if (!v.trim()) return 'Email is required';
        if (!v.includes('@')) return 'Must be a valid email address';
      },
    }),
  );

  return { keyPath, email };
}
