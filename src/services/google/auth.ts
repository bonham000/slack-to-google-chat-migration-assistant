import { google, type admin_directory_v1 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { readFileSync } from 'fs';
import { CHAT_IMPORT_SCOPE, DIRECTORY_SCOPE } from '../../constants';

// Cache of chat API clients keyed by the email being impersonated
const chatClientCache = new Map<string, ReturnType<typeof google.chat>>();

export function createChatClient(
  serviceAccountKeyPath: string,
  impersonateEmail: string,
): ReturnType<typeof google.chat> {
  // Check cache first
  const cacheKey = impersonateEmail;
  if (chatClientCache.has(cacheKey)) return chatClientCache.get(cacheKey)!;

  // Read and parse the service account key file
  const keyFile = JSON.parse(readFileSync(serviceAccountKeyPath, 'utf-8'));

  // Create JWT with domain-wide delegation
  const auth = new JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: [CHAT_IMPORT_SCOPE],
    subject: impersonateEmail, // This is how we impersonate users
  });

  const client = google.chat({ version: 'v1', auth });
  chatClientCache.set(cacheKey, client);
  return client;
}

export function createDirectoryClient(
  serviceAccountKeyPath: string,
  adminEmail: string,
): admin_directory_v1.Admin {
  const keyFile = JSON.parse(readFileSync(serviceAccountKeyPath, 'utf-8'));

  const auth = new JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: [DIRECTORY_SCOPE],
    subject: adminEmail,
  });

  return google.admin({ version: 'directory_v1', auth });
}

export function clearClientCache(): void {
  chatClientCache.clear();
}

// Validate that the service account key file is valid
export function validateServiceAccountKey(
  keyPath: string,
): { valid: boolean; error?: string } {
  try {
    const content = readFileSync(keyPath, 'utf-8');
    const key = JSON.parse(content);
    if (!key.client_email) return { valid: false, error: 'Missing client_email' };
    if (!key.private_key) return { valid: false, error: 'Missing private_key' };
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid key file: ${e}` };
  }
}
