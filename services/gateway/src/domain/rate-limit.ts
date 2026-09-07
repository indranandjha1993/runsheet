export interface RateLimitOptions {
  readonly perMinute: number;
  readonly now?: () => number;
  readonly forgetAfterMs?: number;
}

export interface Decision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastSeen: number;
}

// A token bucket, so a caller who has been quiet is not punished for a short burst, and one
// who is over the line recovers gradually rather than waiting out a whole window.
export function rateLimiter(options: RateLimitOptions): {
  check(caller: string): Decision;
  size(): number;
} {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  const forgetAfterMs = options.forgetAfterMs ?? 600_000;
  const perMs = options.perMinute / 60_000;

  const forgetIdle = (at: number): void => {
    for (const [caller, bucket] of buckets) {
      if (at - bucket.lastSeen > forgetAfterMs) buckets.delete(caller);
    }
  };

  return {
    check(caller) {
      const at = now();
      forgetIdle(at);

      const bucket = buckets.get(caller) ?? { tokens: options.perMinute, lastSeen: at };
      const refilled = Math.min(options.perMinute, bucket.tokens + (at - bucket.lastSeen) * perMs);

      if (refilled < 1) {
        buckets.set(caller, { tokens: refilled, lastSeen: at });
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((1 - refilled) / perMs / 1000)),
        };
      }

      const remaining = refilled - 1;
      buckets.set(caller, { tokens: remaining, lastSeen: at });
      return { allowed: true, remaining: Math.floor(remaining), retryAfterSeconds: 0 };
    },

    size: () => buckets.size,
  };
}
