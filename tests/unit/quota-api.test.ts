import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

let mockServerSupabase: any = null;
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseServerConfigured: () => Boolean(mockServerSupabase),
  getSupabaseServerClient: () => mockServerSupabase,
}));

import { GET } from "@/app/api/quota/route";
import {
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
  getRollingQuotaSnapshot,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  setSharedDeckCache,
  toClientQuota,
  resetQuotaLedgersForTests,
} from "@/lib/rate-limit";

function createMockServerSupabase(options: {
  userId?: string;
  tier?: string;
  tierExpiresAt?: string | null;
}) {
  const userId = options.userId ?? "user-quota-1";
  const tier = options.tier ?? "contender";
  const tierExpiresAt = options.tierExpiresAt ?? null;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
            email: "student@clutcharena.com",
            app_metadata: {},
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      let rowData: any = null;
      if (table === "profiles") {
        rowData =
          tier !== "contender"
            ? { tier, tier_expires_at: tierExpiresAt, updated_at: new Date().toISOString() }
            : { tier: "contender", tier_expires_at: null, updated_at: new Date().toISOString() };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: rowData, error: null }),
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
}

function assertNoRawUsdExposure(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/\$|usd|cogs|windowBudget|windowRemaining|guardBudget|guardRemaining|cycleCeiling|cycleRemaining|effectiveRemaining|spentUsd|reservedUsd|ceilingUsd/i);
}

