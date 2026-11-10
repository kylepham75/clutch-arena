import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerTier } from "@/lib/auth/server-guard";
import {
  TIER_LIMITS,
  evaluateCogsDegradation,
  getRegionalCogsCeiling,
  type UserTier,
  type CogsBudgetStatus,
  type BillingRegion,
} from "@/lib/pricing/tiers";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";

// Check if Upstash Redis credentials are present in the environment (supports UPSTASH_* or Vercel KV_* prefixes)
export function assertProductionRateLimitConfig(): void {
  if (process.env.SKIP_REDIS_CHECK_FOR_TESTS === "true") {
    return;
  }
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return;
    }
    const hasUpstash = Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
    );
    const hasKv = Boolean(
      process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
    );
    if (!hasUpstash && !hasKv) {
      throw new Error(
        "[RateLimit] CRITICAL CONFIG ERROR: UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN is not configured in production! Distributed rate limiting cannot be guaranteed on serverless instances.",
      );
    }
  }
}

// Enforce configuration check on module load in production runtime
assertProductionRateLimitConfig();

const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const hasKv = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
);
const hasUpstashConfig = hasUpstash || hasKv;
const upstashUrl =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis: Redis | null = null;
if (hasUpstashConfig) {
  try {
    redis = new Redis({
      url: upstashUrl!,
      token: upstashToken!,
    });
  } catch {
    redis = null;
  }
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    "[RateLimit] Warning: UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN not configured. Distributed rate limiting is degraded to in-memory fallback.",
  );
}

// Tier-specific Upstash limiters
// Guest & Free (Contender): max 2 uploads per 7 days
const freeIngestLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(2, "7 d"),
      analytics: true,
      prefix: "clutch:ratelimit:ingest:free",
    })
  : null;

// Paid (Cram Pass / Pro / Tutor): up to 50 uploads per day
const paidIngestLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(50, "1 d"),
      analytics: true,
      prefix: "clutch:ratelimit:ingest:paid",
    })
  : null;

// Coach limiter for Guest & Free: max 20 coach interactions per 10 minutes
const freeCoachLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "10 m"),
      analytics: true,
      prefix: "clutch:ratelimit:coach:free",
    })
  : null;

// Coach limiter for Paid: max 60 coach interactions per 10 minutes
const paidCoachLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "10 m"),
      analytics: true,
      prefix: "clutch:ratelimit:coach:paid",
    })
  : null;

// Notes limiter for Pro users: max 30 slide deck conversions per day
const proNotesLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 d"),
      analytics: true,
      prefix: "clutch:ratelimit:notes:pro",
    })
  : null;

// In-memory sliding window fallback for local testing & dev without Redis
interface LocalRateRecord {
  timestamps: number[];
}

export const MAX_LOCAL_RATE_ENTRIES = 2000;
export const MAX_SHARED_DECK_CACHE_ENTRIES = 250;
export const MAX_USER_QUOTA_LEDGER_ENTRIES = 1000;

/**
 * Sets an entry in a Map with bounded maximum size and LRU/FIFO eviction semantics.
 * If the key already exists, it is deleted first so insertion moves it to the newest position.
 * If the map size meets or exceeds maxEntries, the oldest key is evicted (and onEvict called).
 */
export function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
  onEvict?: (evictedKey: K, evictedValue: V) => void,
): void {
  if (maxEntries <= 0) return;
  if (map.has(key)) {
    map.delete(key);
  }
  while (map.size >= maxEntries && map.size > 0) {
    const oldest = map.entries().next();
    if (oldest.done) break;
    const [oldestKey, oldestVal] = oldest.value;
    map.delete(oldestKey);
    onEvict?.(oldestKey, oldestVal);
  }
  map.set(key, value);
}

const localMemoryStore = new Map<string, LocalRateRecord>();

export function getLocalRateMemoryStoreSize(): number {
  return localMemoryStore.size;
}

export function checkInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = localMemoryStore.get(key);
  if (!record) {
    record = { timestamps: [] };
  }

  // Filter out expired timestamps
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  // Opportunistically prune stale records when near capacity
  if (localMemoryStore.size >= MAX_LOCAL_RATE_ENTRIES) {
    for (const [k, v] of localMemoryStore.entries()) {
      v.timestamps = v.timestamps.filter((ts) => ts > windowStart);
      if (v.timestamps.length === 0) {
        localMemoryStore.delete(k);
      }
    }
  }

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const reset = Math.ceil((oldest + windowMs - now) / 1000);
    setBoundedMapEntry(localMemoryStore, key, record, MAX_LOCAL_RATE_ENTRIES);
    return {
      allowed: false,
      remaining: 0,
      reset: Math.max(1, reset),
    };
  }

  record.timestamps.push(now);
  setBoundedMapEntry(localMemoryStore, key, record, MAX_LOCAL_RATE_ENTRIES);
  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    reset: Math.ceil(windowMs / 1000),
  };
}

export type RateLimitType = "ingest" | "coach" | "notes";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
}

/**
 * Normalizes any server, client, or external tier string into a valid UserTier.
 * Explicitly preserves pro_monthly and maps variations safely (SA-07).
 */
export function toUserTier(tier?: ServerTier | UserTier | string | null): UserTier {
  if (!tier) return "contender";
  const normalized = String(tier).toLowerCase().trim();
  if (
    normalized === "pro_monthly" ||
    normalized === "pro-monthly" ||
    normalized === "monthly"
  ) {
    return "pro_monthly";
  }
  if (
    normalized === "cram_pass" ||
    normalized === "crampass" ||
    normalized === "cram-pass"
  ) {
    return "cram_pass";
  }
  if (
    normalized === "pro" ||
    normalized === "pro_semester" ||
    normalized === "pro-semester" ||
    normalized === "semester"
  ) {
    return "pro";
  }
  if (
    normalized === "tutor" ||
    normalized === "tutor_guild" ||
    normalized === "tutor-guild"
  ) {
    return "tutor";
  }
  return "contender";
}

