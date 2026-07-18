export type RateLimiter = { take(now?: number): boolean };
export type IpRateLimiter = { take(clientIp: string, now?: number): boolean };

export class FixedWindowRateLimiter implements RateLimiter {
  private windowStartedAt: number | undefined;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(now = Date.now()): boolean {
    if (this.windowStartedAt === undefined || now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

export class BoundedIpRateLimiter implements IpRateLimiter {
  private readonly entries = new Map<
    string,
    { limiter: FixedWindowRateLimiter; lastSeenAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  take(clientIp: string, now = Date.now()): boolean {
    let entry = this.entries.get(clientIp);
    if (entry && now - entry.lastSeenAt >= this.ttlMs) {
      this.entries.delete(clientIp);
      entry = undefined;
    }
    if (!entry) {
      this.evictExpired(now);
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (oldest.done) break;
        this.entries.delete(oldest.value);
      }
      entry = {
        limiter: new FixedWindowRateLimiter(this.limit, this.windowMs),
        lastSeenAt: now,
      };
    } else {
      this.entries.delete(clientIp);
    }
    entry.lastSeenAt = now;
    this.entries.set(clientIp, entry);
    return entry.limiter.take(now);
  }

  get size(): number {
    return this.entries.size;
  }

  private evictExpired(now: number): void {
    for (const [clientIp, entry] of this.entries) {
      if (now - entry.lastSeenAt < this.ttlMs) break;
      this.entries.delete(clientIp);
    }
  }
}
