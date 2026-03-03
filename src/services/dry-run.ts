import type { ChatSpacePayload, ChatMessagePayload } from '../types';

/**
 * Drop-in replacement for ChatAPI that logs actions without making API calls.
 * Used in dry-run mode to preview the migration.
 */
export class DryRunChatAPI {
  private log: string[] = [];
  private spaceCounter = 0;
  private messageCounter = 0;

  async createImportSpace(payload: ChatSpacePayload): Promise<{ name: string }> {
    this.spaceCounter++;
    const fakeName = `spaces/DRY_RUN_${this.spaceCounter}`;
    const access = payload.accessSettings?.accessState ? ` [${payload.accessSettings.accessState}]` : '';
    this.log.push(`[DRY RUN] Create ${payload.spaceType}${access}: "${payload.displayName ?? '(unnamed)'}" → ${fakeName}`);
    return { name: fakeName };
  }

  async createMessage(
    spaceName: string,
    payload: ChatMessagePayload,
    messageId: string,
    _senderEmail: string | null,
    _messageReplyOption?: string,
  ): Promise<{ name: string }> {
    this.messageCounter++;
    const fakeName = `${spaceName}/messages/DRY_RUN_${this.messageCounter}`;
    const preview = payload.text.length > 80
      ? payload.text.substring(0, 80) + '...'
      : payload.text;
    this.log.push(`[DRY RUN] Message in ${spaceName}: ${preview}`);
    return { name: fakeName };
  }

  async addMember(spaceName: string, memberEmail: string): Promise<void> {
    this.log.push(`[DRY RUN] Add member ${memberEmail} to ${spaceName}`);
  }

  async completeImport(spaceName: string): Promise<void> {
    this.log.push(`[DRY RUN] Finalize space: ${spaceName}`);
  }

  getLog(): string[] {
    return this.log;
  }

  getStats(): { spaces: number; messages: number } {
    return { spaces: this.spaceCounter, messages: this.messageCounter };
  }
}
