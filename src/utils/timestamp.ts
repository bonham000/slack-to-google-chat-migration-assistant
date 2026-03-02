import type { TimeScope } from '../types';

/**
 * Convert a Slack timestamp ("1672531200.000000") to an RFC 3339 string
 * that preserves the original microsecond precision.
 *
 * Output format: "YYYY-MM-DDTHH:mm:ss.xxxxxxZ"
 */
export function slackTsToRfc3339(ts: string): string {
  const [secondsStr, microsStr = '000000'] = ts.split('.');
  const seconds = parseInt(secondsStr, 10);
  const date = new Date(seconds * 1000);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const secs = String(date.getUTCSeconds()).padStart(2, '0');
  const micros = microsStr.padEnd(6, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${secs}.${micros}Z`;
}

/**
 * If `ts` already exists in `usedTimestamps`, increment the microsecond
 * portion by 1 repeatedly until a unique value is found. The final value
 * is added to the set before being returned.
 */
export function ensureUniqueTimestamp(ts: string, usedTimestamps: Set<string>): string {
  let [secondsStr, microsStr = '000000'] = ts.split('.');
  let micros = parseInt(microsStr, 10);

  let candidate = `${secondsStr}.${String(micros).padStart(6, '0')}`;

  while (usedTimestamps.has(candidate)) {
    micros += 1;
    candidate = `${secondsStr}.${String(micros).padStart(6, '0')}`;
  }

  usedTimestamps.add(candidate);
  return candidate;
}

/**
 * Convert a TimeScope to a start/end Unix-timestamp range (in seconds).
 */
export function timeScopeToRange(scope: TimeScope): { start: number; end: number } {
  switch (scope.type) {
    case 'full':
      return { start: 0, end: Date.now() / 1000 };

    case 'last_n_days':
      return {
        start: Date.now() / 1000 - scope.days * 86400,
        end: Date.now() / 1000,
      };

    case 'custom':
      return {
        start: scope.startDate.getTime() / 1000,
        end: scope.endDate.getTime() / 1000,
      };
  }
}
