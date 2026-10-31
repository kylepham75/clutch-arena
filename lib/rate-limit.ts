import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerTier } from "@/lib/auth/server-guard";
import {
  TIER_LIMITS,
  evaluateCogsDegradation,
  type UserTier,
  type CogsBudgetStatus,
} from "@/lib/pricing/tiers";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";

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
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    "[Security Warning] UPSTASH_REDIS_REST_URL/TOKEN not configured. Distributed rate limiting is degraded to in-memory fallback.",
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
 * Checks rate limits using Upstash Redis if configured,
 * or gracefully falls back to an in-memory sliding window.
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType,
  tier: ServerTier = "guest",
): Promise<RateLimitResult> {
  const isNotes = type === "notes";
  const isIngest = type === "ingest";
  const isPaid = tier === "cram_pass" || tier === "pro" || tier === "tutor";
  const isPro = tier === "pro" || tier === "tutor";

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
      const result = await limiter.limit(`${tier}:${identifier}`);
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
    `${type}:${tier}:${identifier}`,
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
}

export interface CheckDeckQuotaOptions {
  estimatedCostUsd?: number;
  language?: string;
  mode?: string;
  focusHash?: string;
  pipelineVersion?: string;
  fileSha256?: string | null;
}

export interface DeckQuotaReservationResult {
  allowed: boolean;
  reason?:
    | "DAILY_BURST_EXCEEDED"
    | "DECK_CREDITS_EXCEEDED"
    | "COGS_CEILING_EXCEEDED"
    | "REGENERATION_LIMIT_EXCEEDED";
  cacheHit: boolean;
  creditConsumed: boolean;
  isRegeneration: boolean;
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

function toUserTier(tier: ServerTier = "guest"): UserTier {
  if (tier === "cram_pass" || tier === "pro" || tier === "tutor") return tier;
  return "contender";
}

function refreshLedgerRollover(ledger: UserQuotaLedger, currentTier: UserTier): UserQuotaLedger {
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
    ledger.cogsCeilingUsd = limits.cogsCeilingUsd;
    ledger.deckCreditsLimit = limits.newDeckCredits;
    changed = true;
  }
  if (changed) {
    ledger.updatedAt = new Date().toISOString();
  }
  return ledger;
}

