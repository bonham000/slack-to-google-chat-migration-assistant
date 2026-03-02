import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
} from '../constants';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryOn?: (error: unknown) => boolean;
}

/**
 * Default predicate: retry on HTTP 429 (rate-limit) or any server error (>= 500).
 * Checks for both `status` and `code` properties on the error object.
 */
function defaultRetryOn(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const status = typeof err.status === 'number' ? err.status : undefined;
    const code = typeof err.code === 'number' ? err.code : undefined;

    if (status === 429 || (status !== undefined && status >= 500)) return true;
    if (code === 429 || (code !== undefined && code >= 500)) return true;
  }
  return false;
}

/**
 * Execute `fn` with exponential-backoff retries.
 *
 * Uses `Bun.sleep()` for the delay between attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = {
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    backoffFactor: options?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
    retryOn: options?.retryOn ?? defaultRetryOn,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If we've used all retries or the error is not retryable, throw immediately.
      if (attempt >= opts.maxRetries || !opts.retryOn!(error)) {
        throw error;
      }

      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt),
        opts.maxDelayMs,
      );

      await Bun.sleep(delay);
    }
  }

  // Should be unreachable, but satisfies the type checker.
  throw lastError;
}