/**
 * Checks rate limits using Upstash Redis if configured,
 * or gracefully falls back to an in-memory sliding window.
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType,
  tier: ServerTier | UserTier = "guest",
): Promise<RateLimitResult> {
  assertProductionRateLimitConfig();
  const isNotes = type === "notes";
  const isIngest = type === "ingest";
  const normTier = toUserTier(tier);
  const isPaid =
    normTier === "cram_pass" ||
    normTier === "pro_monthly" ||
    normTier === "pro" ||
    normTier === "tutor";
  const isPro =
    normTier === "pro_monthly" || normTier === "pro" || normTier === "tutor";

  let limit: number;
  let windowMs: number;

  if (isNotes) {
    limit = isPaid ? 30 : 0;
    windowMs = 24 * 60 * 60 * 1000; // 24 hours
  } else if (isIngest) {
    limit = isPaid ? 50 : 2;
    windowMs = isPaid ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  } else {
    // coach
    limit = isPaid ? 60 : 20;
    windowMs = 10 * 60 * 1000;
  }

  // 1. Try Upstash Redis if available
  const limiter = isNotes
    ? proNotesLimiter
    : isIngest
      ? isPaid
        ? paidIngestLimiter
        : freeIngestLimiter
      : isPaid
        ? paidCoachLimiter
        : freeCoachLimiter;
  if (limiter) {
    try {
      const result = await limiter.limit(`${normTier}:${identifier}`);
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
    } catch (err) {
      // Fallback to in-memory on network failure
      if (process.env.NODE_ENV === "production") {
        console.warn(
          `[RateLimit] Warning: Upstash Redis rate limiter error for ${normTier}:${identifier} (${type}). Degrading to in-memory fallback:`,
          err,
        );
      }
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      `[RateLimit] Warning: Distributed rate limiter is null in production for ${normTier}:${identifier} (${type}). Degrading to in-memory fallback.`,
    );
  }

  // 2. In-memory sliding window fallback
  const memResult = checkInMemoryRateLimit(
    `${type}:${normTier}:${identifier}`,
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

function parseFirstIpToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0].trim();
  if (first.length >= 3 && first.length <= 45 && !/[<>\s"']/.test(first)) {
    return first;
  }
  return null;
}

/**
 * Resolves a reliable client IP address from proxy headers.
 * Hardened against rotating spoofed Cloudflare headers on Vercel deployments (SA-15, SA2-06):
 * 1. Platform-verified 'x-vercel-forwarded-for' takes strict priority over 'cf-connecting-ip'.
 * 2. Verified 'cf-connecting-ip' (only when verified with 'cf-ray' header or TRUST_CLOUDFLARE_HEADERS === "true").
 * 3. Reverse proxy / Nginx real IP header ('x-real-ip').
 * 4. Fallback to 'x-forwarded-for' (sanitized first token).
 * 5. Unverified 'cf-connecting-ip' (only when not on Vercel).
 * 6. Default fallback to '127.0.0.1'.
 */
