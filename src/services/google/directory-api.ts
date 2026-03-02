import { DIRECTORY_BATCH_SIZE } from '../../constants';
import type { admin_directory_v1 } from 'googleapis';

type DirectoryClient = admin_directory_v1.Admin;

export class DirectoryAPI {
  constructor(private client: DirectoryClient) {}

  async resolveUser(email: string): Promise<boolean> {
    try {
      await this.client.users.get({ userKey: email });
      return true;
    } catch (error: any) {
      if (error?.code === 404 || error?.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async resolveUsers(emails: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < emails.length; i += DIRECTORY_BATCH_SIZE) {
      const batch = emails.slice(i, i + DIRECTORY_BATCH_SIZE);
      const promises = batch.map(async (email) => {
        try {
          const exists = await this.resolveUser(email);
          results.set(email, exists);
        } catch {
          // If we can't resolve, assume they don't exist in workspace
          results.set(email, false);
        }
      });
      await Promise.all(promises);
    }

    return results;
  }
}
