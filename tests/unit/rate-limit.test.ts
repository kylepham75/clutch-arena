import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  checkRateLimit,
  checkInMemoryRateLimit,
  setBoundedMapEntry,
  MAX_LOCAL_RATE_ENTRIES,
  MAX_SHARED_DECK_CACHE_ENTRIES,
  MAX_USER_QUOTA_LEDGER_ENTRIES,
  getLocalRateMemoryStoreSize,
  getSharedDeckMemoryCacheSize,
  getFileSha256ToCompositeMapSize,
  getUserQuotaMemoryStoreSize,
  getActorLockMapSize,
  resetQuotaLedgersForTests,
  setSharedDeckCache,
  getSharedDeckCache,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  checkAndReserveDeckQuota,
  rollbackDeckQuotaReservation,
  recordDeckGenerationCogs,
  toUserTier,
  resolveActorKey,
  getClientIp,
} from "@/lib/rate-limit";
import { getRegionalCogsCeiling } from "@/lib/pricing/tiers";
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { createMultiIngestionHandler } from "@/lib/ingestion/multi-handler";
import { createCoachHandler } from "@/lib/coach/handler";
import { studyText } from "../helpers/documents";
import { isAllowedOrigin } from "@/lib/utils";
import * as supabaseServer from "@/lib/supabase/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { questionSchema, studyPackSchema } from "@/lib/schemas/question";
import { normalizeTopicKey } from "@/lib/game/concept-mastery";
import { packToJson } from "@/lib/game/pack-transfer";
import { generateRoomCode } from "@/lib/multiplayer/room-manager";
import { fulfillPayosOrder, clearFulfilledOrderCache } from "@/lib/payments/payos";

