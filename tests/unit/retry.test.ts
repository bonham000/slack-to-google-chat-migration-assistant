import { describe, test, expect } from 'bun:test';
import { withRetry } from '../../src/utils/retry';

describe('withRetry', () => {
  test('returns result on first successful call', async () => {
    const result = await withRetry(async () => 42, { maxRetries: 3 });
    expect(result).toBe(42);
  });

  test('retries on retryable error then returns on success', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw { status: 429, message: 'rate limited' };
        }
        return 'ok';
      },
      { maxRetries: 5, initialDelayMs: 1, maxDelayMs: 10 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  test('throws immediately on non-retryable error', async () => {
    let attempts = 0;
    const promise = withRetry(
      async () => {
        attempts++;
        throw { status: 400, message: 'bad request' };
      },
      { maxRetries: 5, initialDelayMs: 1 },
    );

    await expect(promise).rejects.toEqual({ status: 400, message: 'bad request' });
    expect(attempts).toBe(1);
  });

  test('throws after max retries exhausted', async () => {
    let attempts = 0;
    const promise = withRetry(
      async () => {
        attempts++;
        throw { status: 500, message: 'server error' };
      },
      { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5 },
    );

    await expect(promise).rejects.toEqual({ status: 500, message: 'server error' });
    // 1 initial attempt + 2 retries = 3 total
    expect(attempts).toBe(3);
  });

  test('custom retryOn predicate is respected', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('custom-retriable');
        }
        return 'done';
      },
      {
        maxRetries: 3,
        initialDelayMs: 1,
        retryOn: (err) => err instanceof Error && err.message === 'custom-retriable',
      },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(2);
  });

  test('custom retryOn returning false causes immediate throw', async () => {
    let attempts = 0;
    const promise = withRetry(
      async () => {
        attempts++;
        throw new Error('not-retriable');
      },
      {
        maxRetries: 5,
        initialDelayMs: 1,
        retryOn: () => false,
      },
    );

    await expect(promise).rejects.toThrow('not-retriable');
    expect(attempts).toBe(1);
  });
});