describe("GET /api/quota & Core Rolling % Credit Quota Behavior", () => {
  const BASE_NOW = 1775000000000;

  beforeEach(() => {
    resetQuotaLedgersForTests();
    mockServerSupabase = null;
    vi.clearAllMocks();
  });

  describe("GET /api/quota endpoint", () => {
    it("rejects cross-site origin requests with 403 ORIGIN_NOT_ALLOWED", async () => {
      const req = new Request("http://localhost:3000/api/quota", {
        method: "GET",
        headers: {
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ORIGIN_NOT_ALLOWED");
    });

    it("returns 72h rolling quota & contender limits for unauthenticated guests without exposing raw USD", async () => {
      const guestIp = "198.51.100.88";
      const req = new Request("http://localhost:3000/api/quota", {
        method: "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-vercel-forwarded-for": guestIp,
          "x-vercel-ip-country": "VN",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const json = await res.json();
      expect(json).toEqual({
        ok: true,
        authenticated: false,
        tier: "contender",
        quota: {
          remainingPct: 100,
          usedPct: 0,
          resetsAt: expect.any(String),
          windowHours: 72,
          bottleneckScope: "window",
          mode: "full",
        },
        limits: {
          canUseNotes: true,
          canExportPdf: false,
          maxQuestionsPerRun: 10,
          maxFilesPerUpload: 1,
          freeRegenerationsPerDeck: 1,
        },
      });
      assertNoRawUsdExposure(json);
    });

    it("returns 24h rolling quota & tier limits for authenticated paid tiers (cram_pass, pro_monthly, pro, tutor)", async () => {
      const futureExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      for (const [tier, expectedRegens] of [
        ["cram_pass", 3],
        ["pro_monthly", 5],
        ["pro", 5],
        ["tutor", 5],
      ] as const) {
        mockServerSupabase = createMockServerSupabase({
          userId: `paid-${tier}`,
          tier,
          tierExpiresAt: futureExp,
        });

        const req = new Request("http://localhost:3000/api/quota", {
          method: "GET",
          headers: {
            origin: "http://localhost:3000",
            authorization: "Bearer valid-paid-token",
            "x-vercel-ip-country": "ROW",
          },
        });

        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.authenticated).toBe(true);
        expect(json.tier).toBe(tier);
        expect(json.quota.windowHours).toBe(24);
        expect(json.quota.remainingPct).toBe(100);
        expect(json.quota.usedPct).toBe(0);
        expect(json.limits).toEqual({
          canUseNotes: true,
          canExportPdf: true,
          maxQuestionsPerRun: 30,
          maxFilesPerUpload: tier === "cram_pass" ? 5 : 10,
          freeRegenerationsPerDeck: expectedRegens,
        });
        assertNoRawUsdExposure(json);
      }
    });

    it("reflects shared pool depletion across Deck, Notes, Vision OCR, and Coach in GET /api/quota", async () => {
      const userId = "shared-api-user";
      const futureExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      mockServerSupabase = createMockServerSupabase({
        userId,
        tier: "pro_monthly",
        tierExpiresAt: futureExp,
      });

      // Spend across Deck ($0.098), Notes ($0.020), OCR ($0.010), Coach ($0.012) = $0.140 of $0.280 VN 24h budget (50%)
      await checkAndReserveDeckQuota({ userId }, "pro_monthly", "deck-a", {
        actionKind: "deck",
        estimatedCostUsd: 0.098,
        region: "VN",
      });
      await recordDeckGenerationCogs({ userId }, "pro_monthly", 0.098, 0.098, "VN");

      await checkAndReserveDeckQuota({ userId }, "pro_monthly", "notes-a", {
        actionKind: "notes",
        estimatedCostUsd: 0.02,
        region: "VN",
      });
      await recordDeckGenerationCogs({ userId }, "pro_monthly", 0.02, 0.02, "VN");

      await checkAndReserveDeckQuota({ userId }, "pro_monthly", "ocr-a", {
        actionKind: "ocr",
        estimatedCostUsd: 0.01,
        region: "VN",
      });
      await recordDeckGenerationCogs({ userId }, "pro_monthly", 0.01, 0.01, "VN");

      await checkAndReserveDeckQuota({ userId }, "pro_monthly", "coach-a", {
        actionKind: "coach",
        estimatedCostUsd: 0.012,
        region: "VN",
      });
      await recordDeckGenerationCogs({ userId }, "pro_monthly", 0.012, 0.012, "VN");

      const req = new Request("http://localhost:3000/api/quota", {
        method: "GET",
        headers: {
          origin: "http://localhost:3000",
          authorization: "Bearer token-shared-user",
          "x-vercel-ip-country": "VN",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.quota.remainingPct).toBe(50);
      expect(json.quota.usedPct).toBe(50);
      expect(json.quota.windowHours).toBe(24);
      expect(json.quota.bottleneckScope).toBe("window");
      expect(json.quota.mode).toBe("full");
      assertNoRawUsdExposure(json);
    });
  });

  describe("24h/7d paid vs 72h/30d free rollover", () => {
    it("rolls over paid 24h window independently of 7d (168h) weekly guard and cycle ceiling", async () => {
      const userId = "rollover-paid-pro";
      // pro VN: 24h = $0.40, 7d = $0.85, cycle = $3.80
      await checkAndReserveDeckQuota(userId, "pro", "d1", {
        estimatedCostUsd: 0.40,
        region: "VN",
        nowMs: BASE_NOW,
      });
      await recordDeckGenerationCogs(userId, "pro", 0.40, 0.40, "VN", BASE_NOW);

      const at0h = await getRollingQuotaSnapshot(userId, "pro", "VN", BASE_NOW + 1000);
      expect(at0h.remainingPct).toBe(0);
      expect(at0h.mode).toBe("halted");

      // After 24h: 24h window resets ($0.40 remaining), 7d guard has $0.45 left ($0.85 - $0.40)
      const at24h = await getRollingQuotaSnapshot(userId, "pro", "VN", BASE_NOW + 24 * 3_600_000 + 1000);
      expect(at24h.windowRemainingUsd).toBe(0.40);
      expect(at24h.guardRemainingUsd).toBe(0.45);
      expect(at24h.remainingPct).toBe(53); // 0.45 / 0.85 = 52.94% -> 53%
      expect(at24h.bottleneckScope).toBe("weekly");
      expect(at24h.windowHours).toBe(168);

      // Spend another $0.40 on day 2
      await checkAndReserveDeckQuota(userId, "pro", "d2", {
        estimatedCostUsd: 0.40,
        region: "VN",
        nowMs: BASE_NOW + 24 * 3_600_000 + 2000,
      });
      await recordDeckGenerationCogs(userId, "pro", 0.40, 0.40, "VN", BASE_NOW + 24 * 3_600_000 + 2000);

      // On day 3 (48h): 24h window resets, but weekly guard only has $0.05 left out of $0.85 (~6%)
      const at48h = await getRollingQuotaSnapshot(userId, "pro", "VN", BASE_NOW + 48 * 3_600_000 + 3000);
      expect(at48h.guardRemainingUsd).toBe(0.05);
      expect(at48h.remainingPct).toBe(6);
      expect(at48h.bottleneckScope).toBe("weekly");

      // After 168h (7d): weekly guard rolls over, cycle ceiling ($3.00 / $3.80 = 79%) is tightest scope
      const at7d = await getRollingQuotaSnapshot(userId, "pro", "VN", BASE_NOW + 168 * 3_600_000 + 5000);
      expect(at7d.windowRemainingUsd).toBe(0.40);
      expect(at7d.guardRemainingUsd).toBe(0.85);
      expect(at7d.cycleRemainingUsd).toBe(3.0);
      expect(at7d.bottleneckScope).toBe("cycle");
      expect(at7d.remainingPct).toBe(79);
    });

    it("rolls over free 72h window while capping 30d (720h) anti-abuse guard at $0.32", async () => {
      const userId = "rollover-free-contender";
      // Free contender: 72h = $0.08, 720h = $0.32
      await checkAndReserveDeckQuota(userId, "contender", "free-d1", {
        estimatedCostUsd: 0.08,
        nowMs: BASE_NOW,
      });
      await recordDeckGenerationCogs(userId, "contender", 0.08, 0.08, "VN", BASE_NOW);

      // Before 72h: 0% remaining
      const before72h = await getRollingQuotaSnapshot(userId, "contender", "VN", BASE_NOW + 71 * 3_600_000);
      expect(before72h.remainingPct).toBe(0);

      // At 72h: primary window resets ($0.08), 30d guard has $0.24 / $0.32 = 75% remaining
      const at72h = await getRollingQuotaSnapshot(userId, "contender", "VN", BASE_NOW + 72 * 3_600_000 + 1000);
      expect(at72h.windowRemainingUsd).toBe(0.08);
      expect(at72h.guardRemainingUsd).toBe(0.24);
      expect(at72h.bottleneckScope).toBe("weekly");
      expect(at72h.windowHours).toBe(720);
      expect(at72h.remainingPct).toBe(75);
    });
  });

  describe("0% shared cache hits", () => {
    it("serves shared_deck_cache hits at 0% quota cost even when user is at 0% remaining", async () => {
      const contentHash = "shared-zero-pct-hash";
      const pipelineVersion = "3.0.0-final+haiku+deepseek";

      await setSharedDeckCache({
        contentHash,
        language: "en",
        mode: "generate",
        focusHash: "",
        pipelineVersion,
        questionPool: [{ id: "q1", question: "Cached Question" }],
        clutchNote: { title: "Cached Note", sections: [] },
      });

      // Exhaust contender user completely (0% remaining)
      const userId = "exhausted-cache-user";
      const ledger = await getUserQuotaLedger(userId, "contender", "VN", BASE_NOW);
      ledger.windowSpentUsd = 0.08;
      ledger.weeklySpentUsd = 0.08;
      ledger.cogsSpentUsd = 0.08;
      await saveUserQuotaLedger(ledger);

      const preSnap = await getRollingQuotaSnapshot(userId, "contender", "VN", BASE_NOW);
      expect(preSnap.remainingPct).toBe(0);
      expect(preSnap.mode).toBe("halted");

      // Deck cache hit succeeds with 0% / $0 cost
      const deckCacheRes = await checkAndReserveDeckQuota(userId, "contender", contentHash, {
        actionKind: "deck",
        pipelineVersion,
        nowMs: BASE_NOW,
      });
      expect(deckCacheRes.allowed).toBe(true);
      expect(deckCacheRes.cacheHit).toBe(true);
      expect(deckCacheRes.reserved).toBe(false);
      expect(deckCacheRes.reservedCostUsd).toBe(0);
      expect(deckCacheRes.quota.remainingPct).toBe(0);

      // Notes cache hit succeeds with 0% / $0 cost
      const notesCacheRes = await checkAndReserveDeckQuota(userId, "contender", contentHash, {
        actionKind: "notes",
        pipelineVersion,
        nowMs: BASE_NOW,
      });
      expect(notesCacheRes.allowed).toBe(true);
      expect(notesCacheRes.cacheHit).toBe(true);
      expect(notesCacheRes.reservedCostUsd).toBe(0);
    });
  });

  describe("Eco-mode <=30% step-down", () => {
    it("steps down paid tier to Eco Haiku at <=30% remaining and exposes gentle/hard mode in client quota", async () => {
      const userId = "eco-api-user";
      const futureExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      mockServerSupabase = createMockServerSupabase({
        userId,
        tier: "pro",
        tierExpiresAt: futureExp,
      });

      // pro VN 24h budget = $0.40; spend $0.28 -> $0.12 left (30% remaining)
      const ledger = await getUserQuotaLedger({ userId }, "pro", "VN");
      ledger.windowSpentUsd = 0.28;
      ledger.weeklySpentUsd = 0.28;
      ledger.cogsSpentUsd = 0.28;
      await saveUserQuotaLedger(ledger);

      const quotaRes = await GET(
        new Request("http://localhost:3000/api/quota", {
          method: "GET",
          headers: {
            origin: "http://localhost:3000",
            authorization: "Bearer eco-token",
            "x-vercel-ip-country": "VN",
          },
        }),
      );
      const quotaJson = await quotaRes.json();
      expect(quotaJson.quota.remainingPct).toBe(30);
      expect(quotaJson.quota.usedPct).toBe(70);
      expect(quotaJson.quota.mode).toBe("gentle");
      assertNoRawUsdExposure(quotaJson);

      const reservation = await checkAndReserveDeckQuota({ userId }, "pro", "eco-deck-hash", {
        region: "VN",
      });
      expect(reservation.allowed).toBe(true);
      expect(reservation.isHaikuOverflow).toBe(true);
      expect(reservation.cogsStatus.useCheaperGeneratorSlug).toBe(true);
      expect(reservation.reservedCostUsd).toBe(0.028);
    });
  });

  describe("Rollback & freeRegenerationsPerDeck", () => {
    it("restores remainingPct and releases reservations on rollback across deck, notes, coach, and regenerations", async () => {
      const userId = "rollback-api-user";
      const futureExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      mockServerSupabase = createMockServerSupabase({
        userId,
        tier: "cram_pass",
        tierExpiresAt: futureExp,
      });

      // Reserve a deck ($0.098 of $0.35 -> 72% remaining)
      const deckRes = await checkAndReserveDeckQuota({ userId }, "cram_pass", "rb-deck-1", {
        actionKind: "deck",
        region: "VN",
      });
      expect(deckRes.allowed).toBe(true);
      expect(deckRes.quota.remainingPct).toBe(72);

      // Rollback deck reservation -> restores 100%
      await rollbackDeckQuotaReservation({
        userId,
        tier: "cram_pass",
        contentHash: "rb-deck-1",
        reservedCostUsd: deckRes.reservedCostUsd,
        region: "VN",
        actionKind: "deck",
      });

      const afterDeckRb = await getRollingQuotaSnapshot({ userId }, "cram_pass", "VN");
      expect(afterDeckRb.remainingPct).toBe(100);
      expect(afterDeckRb.windowRemainingUsd).toBe(0.35);

      // Reserve notes & coach, then roll back both
      const notesRes = await checkAndReserveDeckQuota({ userId }, "cram_pass", "rb-notes-1", {
        actionKind: "notes",
        region: "VN",
      });
      const coachRes = await checkAndReserveDeckQuota({ userId }, "cram_pass", "rb-coach-1", {
        actionKind: "coach",
        region: "VN",
      });
      expect(coachRes.quota.remainingPct).toBeLessThan(100);

      await rollbackDeckQuotaReservation({
        userId,
        tier: "cram_pass",
        reservedCostUsd: notesRes.reservedCostUsd,
        region: "VN",
        actionKind: "notes",
      });
      await rollbackDeckQuotaReservation({
        userId,
        tier: "cram_pass",
        reservedCostUsd: coachRes.reservedCostUsd,
        region: "VN",
        actionKind: "coach",
      });

      const res = await GET(
        new Request("http://localhost:3000/api/quota", {
          method: "GET",
          headers: {
            origin: "http://localhost:3000",
            authorization: "Bearer rb-token",
            "x-vercel-ip-country": "VN",
          },
        }),
      );
      const json = await res.json();
      expect(json.quota.remainingPct).toBe(100);
      expect(json.quota.usedPct).toBe(0);
      assertNoRawUsdExposure(json);
    });

    it("enforces freeRegenerationsPerDeck (1 for contender, 3 for cram_pass) and rolls back failed regen slots", async () => {
      const contenderId = "regen-contender";
      const deckHash = "regen-deck-contender";

      const init = await checkAndReserveDeckQuota(contenderId, "contender", deckHash);
      expect(init.allowed).toBe(true);
      expect(init.isRegeneration).toBe(false);

      // 1st regeneration allowed
      const regen1 = await checkAndReserveDeckQuota(contenderId, "contender", deckHash);
      expect(regen1.allowed).toBe(true);
      expect(regen1.isRegeneration).toBe(true);

      // 2nd regeneration blocked
      const regen2 = await checkAndReserveDeckQuota(contenderId, "contender", deckHash);
      expect(regen2.allowed).toBe(false);
      expect(regen2.reason).toBe("REGENERATION_LIMIT_EXCEEDED");

      // Rolling back regen1 restores the 1 free regeneration slot without losing deck unlock
      await rollbackDeckQuotaReservation({
        userId: contenderId,
        tier: "contender",
        contentHash: deckHash,
        reservedCostUsd: regen1.reservedCostUsd,
        isRegeneration: true,
        actionKind: "deck",
      });

      const regenRetry = await checkAndReserveDeckQuota(contenderId, "contender", deckHash);
      expect(regenRetry.allowed).toBe(true);
      expect(regenRetry.isRegeneration).toBe(true);
      expect(toClientQuota(regenRetry.quota)).not.toHaveProperty("windowBudgetUsd");
    });
  });
});