describe("Rate Limiting & Server-Side Tier Enforcement", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("enforces tier-aware sliding window limits (2/week for guest/contender, 50/day for paid)", async () => {
    const guestId = `test-guest-${Date.now()}`;

    // Limit is 2 per week for guest / contender
    const res1 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res1.allowed).toBe(true);
    expect(res1.limit).toBe(2);
    expect(res1.remaining).toBe(1);

    const res2 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    // 3rd request must be blocked
    const res3 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
    expect(res3.retryAfter).toBeGreaterThan(0);

    // Paid tier (cram_pass) gets 50 per day
    const paidId = `test-paid-${Date.now()}`;
    const paidRes = await checkRateLimit(paidId, "ingest", "cram_pass");
    expect(paidRes.allowed).toBe(true);
    expect(paidRes.limit).toBe(50);
    expect(paidRes.remaining).toBe(49);
  });

  it("blocks >10 questions on /api/ingest for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: "user-1" },
        tier: "contender",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set(
      "options",
      JSON.stringify({ operation: "generate", questionCount: 20 }),
    );

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("blocks multi-file generation on /api/ingest-multi for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createMultiIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: false,
        user: null,
        tier: "guest",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notes1.txt"));
    form.append("files", new File([studyText], "notes2.txt"));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const req = new Request("http://localhost:3000/api/ingest-multi", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("returns HTTP 429 RATE_LIMIT_EXCEEDED on /api/ingest when quota exhausted", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 2,
      remaining: 0,
      reset: 3600,
      retryAfter: 3600,
    });

    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      rateLimiter: mockLimiter,
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set("options", JSON.stringify({ operation: "generate" }));

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(mockLimiter).toHaveBeenCalled();
  });

  it("returns HTTP 429 on /api/coach when coach rate limit is reached", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 20,
      remaining: 0,
      reset: 600,
      retryAfter: 600,
    });

    const handler = createCoachHandler({
      rateLimiter: mockLimiter,
    });

    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Help me" }] }],
        document: {
          fileName: "notes.txt",
          sources: [{ id: "1", label: "Page 1", text: "Study material" }],
        },
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  describe("SA-09: Per-Actor Quota Mutex & TOCTOU Race Condition Prevention", () => {
    it("strictly allows at most 3 reservations and blocks the 4th+ concurrent checkAndReserveDeckQuota call", async () => {
      const userId = `user-toctou-${Date.now()}`;
      // Set up ledger with explicit limit of 3 and ample COGS ceiling for testing deck credit limits
      const ledger = await getUserQuotaLedger(userId, "contender");
      ledger.deckCreditsLimit = 3;
      ledger.cogsCeilingUsd = 1.0;
      await saveUserQuotaLedger(ledger);

      // Fire 6 concurrent calls at the exact same instant with burstLimit: 3
      const results = await Promise.all([
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-1", { burstLimit: 3 }),
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-2", { burstLimit: 3 }),
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-3", { burstLimit: 3 }),
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-4", { burstLimit: 3 }),
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-5", { burstLimit: 3 }),
        checkAndReserveDeckQuota(userId, "contender", "hash-concurrent-6", { burstLimit: 3 }),
      ]);

      const allowed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);

      expect(allowed.length).toBe(3);
      expect(blocked.length).toBe(3);
      expect(blocked.every((b) => b.reason === "DECK_CREDITS_EXCEEDED" || b.reason === "DAILY_BURST_EXCEEDED")).toBe(true);

      // Check final ledger state: strictly 3 consumed
      const finalLedger = await getUserQuotaLedger(userId, "contender");
      expect(finalLedger.deckCreditsUsed).toBe(3);
      expect(finalLedger.decksGeneratedCount).toBe(3);

      // Check mutex memory cleanup: lock map has drained completely
      expect(getActorLockMapSize()).toBe(0);
    });
  });

  describe("SA-09: rollbackDeckQuotaReservation on Upstream AI Failures", () => {
    it("restores the reserved deck count (clamped at 0) so failed generation does not consume quota", async () => {
      const userId = `user-rollback-${Date.now()}`;
      const contentHash = "hash-failed-ai-gen";

      // 1. Initial reservation
      const reservation = await checkAndReserveDeckQuota(userId, "contender", contentHash);
      expect(reservation.allowed).toBe(true);
      expect(reservation.reserved).toBe(true);
      expect(reservation.creditsUsed).toBe(1);

      const midLedger = await getUserQuotaLedger(userId, "contender");
      expect(midLedger.deckCreditsUsed).toBe(1);
      expect(midLedger.decksGeneratedCount).toBe(1);

      // 2. Upstream AI failure occurs -> trigger rollback
      const rollbackResult = await rollbackDeckQuotaReservation({
        userId,
        tier: "contender",
        contentHash,
      });

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.decksGeneratedCount).toBe(0);
      expect(rollbackResult.ledger.deckCreditsUsed).toBe(0);

      // 3. Clamping test: rolling back again must clamp at 0 and never go negative
      const clampedResult = await rollbackDeckQuotaReservation({
        userId,
        tier: "contender",
      });
      expect(clampedResult.decksGeneratedCount).toBe(0);
      expect(clampedResult.ledger.deckCreditsUsed).toBe(0);

      // 4. User can now reserve again without false quota exhaustion
      const retryReservation = await checkAndReserveDeckQuota(userId, "contender", "hash-retry-success");
      expect(retryReservation.allowed).toBe(true);
      expect(retryReservation.creditsUsed).toBe(1);
    });

    it("SA2-05: prevents infinite deck credit & daily burst refund exploit on regeneration rollback", async () => {
      const userId = `user-regen-exploit-${Date.now()}`;
      const contentHash = "hash-regen-exploit-doc";

      // 1. Initial successful deck generation
      const initialRes = await checkAndReserveDeckQuota(userId, "contender", contentHash);
      expect(initialRes.allowed).toBe(true);
      expect(initialRes.creditConsumed).toBe(true);
      expect(initialRes.isRegeneration).toBe(false);

      // Simulate successful generation recording actual COGS
      await recordDeckGenerationCogs(userId, "contender", 0.02, 0.028);

      const initialLedger = await getUserQuotaLedger(userId, "contender");
      expect(initialLedger.deckCreditsUsed).toBe(1);
      expect(initialLedger.dailyBurstUsed).toBe(1);
      expect(initialLedger.cogsReservedUsd).toBe(0);
      expect(initialLedger.unlockedDecks[contentHash]).toBeDefined();
      expect(initialLedger.unlockedDecks[contentHash].regenerationsUsed).toBe(0);

      // 2. User reserves quota for a regeneration of the same document
      const regenReservation = await checkAndReserveDeckQuota(userId, "contender", contentHash);
      expect(regenReservation.allowed).toBe(true);
      expect(regenReservation.isRegeneration).toBe(true);
      expect(regenReservation.creditConsumed).toBe(false);

      const preRollbackLedger = await getUserQuotaLedger(userId, "contender");
      expect(preRollbackLedger.deckCreditsUsed).toBe(1);
      expect(preRollbackLedger.dailyBurstUsed).toBe(1);
      expect(preRollbackLedger.cogsReservedUsd).toBe(0.01);
      expect(preRollbackLedger.unlockedDecks[contentHash].regenerationsUsed).toBe(1);

      // 3. Upstream AI failure occurs during regeneration -> rollback with isRegeneration: true (object format)
      const rollbackResult = await rollbackDeckQuotaReservation({
        userId,
        tier: "contender",
        contentHash,
        reservedCostUsd: 0.01,
        isRegeneration: true,
      });

      expect(rollbackResult.success).toBe(true);
      // CRITICAL: deckCreditsUsed and dailyBurstUsed MUST NOT be decremented!
      expect(rollbackResult.ledger.deckCreditsUsed).toBe(1);
      expect(rollbackResult.ledger.dailyBurstUsed).toBe(1);
      expect(rollbackResult.decksGeneratedCount).toBe(1);
      // cogsReservedUsd released back to 0
      expect(rollbackResult.ledger.cogsReservedUsd).toBe(0);
      // regenerationsUsed decremented from 1 back to 0
      expect(rollbackResult.ledger.unlockedDecks[contentHash].regenerationsUsed).toBe(0);
      // Document remains unlocked
      expect(rollbackResult.ledger.unlockedDecks[contentHash]).toBeDefined();

      // 4. Test positional argument calling conventions (5-arg and 6-arg):
      // Re-reserve regeneration
      await checkAndReserveDeckQuota(userId, "contender", contentHash);
      const regenMid1 = await getUserQuotaLedger(userId, "contender");
      expect(regenMid1.unlockedDecks[contentHash].regenerationsUsed).toBe(1);
      expect(regenMid1.cogsReservedUsd).toBe(0.01);

      // Rollback via 5 positional args (5th is boolean isRegeneration)
      const pos5Result = await rollbackDeckQuotaReservation(
        userId,
        "contender",
        contentHash,
        0.01,
        true,
      );
      expect(pos5Result.ledger.deckCreditsUsed).toBe(1);
      expect(pos5Result.ledger.dailyBurstUsed).toBe(1);
      expect(pos5Result.ledger.unlockedDecks[contentHash].regenerationsUsed).toBe(0);
      expect(pos5Result.ledger.cogsReservedUsd).toBe(0);

      // Re-reserve regeneration again
      await checkAndReserveDeckQuota(userId, "contender", contentHash);
      const regenMid2 = await getUserQuotaLedger(userId, "contender");
      expect(regenMid2.unlockedDecks[contentHash].regenerationsUsed).toBe(1);

      // Rollback via 6 positional args (5th is region string, 6th is boolean isRegeneration)
      const pos6Result = await rollbackDeckQuotaReservation(
        userId,
        "contender",
        contentHash,
        0.01,
        "VN",
        true,
      );
      expect(pos6Result.ledger.deckCreditsUsed).toBe(1);
      expect(pos6Result.ledger.dailyBurstUsed).toBe(1);
      expect(pos6Result.ledger.unlockedDecks[contentHash].regenerationsUsed).toBe(0);
      expect(pos6Result.ledger.cogsReservedUsd).toBe(0);
    });
  });

  describe("SA-07: Preserve pro_monthly Tier in toUserTier & Quota Limits", () => {
    it("preserves pro_monthly as a distinct tier and receives pro_monthly deck/COGS limits", async () => {
      // 1. toUserTier preservation
      expect(toUserTier("pro_monthly")).toBe("pro_monthly");
      expect(toUserTier("pro-monthly")).toBe("pro_monthly");
      expect(toUserTier("monthly")).toBe("pro_monthly");
      expect(toUserTier("PRO_MONTHLY")).toBe("pro_monthly");

      // 2. Quota ledger limit verification (12 decks, not 2 from contender)
      const userId = `user-promonthly-${Date.now()}`;
      const ledger = await getUserQuotaLedger(userId, "pro_monthly");
      expect(ledger.tier).toBe("pro_monthly");
      expect(ledger.deckCreditsLimit).toBe(12);

      // 3. Regional COGS ceiling verification (1.50 VN, 3.20 ROW)
      const vnCeiling = getRegionalCogsCeiling("pro_monthly", "VN");
      const rowCeiling = getRegionalCogsCeiling("pro_monthly", "ROW");
      expect(vnCeiling).toBe(1.50);
      expect(rowCeiling).toBe(3.20);

      // 4. Rate limiter recognizes pro_monthly as paid
      const rateRes = await checkRateLimit(userId, "ingest", "pro_monthly");
      expect(rateRes.limit).toBe(50); // Paid ingest limit is 50/day, not 2/week
      expect(rateRes.allowed).toBe(true);
    });
  });

  describe("Haiku Overflow Step-Down & DECK_CREDITS_EXCEEDED Boundary Enforcement", () => {
    it("steps down from Sonnet Pro to Haiku overflow when sonnetProDeckCredits are exhausted and blocks on total exhaustion", async () => {
      const userId = `user-haiku-overflow-${Date.now()}`;
      const ledger = await getUserQuotaLedger(userId, "cram_pass");
      // Cram pass: 5 sonnetProDeckCredits, 10 haikuOverflowDeckCredits
      ledger.deckCreditsUsed = 5;
      ledger.dailyBurstUsed = 0;
      await saveUserQuotaLedger(ledger);

      // Without allowHaikuOverflow: true -> immediately blocked
      const noOverflowRes = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-no-overflow", {
        allowHaikuOverflow: false,
      });
      expect(noOverflowRes.allowed).toBe(false);
      expect(noOverflowRes.reason).toBe("DECK_CREDITS_EXCEEDED");

      // With allowHaikuOverflow: true -> step down to Haiku
      const overflowRes = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-haiku-1", {
        allowHaikuOverflow: true,
        burstLimit: 20,
      });
      expect(overflowRes.allowed).toBe(true);
      expect(overflowRes.isHaikuOverflow).toBe(true);
      expect(overflowRes.cogsStatus.useCheaperGeneratorSlug).toBe(true);
      expect(overflowRes.creditsUsed).toBe(6);

      // When sonnetProDeckCredits + haikuOverflowDeckCredits (5 + 10 = 15) are exhausted:
      const exhaustedLedger = await getUserQuotaLedger(userId, "cram_pass");
      exhaustedLedger.deckCreditsUsed = 15;
      exhaustedLedger.dailyBurstUsed = 0;
      await saveUserQuotaLedger(exhaustedLedger);

      const blockedRes = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-haiku-exceeded", {
        allowHaikuOverflow: true,
        burstLimit: 20,
      });
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.reason).toBe("DECK_CREDITS_EXCEEDED");
    });
  });

  describe("SA-15 / SA2-06: Hardened getClientIp Header Trust Order", () => {
    it("prefers platform-verified x-vercel-forwarded-for over spoofed cf-connecting-ip", () => {
      // 1. Vercel header takes strict precedence over cf-connecting-ip (even if accompanied by cf-ray or spoofed)
      const vercelOverCfReq = new Request("http://localhost:3000", {
        headers: {
          "cf-connecting-ip": "103.21.244.2",
          "x-vercel-forwarded-for": "76.76.21.21",
          "x-real-ip": "192.0.2.1",
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        },
      });
      expect(getClientIp(vercelOverCfReq)).toBe("76.76.21.21");

      const vercelOverVerifiedCfReq = new Request("http://localhost:3000", {
        headers: {
          "cf-connecting-ip": "103.21.244.2",
          "cf-ray": "8d1b2c3d4e5f6a7b-SGN",
          "x-vercel-forwarded-for": "76.76.21.21",
        },
      });
      expect(getClientIp(vercelOverVerifiedCfReq)).toBe("76.76.21.21");
    });

    it("trusts cf-connecting-ip when verified with cf-ray or TRUST_CLOUDFLARE_HEADERS", () => {
      // 2. Verified Cloudflare header with cf-ray takes priority over x-real-ip and x-forwarded-for
      const verifiedCfReq = new Request("http://localhost:3000", {
        headers: {
          "cf-connecting-ip": "103.21.244.2",
          "cf-ray": "8d1b2c3d4e5f6a7b-SGN",
          "x-real-ip": "192.0.2.1",
          "x-forwarded-for": "1.2.3.4",
        },
      });
      expect(getClientIp(verifiedCfReq)).toBe("103.21.244.2");

      // Verified via TRUST_CLOUDFLARE_HEADERS === "true"
      const origTrust = process.env.TRUST_CLOUDFLARE_HEADERS;
      try {
        process.env.TRUST_CLOUDFLARE_HEADERS = "true";
        const envVerifiedCfReq = new Request("http://localhost:3000", {
          headers: {
            "cf-connecting-ip": "103.21.244.2",
            "x-real-ip": "192.0.2.1",
          },
        });
        expect(getClientIp(envVerifiedCfReq)).toBe("103.21.244.2");
      } finally {
        process.env.TRUST_CLOUDFLARE_HEADERS = origTrust;
      }
    });

    it("rejects unverified cf-connecting-ip without cf-ray and falls through properly", () => {
      // 3. Unverified cf-connecting-ip falls through to x-real-ip
      const realIpReq = new Request("http://localhost:3000", {
        headers: {
          "cf-connecting-ip": "103.21.244.2",
          "x-real-ip": "192.0.2.1",
          "x-forwarded-for": "1.2.3.4",
        },
      });
      expect(getClientIp(realIpReq)).toBe("192.0.2.1");

      // 4. Unverified cf-connecting-ip falls through to x-forwarded-for
      const xffReq = new Request("http://localhost:3000", {
        headers: {
          "cf-connecting-ip": "103.21.244.2",
          "x-forwarded-for": " 203.0.113.195 , 70.41.3.18 ",
        },
      });
      expect(getClientIp(xffReq)).toBe("203.0.113.195");

      // 5. On Vercel (simulated via x-vercel-id or VERCEL=1), unverified cf-connecting-ip is ignored
      const origVercel = process.env.VERCEL;
      try {
        process.env.VERCEL = "1";
        const vercelSpoofedReq = new Request("http://localhost:3000", {
          headers: {
            "cf-connecting-ip": "103.21.244.2",
          },
        });
        expect(getClientIp(vercelSpoofedReq)).toBe("127.0.0.1");

        const vercelIdSpoofedReq = new Request("http://localhost:3000", {
          headers: {
            "cf-connecting-ip": "103.21.244.2",
            "x-vercel-id": "iad1::iad1::abcd-1234",
          },
        });
        expect(getClientIp(vercelIdSpoofedReq)).toBe("127.0.0.1");
      } finally {
        process.env.VERCEL = origVercel;
      }

      // 6. Default fallback to 127.0.0.1 when no proxy headers exist
      const localReq = new Request("http://localhost:3000");
      expect(getClientIp(localReq)).toBe("127.0.0.1");
    });
  });

  describe("SA-09 / SA-15: Guest IP Ledger and Authenticated User Ledger Isolation", () => {
    it("isolates guest IP ledgers from authenticated user ledgers", async () => {
      const sharedIdentifier = "198.51.100.42";

      // 1. Resolve actor keys demonstrate proper namespacing
      expect(resolveActorKey({ ip: sharedIdentifier })).toBe(`ip:${sharedIdentifier}`);
      expect(resolveActorKey({ userId: sharedIdentifier })).toBe(`user:${sharedIdentifier}`);

      // 2. Guest reservation with IP
      const guestRes = await checkAndReserveDeckQuota(
        { ip: sharedIdentifier },
        "contender",
        "hash-guest-deck",
      );
      expect(guestRes.allowed).toBe(true);

      const guestLedger = await getUserQuotaLedger({ ip: sharedIdentifier }, "contender");
      expect(guestLedger.deckCreditsUsed).toBe(1);

      // 3. Authenticated user with the same raw string identifier must be unmutated (0 used)
      const userLedgerBefore = await getUserQuotaLedger({ userId: sharedIdentifier }, "contender");
      expect(userLedgerBefore.deckCreditsUsed).toBe(0);

      // 4. Authenticated user makes their own reservation
      const userRes = await checkAndReserveDeckQuota(
        { userId: sharedIdentifier },
        "contender",
        "hash-user-deck",
      );
      expect(userRes.allowed).toBe(true);

      const userLedgerAfter = await getUserQuotaLedger({ userId: sharedIdentifier }, "contender");
      expect(userLedgerAfter.deckCreditsUsed).toBe(1);

      // 5. Guest ledger remains 1 and is not overwritten by user operations
      const guestLedgerFinal = await getUserQuotaLedger({ ip: sharedIdentifier }, "contender");
      expect(guestLedgerFinal.deckCreditsUsed).toBe(1);
    });
  });

  describe("Bounded In-Memory Stores & LRU Eviction", () => {
    describe("setBoundedMapEntry helper", () => {
      it("bounds map size and evicts oldest entry in FIFO/LRU order", () => {
        const map = new Map<string, number>();
        const evicted: Array<{ key: string; value: number }> = [];

        setBoundedMapEntry(map, "a", 1, 3, (k, v) => evicted.push({ key: k, value: v }));
        setBoundedMapEntry(map, "b", 2, 3, (k, v) => evicted.push({ key: k, value: v }));
        setBoundedMapEntry(map, "c", 3, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted.length).toBe(0);

        // Re-inserting existing key refreshes its LRU position without eviction
        setBoundedMapEntry(map, "a", 10, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted.length).toBe(0);

        // Inserting 4th item should evict "b" (since "a" was refreshed and "c" was after "b")
        setBoundedMapEntry(map, "d", 4, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted).toEqual([{ key: "b", value: 2 }]);
        expect(Array.from(map.keys())).toEqual(["c", "a", "d"]);
      });
    });

    describe("sharedDeckMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_SHARED_DECK_CACHE_ENTRIES (250) and evicts oldest entries", async () => {
        expect(getSharedDeckMemoryCacheSize()).toBe(0);

        // Insert 260 distinct shared deck entries
        for (let i = 0; i < 260; i++) {
          await setSharedDeckCache({
            contentHash: `hash-${i}`,
            fileSha256: `sha-${i}`,
            language: "en",
            mode: "generate",
            focusHash: "",
            pipelineVersion: "v1",
            questionPool: [{ id: `q-${i}`, text: `Question ${i}` }],
          });
        }

        expect(getSharedDeckMemoryCacheSize()).toBe(MAX_SHARED_DECK_CACHE_ENTRIES);
        expect(getFileSha256ToCompositeMapSize()).toBeLessThanOrEqual(MAX_SHARED_DECK_CACHE_ENTRIES);

        // Oldest entries (0-9) should have been evicted
        const entry0 = await getSharedDeckCache({ contentHash: "hash-0", pipelineVersion: "v1", fileSha256: "sha-0" });
        expect(entry0).toBeNull();
        const entry9 = await getSharedDeckCache({ contentHash: "hash-9", pipelineVersion: "v1", fileSha256: "sha-9" });
        expect(entry9).toBeNull();

        // Newest entry (259) should be present
        const entry259 = await getSharedDeckCache({ contentHash: "hash-259", pipelineVersion: "v1", fileSha256: "sha-259" });
        expect(entry259).not.toBeNull();
        expect(entry259?.contentHash).toBe("hash-259");
      });

      it("preserves recently accessed entry on cache hit while evicting unaccessed older entry", async () => {
        // Insert up to MAX_SHARED_DECK_CACHE_ENTRIES (250)
        for (let i = 0; i < MAX_SHARED_DECK_CACHE_ENTRIES; i++) {
          await setSharedDeckCache({
            contentHash: `item-${i}`,
            fileSha256: `file-sha-${i}`,
            language: "en",
            mode: "generate",
            focusHash: "",
            pipelineVersion: "v1",
            questionPool: [{ id: `q-${i}` }],
          });
        }
        expect(getSharedDeckMemoryCacheSize()).toBe(250);

        // Access item-0 (cache hit refreshes its LRU order)
        const hit0 = await getSharedDeckCache({
          contentHash: "item-0",
          pipelineVersion: "v1",
          fileSha256: "file-sha-0",
        });
        expect(hit0).not.toBeNull();

        // Now insert item-250 (overflowing by 1)
        await setSharedDeckCache({
          contentHash: "item-250",
          fileSha256: "file-sha-250",
          language: "en",
          mode: "generate",
          focusHash: "",
          pipelineVersion: "v1",
          questionPool: [{ id: "q-250" }],
        });

        expect(getSharedDeckMemoryCacheSize()).toBe(250);

        // item-1 was the oldest unaccessed entry, so it should be evicted
        const checkItem1 = await getSharedDeckCache({
          contentHash: "item-1",
          pipelineVersion: "v1",
          fileSha256: "file-sha-1",
        });
        expect(checkItem1).toBeNull();

        // item-0 was accessed right before, so it MUST still be present
        const checkItem0 = await getSharedDeckCache({
          contentHash: "item-0",
          pipelineVersion: "v1",
          fileSha256: "file-sha-0",
        });
        expect(checkItem0).not.toBeNull();
        expect(checkItem0?.contentHash).toBe("item-0");
      });
    });

    describe("userQuotaMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_USER_QUOTA_LEDGER_ENTRIES (1000) and evicts oldest entries", async () => {
        expect(getUserQuotaMemoryStoreSize()).toBe(0);

        // Insert 1020 ledgers
        for (let i = 0; i < 1020; i++) {
          await getUserQuotaLedger(`user-${i}`, "contender");
        }

        expect(getUserQuotaMemoryStoreSize()).toBe(MAX_USER_QUOTA_LEDGER_ENTRIES);

        // Verify with saveUserQuotaLedger that updating refreshes LRU:
        resetQuotaLedgersForTests();
        for (let i = 0; i < 1000; i++) {
          await saveUserQuotaLedger({
            userId: `u-${i}`,
            tier: "contender",
            cogsSpentUsd: i * 0.001,
            cogsReservedUsd: 0,
            cogsCeilingUsd: 0.05,
            deckCreditsUsed: 1,
            deckCreditsLimit: 2,
            dailyBurstUsed: 1,
            dailyBurstDate: "2026-10-31",
            unlockedDecks: {},
          });
        }
        expect(getUserQuotaMemoryStoreSize()).toBe(1000);

        // Update u-0 (refreshing LRU)
        const u0 = await getUserQuotaLedger("u-0", "contender");
        u0.deckCreditsUsed = 2;
        await saveUserQuotaLedger(u0);

        // Insert u-1000 (overflows by 1)
        await saveUserQuotaLedger({
          userId: "u-1000",
          tier: "contender",
          cogsSpentUsd: 0,
          cogsReservedUsd: 0,
          cogsCeilingUsd: 0.05,
          deckCreditsUsed: 0,
          deckCreditsLimit: 2,
          dailyBurstUsed: 0,
          dailyBurstDate: "2026-10-31",
          unlockedDecks: {},
        });

        expect(getUserQuotaMemoryStoreSize()).toBe(1000);

        // u-1 should be evicted (cogsSpentUsd would reset to 0 in a fresh ledger)
        const ledger1 = await getUserQuotaLedger("u-1", "contender");
        expect(ledger1.cogsSpentUsd).toBe(0);

        // u-0 was refreshed and should retain modified deckCreditsUsed: 2
        const ledger0 = await getUserQuotaLedger("u-0", "contender");
        expect(ledger0.deckCreditsUsed).toBe(2);
      });
    });

    describe("localMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_LOCAL_RATE_ENTRIES (2000) and evicts oldest entries", () => {
        expect(getLocalRateMemoryStoreSize()).toBe(0);

        // Insert 2050 distinct rate limit records
        for (let i = 0; i < 2050; i++) {
          checkInMemoryRateLimit(`ip-${i}`, 10, 60000);
        }

        expect(getLocalRateMemoryStoreSize()).toBe(MAX_LOCAL_RATE_ENTRIES);

        // Test LRU refresh:
        resetQuotaLedgersForTests();
        for (let i = 0; i < 2000; i++) {
          checkInMemoryRateLimit(`client-${i}`, 5, 60000);
        }
        expect(getLocalRateMemoryStoreSize()).toBe(2000);

        // Access client-0 again to consume a 2nd hit and refresh LRU
        const touch0 = checkInMemoryRateLimit("client-0", 5, 60000);
        expect(touch0.remaining).toBe(3); // 5 - 2 = 3

        // Insert client-2000 (overflowing by 1)
        checkInMemoryRateLimit("client-2000", 5, 60000);
        expect(getLocalRateMemoryStoreSize()).toBe(2000);

        // client-1 was the oldest unaccessed entry, so it should be evicted. Next hit starts fresh with remaining 4
        const hitClient1 = checkInMemoryRateLimit("client-1", 5, 60000);
        expect(hitClient1.remaining).toBe(4);

        // client-0 was refreshed and had remaining 3. Next hit should give remaining 2!
        const hitClient0 = checkInMemoryRateLimit("client-0", 5, 60000);
        expect(hitClient0.remaining).toBe(2);
      });
    });
  });

  describe("NV2-01 & NV2-02: Origin Validation & Supabase Production Warning", () => {
    it("isAllowedOrigin rejects requests with sec-fetch-site: cross-site", () => {
      const req = new Request("http://localhost:3000/api/test", {
        headers: {
          "sec-fetch-site": "cross-site",
        },
      });
      expect(isAllowedOrigin("http://evil.com", req)).toBe(false);
      expect(isAllowedOrigin("http://localhost:3000", req)).toBe(false);
      expect(isAllowedOrigin(null, req)).toBe(false);
    });

    it("isAllowedOrigin permits valid same-origin or local dev requests", () => {
      const req = new Request("http://localhost:3000/api/test", {
        headers: {
          "sec-fetch-site": "same-origin",
        },
      });
      expect(isAllowedOrigin("http://localhost:3000", req)).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:3000", req)).toBe(true);
    });

    it("getSupabaseServerClient issues a production warning when NODE_ENV === 'production' and SUPABASE_SERVICE_ROLE_KEY is missing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const origNodeEnv = process.env.NODE_ENV;
      const origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      try {
        (process.env as any).NODE_ENV = "production";
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

        getSupabaseServerClient();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("[Supabase] Production Warning: SUPABASE_SERVICE_ROLE_KEY is missing")
        );
      } finally {
        (process.env as any).NODE_ENV = origNodeEnv;
        if (origServiceKey) {
          process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
        } else {
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        }
        if (origUrl) {
          process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
        } else {
          delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        }
        warnSpy.mockRestore();
      }
    });
  });

  describe("Task 5.4 - SA2-24: Prototype Pollution Guard, Secure PRNG & Quota Ledger Reset", () => {
    describe("Prototype pollution guards in question schemas & concept mastery", () => {
      it("rejects prototype pollution keys ('__proto__', 'constructor', 'prototype') on questionSchema.id", () => {
        const baseQuestion = {
          question: "What is inflation?",
          options: ["A", "B", "C", "D"] as [string, string, string, string],
          correctIndex: 0,
          explanation: "Expansion of money supply",
          conceptVariant: {
            question: "What is inflation?",
            options: ["A", "B", "C", "D"] as [string, string, string, string],
            correctIndex: 0,
            explanation: "Expansion of money supply",
          },
        };

        const protoRes = questionSchema.safeParse({ ...baseQuestion, id: "__proto__" });
        expect(protoRes.success).toBe(false);

        const ctorRes = questionSchema.safeParse({ ...baseQuestion, id: "constructor" });
        expect(ctorRes.success).toBe(false);

        const protoTypeRes = questionSchema.safeParse({ ...baseQuestion, id: "prototype" });
        expect(protoTypeRes.success).toBe(false);

        const validRes = questionSchema.safeParse({ ...baseQuestion, id: "q-1" });
        expect(validRes.success).toBe(true);
      });

      it("rejects prototype pollution keys in studyPackSchema metadata and pack id", () => {
        const validQuestion = {
          id: "q-1",
          question: "What is inflation?",
          options: ["A", "B", "C", "D"] as [string, string, string, string],
          correctIndex: 0,
          explanation: "Expansion of money supply",
          conceptVariant: {
            question: "What is inflation?",
            options: ["A", "B", "C", "D"] as [string, string, string, string],
            correctIndex: 0,
            explanation: "Expansion of money supply",
          },
        };

        const badPackId = studyPackSchema.safeParse({
          id: "__proto__",
          title: "Test Pack",
          questions: [validQuestion],
          metadata: {},
        });
        expect(badPackId.success).toBe(false);

        // Metadata with constructor key
        const badMetaCtor = studyPackSchema.safeParse({
          id: "pack-1",
          title: "Test Pack",
          questions: [validQuestion],
          metadata: {
            constructor: { topic: "malicious" },
          },
        });
        expect(badMetaCtor.success).toBe(false);

        // Metadata with __proto__ key parsed from JSON
        const badMetaProto = studyPackSchema.safeParse({
          id: "pack-1",
          title: "Test Pack",
          questions: [validQuestion],
          metadata: JSON.parse('{"__proto__": {"topic": "malicious"}}'),
        });
        expect(badMetaProto.success).toBe(false);

        // Metadata with prototype key
        const badMetaProtoType = studyPackSchema.safeParse({
          id: "pack-1",
          title: "Test Pack",
          questions: [validQuestion],
          metadata: {
            prototype: { topic: "malicious" },
          },
        });
        expect(badMetaProtoType.success).toBe(false);
      });

      it("normalizeTopicKey rejects '__proto__', 'constructor', 'prototype' and normalizes valid topics", () => {
        expect(() => normalizeTopicKey("__proto__")).toThrow(/prototype pollution/i);
        expect(() => normalizeTopicKey("constructor")).toThrow(/prototype pollution/i);
        expect(() => normalizeTopicKey("prototype")).toThrow(/prototype pollution/i);
        expect(() => normalizeTopicKey("  __PROTO__  ")).toThrow(/prototype pollution/i);

        expect(normalizeTopicKey("Microeconomics")).toBe("microeconomics");
        expect(normalizeTopicKey("  Fiscal Policy  ")).toBe("fiscal policy");
      });

      it("packToJson does not copy prototype pollution keys onto export objects or metadata", () => {
        const validQuestion = {
          id: "q-1",
          question: "What is inflation?",
          options: ["A", "B", "C", "D"] as [string, string, string, string],
          correctIndex: 0,
          explanation: "Expansion of money supply",
          conceptVariant: {
            question: "What is inflation?",
            options: ["A", "B", "C", "D"] as [string, string, string, string],
            correctIndex: 0,
            explanation: "Expansion of money supply",
          },
        };

        const pack: any = {
          id: "pack-test",
          title: "Test Pack",
          subtitle: "Subtitle",
          questions: [validQuestion],
          metadata: {
            "q-1": { topic: "Money", chapter: "Ch 1", citation: "Source", rule: "Rule" },
            constructor: { topic: "malicious" },
          },
          __proto__: { polluted: true },
        };

        const jsonStr = packToJson(pack);
        const parsed = JSON.parse(jsonStr);

        expect(Object.prototype.hasOwnProperty.call(parsed.pack.metadata, "constructor")).toBe(false);
        expect(Object.keys(parsed.pack.metadata)).not.toContain("constructor");
        expect(Object.keys(parsed.pack.metadata)).not.toContain("__proto__");
        expect(Object.keys(parsed.pack.metadata)).not.toContain("prototype");
        expect(Object.prototype.hasOwnProperty.call(parsed.pack, "constructor")).toBe(false);
        expect(Object.keys(parsed.pack)).not.toContain("__proto__");
        expect(jsonStr).not.toContain('"constructor"');
        expect(jsonStr).not.toContain('"polluted"');
        expect(parsed.pack.metadata["q-1"]).toBeDefined();
        expect(parsed.pack.id).toBe("pack-test");
      });
    });

    describe("Secure PRNG Room Code Generation", () => {
      it("generateRoomCode produces valid 6-character room codes matching ^[A-Z0-9]{6}$", () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const charSet = new Set(chars);
        const codes = new Set<string>();

        for (let i = 0; i < 50; i++) {
          const code = generateRoomCode();
          expect(code).toHaveLength(6);
          expect(code).toMatch(/^[A-Z0-9]{6}$/);

          for (const ch of code) {
            expect(charSet.has(ch)).toBe(true);
          }
          codes.add(code);
        }

        // Must generate diverse codes across 50 iterations
        expect(codes.size).toBeGreaterThan(45);
      });
    });

    describe("Quota Ledger Reset on Subscription Fulfillment", () => {
      it("fulfillPayosOrder resets deck_credits_used, cogs_spent_usd, daily_burst_used to 0 and updates tier", async () => {
        clearFulfilledOrderCache();

        let upsertedQuotaData: Record<string, unknown> | null = null;

        const mockClient = {
          from: (table: string) => {
            if (table === "user_subscriptions") {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "payos_17300000000002",
                        user_id: "user-renew-1",
                        tier: "pro",
                        amount: 299000,
                        status: "pending",
                        expires_at: null,
                      },
                    }),
                  }),
                }),
                upsert: async () => ({ error: null }),
              };
            }
            if (table === "user_quota_ledgers") {
              return {
                upsert: async (payload: any) => {
                  upsertedQuotaData = payload;
                  return { error: null };
                },
              };
            }
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
              upsert: async () => ({ error: null }),
              update: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          },
          auth: {
            getUser: async () => ({
              data: { user: { id: "user-renew-1", email: "student@test.com" } },
              error: null,
            }),
            admin: {
              getUserById: async () => ({ data: null, error: null }),
              updateUserById: async () => ({ error: null }),
            },
          },
        };

        const serverSpy = vi
          .spyOn(supabaseServer, "getSupabaseServerClient")
          .mockReturnValue(mockClient as any);

        try {
          const res = await fulfillPayosOrder({
            orderCode: 17300000000002, // Ends in 2 -> "pro"
            amount: 299000,
            fallbackUserId: "user-renew-1",
            userToken: "valid-token",
          });

          expect(res.fulfilled).toBe(true);
          expect(res.userId).toBe("user-renew-1");
          expect(res.tier).toBe("pro");

          // Verify quota ledger was reset to 0
          expect(upsertedQuotaData).not.toBeNull();
          expect(upsertedQuotaData).toEqual(
            expect.objectContaining({
              user_id: "user:user-renew-1",
              tier: "pro",
              deck_credits_used: 0,
              cogs_spent_usd: 0,
              daily_burst_used: 0,
              updated_at: expect.any(String),
            }),
          );
        } finally {
          serverSpy.mockRestore();
        }
      });
    });
  });
});
