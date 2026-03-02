import type { SlackFile } from '../types';

/**
 * Convert Slack mrkdwn to Google Chat text format.
 *
 * Transformations are applied in a deliberate order so that earlier
 * replacements do not interfere with later ones.
 */
export function convertSlackToGChat(
  text: string,
  userMap: Map<string, string>,
  displayNames: Map<string, string>,
): string {
  let result = text;

  // 1. Decode HTML entities
  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');

  // 2. User mentions  <@U1234> → @DisplayName or @unknown
  result = result.replace(/<@(U[A-Z0-9]+)>/g, (_match, userId: string) => {
    const name = displayNames.get(userId);
    return name ? `@${name}` : '@unknown';
  });

  // 3. Channel references  <#C1234|channel-name> → #channel-name
  //    Also handle <#C1234> (no pipe) → #C1234
  result = result.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, (_match, _id: string, name: string) => {
    return `#${name}`;
  });
  result = result.replace(/<#([A-Z0-9]+)>/g, (_match, id: string) => {
    return `#${id}`;
  });

  // 4. Mail links  <mailto:user@example.com|user@example.com> → user@example.com
  //    (processed before generic links to avoid being caught by the link-with-text rule)
  result = result.replace(/<mailto:([^|>]+)\|([^>]+)>/g, (_match, _href: string, label: string) => {
    return label;
  });

  // 5. Special mentions  <!here|here> or <!here> → @here
  result = result.replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_match, keyword: string) => {
    return `@${keyword}`;
  });

  // 6. Links with display text  <https://example.com|click here> → click here (https://example.com)
  result = result.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_match, url: string, label: string) => {
    return `${label} (${url})`;
  });

  // 7. Bare links  <https://example.com> → https://example.com
  result = result.replace(/<(https?:\/\/[^>]+)>/g, (_match, url: string) => {
    return url;
  });

  return result;
}

/**
 * Return one placeholder line per attached file.
 */
export function formatAttachmentPlaceholders(files: SlackFile[]): string {
  return files.map((f) => `[Attachment: ${f.name}]`).join('\n');
}

/**
 * Prefix a message with a bot display-name attribution.
 */
export function formatBotAttribution(displayName: string, text: string): string {
  return `[${displayName}]: ${text}`;
}
