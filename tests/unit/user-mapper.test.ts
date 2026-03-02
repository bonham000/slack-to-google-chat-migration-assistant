import { describe, test, expect } from 'bun:test';
import { buildUserMap } from '../../src/services/slack/user-mapper';
import type { SlackUser } from '../../src/types';

const FIXTURE_USERS: SlackUser[] = [
  {
    id: 'U001',
    name: 'jsmith',
    real_name: 'John Smith',
    is_bot: false,
    profile: {
      email: 'john@example.com',
      real_name: 'John Smith',
      display_name: 'Johnny',
    },
  },
  {
    id: 'U002',
    name: 'jdoe',
    real_name: 'Jane Doe',
    is_bot: false,
    profile: { email: 'jane@example.com', real_name: 'Jane Doe' },
  },
  {
    id: 'U003',
    name: 'nomail',
    real_name: 'No Email User',
    is_bot: false,
    profile: { real_name: 'No Email User' },
  },
  {
    id: 'B001',
    name: 'githubbot',
    real_name: 'GitHub',
    is_bot: true,
    profile: { real_name: 'GitHub' },
  },
];

describe('buildUserMap', () => {
  test('maps users with emails to userMap', () => {
    const result = buildUserMap(FIXTURE_USERS);
    expect(result.userMap.size).toBe(2);
    expect(result.userMap.get('U001')).toBe('john@example.com');
    expect(result.userMap.get('U002')).toBe('jane@example.com');
  });

  test('identifies bot users', () => {
    const result = buildUserMap(FIXTURE_USERS);
    expect(result.botUsers).toHaveLength(1);
    expect(result.botUsers[0].id).toBe('B001');
    expect(result.botUsers[0].name).toBe('githubbot');
  });

  test('identifies unmapped users (no email, not bot)', () => {
    const result = buildUserMap(FIXTURE_USERS);
    expect(result.unmappedUsers).toHaveLength(1);
    expect(result.unmappedUsers[0].id).toBe('U003');
    expect(result.unmappedUsers[0].name).toBe('nomail');
  });

  test('builds display names for all users', () => {
    const result = buildUserMap(FIXTURE_USERS);
    expect(result.displayNames.size).toBe(4);
    expect(result.displayNames.get('U001')).toBe('John Smith');
    expect(result.displayNames.get('U002')).toBe('Jane Doe');
    expect(result.displayNames.get('U003')).toBe('No Email User');
    expect(result.displayNames.get('B001')).toBe('GitHub');
  });

  test('display name falls back through the chain', () => {
    // User with no real_name, has display_name
    const users: SlackUser[] = [
      {
        id: 'U100',
        name: 'fallback1',
        profile: { display_name: 'Display Only' },
      },
    ];
    const result = buildUserMap(users);
    expect(result.displayNames.get('U100')).toBe('Display Only');
  });

  test('display name falls back to profile.real_name', () => {
    const users: SlackUser[] = [
      {
        id: 'U101',
        name: 'fallback2',
        profile: { real_name: 'Profile Real Name' },
      },
    ];
    const result = buildUserMap(users);
    expect(result.displayNames.get('U101')).toBe('Profile Real Name');
  });

  test('display name falls back to name as last resort', () => {
    const users: SlackUser[] = [
      {
        id: 'U102',
        name: 'lastresort',
        profile: {},
      },
    ];
    const result = buildUserMap(users);
    expect(result.displayNames.get('U102')).toBe('lastresort');
  });

  test('is_app_user is treated as bot', () => {
    const users: SlackUser[] = [
      {
        id: 'A001',
        name: 'appuser',
        real_name: 'App User',
        is_app_user: true,
        profile: { email: 'app@example.com', real_name: 'App User' },
      },
    ];
    const result = buildUserMap(users);
    expect(result.botUsers).toHaveLength(1);
    expect(result.botUsers[0].id).toBe('A001');
    // App users should not be in userMap even if they have an email
    expect(result.userMap.has('A001')).toBe(false);
  });

  test('handles empty user list', () => {
    const result = buildUserMap([]);
    expect(result.userMap.size).toBe(0);
    expect(result.displayNames.size).toBe(0);
    expect(result.unmappedUsers).toHaveLength(0);
    expect(result.botUsers).toHaveLength(0);
  });
});
