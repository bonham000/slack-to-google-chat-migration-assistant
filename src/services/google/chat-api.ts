import type { ChatSpacePayload, ChatMessagePayload } from '../../types';
import { withRetry } from '../../utils/retry';
import { RateLimiter } from './rate-limiter';

// The chatClient type is complex, so use the return type of google.chat()
type ChatClient = ReturnType<typeof import('googleapis').google.chat>;

export class ChatAPI {
  constructor(
    private getClient: (email?: string) => ChatClient,
    private adminEmail: string,
    private rateLimiter: RateLimiter,
  ) {}

  async createImportSpace(payload: ChatSpacePayload): Promise<{ name: string }> {
    const client = this.getClient(this.adminEmail);

    const requestBody: Record<string, unknown> = {
      spaceType: payload.spaceType,
      importMode: payload.importMode,
      spaceThreadingState: payload.spaceThreadingState,
    };

    if (payload.displayName) {
      requestBody.displayName = payload.displayName;
    }
    if (payload.createTime) {
      requestBody.createTime = payload.createTime;
    }
    if (payload.accessSettings) {
      requestBody.accessSettings = payload.accessSettings;
    }

    const result = await withRetry(() =>
      client.spaces.create({ requestBody }),
    );
    return { name: result.data.name! };
  }

  async createMessage(
    spaceName: string,
    payload: ChatMessagePayload,
    messageId: string,
    senderEmail: string | null,
    messageReplyOption?: string,
  ): Promise<{ name: string }> {
    await this.rateLimiter.acquire();

    // Use sender's delegated client if available, otherwise admin
    const client = this.getClient(senderEmail || this.adminEmail);

    const requestBody: Record<string, unknown> = {
      text: payload.text,
      createTime: payload.createTime,
    };

    if (payload.thread?.threadKey) {
      requestBody.thread = { threadKey: payload.thread.threadKey };
    }

    const params: Record<string, unknown> = {
      parent: spaceName,
      requestBody,
      messageId,
    };

    if (messageReplyOption) {
      params.messageReplyOption = messageReplyOption;
    }

    const result = await withRetry(() =>
      client.spaces.messages.create(params as any),
    );

    return { name: result.data.name! };
  }

  async addMember(spaceName: string, memberEmail: string): Promise<void> {
    const client = this.getClient(this.adminEmail);
    await withRetry(() =>
      client.spaces.members.create({
        parent: spaceName,
        requestBody: {
          member: { name: `users/${memberEmail}`, type: 'HUMAN' },
        },
      }),
    );
  }

  async completeImport(spaceName: string): Promise<void> {
    const client = this.getClient(this.adminEmail);
    await withRetry(() =>
      client.spaces.completeImport({ name: spaceName }),
    );
  }
}
