/** In-memory per-key rate limiter (#308). Zero dependencies, single bun
 *  process: a Map of key -> {count, window reset}; expired entries are swept
 *  on a timer so the map can't grow unboundedly. */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets (for Retry-After). 0 when allowed. */
  retryAfterSec: number;
}

export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const { windowMs, max } = opts;
  const hits = new Map<string, { count: number; reset: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  if (typeof (sweep as any)?.unref === "function") (sweep as any).unref();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset <= now) {
        e = { count: 0, reset: now + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      if (e.count > max) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((e.reset - now) / 1000)) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
