import * as p from '@clack/prompts';
import type { ChannelResult } from '../types';

export function createProgressReporter() {
  let currentSpinner: ReturnType<typeof p.spinner> | null = null;

  return {
    startChannel(channelName: string, totalMessages: number): void {
      currentSpinner = p.spinner();
      currentSpinner.start(
        `Migrating #${channelName} (0/${totalMessages} messages)`,
      );
    },

    updateChannel(
      channelName: string,
      current: number,
      total: number,
    ): void {
      currentSpinner?.message(
        `Migrating #${channelName} (${current}/${total} messages)`,
      );
    },

    finishChannel(channelName: string, result: ChannelResult): void {
      if (result.status === 'already_finalized') {
        currentSpinner?.stop(`#${channelName}: already finalized, skipped`);
      } else {
        const parts = [`${result.messagesCreated} created`];
        if (result.messagesSkipped > 0)
          parts.push(`${result.messagesSkipped} skipped`);
        if (result.messagesFailed > 0)
          parts.push(`${result.messagesFailed} failed`);
        currentSpinner?.stop(`#${channelName}: ${parts.join(', ')}`);
      }
    },
  };
}
