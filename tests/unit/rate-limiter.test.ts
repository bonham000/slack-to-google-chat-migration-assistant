import { describe, test, expect } from 'bun:test';
import { RateLimiter } from '../../src/services/google/rate-limiter';

describe('RateLimiter', () => {
  test('initial token count equals max tokens', () => {
    const limiter = new RateLimiter(100);
    const tokens = limiter.getTokenCount();
    // Allow small floating point variance from refill calculation
    expect(tokens).toBeGreaterThanOrEqual(99);
    expect(tokens).toBeLessThanOrEqual(100);
  });

  test('acquire() decrements tokens by 1', async () => {
    const limiter = new RateLimiter(100);
    const before = limiter.getTokenCount();
    await limiter.acquire();
    const after = limiter.getTokenCount();
    // After one acquire, tokens should be approximately 1 less
    // (small refill may occur between calls, so allow tolerance)
    expect(before - after).toBeGreaterThan(0.5);
    expect(before - after).toBeLessThan(1.5);
  });

  test('multiple rapid acquires drain tokens', async () => {
    const limiter = new RateLimiter(10);
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }
    const remaining = limiter.getTokenCount();
    // Started with 10, drained 5, should be approximately 5
    expect(remaining).toBeGreaterThanOrEqual(4);
    expect(remaining).toBeLessThanOrEqual(6);
  });

  test('after draining tokens, acquire waits and then succeeds', async () => {
    // Use a very small rate: 2 tokens per minute
    // That means refill rate = 2/60000 tokens per ms
    // After draining 2 tokens, we need ~30 seconds for 1 token...
    // Instead, use a higher rate to keep the test fast: 6000 per minute = 100 per second
    const limiter = new RateLimiter(6000);

    // Drain all tokens
    for (let i = 0; i < 6000; i++) {
      await limiter.acquire();
    }

    const tokensBefore = limiter.getTokenCount();
    expect(tokensBefore).toBeLessThan(1);

    // Next acquire should wait for refill and then succeed
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should have waited at least a few ms for token refill
    // With 6000/min = 100/s, need ~10ms for 1 token
    expect(elapsed).toBeGreaterThanOrEqual(5);

    // But it should complete (not hang)
    expect(true).toBe(true);
  });

  test('getTokenCount() reflects current state after acquires', async () => {
    const limiter = new RateLimiter(50);

    const initial = limiter.getTokenCount();
    expect(initial).toBeGreaterThanOrEqual(49);
    expect(initial).toBeLessThanOrEqual(50);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const afterThree = limiter.getTokenCount();
    // Should be roughly 47 (50 - 3), with small refill tolerance
    expect(afterThree).toBeGreaterThanOrEqual(45);
    expect(afterThree).toBeLessThanOrEqual(48);
  });
});
