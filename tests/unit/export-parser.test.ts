import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import { parseExport } from '../../src/services/slack/export-parser';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/minimal-export');

describe('parseExport', () => {
  test('parses a directory export and loads users', () => {
    const result = parseExport(FIXTURES_DIR);
    expect(result.users).toHaveLength(4);
    expect(result.users[0].id).toBe('U001');
    expect(result.users[0].name).toBe('jsmith');
  });

  test('parses a directory export and loads channels', () => {
    const result = parseExport(FIXTURES_DIR);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0].name).toBe('general');
    expect(result.channels[1].name).toBe('random');
  });

  test('detects channel directories', () => {
    const result = parseExport(FIXTURES_DIR);
    expect(result.channelNames).toContain('general');
    expect(result.channelNames).toContain('random');
    expect(result.channelNames).toHaveLength(2);
  });

  test('sets wasExtracted to false for directory input', () => {
    const result = parseExport(FIXTURES_DIR);
    expect(result.wasExtracted).toBe(false);
  });

  test('sets rootDir to the provided directory', () => {
    const result = parseExport(FIXTURES_DIR);
    expect(result.rootDir).toBe(FIXTURES_DIR);
  });

  test('throws ExportParseError for non-existent path', () => {
    expect(() => parseExport('/nonexistent/path')).toThrow('Path does not exist');
  });

  test('throws ExportParseError when users.json is missing', () => {
    // Use a directory that exists but has no users.json
    const emptyDir = path.resolve(__dirname, '../fixtures');
    expect(() => parseExport(emptyDir)).toThrow('Missing users.json');
  });

  test('channel names are sorted alphabetically', () => {
    const result = parseExport(FIXTURES_DIR);
    const sorted = [...result.channelNames].sort();
    expect(result.channelNames).toEqual(sorted);
  });
});
