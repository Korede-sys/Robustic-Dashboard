import { redact } from "./sanitize.ts";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// Keeps requests to a backoffice at least `minIntervalMs` apart, so a sync can
// never hammer a system that is also in use by people.
export class RateLimiter {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private minIntervalMs: number, private clock: Clock) {}
  async wait(): Promise<void> {
    const gap = this.last + this.minIntervalMs - this.clock.now();
    if (gap > 0) await this.clock.sleep(gap);
    this.last = this.clock.now();
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
    this.name = "HttpError";
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface HttpOptions {
  clock: Clock;
  limiter: RateLimiter;
  maxRetries: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  random?: () => number;
  secrets?: () => string[];
}

// Retry policy: transient failures (network error, timeout, 408/425/429/5xx) are
// retried with exponential backoff + jitter, honouring Retry-After. Failures
// that retrying cannot fix -- bad credentials (401/403), not found, other 4xx --
// are NOT retried: repeating a rejected login is how accounts get locked out.
export function makeHttp(o: HttpOptions) {
  const base = o.baseDelayMs ?? 500;
  const rand = o.random ?? Math.random;
  const doFetch = o.fetchImpl ?? fetch;
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= o.maxRetries; attempt++) {
      await o.limiter.wait();
      const ctl = new AbortController();
      const timer = o.timeoutMs ? setTimeout(() => ctl.abort(), o.timeoutMs) : undefined;
      try {
        const res = await doFetch(url, { ...init, signal: ctl.signal });
        if (res.ok) return res;
        const retryAfter = Number(res.headers.get("retry-after"));
        const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
        // Status only -- never the body, which could echo credentials.
        const err = new HttpError(res.status, `Backoffice responded with HTTP ${res.status}`, retryAfterMs);
        if (!RETRYABLE.has(res.status)) throw err;
        lastErr = err;
      } catch (e) {
        if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
        lastErr = e instanceof HttpError ? e : new Error(`Network error: ${redact(e, o.secrets?.() ?? [])}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (attempt === o.maxRetries) break;
      const hint = lastErr instanceof HttpError ? lastErr.retryAfterMs : undefined;
      await o.clock.sleep(hint ?? base * 2 ** attempt + Math.floor(rand() * base));
    }
    throw lastErr instanceof Error ? lastErr : new Error("Request failed");
  };
}