export async function getUserQuotaLedger(
  userId: string,
  tier: ServerTier = "contender",
): Promise<UserQuotaLedger> {
  const userTier = toUserTier(tier);
  const limits = TIER_LIMITS[userTier];

  // 1. Check in-memory store
  const existing = userQuotaMemoryStore.get(userId);
  if (existing) {
    const refreshed = refreshLedgerRollover(existing, userTier);
    setBoundedMapEntry(
      userQuotaMemoryStore,
      userId,
      refreshed,
      MAX_USER_QUOTA_LEDGER_ENTRIES,
    );
    return refreshed;
  }

  // 2. Check Upstash Redis
  if (redis) {
    try {
      const raw = await redis.get<string | UserQuotaLedger>(`clutch:quota:ledger:${userId}`);
      if (raw) {
        const parsed: UserQuotaLedger = typeof raw === "string" ? JSON.parse(raw) : raw;
        const refreshed = refreshLedgerRollover(parsed, userTier);
        setBoundedMapEntry(
          userQuotaMemoryStore,
          userId,
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
        const { data } = await supabase
          .from("user_quota_ledgers")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (data) {
          const parsed: UserQuotaLedger = {
            userId: data.user_id,
            tier: (data.tier as UserTier) ?? userTier,
            cogsSpentUsd: Number(data.cogs_spent_usd ?? 0),
            cogsReservedUsd: Number(data.cogs_reserved_usd ?? 0),
            cogsCeilingUsd: Number(data.cogs_ceiling_usd ?? limits.cogsCeilingUsd),
            deckCreditsUsed: Number(data.deck_credits_used ?? 0),
            deckCreditsLimit: Number(data.deck_credits_limit ?? limits.newDeckCredits),
            dailyBurstUsed: Number(data.daily_burst_used ?? 0),
            dailyBurstDate: data.daily_burst_date ?? new Date().toISOString().slice(0, 10),
            unlockedDecks: (data.unlocked_decks as Record<string, UnlockedDeckRecord>) ?? {},
            updatedAt: data.updated_at,
          };
          const refreshed = refreshLedgerRollover(parsed, userTier);
          setBoundedMapEntry(
            userQuotaMemoryStore,
            userId,
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
    userId,
    tier: userTier,
    cogsSpentUsd: 0,
    cogsReservedUsd: 0,
    cogsCeilingUsd: limits.cogsCeilingUsd,
    deckCreditsUsed: 0,
    deckCreditsLimit: limits.newDeckCredits,
    dailyBurstUsed: 0,
    dailyBurstDate: today,
    unlockedDecks: {},
    updatedAt: new Date().toISOString(),
  };
  setBoundedMapEntry(
    userQuotaMemoryStore,
    userId,
    fresh,
    MAX_USER_QUOTA_LEDGER_ENTRIES,
  );
  return fresh;
}

export async function saveUserQuotaLedger(ledger: UserQuotaLedger): Promise<void> {
  ledger.updatedAt = new Date().toISOString();
  setBoundedMapEntry(
    userQuotaMemoryStore,
    ledger.userId,
    {
      ...ledger,
      unlockedDecks: { ...ledger.unlockedDecks },
    },
    MAX_USER_QUOTA_LEDGER_ENTRIES,
  );

  if (redis) {
    try {
      await redis.set(`clutch:quota:ledger:${ledger.userId}`, JSON.stringify(ledger), {
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
          user_id: ledger.userId,
          tier: ledger.tier,
          cogs_spent_usd: ledger.cogsSpentUsd,
          cogs_reserved_usd: ledger.cogsReservedUsd,
          cogs_ceiling_usd: ledger.cogsCeilingUsd,
          deck_credits_used: ledger.deckCreditsUsed,
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

export async function checkAndReserveDeckQuota(
  userId: string,
  tier: ServerTier = "contender",
  contentHash: string,
  options?: CheckDeckQuotaOptions,
): Promise<DeckQuotaReservationResult> {
  const userTier = toUserTier(tier);
  const limits = TIER_LIMITS[userTier];
  const ledger = await getUserQuotaLedger(userId, userTier);

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
  );

  // Cache hit: consumes 0 deck credits and incurs $0.00 COGS!
  if (cachedDeck) {
    return {
      allowed: true,
      cacheHit: true,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: ledger.deckCreditsLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: limits.dailyDeckBurstLimit,
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
        reason: "REGENERATION_LIMIT_EXCEEDED",
        cacheHit: false,
        creditConsumed: false,
        isRegeneration: true,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: ledger.deckCreditsLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: limits.dailyDeckBurstLimit,
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
    );

    if (cogsStatus.mode === "halted" || cogsStatus.serveCachedPoolsOnly) {
      return {
        allowed: false,
        reason: "COGS_CEILING_EXCEEDED",
        cacheHit: false,
        creditConsumed: false,
        isRegeneration: true,
        creditsUsed: ledger.deckCreditsUsed,
        creditsLimit: ledger.deckCreditsLimit,
        dailyBurstUsed: ledger.dailyBurstUsed,
        dailyBurstLimit: limits.dailyDeckBurstLimit,
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
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: true,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: ledger.deckCreditsLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: limits.dailyDeckBurstLimit,
      cogsStatus,
      ledger,
    };
  }

  // 3. New distinct document (contentHash): enforce deck credits, daily burst, and COGS ceiling
  if (ledger.deckCreditsUsed >= limits.newDeckCredits) {
    return {
      allowed: false,
      reason: "DECK_CREDITS_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: ledger.deckCreditsLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: limits.dailyDeckBurstLimit,
      cogsStatus: baseCogsStatus,
      ledger,
    };
  }

  if (ledger.dailyBurstUsed >= limits.dailyDeckBurstLimit) {
    return {
      allowed: false,
      reason: "DAILY_BURST_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: ledger.deckCreditsLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: limits.dailyDeckBurstLimit,
      cogsStatus: baseCogsStatus,
      ledger,
    };
  }

  const estCost = options?.estimatedCostUsd ?? (userTier === "contender" ? 0.02 : 0.035);
  const cogsStatus = evaluateCogsDegradation(
    ledger.cogsSpentUsd,
    ledger.cogsCeilingUsd,
    estCost,
    ledger.cogsReservedUsd,
  );

  if (cogsStatus.mode === "halted" || cogsStatus.serveCachedPoolsOnly) {
    return {
      allowed: false,
      reason: "COGS_CEILING_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: ledger.deckCreditsUsed,
      creditsLimit: ledger.deckCreditsLimit,
      dailyBurstUsed: ledger.dailyBurstUsed,
      dailyBurstLimit: limits.dailyDeckBurstLimit,
      cogsStatus,
      ledger,
    };
  }

  // Reserve COGS and consume 1 deck credit and 1 daily burst
  ledger.deckCreditsUsed += 1;
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
    cacheHit: false,
    creditConsumed: true,
    isRegeneration: false,
    creditsUsed: ledger.deckCreditsUsed,
    creditsLimit: limits.newDeckCredits,
    dailyBurstUsed: ledger.dailyBurstUsed,
    dailyBurstLimit: limits.dailyDeckBurstLimit,
    cogsStatus,
    ledger,
  };
}

export async function recordDeckGenerationCogs(
  userId: string,
  tier: ServerTier,
  actualCostUsd: number,
  reservedCostUsd?: number,
): Promise<{ ledger: UserQuotaLedger; cogsStatus: CogsBudgetStatus }> {
  const userTier = toUserTier(tier);
  const ledger = await getUserQuotaLedger(userId, userTier);

  const release = reservedCostUsd !== undefined ? reservedCostUsd : actualCostUsd;
  ledger.cogsReservedUsd = Math.max(0, Number((ledger.cogsReservedUsd - release).toFixed(6)));
  ledger.cogsSpentUsd = Number((ledger.cogsSpentUsd + actualCostUsd).toFixed(6));
  ledger.updatedAt = new Date().toISOString();

  const cogsStatus = evaluateCogsDegradation(
    ledger.cogsSpentUsd,
    ledger.cogsCeilingUsd,
    0,
    ledger.cogsReservedUsd,
  );

  await saveUserQuotaLedger(ledger);
  return { ledger, cogsStatus };
}

export function resetQuotaLedgersForTests(): void {
  userQuotaMemoryStore.clear();
  localMemoryStore.clear();
  sharedDeckMemoryStore.clear();
  fileSha256ToCompositeMap.clear();
}
