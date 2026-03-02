import * as p from '@clack/prompts';
import { runCli } from './cli/prompts';
import {
  displayExportSummary,
  displayPostMigrationSummary,
  displayMigrationStatus,
} from './cli/summary';
import { createProgressReporter } from './cli/progress';
import { Migrator } from './core/migrator';
import { readChannelMessages } from './services/slack/message-reader';

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

    // --- Parse export and show summary ---
    const s = p.spinner();
    s.start('Parsing Slack export...');

    const progress = createProgressReporter();

    const onProgress = (channel: string, current: number, total: number) => {
      progress.updateChannel(channel, current, total);
    };

    const onUserResolution = (matched: number, total: number) => {
      // This callback fires during Migrator.create, we'll show the result after
    };

    const migrator = await Migrator.create(config, onProgress, onUserResolution);
    s.stop('Export parsed and users resolved.');

    // Show summary
    displayExportSummary(migrator.getExportData(), migrator.getUserMapResult());

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
    // Confirm before starting
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

    // Save credentials path for future runs
    if (!config.dryRun && config.serviceAccountKeyPath) {
      // Already saved in Migrator.create via stateDb.setConfigValue
    }

    // Run migration with per-channel progress
    const exportData = migrator.getExportData();
    const channelMessages = new Map<string, number>();
    for (const name of exportData.channelNames) {
      channelMessages.set(
        name,
        readChannelMessages(exportData.rootDir, name, config.timeScope).length,
      );
    }

    const summary = await migrator.migrate();

    // Show results
    displayPostMigrationSummary(summary, config.dryRun);
    migrator.close();

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
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  p.cancel('\nInterrupted. Your progress has been saved. Re-run to resume.');
  process.exit(130);
});

main();
