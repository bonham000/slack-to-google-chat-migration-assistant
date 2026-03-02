import { describe, test, expect } from 'bun:test';
import {
  convertSlackToGChat,
  formatAttachmentPlaceholders,
  formatBotAttribution,
} from '../../src/services/formatting';
import type { SlackFile } from '../../src/types';

describe('convertSlackToGChat', () => {
  const userMap = new Map<string, string>([
    ['U001', 'W001'],
    ['U002', 'W002'],
  ]);
  const displayNames = new Map<string, string>([
    ['U001', 'John Smith'],
    ['U002', 'Jane Doe'],
  ]);

  test('user mention with mapping resolves to display name', () => {
    const result = convertSlackToGChat('<@U001>', userMap, displayNames);
    expect(result).toBe('@John Smith');
  });

  test('user mention without mapping resolves to @unknown', () => {
    const result = convertSlackToGChat('<@UXXX>', userMap, displayNames);
    expect(result).toBe('@unknown');
  });

  test('channel reference with pipe extracts channel name', () => {
    const result = convertSlackToGChat('<#C001|general>', userMap, displayNames);
    expect(result).toBe('#general');
  });

  test('channel reference without pipe keeps channel ID', () => {
    const result = convertSlackToGChat('<#C001>', userMap, displayNames);
    expect(result).toBe('#C001');
  });

  test('link with display text formats as "label (url)"', () => {
    const result = convertSlackToGChat(
      '<https://example.com|click here>',
      userMap,
      displayNames,
    );
    expect(result).toBe('click here (https://example.com)');
  });

  test('bare link is unwrapped', () => {
    const result = convertSlackToGChat('<https://example.com>', userMap, displayNames);
    expect(result).toBe('https://example.com');
  });

  test('special mention <!here> converts to @here', () => {
    const result = convertSlackToGChat('<!here>', userMap, displayNames);
    expect(result).toBe('@here');
  });

  test('special mention <!channel> converts to @channel', () => {
    const result = convertSlackToGChat('<!channel>', userMap, displayNames);
    expect(result).toBe('@channel');
  });

  test('special mention <!everyone> converts to @everyone', () => {
    const result = convertSlackToGChat('<!everyone>', userMap, displayNames);
    expect(result).toBe('@everyone');
  });

  test('special mention with pipe <!here|here> converts to @here', () => {
    const result = convertSlackToGChat('<!here|here>', userMap, displayNames);
    expect(result).toBe('@here');
  });

  test('HTML entities are decoded', () => {
    const result = convertSlackToGChat('a &amp; b &lt; c &gt; d', userMap, displayNames);
    expect(result).toBe('a & b < c > d');
  });

  test('mailto links extract email label', () => {
    const result = convertSlackToGChat(
      '<mailto:user@example.com|user@example.com>',
      userMap,
      displayNames,
    );
    expect(result).toBe('user@example.com');
  });

  test('mixed message with multiple formatting types', () => {
    const input =
      'Hey <@U001>, check <#C001|general> &amp; see <https://example.com|this link>. Also <!here>';
    const result = convertSlackToGChat(input, userMap, displayNames);
    expect(result).toBe(
      'Hey @John Smith, check #general & see this link (https://example.com). Also @here',
    );
  });
});

describe('formatAttachmentPlaceholders', () => {
  test('single file', () => {
    const files: SlackFile[] = [{ name: 'report.pdf' }];
    expect(formatAttachmentPlaceholders(files)).toBe('[Attachment: report.pdf]');
  });

  test('multiple files', () => {
    const files: SlackFile[] = [{ name: 'report.pdf' }, { name: 'image.png' }];
    expect(formatAttachmentPlaceholders(files)).toBe(
      '[Attachment: report.pdf]\n[Attachment: image.png]',
    );
  });
});

describe('formatBotAttribution', () => {
  test('formats bot name and text', () => {
    expect(formatBotAttribution('Jira Bot', 'Ticket created')).toBe(
      '[Jira Bot]: Ticket created',
    );
  });
});
