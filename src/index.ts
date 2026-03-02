import * as p from '@clack/prompts';
import { runCli } from './cli/prompts';
import {
  displayExportSummary,
  displayPostMigrationSummary,
  displayMigrationStatus,
} from './cli/summary';
import { Migrator, type MigratorCallbacks } from './core/migrator';

let activeMigrator: Migrator | null = null;

async function main() {
  try {
    const config = await runCli();

    // --- Status mode: just show status and exit ---
    if (config.mode === 'status') {
      const migrator = await Migrator.create(config);
      displayMigrationStatus(migrator.getStatus());
      migrator.close();
      p.outro('Done.');
      return;
    }

    // --- Parse export, resolve users ---
    const parseSpinner = p.spinner();
    parseSpinner.start('Parsing Slack export...');

    // Single migration spinner + indented per-channel log lines
    let migrationSpinner: ReturnType<typeof p.spinner> | null = null as ReturnType<typeof p.spinner> | null;

    const callbacks: MigratorCallbacks = {
      onProgress(_channel, current, total) {
        migrationSpinner?.message(
          `Migrating #${_channel} (${current}/${total} messages)`,
        );
      },

      onChannelStart(channel, messageCount) {
        if (!migrationSpinner) {
          migrationSpinner = p.spinner();
          migrationSpinner.start(`Migrating #${channel} (0/${messageCount} messages)`);
        } else {
          migrationSpinner.message(`Migrating #${channel} (0/${messageCount} messages)`);
        }
      },

      onChannelFinish(channel, result) {
        let detail: string;
        if (result.status === 'already_finalized') {
          detail = 'already finalized, skipped';
        } else if (
          result.messagesCreated === 0 &&
          result.messagesFailed === 0
        ) {
          detail = 'no messages in scope';
        } else {
          const parts: string[] = [];
          if (result.messagesCreated > 0)
            parts.push(`${result.messagesCreated} created`);
          if (result.messagesSkipped > 0)
            parts.push(`${result.messagesSkipped} skipped`);
          if (result.messagesFailed > 0)
            parts.push(`${result.messagesFailed} failed`);
          detail = parts.join(', ');
        }
        p.log.info(`#${channel}: ${detail}`);
      },
    };

    const migrator = await Migrator.create(config, callbacks);
    activeMigrator = migrator;
    parseSpinner.stop('Export parsed and users resolved.');

    // Show summary
    displayExportSummary(
      migrator.getExportData(),
      migrator.getUserMapResult(),
      config.timeScope,
    );

    // --- Finalize mode ---
    if (config.mode === 'finalize') {
      const confirm = await p.confirm({
        message:
          'This will make all imported spaces visible to users. Proceed?',
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.cancel('Finalization cancelled.');
        migrator.close();
        return;
      }

      const finalizeSpinner = p.spinner();
      finalizeSpinner.start('Finalizing spaces...');
      const count = await migrator.finalize();
      finalizeSpinner.stop(`Finalized ${count} space(s).`);
      migrator.close();
      p.outro('Migration complete! Spaces are now visible to users.');
      return;
    }

    // --- New or Resume migration ---
    const scopeDesc =
      config.timeScope.type === 'last_n_days'
        ? `last ${config.timeScope.days} days`
        : config.timeScope.type === 'custom'
          ? 'custom date range'
          : 'full history';

    const modeDesc = config.dryRun ? 'DRY RUN' : 'LIVE';

    const proceed = await p.confirm({
      message: `Start ${modeDesc} migration (${scopeDesc})?`,
      initialValue: true,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Migration cancelled.');
      migrator.close();
      return;
    }

    // Run migration — single spinner with per-channel log lines
    const summary = await migrator.migrate();
    migrationSpinner?.stop('All channels processed.');

    // Show results
    displayPostMigrationSummary(summary, config.dryRun);
    migrator.close();
    activeMigrator = null;

    if (config.dryRun) {
      p.outro('Dry run complete. No changes were made to Google Chat.');
    } else {
      p.outro(
        'Migration run complete. Re-run and choose "Finalize" when ready.',
      );
    }
  } catch (err) {
    p.cancel('Migration failed.');
    console.error(err);
    activeMigrator?.close();
    process.exit(1);
  }
}

// Graceful shutdown — close DB cleanly
process.on('SIGINT', () => {
  activeMigrator?.close();
  p.cancel('\nInterrupted. Your progress has been saved. Re-run to resume.');
  process.exit(130);
});

main();
