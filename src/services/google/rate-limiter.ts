import { IMPORT_MODE_MESSAGES_PER_MINUTE } from '../../constants';

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(tokensPerMinute: number = IMPORT_MODE_MESSAGES_PER_MINUTE) {
    this.maxTokens = tokensPerMinute;
    this.tokens = tokensPerMinute;
    this.refillRate = tokensPerMinute / 60_000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
      await Bun.sleep(waitMs);
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** For testing: get current token count */
  getTokenCount(): number {
    this.refill();
    return this.tokens;
  }
}
