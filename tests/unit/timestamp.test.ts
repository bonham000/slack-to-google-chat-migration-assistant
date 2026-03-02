import { describe, test, expect } from 'bun:test';
import {
  slackTsToRfc3339,
  ensureUniqueTimestamp,
  timeScopeToRange,
} from '../../src/utils/timestamp';
import type { TimeScope } from '../../src/types';

describe('slackTsToRfc3339', () => {
  test('converts epoch with zero microseconds', () => {
    const result = slackTsToRfc3339('1672531200.000000');
    expect(result).toBe('2023-01-01T00:00:00.000000Z');
  });

  test('preserves microsecond precision', () => {
    const result = slackTsToRfc3339('1705312200.123456');
    // 1705312200 = 2024-01-15T11:30:00 UTC
    expect(result).toMatch(/\.123456Z$/);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });
});

describe('ensureUniqueTimestamp', () => {
  test('returns same timestamp when no collision', () => {
    const used = new Set<string>();
    const result = ensureUniqueTimestamp('1672531200.000000', used);
    expect(result).toBe('1672531200.000000');
    expect(used.has('1672531200.000000')).toBe(true);
  });

  test('increments microseconds on collision', () => {
    const used = new Set<string>(['1672531200.000000']);
    const result = ensureUniqueTimestamp('1672531200.000000', used);
    expect(result).toBe('1672531200.000001');
    expect(used.has('1672531200.000001')).toBe(true);
  });

  test('increments multiple times for consecutive collisions', () => {
    const used = new Set<string>([
      '1672531200.000000',
      '1672531200.000001',
      '1672531200.000002',
    ]);
    const result = ensureUniqueTimestamp('1672531200.000000', used);
    expect(result).toBe('1672531200.000003');
    expect(used.has('1672531200.000003')).toBe(true);
  });
});

describe('timeScopeToRange', () => {
  test('full scope starts at 0', () => {
    const scope: TimeScope = { type: 'full' };
    const range = timeScopeToRange(scope);
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(0);
  });

  test('last_n_days scope computes correct window', () => {
    const scope: TimeScope = { type: 'last_n_days', days: 7 };
    const before = Date.now() / 1000;
    const range = timeScopeToRange(scope);
    const after = Date.now() / 1000;

    // The start should be approximately 7 days before now
    expect(range.end - range.start).toBeCloseTo(7 * 86400, -1);
    expect(range.end).toBeGreaterThanOrEqual(before);
    expect(range.end).toBeLessThanOrEqual(after + 1);
  });

  test('custom scope uses provided dates', () => {
    const startDate = new Date('2024-01-01T00:00:00Z');
    const endDate = new Date('2024-01-31T23:59:59Z');
    const scope: TimeScope = { type: 'custom', startDate, endDate };
    const range = timeScopeToRange(scope);

    expect(range.start).toBe(startDate.getTime() / 1000);
    expect(range.end).toBe(endDate.getTime() / 1000);
  });
});
