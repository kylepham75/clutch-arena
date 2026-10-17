import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Check if Upstash Redis credentials are present in the environment
const hasUpstashConfig = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

let redis: Redis | null = null;
if (hasUpstashConfig) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  } catch {
    redis = null;
  }
}

// Ingest limiter: max 3 uploads per day for free/guest users
const ingestLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 d"),
      analytics: true,
      prefix: "clutch:ratelimit:ingest",
    })
  : null;

// Coach limiter: max 20 coach interactions per 10 minutes
const coachLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "10 m"),
      analytics: true,
      prefix: "clutch:ratelimit:coach",
    })
  : null;

// In-memory sliding window fallback for local testing & dev without Redis
interface LocalRateRecord {
  timestamps: number[];
}
const localMemoryStore = new Map<string, LocalRateRecord>();

function checkInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = localMemoryStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    localMemoryStore.set(key, record);
  }

  // Filter out expired timestamps
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const reset = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      reset: Math.max(1, reset),
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    reset: Math.ceil(windowMs / 1000),
  };
}

export type RateLimitType = "ingest" | "coach";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
}

/**
 * Checks rate limits using Upstash Redis if configured,
 * or gracefully falls back to an in-memory sliding window.
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType,
): Promise<RateLimitResult> {
  const isIngest = type === "ingest";
  const limit = isIngest ? 3 : 20;
  const windowMs = isIngest ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000;

  // 1. Try Upstash Redis if available
  const limiter = isIngest ? ingestLimiter : coachLimiter;
  if (limiter) {
    try {
      const result = await limiter.limit(identifier);
      const retryAfter = Math.max(
        1,
        Math.ceil((result.reset - Date.now()) / 1000),
      );
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        retryAfter,
      };
    } catch {
      // Fallback to in-memory on network failure
    }
  }

  // 2. In-memory sliding window fallback
  const memResult = checkInMemoryRateLimit(
    `${type}:${identifier}`,
    limit,
    windowMs,
  );
  return {
    allowed: memResult.allowed,
    limit,
    remaining: memResult.remaining,
    reset: memResult.reset,
    retryAfter: memResult.reset,
  };
}

/**
 * Resolves a reliable client IP address from standard proxy headers
 */
export function getClientIp(request: Request): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const ip = xForwardedFor.split(",")[0].trim();
    if (ip) return ip;
  }
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp.trim();

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  return "127.0.0.1";
}
