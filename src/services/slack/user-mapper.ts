import type { SlackUser, UserMapResult } from '../../types';

/**
 * Build lookup maps from a list of Slack users.
 *
 * - Bots (`is_bot || is_app_user`) are collected into `botUsers`.
 * - Non-bot users with an email go into `userMap` (slackId -> email).
 * - Non-bot users without an email go into `unmappedUsers`.
 * - Every user gets a display name entry in `displayNames`.
 */
export function buildUserMap(users: SlackUser[]): UserMapResult {
  const userMap = new Map<string, string>();
  const displayNames = new Map<string, string>();
  const unmappedUsers: SlackUser[] = [];
  const botUsers: SlackUser[] = [];

  for (const user of users) {
    // Compute display name with fallback chain
    const displayName =
      user.real_name ||
      user.profile?.display_name ||
      user.profile?.real_name ||
      user.name;

    displayNames.set(user.id, displayName);

    // Categorise
    if (user.is_bot || user.is_app_user) {
      botUsers.push(user);
      continue;
    }

    const email = user.profile?.email;
    if (email) {
      userMap.set(user.id, email);
    } else {
      unmappedUsers.push(user);
    }
  }

  return { userMap, displayNames, unmappedUsers, botUsers };
}
