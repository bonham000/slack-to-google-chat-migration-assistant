export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Set the minimum log level. Messages below this threshold are suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Write a log line to stderr if `level` meets the current threshold.
 *
 * Format: [ISO-timestamp] [LEVEL] message {optional JSON data}
 */
export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase();
  let line = `[${timestamp}] [${tag}] ${message}`;

  if (data !== undefined) {
    line += ` ${JSON.stringify(data)}`;
  }

  console.error(line);
}

export function debug(message: string, data?: Record<string, unknown>): void {
  log('debug', message, data);
}

export function info(message: string, data?: Record<string, unknown>): void {
  log('info', message, data);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  log('warn', message, data);
}

export function error(message: string, data?: Record<string, unknown>): void {
  log('error', message, data);
}
