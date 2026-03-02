import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import {
  readChannelMessages,
  countChannelMessages,
} from '../../src/services/slack/message-reader';
import type { TimeScope } from '../../src/types';

const EXPORT_ROOT = path.resolve(__dirname, '../fixtures/minimal-export');

describe('readChannelMessages', () => {
  test('loads all messages from a channel sorted by ts', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'general');
    expect(messages.length).toBe(8);
    // Verify sorted ascending
    for (let i = 1; i < messages.length; i++) {
      expect(parseFloat(messages[i].ts)).toBeGreaterThanOrEqual(
        parseFloat(messages[i - 1].ts),
      );
    }
  });

  test('first message has earliest timestamp', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'general');
    expect(messages[0].text).toBe('Good morning team!');
    expect(messages[0].ts).toBe('1705312200.000000');
  });

  test('last message has latest timestamp', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'general');
    expect(messages[messages.length - 1].ts).toBe('1705398700.000000');
  });

  test('returns empty array for nonexistent channel', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'nonexistent');
    expect(messages).toEqual([]);
  });

  test('deduplicates messages with same ts', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'general');
    const tsValues = messages.map((m) => m.ts);
    const uniqueTsValues = new Set(tsValues);
    expect(tsValues.length).toBe(uniqueTsValues.size);
  });

  test('includes messages with files', () => {
    const messages = readChannelMessages(EXPORT_ROOT, 'general');
    const withFiles = messages.filter((m) => m.files && m.files.length > 0);
    expect(withFiles).toHaveLength(1);
    expect(withFiles[0].files![0].name).toBe('report.pdf');
  });
});

describe('time scope filtering', () => {
  test('full scope returns all messages', () => {
    const scope: TimeScope = { type: 'full' };
    const messages = readChannelMessages(EXPORT_ROOT, 'general', scope);
    expect(messages.length).toBe(8);
  });

  test('last_n_days filters by cutoff', () => {
    // The messages are from Jan 15-16 2024.
    // ts 1705312200 = Jan 15, 2024 ~10:30 UTC
    // ts 1705398700 = Jan 16, 2024 ~10:31 UTC
    //
    // We want a scope that only includes day 2 messages (Jan 16).
    // Day 2 messages: ts >= 1705398600 (1705398600, 1705398700)
    // We need cutoff such that cutoff <= 1705398600.
    // cutoff = Date.now()/1000 - days * 86400
    // We need days = (Date.now()/1000 - 1705398600) / 86400
    // But let's use 'custom' for precise testing and test last_n_days
    // with a different approach.

    // Use a very large number of days to include everything
    const scopeAll: TimeScope = { type: 'last_n_days', days: 999999 };
    const allMessages = readChannelMessages(EXPORT_ROOT, 'general', scopeAll);
    expect(allMessages.length).toBe(8);

    // Use 0 days (cutoff = now) to exclude everything (messages are from 2024)
    const scopeNone: TimeScope = { type: 'last_n_days', days: 0 };
    const noMessages = readChannelMessages(EXPORT_ROOT, 'general', scopeNone);
    expect(noMessages.length).toBe(0);
  });

  test('custom scope filters between start and end dates', () => {
    // Only include messages from Jan 16, 2024
    const scope: TimeScope = {
      type: 'custom',
      startDate: new Date('2024-01-16T00:00:00Z'),
      endDate: new Date('2024-01-16T23:59:59Z'),
    };
    const messages = readChannelMessages(EXPORT_ROOT, 'general', scope);
    expect(messages.length).toBe(2);
    expect(messages[0].text).toBe('Day 2 message');
    expect(messages[1].text).toContain('this link');
  });

  test('custom scope can select a single day', () => {
    // Only Jan 15, 2024
    const scope: TimeScope = {
      type: 'custom',
      startDate: new Date('2024-01-15T00:00:00Z'),
      endDate: new Date('2024-01-15T23:59:59Z'),
    };
    const messages = readChannelMessages(EXPORT_ROOT, 'general', scope);
    expect(messages.length).toBe(6);
  });
});

describe('countChannelMessages', () => {
  test('returns correct count for all messages', () => {
    const count = countChannelMessages(EXPORT_ROOT, 'general');
    expect(count).toBe(8);
  });

  test('returns correct count with time scope', () => {
    const scope: TimeScope = {
      type: 'custom',
      startDate: new Date('2024-01-16T00:00:00Z'),
      endDate: new Date('2024-01-16T23:59:59Z'),
    };
    const count = countChannelMessages(EXPORT_ROOT, 'general', scope);
    expect(count).toBe(2);
  });

  test('returns 0 for nonexistent channel', () => {
    const count = countChannelMessages(EXPORT_ROOT, 'nonexistent');
    expect(count).toBe(0);
  });
});