export function getClientIp(request: Request): string {
  // 1. Vercel platform-verified header takes strict priority
  const vercel = parseFirstIpToken(request.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const cf = parseFirstIpToken(request.headers.get("cf-connecting-ip"));
  const hasCfRay = Boolean(request.headers.get("cf-ray")?.trim());
  const isCfVerified = hasCfRay || process.env.TRUST_CLOUDFLARE_HEADERS === "true";

  // 2. Verified Cloudflare header (accompanied by cf-ray or TRUST_CLOUDFLARE_HEADERS)
  if (cf && isCfVerified) {
    return cf;
  }

  // 3. Reverse proxy / Nginx real IP header
  const realIp = parseFirstIpToken(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  // 4. Fallback to X-Forwarded-For (sanitized first token)
  const forwarded = parseFirstIpToken(request.headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;

  // 5. Unverified cf-connecting-ip (only when not on Vercel)
  const isOnVercel =
    Boolean(process.env.VERCEL) ||
    Boolean(request.headers.get("x-vercel-id"));
  if (cf && !isOnVercel) {
    return cf;
  }

  return "127.0.0.1";
}

/* -------------------------------------------------------------------------- */
/*  Actor Identification & Namespaced Ledgers (SA-09 / SA-15)                 */
/* -------------------------------------------------------------------------- */

export type ActorIdentifier =
  | string
  | {
      userId?: string | null;
      ip?: string | null;
      tier?: ServerTier | UserTier | string | null;
      region?: BillingRegion | string | null;
      authToken?: string | null;
    };

/**
 * Ensures authenticated users use a distinct ledger namespace (user:${userId})
 * and unauthenticated guests use a distinct namespace (ip:${ip}), preventing
 * guest IPs and user IDs from colliding or overwriting each other's quota state.
 */
export function resolveActorKey(
  actor:
    | ActorIdentifier
    | RollbackDeckQuotaParams
    | null
    | undefined,
): string {
  if (!actor) return "user:anonymous";

  if (typeof actor === "string") {
    const trimmed = actor.trim();
    if (!trimmed) return "user:anonymous";
    if (trimmed.startsWith("user:") || trimmed.startsWith("ip:")) {
      return trimmed;
    }
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed);
    const isIpv6 =
      trimmed.includes(":") &&
      !trimmed.startsWith("user-") &&
      !trimmed.startsWith("u-");
    const isLocalhost = trimmed === "localhost" || trimmed === "127.0.0.1";
    if (isIpv4 || isIpv6 || isLocalhost) {
      return `ip:${trimmed}`;
    }
    return `user:${trimmed}`;
  }

  if (actor.userId && actor.userId.trim()) {
    const u = actor.userId.trim();
    return u.startsWith("user:") ? u : `user:${u}`;
  }

  if (actor.ip && actor.ip.trim()) {
    const i = actor.ip.trim();
    return i.startsWith("ip:") ? i : `ip:${i}`;
  }

  return "user:anonymous";
}

/* -------------------------------------------------------------------------- */
/*  Per-Actor Async Mutex / Promise Queue for TOCTOU Prevention (SA-09)       */
/* -------------------------------------------------------------------------- */

const actorLockMap = new Map<string, Promise<unknown>>();

export function getActorLockMapSize(): number {
  return actorLockMap.size;
}

/**
 * Serializes async quota mutations per actorKey using an in-process promise queue.
 * Closes TOCTOU race conditions where concurrent calls read the same snapshot before writing.
 * Automatically cleans up settled promises from the map once the queue drains to prevent memory leaks.
 */
export async function withActorQuotaLock<T>(
  actorKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previousLock = actorLockMap.get(actorKey) ?? Promise.resolve();

  let releaseLock: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  actorLockMap.set(actorKey, currentLock);

  const task = previousLock
    .catch(() => {})
    .then(async () => {
      return await fn();
    });

  try {
    return await task;
  } finally {
    releaseLock!();
    if (actorLockMap.get(actorKey) === currentLock) {
      actorLockMap.delete(actorKey);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Content-Hash & Shared Deck Cache Engine                                   */
/* -------------------------------------------------------------------------- */

export function computeContentHash(input: {
  normalizedText: string;
  pageCount?: number | null;
  imageHashes?: string[];
}): string {
  const normText = input.normalizedText.replace(/\r\n/g, "\n").trim();
  const sortedImages = input.imageHashes ? [...input.imageHashes].sort() : [];
  const payload = JSON.stringify({
    text: normText,
    pages: input.pageCount ?? null,
    images: sortedImages,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function computeFileSha256(buffer: ArrayBuffer | Uint8Array | Buffer): string {
  let nodeBuf: Buffer;
  if (Buffer.isBuffer(buffer)) {
    nodeBuf = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    nodeBuf = Buffer.from(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    nodeBuf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    nodeBuf = Buffer.from(buffer as unknown as ArrayBuffer);
  }
  return createHash("sha256").update(nodeBuf).digest("hex");
}

export interface SharedDeckCacheEntry {
  id?: string;
  contentHash: string;
  fileSha256?: string | null;
  language: string;
  mode: string;
  focusHash: string;
  pipelineVersion: string;
  servedGeneratorModel?: string | null;
  servedVerifierModel?: string | null;
  questionPool: any[];
  studyMetadata?: Record<string, any>;
  clutchNote?: any;
  hitCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SharedDeckLookupKey {
  contentHash: string;
  language?: string;
  mode?: string;
  focusHash?: string;
  pipelineVersion: string;
  fileSha256?: string | null;
}

const sharedDeckMemoryStore = new Map<string, SharedDeckCacheEntry>();
const fileSha256ToCompositeMap = new Map<string, string>();

export function getSharedDeckMemoryCacheSize(): number {
  return sharedDeckMemoryStore.size;
}

export function getFileSha256ToCompositeMapSize(): number {
  return fileSha256ToCompositeMap.size;
}

function setSharedDeckMemoryEntry(
  compositeKey: string,
  entry: SharedDeckCacheEntry,
): void {
  setBoundedMapEntry(
    sharedDeckMemoryStore,
    compositeKey,
    entry,
    MAX_SHARED_DECK_CACHE_ENTRIES,
    (evictedKey, evictedValue) => {
      if (
        evictedValue?.fileSha256 &&
        fileSha256ToCompositeMap.get(evictedValue.fileSha256) === evictedKey
      ) {
        fileSha256ToCompositeMap.delete(evictedValue.fileSha256);
      }
    },
  );
  if (entry.fileSha256) {
    setBoundedMapEntry(
      fileSha256ToCompositeMap,
      entry.fileSha256,
      compositeKey,
      MAX_SHARED_DECK_CACHE_ENTRIES,
    );
  }
}

function makeCacheCompositeKey(
  contentHash: string,
  language = "en",
  mode = "generate",
  focusHash = "",
  pipelineVersion = "v1",
): string {
  return `${contentHash}:${language}:${mode}:${focusHash}:${pipelineVersion}`;
}

export async function getSharedDeckCache(
  key: SharedDeckLookupKey,
): Promise<SharedDeckCacheEntry | null> {
  const lang = key.language || "en";
  const mode = key.mode || "generate";
  const focus = key.focusHash || "";
  const compositeKey = makeCacheCompositeKey(
    key.contentHash,
    lang,
    mode,
    focus,
    key.pipelineVersion,
  );

  // 1. Direct composite lookup in memory
  let cached = sharedDeckMemoryStore.get(compositeKey);
  let matchedCompositeKey = compositeKey;

  // 2. Fast-path lookup by fileSha256 in memory
  if (!cached && key.fileSha256) {
    const linkedCompositeKey = fileSha256ToCompositeMap.get(key.fileSha256);
    if (linkedCompositeKey) {
      const match = sharedDeckMemoryStore.get(linkedCompositeKey);
      if (
        match &&
        match.language === lang &&
        match.mode === mode &&
        match.focusHash === focus &&
        match.pipelineVersion === key.pipelineVersion
      ) {
        cached = match;
        matchedCompositeKey = linkedCompositeKey;
      }
    }
  }

  // 3. If found in memory, bump hit count, refresh LRU and return
  if (cached) {
    cached.hitCount += 1;
    cached.updatedAt = new Date().toISOString();
    setSharedDeckMemoryEntry(matchedCompositeKey, cached);
    if (isSupabaseServerConfigured() && cached.id) {
      try {
        const supabase = getSupabaseServerClient();
        if (supabase) {
          void supabase
            .from("shared_deck_cache")
            .update({ hit_count: cached.hitCount, updated_at: cached.updatedAt })
            .eq("id", cached.id);
        }
      } catch {
        // ignore background sync errors
      }
    }
    return cached;
  }

  // 4. Supabase cloud lookup if configured
  if (isSupabaseServerConfigured()) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        let { data } = await supabase
          .from("shared_deck_cache")
          .select("*")
          .eq("content_hash", key.contentHash)
          .eq("language", lang)
          .eq("mode", mode)
          .eq("focus_hash", focus)
          .eq("pipeline_version", key.pipelineVersion)
          .maybeSingle();

        if (!data && key.fileSha256) {
          const res = await supabase
            .from("shared_deck_cache")
            .select("*")
            .eq("file_sha256", key.fileSha256)
            .eq("language", lang)
            .eq("mode", mode)
            .eq("focus_hash", focus)
            .eq("pipeline_version", key.pipelineVersion)
            .maybeSingle();
          data = res.data;
        }

        if (data) {
          const entry: SharedDeckCacheEntry = {
            id: data.id,
            contentHash: data.content_hash,
            fileSha256: data.file_sha256,
            language: data.language,
            mode: data.mode,
            focusHash: data.focus_hash,
            pipelineVersion: data.pipeline_version,
            servedGeneratorModel: data.served_generator_model,
            servedVerifierModel: data.served_verifier_model,
            questionPool: Array.isArray(data.question_pool) ? data.question_pool : [],
            studyMetadata: data.study_metadata ?? {},
            clutchNote: data.clutch_note ?? null,
            hitCount: (data.hit_count ?? 0) + 1,
            createdAt: data.created_at,
            updatedAt: new Date().toISOString(),
          };
          setSharedDeckMemoryEntry(compositeKey, entry);
          void supabase
            .from("shared_deck_cache")
            .update({ hit_count: entry.hitCount, updated_at: entry.updatedAt })
            .eq("id", data.id);
          return entry;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function setSharedDeckCache(
  entry: Omit<SharedDeckCacheEntry, "hitCount"> & { hitCount?: number },
): Promise<SharedDeckCacheEntry> {
  const lang = entry.language || "en";
  const mode = entry.mode || "generate";
  const focus = entry.focusHash || "";
  const hitCount = entry.hitCount ?? 0;
  const compositeKey = makeCacheCompositeKey(
    entry.contentHash,
    lang,
    mode,
    focus,
    entry.pipelineVersion,
  );

  const fullEntry: SharedDeckCacheEntry = {
    id: entry.id ?? `cache-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    contentHash: entry.contentHash,
    fileSha256: entry.fileSha256 ?? null,
    language: lang,
    mode,
    focusHash: focus,
    pipelineVersion: entry.pipelineVersion,
    servedGeneratorModel: entry.servedGeneratorModel ?? null,
    servedVerifierModel: entry.servedVerifierModel ?? null,
    questionPool: Array.isArray(entry.questionPool) ? entry.questionPool : [],
    studyMetadata: entry.studyMetadata ?? {},
    clutchNote: entry.clutchNote ?? null,
    hitCount,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  setSharedDeckMemoryEntry(compositeKey, fullEntry);

  if (isSupabaseServerConfigured()) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        const payload = {
          content_hash: fullEntry.contentHash,
          file_sha256: fullEntry.fileSha256,
          language: fullEntry.language,
          mode: fullEntry.mode,
          focus_hash: fullEntry.focusHash,
          pipeline_version: fullEntry.pipelineVersion,
          served_generator_model: fullEntry.servedGeneratorModel,
          served_verifier_model: fullEntry.servedVerifierModel,
          question_pool: fullEntry.questionPool,
          study_metadata: fullEntry.studyMetadata,
          clutch_note: fullEntry.clutchNote,
          hit_count: fullEntry.hitCount,
          updated_at: fullEntry.updatedAt,
        };
        const { data } = await supabase
          .from("shared_deck_cache")
          .upsert(payload, {
            onConflict: "content_hash,language,mode,focus_hash,pipeline_version",
          })
          .select("id")
          .maybeSingle();

        if (data?.id) {
          fullEntry.id = data.id;
        }
      }
    } catch {
      // ignore
    }
  }

  return fullEntry;
}

export interface CachedParsedDocumentData {
  fileName: string;
  format: "pdf" | "pptx" | "docx" | "txt" | "mixed";
  sources: Array<{ id: string; label: string; text: string }>;
  pageCount: number | null;
  characterCount: number;
  warnings: string[];
  fileSha256: string;
  contentHash: string;
  imageHashes?: string[];
  dedupedSlideCount?: number;
  formulaInventory?: any[];
}

/**
 * Retrieves a pre-extracted parsed slide deck from the shared deck cache by file SHA-256.
 * Bridges Clutch Notes AI and Quiz Arena ingestion to prevent redundant re-parsing & OCR.
 */
export async function getCachedParsedDocument(
  fileSha256: string,
): Promise<CachedParsedDocumentData | null> {
  if (!fileSha256 || typeof fileSha256 !== "string" || !fileSha256.trim()) {
    return null;
  }
  const cleanSha = fileSha256.trim();

  // 1. Fast-path memory lookup via linked composite key
  const linkedKey = fileSha256ToCompositeMap.get(cleanSha);
  if (linkedKey) {
    const entry = sharedDeckMemoryStore.get(linkedKey);
    const meta = entry?.studyMetadata;
    if (meta && Array.isArray(meta.sources) && meta.sources.length > 0) {
      const charCount =
        typeof meta.characterCount === "number" && meta.characterCount > 0
          ? meta.characterCount
          : meta.sources.reduce((sum: number, s: any) => sum + (s.text?.length || 0), 0);
      return {
        fileName: meta.fileName || "lecture-slides.pdf",
        format: meta.format || (meta.fileName?.toLowerCase().endsWith(".pptx") ? "pptx" : "pdf"),
        sources: meta.sources,
        pageCount: typeof meta.slideCount === "number" ? meta.slideCount : meta.sources.length,
        characterCount: charCount,
        warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
        fileSha256: cleanSha,
        contentHash: entry!.contentHash,
        imageHashes: Array.isArray(meta.imageHashes) ? meta.imageHashes : undefined,
        dedupedSlideCount: typeof meta.dedupedSlideCount === "number" ? meta.dedupedSlideCount : undefined,
        formulaInventory: Array.isArray(meta.formulaInventory) ? meta.formulaInventory : undefined,
      };
    }
  }

  // 2. Scan all entries in sharedDeckMemoryStore for matching fileSha256
  for (const entry of sharedDeckMemoryStore.values()) {
    if (entry.fileSha256 === cleanSha) {
      const meta = entry.studyMetadata;
      if (meta && Array.isArray(meta.sources) && meta.sources.length > 0) {
        const charCount =
          typeof meta.characterCount === "number" && meta.characterCount > 0
            ? meta.characterCount
            : meta.sources.reduce((sum: number, s: any) => sum + (s.text?.length || 0), 0);
        return {
          fileName: meta.fileName || "lecture-slides.pdf",
          format: meta.format || (meta.fileName?.toLowerCase().endsWith(".pptx") ? "pptx" : "pdf"),
          sources: meta.sources,
          pageCount: typeof meta.slideCount === "number" ? meta.slideCount : meta.sources.length,
          characterCount: charCount,
          warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
          fileSha256: cleanSha,
          contentHash: entry.contentHash,
          imageHashes: Array.isArray(meta.imageHashes) ? meta.imageHashes : undefined,
          dedupedSlideCount: typeof meta.dedupedSlideCount === "number" ? meta.dedupedSlideCount : undefined,
          formulaInventory: Array.isArray(meta.formulaInventory) ? meta.formulaInventory : undefined,
        };
      }
    }
  }

  // 3. Cloud Supabase lookup if configured
  if (isSupabaseServerConfigured()) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        const { data } = await supabase
          .from("shared_deck_cache")
          .select("content_hash, file_sha256, study_metadata")
          .eq("file_sha256", cleanSha)
          .limit(5);

        if (Array.isArray(data)) {
          for (const row of data) {
            const meta = row.study_metadata;
            if (meta && Array.isArray(meta.sources) && meta.sources.length > 0) {
              const charCount =
                typeof meta.characterCount === "number" && meta.characterCount > 0
                  ? meta.characterCount
                  : meta.sources.reduce((sum: number, s: any) => sum + (s.text?.length || 0), 0);
              return {
                fileName: meta.fileName || "lecture-slides.pdf",
                format: meta.format || (meta.fileName?.toLowerCase().endsWith(".pptx") ? "pptx" : "pdf"),
                sources: meta.sources,
                pageCount: typeof meta.slideCount === "number" ? meta.slideCount : meta.sources.length,
                characterCount: charCount,
                warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
                fileSha256: cleanSha,
                contentHash: row.content_hash,
                imageHashes: Array.isArray(meta.imageHashes) ? meta.imageHashes : undefined,
                dedupedSlideCount: typeof meta.dedupedSlideCount === "number" ? meta.dedupedSlideCount : undefined,
                formulaInventory: Array.isArray(meta.formulaInventory) ? meta.formulaInventory : undefined,
              };
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function sampleQuestionsFromCachedPool<T = any>(
  pool: T[],
  count = 25,
  seed?: number | string,
): T[] {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  if (pool.length <= count) return [...pool];

  const copy = [...pool];

  if (seed !== undefined) {
    let seedNum = 0;
    if (typeof seed === "number") {
      seedNum = seed;
    } else {
      for (let i = 0; i < seed.length; i++) {
        seedNum = (seedNum * 31 + seed.charCodeAt(i)) | 0;
      }
    }

    let s = seedNum >>> 0;
    const rng = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
  } else {
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
  }

  return copy.slice(0, count);
}

export function clearSharedDeckCacheForTests(): void {
  sharedDeckMemoryStore.clear();
  fileSha256ToCompositeMap.clear();
}

/* -------------------------------------------------------------------------- */
/*  Durable Quota & Cumulative COGS Manager                                   */
/* -------------------------------------------------------------------------- */

export interface UnlockedDeckRecord {
  unlockedAt: string;
  regenerationsUsed: number;
  maxRegenerations: number;
}

export interface UserQuotaLedger {
  userId: string;
  tier: UserTier;
  cogsSpentUsd: number;
  cogsReservedUsd: number;
  cogsCeilingUsd: number;
  deckCreditsUsed: number;
  deckCreditsLimit: number;
  dailyBurstUsed: number;
  dailyBurstDate: string; // YYYY-MM-DD
  unlockedDecks: Record<string, UnlockedDeckRecord>;
  updatedAt?: string;
  decksGeneratedCount?: number;
  estimatedCogsUsd?: number;
}

export interface CheckDeckQuotaOptions {
  estimatedCostUsd?: number;
  language?: string;
  mode?: string;
  focusHash?: string;
  pipelineVersion?: string;
  fileSha256?: string | null;
  region?: BillingRegion | string | null;
  maxDeckCredits?: number;
  overrideLimit?: number;
  burstLimit?: number;
  allowHaikuOverflow?: boolean;
}

export interface DeckQuotaReservationResult {
  allowed: boolean;
  reserved: boolean;
  reason?:
    | "DAILY_BURST_EXCEEDED"
    | "DECK_CREDITS_EXCEEDED"
    | "COGS_CEILING_EXCEEDED"
    | "REGENERATION_LIMIT_EXCEEDED";
  cacheHit: boolean;
  creditConsumed: boolean;
  isRegeneration: boolean;
  isHaikuOverflow?: boolean;
  creditsUsed: number;
  creditsLimit: number;
  dailyBurstUsed: number;
  dailyBurstLimit: number;
  cogsStatus: CogsBudgetStatus;
  cachedDeck?: SharedDeckCacheEntry | null;
  ledger: UserQuotaLedger;
}

const userQuotaMemoryStore = new Map<string, UserQuotaLedger>();

export function getUserQuotaMemoryStoreSize(): number {
  return userQuotaMemoryStore.size;
}

function refreshLedgerRollover(
  ledger: UserQuotaLedger,
  currentTier: UserTier,
  region: BillingRegion = "VN",
): UserQuotaLedger {
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  if (ledger.dailyBurstDate !== today) {
    ledger.dailyBurstDate = today;
    ledger.dailyBurstUsed = 0;
    changed = true;
  }
  if (ledger.tier !== currentTier) {
    ledger.tier = currentTier;
    const limits = TIER_LIMITS[currentTier];
    ledger.cogsCeilingUsd = getRegionalCogsCeiling(currentTier, region);
    ledger.deckCreditsLimit = limits.newDeckCredits;
    changed = true;
  }
  ledger.decksGeneratedCount = ledger.deckCreditsUsed;
  ledger.estimatedCogsUsd = ledger.cogsSpentUsd;
  if (changed) {
    ledger.updatedAt = new Date().toISOString();
  }
  return ledger;
}

export async function getUserQuotaLedger(
  actor: ActorIdentifier,
  tier: ServerTier | UserTier = "contender",
  region: BillingRegion = "VN",
): Promise<UserQuotaLedger> {
  const actorKey = resolveActorKey(actor);
  const effectiveTier =
    typeof actor === "object" && actor !== null && actor.tier
      ? actor.tier
      : tier;
  const userTier = toUserTier(effectiveTier);
  const limits = TIER_LIMITS[userTier];
  const effectiveCeiling = getRegionalCogsCeiling(userTier, region);

  // 1. Check in-memory store
  const existing = userQuotaMemoryStore.get(actorKey);
  if (existing) {
    const refreshed = refreshLedgerRollover(existing, userTier, region);
    setBoundedMapEntry(
      userQuotaMemoryStore,
      actorKey,
      refreshed,
      MAX_USER_QUOTA_LEDGER_ENTRIES,
    );
    return refreshed;
  }

  // 2. Check Upstash Redis
  if (redis) {
    try {
      const raw = await redis.get<string | UserQuotaLedger>(`clutch:quota:ledger:${actorKey}`);
      if (raw) {
        const parsed: UserQuotaLedger = typeof raw === "string" ? JSON.parse(raw) : raw;
        const refreshed = refreshLedgerRollover(parsed, userTier, region);
        setBoundedMapEntry(
          userQuotaMemoryStore,
          actorKey,
          refreshed,
          MAX_USER_QUOTA_LEDGER_ENTRIES,
        );
        return refreshed;
      }
    } catch {
      // ignore
    }
  }

  // 3. Check Supabase
  if (isSupabaseServerConfigured()) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        let { data } = await supabase
          .from("user_quota_ledgers")
          .select("*")
          .eq("user_id", actorKey)
          .maybeSingle();

        if (!data && actorKey.startsWith("user:")) {
          const rawId = actorKey.slice(5);
          const legacyRes = await supabase
            .from("user_quota_ledgers")
            .select("*")
            .eq("user_id", rawId)
            .maybeSingle();
          data = legacyRes.data;
        }

        if (data) {
          const parsed: UserQuotaLedger = {
            userId: actorKey,
            tier: (data.tier as UserTier) ?? userTier,
            cogsSpentUsd: Number(data.cogs_spent_usd ?? data.estimated_cogs_usd ?? 0),
            estimatedCogsUsd: Number(data.estimated_cogs_usd ?? data.cogs_spent_usd ?? 0),
            cogsReservedUsd: Number(data.cogs_reserved_usd ?? 0),
            cogsCeilingUsd: Number(data.cogs_ceiling_usd ?? effectiveCeiling),
            deckCreditsUsed: Number(data.deck_credits_used ?? data.decks_generated_count ?? 0),
            decksGeneratedCount: Number(data.decks_generated_count ?? data.deck_credits_used ?? 0),
            deckCreditsLimit: Number(data.deck_credits_limit ?? limits.newDeckCredits),
            dailyBurstUsed: Number(data.daily_burst_used ?? 0),
            dailyBurstDate: data.daily_burst_date ?? new Date().toISOString().slice(0, 10),
            unlockedDecks: (data.unlocked_decks as Record<string, UnlockedDeckRecord>) ?? {},
            updatedAt: data.updated_at,
          };
          const refreshed = refreshLedgerRollover(parsed, userTier, region);
          setBoundedMapEntry(
            userQuotaMemoryStore,
            actorKey,
            refreshed,
            MAX_USER_QUOTA_LEDGER_ENTRIES,
          );
          return refreshed;
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Default fresh ledger
  const today = new Date().toISOString().slice(0, 10);
  const fresh: UserQuotaLedger = {
    userId: actorKey,
    tier: userTier,
    cogsSpentUsd: 0,
    estimatedCogsUsd: 0,
    cogsReservedUsd: 0,
    cogsCeilingUsd: effectiveCeiling,
    deckCreditsUsed: 0,
    decksGeneratedCount: 0,
    deckCreditsLimit: limits.newDeckCredits,
    dailyBurstUsed: 0,
    dailyBurstDate: today,
    unlockedDecks: {},
    updatedAt: new Date().toISOString(),
  };
  setBoundedMapEntry(
    userQuotaMemoryStore,
    actorKey,
    fresh,
    MAX_USER_QUOTA_LEDGER_ENTRIES,
  );
  return fresh;
}

export async function saveUserQuotaLedger(ledger: UserQuotaLedger): Promise<void> {
  const actorKey = resolveActorKey(ledger.userId);
  ledger.userId = actorKey;
  ledger.decksGeneratedCount = ledger.deckCreditsUsed;
  ledger.estimatedCogsUsd = ledger.cogsSpentUsd;
  ledger.updatedAt = new Date().toISOString();

  setBoundedMapEntry(
    userQuotaMemoryStore,
    actorKey,
    {
      ...ledger,
      unlockedDecks: { ...ledger.unlockedDecks },
    },
    MAX_USER_QUOTA_LEDGER_ENTRIES,
  );

  if (redis) {
    try {
      await redis.set(`clutch:quota:ledger:${actorKey}`, JSON.stringify(ledger), {
        ex: 120 * 24 * 60 * 60, // 120 days TTL
      });
    } catch {
      // ignore
    }
  }

  if (isSupabaseServerConfigured()) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        await supabase.from("user_quota_ledgers").upsert({
          user_id: actorKey,
          tier: ledger.tier,
          cogs_spent_usd: ledger.cogsSpentUsd,
          estimated_cogs_usd: ledger.cogsSpentUsd,
          cogs_reserved_usd: ledger.cogsReservedUsd,
          cogs_ceiling_usd: ledger.cogsCeilingUsd,
          deck_credits_used: ledger.deckCreditsUsed,
          decks_generated_count: ledger.deckCreditsUsed,
          deck_credits_limit: ledger.deckCreditsLimit,
          daily_burst_used: ledger.dailyBurstUsed,
          daily_burst_date: ledger.dailyBurstDate,
          unlocked_decks: ledger.unlockedDecks,
          updated_at: ledger.updatedAt,
        });
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Checks and reserves deck generation quota.
 * Wrapped with withActorQuotaLock to serialize concurrent requests per actor and eliminate TOCTOU races (SA-09).
 */
export async function checkAndReserveDeckQuota(
  actor: ActorIdentifier,
  tier: ServerTier | UserTier = "contender",
  contentHash: string,
  options?: CheckDeckQuotaOptions,
): Promise<DeckQuotaReservationResult> {
  assertProductionRateLimitConfig();
  const actorKey = resolveActorKey(actor);
  const effectiveTier: ServerTier | UserTier =
    typeof actor === "object" && actor !== null && actor.tier
      ? (actor.tier as ServerTier | UserTier)
      : tier;
  const effectiveRegion: BillingRegion =
    (options?.region as BillingRegion) ??
    (typeof actor === "object" && actor !== null && actor.region ? (actor.region as BillingRegion) : "VN");

  return withActorQuotaLock(actorKey, async () => {
    const userTier = toUserTier(effectiveTier);
    const limits = TIER_LIMITS[userTier];
    const ledger = await getUserQuotaLedger(actorKey, userTier, effectiveRegion);

    const creditLimit =
      options?.maxDeckCredits ?? options?.overrideLimit ?? ledger.deckCreditsLimit ?? limits.newDeckCredits;
    const burstLimit = options?.burstLimit ?? limits.dailyDeckBurstLimit;

    // 1. Check if contentHash exists in shared_deck_cache
    let cachedDeck: SharedDeckCacheEntry | null = null;
    if (options?.pipelineVersion) {
      cachedDeck = await getSharedDeckCache({
        contentHash,
        language: options.language,
        mode: options.mode,
        focusHash: options.focusHash,
        pipelineVersion: options.pipelineVersion,
        fileSha256: options.fileSha256,
      });
    } else {
      for (const [cKey, entry] of sharedDeckMemoryStore.entries()) {
        if (entry.contentHash === contentHash) {
          cachedDeck = entry;
          setSharedDeckMemoryEntry(cKey, entry);
          break;
        }
      }
    }

    const baseCogsStatus = evaluateCogsDegradation(
      ledger.cogsSpentUsd,
      ledger.cogsCeilingUsd,
      0,
      ledger.cogsReservedUsd,
      effectiveRegion,
    );

    // Cache hit: consumes 0 deck credits and incurs $0.00 COGS!
    if (cachedDeck) {
      return {
        allowed: true,
        reserved: false,
        cacheHit: true,
        creditConsumed: false,
        isRegeneration: false,
        isHaikuOverflow: false,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: creditLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: burstLimit,
        cogsStatus: baseCogsStatus,
        cachedDeck,
        ledger,
      };
    }

    // 2. Check if contentHash was already unlocked by this user in current period
    const existingDeckRecord = ledger.unlockedDecks[contentHash];
    if (existingDeckRecord) {
      const maxRegens = existingDeckRecord.maxRegenerations ?? limits.freeRegenerationsPerDeck;
      if (existingDeckRecord.regenerationsUsed >= maxRegens) {
        return {
          allowed: false,
          reserved: false,
          reason: "REGENERATION_LIMIT_EXCEEDED",
          cacheHit: false,
          creditConsumed: false,
          isRegeneration: true,
          isHaikuOverflow: false,
          creditsUsed: ledger.deckCreditsUsed,
          creditsLimit: creditLimit,
          dailyBurstUsed: ledger.dailyBurstUsed,
          dailyBurstLimit: burstLimit,
          cogsStatus: baseCogsStatus,
          ledger,
        };
      }

      const estCost = options?.estimatedCostUsd ?? (userTier === "contender" ? 0.01 : 0.02);
      const cogsStatus = evaluateCogsDegradation(
        ledger.cogsSpentUsd,
        ledger.cogsCeilingUsd,
        estCost,
        ledger.cogsReservedUsd,
        effectiveRegion,
      );

      if (cogsStatus.mode === "halted" || cogsStatus.serveCachedPoolsOnly) {
        return {
          allowed: false,
          reserved: false,
          reason: "COGS_CEILING_EXCEEDED",
          cacheHit: false,
          creditConsumed: false,
          isRegeneration: true,
          isHaikuOverflow: false,
          creditsUsed: ledger.deckCreditsUsed,
          creditsLimit: creditLimit,
          dailyBurstUsed: ledger.dailyBurstUsed,
          dailyBurstLimit: burstLimit,
          cogsStatus,
          ledger,
        };
      }

      // Regeneration allowed without consuming new deck credit
      existingDeckRecord.regenerationsUsed += 1;
      ledger.cogsReservedUsd = Number((ledger.cogsReservedUsd + estCost).toFixed(6));
      await saveUserQuotaLedger(ledger);

      return {
        allowed: true,
        reserved: true,
        cacheHit: false,
        creditConsumed: false,
        isRegeneration: true,
        isHaikuOverflow: false,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: creditLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: burstLimit,
        cogsStatus,
        ledger,
      };
    }

    // 3. New distinct document (contentHash): enforce deck credits, daily burst, and COGS ceiling
    let isHaikuOverflow = false;
    if (ledger.deckCreditsUsed >= creditLimit) {
      if (
        options?.allowHaikuOverflow === true &&
        limits.haikuOverflowDeckCredits > 0 &&
        ledger.deckCreditsUsed < creditLimit + limits.haikuOverflowDeckCredits
      ) {
        isHaikuOverflow = true;
      } else {
        return {
          allowed: false,
          reserved: false,
          reason: "DECK_CREDITS_EXCEEDED",
          cacheHit: false,
          creditConsumed: false,
          isRegeneration: false,
          isHaikuOverflow: false,
          creditsUsed: ledger.deckCreditsUsed,
          creditsLimit: creditLimit,
          dailyBurstUsed: ledger.dailyBurstUsed,
          dailyBurstLimit: burstLimit,
          cogsStatus: baseCogsStatus,
          ledger,
        };
      }
    }

    if (ledger.dailyBurstUsed >= burstLimit) {
      return {
        allowed: false,
        reserved: false,
        reason: "DAILY_BURST_EXCEEDED",
        cacheHit: false,
        creditConsumed: false,
        isRegeneration: false,
        isHaikuOverflow,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: creditLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: burstLimit,
        cogsStatus: baseCogsStatus,
        ledger,
      };
    }

    const defaultCost = userTier === "contender" || isHaikuOverflow ? 0.028 : 0.098;
    const estCost =
      options?.estimatedCostUsd !== undefined
        ? isHaikuOverflow
          ? Math.min(options.estimatedCostUsd, 0.028)
          : options.estimatedCostUsd
        : defaultCost;

    let cogsStatus = evaluateCogsDegradation(
      ledger.cogsSpentUsd,
      ledger.cogsCeilingUsd,
      estCost,
      ledger.cogsReservedUsd,
      effectiveRegion,
    );

    if (isHaikuOverflow) {
      cogsStatus = { ...cogsStatus, useCheaperGeneratorSlug: true };
    }

    if (cogsStatus.mode === "halted" || cogsStatus.serveCachedPoolsOnly) {
      return {
        allowed: false,
        reserved: false,
        reason: "COGS_CEILING_EXCEEDED",
        cacheHit: false,
        creditConsumed: false,
        isRegeneration: false,
        isHaikuOverflow,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: creditLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: burstLimit,
        cogsStatus,
        ledger,
      };
    }

    // Reserve COGS and consume 1 deck credit and 1 daily burst
    ledger.deckCreditsUsed += 1;
    ledger.decksGeneratedCount = ledger.deckCreditsUsed;
    ledger.dailyBurstUsed += 1;
    ledger.cogsReservedUsd = Number((ledger.cogsReservedUsd + estCost).toFixed(6));
    ledger.unlockedDecks[contentHash] = {
      unlockedAt: new Date().toISOString(),
      regenerationsUsed: 0,
      maxRegenerations: limits.freeRegenerationsPerDeck,
    };

    await saveUserQuotaLedger(ledger);

    return {
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      isHaikuOverflow,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: creditLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: burstLimit,
      cogsStatus,
      ledger,
    };
  });
}

/**
 * Records actual COGS expenditure after AI generation completes, releasing reserved amount.
 * Serialized per actorKey to eliminate race conditions on cumulative cost totals.
 */
export async function recordDeckGenerationCogs(
  actor: ActorIdentifier,
  tier: ServerTier | UserTier = "contender",
  actualCostUsd: number,
  reservedCostUsd?: number,
  region?: BillingRegion,
): Promise<{ ledger: UserQuotaLedger; cogsStatus: CogsBudgetStatus }> {
  const actorKey = resolveActorKey(actor);
  const effectiveTier =
    typeof actor === "object" && actor !== null && actor.tier
      ? (actor.tier as ServerTier | UserTier)
      : tier;

  return withActorQuotaLock(actorKey, async () => {
    const userTier = toUserTier(effectiveTier);
    const ledger = await getUserQuotaLedger(actorKey, userTier, region);

    const release = reservedCostUsd !== undefined ? reservedCostUsd : actualCostUsd;
    ledger.cogsReservedUsd = Math.max(0, Number((ledger.cogsReservedUsd - release).toFixed(6)));
    ledger.cogsSpentUsd = Number((ledger.cogsSpentUsd + actualCostUsd).toFixed(6));
    ledger.estimatedCogsUsd = ledger.cogsSpentUsd;
    ledger.updatedAt = new Date().toISOString();

    const cogsStatus = evaluateCogsDegradation(
      ledger.cogsSpentUsd,
      ledger.cogsCeilingUsd,
      0,
      ledger.cogsReservedUsd,
      region,
    );

    await saveUserQuotaLedger(ledger);
    return { ledger, cogsStatus };
  });
}

export interface RollbackDeckQuotaParams {
  userId?: string | null;
  ip?: string | null;
  tier?: ServerTier | UserTier | string | null;
  region?: BillingRegion | string | null;
  authToken?: string | null;
  contentHash?: string | null;
  reservedCostUsd?: number | null;
  isRegeneration?: boolean | null;
}

/**
 * Rolls back a reserved deck quota slot and COGS reservation on upstream AI failure (SA-09, SA2-05).
 * Safely decrements decksGeneratedCount / deckCreditsUsed / dailyBurstUsed (clamped at >= 0)
 * ONLY when !isRegeneration. For regenerations, credits are left intact and regenerationsUsed is decremented.
 */
export async function rollbackDeckQuotaReservation(
  actorOrParams: ActorIdentifier | RollbackDeckQuotaParams,
  tier?: ServerTier | UserTier | string | null,
  contentHash?: string | null,
  reservedCostUsd?: number | null,
  region?: BillingRegion | boolean | null,
  isRegeneration?: boolean | null,
): Promise<{ success: boolean; ledger: UserQuotaLedger; decksGeneratedCount: number }> {
  const actorKey = resolveActorKey(actorOrParams);

  let effectiveTier: ServerTier | UserTier | string | null = tier ?? "contender";
  let targetContentHash: string | null = contentHash ?? null;
  let targetReservedCost: number | null = reservedCostUsd ?? null;
  let isRegen: boolean | null = null;
  let effectiveRegion: BillingRegion = "VN";

  if (typeof region === "boolean") {
    isRegen = region;
  } else if (region && typeof region === "string") {
    effectiveRegion = region as BillingRegion;
  }

  if (typeof isRegeneration === "boolean" && isRegen === null) {
    isRegen = isRegeneration;
  }

  if (typeof actorOrParams === "object" && actorOrParams !== null) {
    if ("tier" in actorOrParams && actorOrParams.tier) {
      effectiveTier = actorOrParams.tier;
    }
    if ("contentHash" in actorOrParams && actorOrParams.contentHash) {
      targetContentHash = actorOrParams.contentHash;
    }
    if ("reservedCostUsd" in actorOrParams && actorOrParams.reservedCostUsd !== undefined && actorOrParams.reservedCostUsd !== null) {
      targetReservedCost = actorOrParams.reservedCostUsd;
    }
    if ("isRegeneration" in actorOrParams && actorOrParams.isRegeneration !== undefined && actorOrParams.isRegeneration !== null) {
      isRegen = Boolean(actorOrParams.isRegeneration);
    }
    if ("region" in actorOrParams && actorOrParams.region && typeof actorOrParams.region === "string") {
      effectiveRegion = actorOrParams.region as BillingRegion;
    }
  }

  const isRegenActive = Boolean(isRegen);

  return withActorQuotaLock(actorKey, async () => {
    const userTier = toUserTier(effectiveTier);
    const ledger = await getUserQuotaLedger(actorKey, userTier, effectiveRegion);

    // CRITICAL (SA2-05): Only decrement deckCreditsUsed, decksGeneratedCount, and dailyBurstUsed
    // when NOT a regeneration. Regeneration reservations consume 0 deck credits and 0 daily burst,
    // so rolling back must not refund credits or burst limits (infinite credit refund exploit).
    if (!isRegenActive) {
      ledger.deckCreditsUsed = Math.max(0, (ledger.deckCreditsUsed ?? 0) - 1);
      ledger.decksGeneratedCount = ledger.deckCreditsUsed;
      ledger.dailyBurstUsed = Math.max(0, (ledger.dailyBurstUsed ?? 0) - 1);
    }

    // Roll back reserved COGS if specified or default
    const estToRelease =
      typeof targetReservedCost === "number"
        ? targetReservedCost
        : userTier === "contender"
          ? (isRegenActive ? 0.01 : 0.02)
          : (isRegenActive ? 0.02 : 0.035);

    ledger.cogsReservedUsd = Math.max(
      0,
      Number(((ledger.cogsReservedUsd ?? 0) - estToRelease).toFixed(6)),
    );

    // If contentHash was passed, adjust unlockedDecks
    if (targetContentHash && ledger.unlockedDecks[targetContentHash]) {
      if (isRegenActive) {
        ledger.unlockedDecks[targetContentHash].regenerationsUsed = Math.max(
          0,
          (ledger.unlockedDecks[targetContentHash].regenerationsUsed ?? 1) - 1,
        );
      } else if (ledger.unlockedDecks[targetContentHash].regenerationsUsed === 0) {
        delete ledger.unlockedDecks[targetContentHash];
      }
    }

    ledger.updatedAt = new Date().toISOString();
    await saveUserQuotaLedger(ledger);

    return {
      success: true,
      ledger,
      decksGeneratedCount: ledger.deckCreditsUsed,
    };
  });
}

/**
 * Checks notes rate limits with in-process lock to prevent concurrent bypass.
 */
export async function checkNotesRateLimit(
  actor: ActorIdentifier,
  tier?: ServerTier | UserTier | string | null,
): Promise<RateLimitResult> {
  assertProductionRateLimitConfig();
  const actorKey = resolveActorKey(actor);
  const resolvedTier: ServerTier =
    typeof actor === "object" && actor !== null && actor.tier
      ? (actor.tier as ServerTier)
      : ((tier as ServerTier) ?? "contender");

  return withActorQuotaLock(actorKey, async () => {
    return checkRateLimit(actorKey, "notes", resolvedTier);
  });
}

export function resetQuotaLedgersForTests(): void {
  userQuotaMemoryStore.clear();
  localMemoryStore.clear();
  sharedDeckMemoryStore.clear();
  fileSha256ToCompositeMap.clear();
  actorLockMap.clear();
}
